import { OfficialWhatsAppAdapter } from '../adapters/whatsapp/official';
import { Platform } from '../types/models';
import { runMigrations } from '../infrastructure/database/migrations';
import { processOneOutboxMessage } from '../infrastructure/database/outbox-worker';

async function main(): Promise<void> {
  await runMigrations();
  const adapter = new OfficialWhatsAppAdapter();
  await adapter.initialize();
  if (!adapter.isReady()) throw new Error('WhatsApp adapter is not ready');
  const adapters = new Map([[Platform.WHATSAPP, adapter]]);
  console.log('🚚 Outbox worker started.');
  while (true) {
    const didWork = await processOneOutboxMessage(adapters);
    if (!didWork) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main().catch(error => { console.error('OUTBOX WORKER FATAL:', error); process.exit(1); });
