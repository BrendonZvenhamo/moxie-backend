const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
  if (!databaseUrl) throw new Error('INTEGRATION_DATABASE_URL is required');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const leaseSeconds = Number(process.argv[2] || 3);
    const result = await client.query(`
      WITH candidate AS (
        SELECT id FROM outbox_messages
        WHERE (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP)
           OR (status = 'processing' AND locked_until < CURRENT_TIMESTAMP)
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE outbox_messages o
      SET status = 'processing',
          attempts = o.attempts + 1,
          locked_until = CURRENT_TIMESTAMP + ($1 * INTERVAL '1 second'),
          updated_at = CURRENT_TIMESTAMP
      FROM candidate c
      WHERE o.id = c.id
      RETURNING o.id, o.attempts, o.locked_until
    `, [leaseSeconds]);
    if (!result.rows.length) {
      throw new Error('No outbox job available for crash simulation');
    }
    console.log(JSON.stringify(result.rows[0]));
    // Simulate a process dying while the external API call is in flight.
    setInterval(() => {}, 1000);
  } finally {
    // Deliberately unreachable while the simulated worker is alive.
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
