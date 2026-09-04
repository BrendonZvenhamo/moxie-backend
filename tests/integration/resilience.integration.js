'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Pool } = require('pg');

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
if (!INTEGRATION_DATABASE_URL) {
  throw new Error('INTEGRATION_DATABASE_URL is required. This suite is destructive and refuses to use DATABASE_URL directly.');
}
// All application modules, including the shared service pool, must point at
// the disposable integration database before they are imported.
process.env.DATABASE_URL = INTEGRATION_DATABASE_URL;

const { runMigrations } = require('../../dist/infrastructure/database/migrations');
const { UserService } = require('../../dist/core/services/user');
const { MatchmakingService } = require('../../dist/core/services/matchmaker');
const { ingestWebhookEvent, claimWebhookEvent, markWebhookProcessed } = require('../../dist/infrastructure/database/webhook-events');
const { processOneOutboxMessage } = require('../../dist/infrastructure/database/outbox-worker');
const { runMaintenanceOnce } = require('../../dist/core/services/maintenance');
const { Platform, UserStatus } = require('../../dist/types/models');

const DATABASE_URL = INTEGRATION_DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL });
const userService = new UserService();
const matchmaker = new MatchmakingService(userService);

async function sql(text, params) {
  return pool.query(text, params);
}

async function resetDatabase() {
  // Integration tests are destructive. The README instructs users to point
  // DATABASE_URL at a disposable database/container.
  await sql(`
    TRUNCATE TABLE
      outbox_messages,
      webhook_events,
      match_messages,
      contacts,
      blocked_users,
      reports,
      feedbacks,
      matches,
      users
    RESTART IDENTITY CASCADE
  `);
}

async function createUser(externalId, overrides = {}) {
  const defaults = {
    username: externalId,
    platform: 'whatsapp',
    status: 'idle',
    onboarding_step: 'completed',
    purpose: 'both',
    gender: 'other',
    pref_gender: 'both',
    age: 25,
    pref_age_min: 18,
    pref_age_max: 99,
    interests: ['technology'],
    normalized_interests: ['technology_cluster'],
    trust_score: 100,
    is_ready: false,
    is_banned: false,
    last_activity_at: new Date(),
  };
  const values = { ...defaults, ...overrides };
  const result = await sql(`
    INSERT INTO users (
      external_id, platform, username, status, onboarding_step, purpose,
      gender, pref_gender, age, pref_age_min, pref_age_max,
      interests, normalized_interests, trust_score, is_ready, is_banned,
      last_activity_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING *
  `, [
    values.external_id || externalId,
    values.platform,
    values.username,
    values.status,
    values.onboarding_step,
    values.purpose,
    values.gender,
    values.pref_gender,
    values.age,
    values.pref_age_min,
    values.pref_age_max,
    values.interests,
    values.normalized_interests,
    values.trust_score,
    values.is_ready,
    values.is_banned,
    values.last_activity_at,
  ]);
  return result.rows[0];
}

async function testWebhookDedup() {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [{ id: 'integration-event-1001', from: '10001', type: 'text', text: { body: 'hello' } }] } }] }],
  };

  const results = await Promise.all(
    Array.from({ length: 5 }, () => ingestWebhookEvent(Platform.WHATSAPP, 'integration-event-1001', payload))
  );

  assert.equal(results.filter(r => r === 'inserted').length, 1);
  assert.equal(results.filter(r => r === 'duplicate').length, 4);

  const count = await sql(
    `SELECT count(*)::int AS count FROM webhook_events WHERE platform = 'whatsapp' AND external_event_id = 'integration-event-1001'`
  );
  assert.equal(count.rows[0].count, 1);

  const claims = await Promise.all(Array.from({ length: 5 }, () => claimWebhookEvent(30)));
  assert.equal(claims.filter(Boolean).length, 1, 'exactly one worker may claim the durable event');
  if (claims[0]) await markWebhookProcessed(claims[0].id);
  else await markWebhookProcessed(claims.find(Boolean).id);

  const processed = await sql(
    `SELECT status, attempts FROM webhook_events WHERE platform = 'whatsapp' AND external_event_id = 'integration-event-1001'`
  );
  assert.equal(processed.rows[0].status, 'processed');
  assert.equal(processed.rows[0].attempts, 1);
}

