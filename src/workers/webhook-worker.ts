import { CommandHandler } from '../core/services/commands';
import { MatchmakingService } from '../core/services/matchmaker';
import { RelayService } from '../core/services/relay';
import { UserService } from '../core/services/user';
import { RateLimiter } from '../utils/rate-limiter';
import { OfficialWhatsAppAdapter } from '../adapters/whatsapp/official';
import { claimWebhookEvent, markWebhookProcessed, releaseWebhookEvent } from '../infrastructure/database/webhook-events';
import { runMigrations } from '../infrastructure/database/migrations';
import { Platform } from '../types/models';

async function main(): Promise<void> {
  await runMigrations();
  const userService = new UserService();
  const matchmaker = new MatchmakingService(userService);
  const relay = new RelayService(userService, matchmaker);
  const commands = new CommandHandler(userService, matchmaker, relay);
  const limiter = new RateLimiter();
  const adapter = new OfficialWhatsAppAdapter();
  relay.registerAdapter(Platform.WHATSAPP, adapter);

  adapter.onMessage(async msg => {
    if (!(await limiter.isAllowed(msg.externalId))) return;
    if (await commands.handle(msg, adapter)) return;
    await relay.relayMessage(msg, adapter.getPlatform());
  });
  adapter.onTypingState(async id => relay.relayTypingState(id, adapter.getPlatform()));
  adapter.onButtonSelected(async (id, btn) => commands.handleButton(id, btn, adapter));
  await adapter.initialize();
  if (!adapter.isReady()) throw new Error('WhatsApp adapter is not ready');

  console.log('📥 Webhook worker started.');
  while (true) {
    const job = await claimWebhookEvent();
    if (!job) {
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    try {
      await adapter.handleWebhookPayload(job.payload);
      await markWebhookProcessed(job.id);
    } catch (error) {
      console.error(`Webhook event ${job.id} failed on attempt ${job.attempts}:`, error);
      await releaseWebhookEvent(job.id, error);
    }
  }
}

main().catch(error => { console.error('WEBHOOK WORKER FATAL:', error); process.exit(1); });
