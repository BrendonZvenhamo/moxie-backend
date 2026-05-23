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

const DASHBOARD_HTML = (password: string) => `
<!DOCTYPE html>
<html>
<head>
  <title>Moxie Admin Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #1c1e21; }
    .container { max-width: 1000px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
    h1 { margin: 0; font-size: 24px; display: flex; align-items: center; gap: 10px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .card h3 { margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; color: #65676b; }
    .card .value { font-size: 32px; font-weight: bold; color: #1877f2; }
    .section { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 30px; }
    .section h2 { margin-top: 0; font-size: 18px; border-bottom: 1px solid #ebedf0; padding-bottom: 10px; margin-bottom: 15px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 12px; color: #65676b; text-transform: uppercase; padding: 10px; border-bottom: 1px solid #ebedf0; }
    td { padding: 10px; border-bottom: 1px solid #f0f2f5; font-size: 14px; }
    .refresh-btn { background: #1877f2; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; }
    .refresh-btn:hover { background: #166fe5; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🦁 Moxie Admin Dashboard <span style="font-size: 12px; background: #e4e6eb; padding: 4px 8px; border-radius: 20px; color: #65676b;">v1.0.7</span></h1>
      <button class="refresh-btn" onclick="location.reload()">Refresh Data</button>
    </header>

    <div id="stats" class="stats-grid">
      <div class="card"><h3>Total Users</h3><div class="value" id="totalUsers">...</div></div>
      <div class="card"><h3>Active Matches</h3><div class="value" id="activeMatches">...</div></div>
      <div class="card"><h3>Searching</h3><div class="value" id="searchingUsers">...</div></div>
      <div class="card"><h3>Matched</h3><div class="value" id="matchedUsers">...</div></div>
    </div>

    <div class="section">
      <h2>Recent Matches</h2>
      <table>
        <thead>
          <tr><th>Started</th><th>User 1</th><th>User 2</th><th>Interests</th></tr>
        </thead>
        <tbody id="recentMatches"></tbody>
      </table>
    </div>

    <div class="section">
      <h2>Recent Feedback</h2>
      <div id="feedbacks"></div>
    </div>

    <div class="section">
      <h2>Recent Reports</h2>
      <div id="reports"></div>
    </div>
  </div>

  <script>
    const pw = '${password}';
    async function loadStats() {
      try {
        const res = await fetch('/api/stats?pw=' + pw);
        const data = await res.json();
        
        document.getElementById('totalUsers').textContent = data.totalUsers;
        document.getElementById('activeMatches').textContent = data.activeMatches;
        document.getElementById('searchingUsers').textContent = data.searchingUsers;
        document.getElementById('matchedUsers').textContent = data.matchedUsers;

        const recentMatchesHtml = data.recentMatches.map(m => \`
          <tr>
            <td>\${new Date(m.started_at).toLocaleString()}</td>
            <td>\${m.user1}</td>
            <td>\${m.user2}</td>
            <td><small>\${m.shared_interests.join(', ')}</small></td>
          </tr>
        \`).join('');
        document.getElementById('recentMatches').innerHTML = recentMatchesHtml || '<tr><td colspan="4">No recent matches</td></tr>';

        const feedbackHtml = data.feedbacks.map(f => \`
          <div style="padding: 10px; border-bottom: 1px solid #f0f2f5;">
            <strong>\${f.username}</strong> <small style="color: #65676b;">\${new Date(f.created_at).toLocaleString()}</small>
            <p style="margin: 5px 0 0 0;">\${f.content}</p>
          </div>
        \`).join('');
        document.getElementById('feedbacks').innerHTML = feedbackHtml || '<p>No feedback yet</p>';

        const reportHtml = data.reports.map(r => \`
          <div style="padding: 10px; border-bottom: 1px solid #f0f2f5; color: #d93025;">
            <strong>\${r.reporter}</strong> reported <strong>\${r.reported}</strong>
            <p style="margin: 5px 0 0 0;">Reason: \${r.reason}</p>
          </div>
        \`).join('');
        document.getElementById('reports').innerHTML = reportHtml || '<p>No reports</p>';

      } catch (err) {
        console.error('Failed to load stats:', err);
      }
    }
    loadStats();
  </script>
</body>
</html>
`;

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
    res.send(\`<html><body><h1>🛡️ Privacy Policy</h1><p>We do NOT store messages.</p></body></html>\`);
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
  app.get('/', auth, (req, res) => {
    res.send(DASHBOARD_HTML(process.env.DASHBOARD_PASSWORD || ''));
  });
  app.get('/api/stats', auth, async (req, res) => res.json(await dashboardService.getStats()));

  app.listen(port, () => console.log(\`🚀 Server on \${port}\`));

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
      console.log(\`🚀 \${adapter.getPlatform()} is LIVE!\`);
    } catch (error: any) {
      console.error(\`⚠️ Failed to start \${adapter.getPlatform()}:\`, error?.message || error);
    }
  }
}

bootstrap().catch(err => { console.error('💥 FATAL:', err); });
