import dotenv from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import { UserService } from './core/services/user';
import { MatchmakingService } from './core/services/matchmaker';
import { CommandHandler } from './core/services/commands';
import { RelayService } from './core/services/relay';
import { DashboardService } from './core/services/dashboard';
import { RateLimiter } from './utils/rate-limiter';
import { TelegramAdapter } from './adapters/telegram/adapter';
import { OfficialWhatsAppAdapter } from './adapters/whatsapp/official';
import { Platform } from './types/models';
import { IncomingMessage, IPlatformAdapter } from './core/interfaces/platform';

dotenv.config();

async function bootstrap() {
  console.log('🚀 [VERSION 1.0.7] PRODUCTION BOOT...');

  const userService = new UserService();
  const matchmakingService = new MatchmakingService(userService);
  const relayService = new RelayService(userService, matchmakingService);
  const commandHandler = new CommandHandler(userService, matchmakingService, relayService);
  const dashboardService = new DashboardService();
  const rateLimiter = new RateLimiter();

  const app = express();
  const port = process.env.PORT || 3000;
  app.use(bodyParser.json({ limit: '50mb' }));

  // --- 1. PUBLIC ROUTES ---
  app.get('/version', (req, res) => res.send('Moxie v1.0.7 Online'));
  app.get('/privacy', (req, res) => {
    res.send(`<html><body><h1>🛡️ Privacy Policy</h1><p>We do NOT store messages.</p></body></html>`);
  });
  app.get('/webhooks/whatsapp', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
  });

  // --- 2. AUTH ---
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const password = process.env.DASHBOARD_PASSWORD;
    if ((req.query.pw || req.headers['x-dashboard-pw']) === password && password) return next();
    res.status(403).send('<h1>🚫 Unauthorized</h1>');
  };

  // --- 3. PROTECTED ---
  app.get('/', auth, (req, res) => res.send('<h1>🦁 Moxie Admin Active</h1>'));
  app.get('/api/stats', auth, async (req, res) => res.json(await dashboardService.getStats()));

  app.listen(port, () => console.log(`🚀 Server on ${port}`));

  // --- 4. ADAPTERS (WITH SAFETY) ---
  const adapters: IPlatformAdapter[] = [];
  
  // Setup Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const tg = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN);
      adapters.push(tg);
      relayService.registerAdapter(Platform.TELEGRAM, tg);
      console.log('✅ Telegram Adapter registered.');
    } catch (e) { console.error('❌ Telegram setup failed:', e); }
  }

  // Setup WhatsApp
  try {
    const wa = new OfficialWhatsAppAdapter();
    adapters.push(wa);
    relayService.registerAdapter(Platform.WHATSAPP, wa);
    console.log('✅ WhatsApp Adapter registered.');
  } catch (e) { console.error('❌ WhatsApp setup failed:', e); }

  app.post('/webhooks/whatsapp', async (req, res) => {
    try {
      const wa = adapters.find(a => a.getPlatform() === Platform.WHATSAPP) as OfficialWhatsAppAdapter;
      if (wa) await wa.handleWebhookPayload(req.body);
      res.sendStatus(200);
    } catch (err) { res.sendStatus(500); }
  });

  // Initialize all safely
  for (const adapter of adapters) {
    try {
      adapter.onMessage(async (msg) => {
        if (!rateLimiter.isAllowed(msg.externalId)) return;
        if (await commandHandler.handle(msg, adapter)) return;
        await relayService.relayMessage(msg, adapter.getPlatform());
      });
      adapter.onTypingState(async (id) => relayService.relayTypingState(id, adapter.getPlatform()));
      adapter.onButtonSelected(async (id, btn) => commandHandler.handleButton(id, btn, adapter));
      
      await adapter.initialize();
      console.log(`🚀 ${adapter.getPlatform()} is LIVE!`);
    } catch (error: any) {
      console.error(`⚠️ Failed to start ${adapter.getPlatform()}:`, error?.message || error);
    }
  }
}

bootstrap().catch(err => { console.error('💥 FATAL:', err); });