async function testConcurrentRewards() {
  const user = await createUser('reward-user');
  const before = user.trust_score;

  const results = await Promise.all(
    Array.from({ length: 20 }, () => userService.claimDailyReward(user.id))
  );

  assert.equal(results.filter(Boolean).length, 1, 'exactly one reward claim must succeed');

  const row = await sql('SELECT trust_score FROM users WHERE id = $1', [user.id]);
  assert.equal(row.rows[0].trust_score, before + 2);
}

async function testMatchTransactionAndOutbox() {
  const a = await createUser('match-a', { gender: 'male', pref_gender: 'both' });
  const b = await createUser('match-b', { gender: 'female', pref_gender: 'both' });

  await sql(`UPDATE users SET status = 'searching', normalized_interests = ARRAY['technology_cluster'], interests = ARRAY['technology'] WHERE id IN ($1,$2)`, [a.id, b.id]);

  const match = await matchmaker.findMatch(a.id, false);
  assert.ok(match, 'a match should be created');

  const matches = await sql('SELECT * FROM matches WHERE id = $1', [match.id]);
  assert.equal(matches.rowCount, 1);

  const users = await sql(`SELECT id, status, current_match_id FROM users WHERE id IN ($1,$2) ORDER BY id`, [a.id, b.id]);
  assert.equal(users.rows.length, 2);
  assert.ok(users.rows.every(r => r.status === UserStatus.MATCHED));
  assert.ok(users.rows.every(r => r.current_match_id === match.id));

  const outbox = await sql(`SELECT dedupe_key, status FROM outbox_messages WHERE dedupe_key LIKE $1 ORDER BY dedupe_key`, [`match:${match.id}:%`]);
  assert.equal(outbox.rowCount, 2, 'match creation must enqueue exactly two notifications atomically');

  const activePair = await sql(`SELECT count(*)::int AS count FROM matches WHERE ended_at IS NULL AND id = $1`, [match.id]);
  assert.equal(activePair.rows[0].count, 1);
}

