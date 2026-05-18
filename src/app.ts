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
  console.log('🚀 [VERSION 1.0.6] PRODUCTION BOOT...');

  const userService = new UserService();
  const matchmakingService = new MatchmakingService(userService);
  const relayService = new RelayService(userService, matchmakingService);
  const commandHandler = new CommandHandler(userService, matchmakingService, relayService);
  const dashboardService = new DashboardService();
  const rateLimiter = new RateLimiter();

  const app = express();
  const port = process.env.PORT || 3000;
  app.use(bodyParser.json({ limit: '50mb' }));

  // --- 1. PUBLIC ROUTES (Zero Auth) ---
  app.get('/version', (req, res) => res.send('Moxie v1.0.6 is Online'));

  app.get('/privacy', (req, res) => {
    res.send(`
      <html>
      <head><title>Moxie Privacy</title><style>body{font-family:sans-serif;padding:40px;line-height:1.6;max-width:800px;margin:auto;}</style></head>
      <body>
        <h1>🛡️ Moxie Privacy Policy</h1>
        <p>We connect people anonymously. We do <b>NOT</b> store your private messages.</p>
        <p><b>Data:</b> We only store your platform ID and profile settings to facilitate matches.</p>
        <p>© 2026 Moxie</p>
      </body>
      </html>
    `);
  });

  app.get('/webhooks/whatsapp', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
  });

  // --- 2. AUTH MIDDLEWARE (For Dashboard Only) ---
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const password = process.env.DASHBOARD_PASSWORD;
    const provided = req.query.pw || req.headers['x-dashboard-pw'];
    if (provided === password && password) return next();
    res.status(403).send('<h1>🚫 Unauthorized</h1>');
  };

  // --- 3. PROTECTED ROUTES ---
  app.get('/', auth, (req, res) => res.send('<h1>🦁 Moxie Admin Active</h1>'));
  app.get('/api/stats', auth, async (req, res) => res.json(await dashboardService.getStats()));

  // --- 4. SERVER & ADAPTERS ---
  app.listen(port, () => console.log(`🚀 Port ${port}`));

  const adapters: IPlatformAdapter[] = [];
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const tg = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN);
    adapters.push(tg);
    relayService.registerAdapter(Platform.TELEGRAM, tg);
  }
  const wa = new OfficialWhatsAppAdapter();
  adapters.push(wa);
  relayService.registerAdapter(Platform.WHATSAPP, wa);

  app.post('/webhooks/whatsapp', async (req, res) => {
    await wa.handleWebhookPayload(req.body);
    res.sendStatus(200);
  });

  const messageHandler = (adapter: IPlatformAdapter) => async (msg: IncomingMessage) => {
    if (!rateLimiter.isAllowed(msg.externalId)) return;
    if (await commandHandler.handle(msg, adapter)) return;
    await relayService.relayMessage(msg, adapter.getPlatform());
  };

  for (const adapter of adapters) {
    adapter.onMessage(messageHandler(adapter));
    adapter.onTypingState(async (id) => relayService.relayTypingState(id, adapter.getPlatform()));
    adapter.onButtonSelected(async (id, btn) => commandHandler.handleButton(id, btn, adapter));
    await adapter.initialize();
  }
}

bootstrap().catch(err => { console.error(err); process.exit(1); });
