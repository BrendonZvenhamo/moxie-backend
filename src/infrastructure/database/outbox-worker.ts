import { query, withTransaction } from './pool';
import { Platform } from '../../types/models';
import { Message } from '../../types/messages';
import { IPlatformAdapter } from '../../core/interfaces/platform';

export interface AdapterRegistry {
  get(platform: Platform): IPlatformAdapter | undefined;
}

function backoffSeconds(attempts: number): number {
  return Math.min(300, Math.max(1, 2 ** Math.min(attempts, 8)));
}

export async function processOneOutboxMessage(adapters: AdapterRegistry, leaseSeconds = 60): Promise<boolean> {
  const job = await withTransaction(async client => {
    const result = await client.query(
      `WITH candidate AS (
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
       RETURNING o.*`,
      [leaseSeconds]
    );
    return result.rows[0] || null;
  });

  if (!job) return false;

  const adapter = adapters.get(job.platform as Platform);
  if (!adapter) {
    await scheduleOutboxRetry(job, new Error(`No adapter available for ${job.platform}`));
    return true;
  }

  try {
    await adapter.sendMessage(job.recipient_external_id, job.payload as Partial<Message>);
    await query(
      `UPDATE outbox_messages
       SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP,
           locked_until = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'processing'`,
      [job.id]
    );
  } catch (error) {
    await scheduleOutboxRetry(job, error);
  }
  return true;
}

async function scheduleOutboxRetry(job: any, error: unknown): Promise<void> {
  const delay = backoffSeconds(job.attempts);
  await query(
    `UPDATE outbox_messages
     SET status = 'pending',
         next_attempt_at = CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'),
         locked_until = NULL,
         last_error = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [job.id, delay, error instanceof Error ? error.message : String(error)]
  );
}

export async function runOutboxWorker(adapters: AdapterRegistry): Promise<void> {
  console.log('🚚 Outbox worker started.');
  while (true) {
    const didWork = await processOneOutboxMessage(adapters);
    if (!didWork) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