async function testOutboxCrashRecovery() {
  const result = await sql(`
    INSERT INTO outbox_messages (dedupe_key, platform, recipient_external_id, payload)
    VALUES ('integration:crash:1', 'whatsapp', 'crash-recipient', '{"type":"text","content":"recovery"}'::jsonb)
    RETURNING id
  `);
  const outboxId = result.rows[0].id;

  const child = spawn(process.execPath, [
    path.join(__dirname, '../../scripts/integration-crash-claim.js'),
    '2',
  ], {
    env: { ...process.env, INTEGRATION_DATABASE_URL: DATABASE_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let crashObserved = false;
  let childStderr = '';
  child.stderr.on('data', chunk => { childStderr += chunk.toString(); });
  child.on('error', error => { throw error; });

  for (let attempt = 0; attempt < 40; attempt++) {
    const state = await sql('SELECT status FROM outbox_messages WHERE id = $1', [outboxId]);
    if (state.rows[0]?.status === 'processing') { crashObserved = true; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(crashObserved, true, `crash simulator never claimed outbox job: ${childStderr}`);

  process.kill(child.pid, 'SIGKILL');
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  const beforeRecovery = await sql('SELECT status, locked_until FROM outbox_messages WHERE id = $1', [outboxId]);
  assert.equal(beforeRecovery.rows[0].status, 'processing');

  // Jump the lease into the past; this models elapsed time after a process crash
  // without making CI wait seconds.
  await sql(`UPDATE outbox_messages SET locked_until = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1`, [outboxId]);

  const delivered = [];
  const adapter = {
    async sendMessage(recipient, message) {
      delivered.push({ recipient, message });
    }
  };

  const didWork = await processOneOutboxMessage({ get: () => adapter }, 60);
  assert.equal(didWork, true);
  assert.equal(delivered.length, 1);

  const after = await sql('SELECT status, delivered_at, attempts FROM outbox_messages WHERE id = $1', [outboxId]);
  assert.equal(after.rows[0].status, 'delivered');
  assert.ok(after.rows[0].delivered_at);
  assert.equal(after.rows[0].attempts, 2);
}

async function testOutboxRetryRecovery() {
  const result = await sql(`
    INSERT INTO outbox_messages (dedupe_key, platform, recipient_external_id, payload)
    VALUES ('integration:retry:1', 'whatsapp', 'retry-recipient', '{"type":"text","content":"retry"}'::jsonb)
    RETURNING id
  `);
  const outboxId = result.rows[0].id;

  let failures = 0;
  const failingAdapter = {
    async sendMessage() {
      failures += 1;
      throw new Error('simulated provider outage');
    }
  };
  assert.equal(await processOneOutboxMessage({ get: () => failingAdapter }, 60), true);

  const failed = await sql('SELECT status, attempts, last_error, next_attempt_at FROM outbox_messages WHERE id = $1', [outboxId]);
  assert.equal(failed.rows[0].status, 'pending');
  assert.equal(failed.rows[0].attempts, 1);
  assert.match(failed.rows[0].last_error, /simulated provider outage/);
  assert.equal(failures, 1);

  await sql(`UPDATE outbox_messages SET next_attempt_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1`, [outboxId]);
  const deliveries = [];
  const healthyAdapter = {
    async sendMessage(recipient, message) { deliveries.push({ recipient, message }); }
  };
  assert.equal(await processOneOutboxMessage({ get: () => healthyAdapter }, 60), true);
  assert.equal(deliveries.length, 1);

  const recovered = await sql('SELECT status, attempts, delivered_at FROM outbox_messages WHERE id = $1', [outboxId]);
  assert.equal(recovered.rows[0].status, 'delivered');
  assert.equal(recovered.rows[0].attempts, 2);
  assert.ok(recovered.rows[0].delivered_at);
}

async function testColdBootMaintenanceRecovery() {
  const a = await createUser('stale-a', { status: 'matched', is_ready: true });
  const b = await createUser('stale-b', { status: 'matched', is_ready: true });

  const match = await sql(`
    INSERT INTO matches (user_1_id, user_2_id, shared_interests, started_at, last_activity_at)
    VALUES ($1,$2,ARRAY['technology'], CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP - INTERVAL '30 minutes')
    RETURNING id
  `, [a.id < b.id ? a.id : b.id, a.id < b.id ? b.id : a.id]);
  const matchId = match.rows[0].id;
  await sql(`UPDATE users SET current_match_id = $1 WHERE id IN ($2,$3)`, [matchId, a.id, b.id]);

  const result = await runMaintenanceOnce(userService, matchmaker);
  assert.ok(result.inactive >= 2);

  const ended = await sql('SELECT ended_at FROM matches WHERE id = $1', [matchId]);
  assert.ok(ended.rows[0].ended_at);

  const users = await sql('SELECT status, current_match_id FROM users WHERE id IN ($1,$2) ORDER BY id', [a.id, b.id]);
  assert.ok(users.rows.every(r => r.status === 'idle' && r.current_match_id === null));

  const notices = await sql(`SELECT count(*)::int AS count FROM outbox_messages WHERE dedupe_key LIKE $1`, [`match:${matchId}:%:ended`]);
  assert.equal(notices.rows[0].count, 2);
}

async function main() {
  const started = Date.now();
  console.log('🔬 Moxie PostgreSQL resilience integration suite');
  console.log(`   DATABASE_URL host: ${new URL(DATABASE_URL).hostname}`);

  await runMigrations();
  await resetDatabase();

  const tests = [
    ['5-way webhook deduplication', testWebhookDedup],
    ['20-way concurrent daily reward', testConcurrentRewards],
    ['atomic match creation + transactional outbox', testMatchTransactionAndOutbox],
    ['SIGKILL outbox worker recovery', testOutboxCrashRecovery],
    ['outbox retry after provider failure', testOutboxRetryRecovery],
    ['cold-boot maintenance reconciliation', testColdBootMaintenanceRecovery],
  ];

  for (const [name, test] of tests) {
    const before = Date.now();
    try {
      await test();
      console.log(`✅ ${name} (${Date.now() - before}ms)`);
    } catch (error) {
      console.error(`❌ ${name}`);
      throw error;
    }
    await resetDatabase();
  }

  console.log(`\n✅ ALL INTEGRATION TESTS PASSED (${Date.now() - started}ms)`);
}

main()
  .catch(error => {
    console.error('\nINTEGRATION FAILURE');
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
