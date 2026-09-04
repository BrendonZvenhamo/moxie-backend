import { withTransaction } from './pool';
import { Platform } from '../../types/models';
import { Message } from '../../types/messages';

export interface OutboxPayload {
  type: string;
  content?: string;
  title?: string;
  body?: string;
  buttons?: unknown[];
  footer?: string;
  url?: string;
  caption?: string;
  [key: string]: unknown;
}

export async function enqueueOutbox(
  client: any,
  args: {
    dedupeKey: string;
    platform: Platform;
    recipientExternalId: string;
    message: Partial<Message>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_messages
      (dedupe_key, platform, recipient_external_id, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [args.dedupeKey, args.platform, args.recipientExternalId, JSON.stringify(args.message)]
  );
}

export async function enqueueOutboxStandalone(args: {
  dedupeKey: string;
  platform: Platform;
  recipientExternalId: string;
  message: Partial<Message>;
}): Promise<void> {
  await withTransaction(async client => enqueueOutbox(client, args));
}
