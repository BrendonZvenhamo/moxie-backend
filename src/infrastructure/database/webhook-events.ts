import { query, withTransaction } from './pool';
import { Platform } from '../../types/models';

export async function ingestWebhookEvent(platform: Platform, externalEventId: string, payload: unknown): Promise<'inserted' | 'duplicate'> {
  const result = await query(
    `INSERT INTO webhook_events (platform, external_event_id, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (platform, external_event_id) DO NOTHING
     RETURNING id`,
    [platform, externalEventId, JSON.stringify(payload)]
  );
  return result.rows.length ? 'inserted' : 'duplicate';
}

export async function claimWebhookEvent(workerLeaseSeconds = 300): Promise<any | null> {
  return withTransaction(async client => {
    const result = await client.query(
      `WITH candidate AS (
         SELECT id FROM webhook_events
         WHERE status = 'pending'
            OR (status = 'processing' AND locked_until < CURRENT_TIMESTAMP)
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE webhook_events e
       SET status = 'processing',
           attempts = e.attempts + 1,
           locked_until = CURRENT_TIMESTAMP + ($1 * INTERVAL '1 second'),
           updated_at = CURRENT_TIMESTAMP
       FROM candidate c
       WHERE e.id = c.id
       RETURNING e.*`,
      [workerLeaseSeconds]
    );
    return result.rows[0] || null;
  });
}

export async function markWebhookProcessed(id: string): Promise<void> {
  await query(
    `UPDATE webhook_events
     SET status = 'processed', processed_at = CURRENT_TIMESTAMP,
         locked_until = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id]
  );
}

export async function releaseWebhookEvent(id: string, error: unknown): Promise<void> {
  await query(
    `UPDATE webhook_events
     SET status = 'pending', locked_until = NULL,
         last_error = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, error instanceof Error ? error.message : String(error)]
  );
}

export function extractExternalEventId(payload: any): string | null {
  return payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id
    || payload?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id
    || null;
}
