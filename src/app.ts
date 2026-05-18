import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
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
  console.log('🚀 Starting Moxie Backend (Official API Mode)...');

  // 1. Initialize Services
  const userService = new UserService();
  const matchmakingService = new MatchmakingService(userService);
  const relayService = new RelayService(userService, matchmakingService);
  const commandHandler = new CommandHandler(userService, matchmakingService, relayService);
  const dashboardService = new DashboardService();
  const rateLimiter = new RateLimiter();

  // 2. Setup Express
  const app = express();
  const port = process.env.PORT || 3000;

  // Use body-parser for Meta webhooks which can be large
  app.use(bodyParser.json({ limit: '50mb' }));

  // Dashboard Security Middleware
  const dashboardAuth = (req: Request, res: Response, next: any) => {
    // Exempt webhooks from auth
    if (req.path.startsWith('/webhooks')) return next();

    const password = process.env.DASHBOARD_PASSWORD;
    if (!password) {
      console.warn('⚠️ DASHBOARD_PASSWORD not set in .env! Dashboard is vulnerable.');
      return next();
    }

    const providedPw = req.query.pw || req.headers['x-dashboard-pw'];
    if (providedPw !== password) {
      return res.status(403).send('<h1>🚫 Unauthorized</h1><p>Please provide the dashboard password in the URL (?pw=...) or X-Dashboard-Pw header.</p>');
    }
    next();
  };

  // Webhook Verification (Meta Handshake) - NO AUTH NEEDED
  app.get('/webhooks/whatsapp', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('✅ Webhook verified by Meta!');
      return res.status(200).send(challenge);
    }
    res.sendStatus(403);
  });

  // Apply auth to all other routes
  app.use(dashboardAuth);

  app.get('/api/stats', async (req: Request, res: Response) => {
    try {
      const stats = await dashboardService.getStats();
      res.json(stats);
    } catch (err) {
      console.error('💥 Dashboard API Error:', err);
      res.status(500).json({ error: 'Failed to fetch stats', details: (err as any).message });
    }
  });

  app.post('/api/reset', async (req: Request, res: Response) => {
    try {
      await dashboardService.resetStats();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reset stats' });
    }
  });

  app.get('/', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Moxie Admin Dashboard</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f4f7f6; padding: 20px; }
          .container { max-width: 1000px; margin: 0 auto; }
          .header { background: #075e54; color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
          .header-actions { display: flex; gap: 10px; }
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
          .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .card h3 { margin: 0; color: #666; font-size: 14px; text-transform: uppercase; }
          .card .value { font-size: 32px; font-weight: bold; color: #333; margin: 10px 0; }
          .btn { cursor: pointer; background: transparent; border: 1px solid white; color: white; padding: 8px 15px; border-radius: 5px; font-size: 12px; font-weight: bold; }
          .btn:hover { background: rgba(255,255,255,0.1); }
          .btn-danger { background: #f44336; border-color: #f44336; }
          .btn-danger:hover { background: #d32f2f; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; background: white; border-radius: 10px; overflow: hidden; }
          th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
          th { background: #fafafa; color: #666; }
        </style>
        <script>
          async function refreshStats() {
            try {
              // Add a timestamp to bypass browser cache (Fixes 304 Not Modified)
              const cacheBuster = '&t=' + Date.now();
              const res = await fetch('/api/stats' + window.location.search + cacheBuster);
              if (res.status === 403) {
                console.error('🚫 Dashboard: Unauthorized (Check password)');
                return;
              }
              if (!res.ok) {
                console.error('💥 Dashboard: Server returned error', res.status);
                return;
              }
              
              const data = await res.json();
              console.log('📊 Dashboard: Data refreshed', data);
              
              // Stats fallback to 0 if undefined
              document.getElementById('total-users').innerText = data.totalUsers || 0;
              document.getElementById('searching-users').innerText = data.searchingUsers || 0;
              document.getElementById('matched-users').innerText = data.matchedUsers || 0;
              document.getElementById('active-matches').innerText = data.activeMatches || 0;
              document.getElementById('wa-users').innerText = (data.platformStats && data.platformStats.whatsapp) || 0;
              document.getElementById('tg-users').innerText = (data.platformStats && data.platformStats.telegram) || 0;

              // Update Feedbacks
              const feedbackTable = document.getElementById('feedback-body');
              if (feedbackTable) {
                feedbackTable.innerHTML = '';
                if (data.feedbacks && data.feedbacks.length > 0) {
                  data.feedbacks.forEach(f => {
                    const row = \`<tr><td>\${new Date(f.created_at).toLocaleString()}</td><td><b>\${f.username}</b></td><td>\${f.content}</td></tr>\`;
                    feedbackTable.innerHTML += row;
                  });
                } else {
                  feedbackTable.innerHTML = '<tr><td colspan=\"3\" style=\"text-align: center; color: #999;\">No feedback yet.</td></tr>';
                }
              }

              // Update Reports
              const reportTable = document.getElementById('report-body');
              if (reportTable) {
                reportTable.innerHTML = '';
                if (data.reports && data.reports.length > 0) {
                  data.reports.forEach(r => {
                    const logs = (r.chat_log || []).map(l => \`<div><b>\${l.sender}:</b> \${l.text}</div>\`).join('') || '<i style=\"color:#999\">No logs available</i>';
                    const row = \`<tr>
                      <td>\${new Date(r.create_at).toLocaleString()}</td>
                      <td>\${r.reporter} ➡️ \${r.reported}</td>
                      <td>\${r.reason}</td>
                      <td style=\"font-size: 11px; background: #fffde7; padding: 10px;\">\${logs}</td>
                    </tr>\`;
                    reportTable.innerHTML += row;
                  });
                } else {
                  reportTable.innerHTML = '<tr><td colspan=\"4\" style=\"text-align: center; color: #999;\">No reports yet.</td></tr>';
                }
              }

            } catch (err) {
              console.error('❌ Dashboard: Refresh failed', err);
            }
          }

          async function resetData() {
            if (!confirm('⚠️ Are you sure? This will delete all matches and reset all users to IDLE.')) return;
            const res = await fetch('/api/reset' + window.location.search, { method: 'POST' });
            if (res.ok) {
              alert('✅ System reset successfully!');
              refreshStats();
            } else {
              alert('❌ Failed to reset data.');
            }
          }

          setInterval(refreshStats, 5000);
          window.onload = refreshStats;
        </script>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🦁 MOXIE LIVE DASHBOARD</h1>
            <div class="header-actions">
              <button class="btn" onclick="refreshStats()">REFRESH</button>
              <button class="btn btn-danger" onclick="resetData()">RESET ALL DATA</button>
            </div>
          </div>
          <div class="stats-grid">
            <div class="card"><h3>Total Users</h3><div class="value" id="total-users">...</div></div>
            <div class="card"><h3>Searching</h3><div class="value" id="searching-users" style="color: #ff9800;">...</div></div>
            <div class="card"><h3>Matched</h3><div class="value" id="matched-users" style="color: #4caf50;">...</div></div>
            <div class="card"><h3>Active Matches</h3><div class="value" id="active-matches">...</div></div>
            <div class="card"><h3>WhatsApp</h3><div class="value" id="wa-users">...</div></div>
            <div class="card"><h3>Telegram</h3><div class="value" id="tg-users">...</div></div>
          </div>

          <h2 style="margin-top: 40px; color: #333;">💬 LATEST USER FEEDBACK</h2>
          <table>
            <thead>
              <tr>
                <th width="20%">Date</th>
                <th width="20%">User</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody id="feedback-body">
              <tr><td colspan="3" style="text-align: center; color: #999;">Loading feedback...</td></tr>
            </tbody>
          </table>

          <h2 style=\"margin-top: 40px; color: #333;\">🚩 USER REPORTS (PRO)</h2>
          <table>
            <thead>
              <tr>
                <th width=\"15%\">Date</th>
                <th width=\"20%\">Reporter ➡️ Reported</th>
                <th width=\"20%\">Reason</th>
                <th>Chat Log (Last 5)</th>
              </tr>
            </thead>
            <tbody id=\"report-body\">
              <tr><td colspan=\"4\" style=\"text-align: center; color: #999;\">Loading reports...</td></tr>
            </tbody>
          </table>

          <p style=\"text-align: center; color: #999; margin-top: 40px;\">Live updates every 5 seconds</p>
        </div>
      </body>
      </html>
    `);
  });

  app.listen(port, () => {
    console.log(`📊 Admin Dashboard available at http://localhost:${port}`);
  });

  // 3. Initialize Adapters
  const adapters: IPlatformAdapter[] = [];

  if (process.env.TELEGRAM_BOT_TOKEN) {
    const tgAdapter = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN);
    adapters.push(tgAdapter);
    relayService.registerAdapter(Platform.TELEGRAM, tgAdapter);
  } else {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN not found in .env');
  }

  const waAdapter = new OfficialWhatsAppAdapter();
  adapters.push(waAdapter);
  relayService.registerAdapter(Platform.WHATSAPP, waAdapter);

  // Webhook Receiver (Incoming Messages)
  app.post('/webhooks/whatsapp', async (req: Request, res: Response) => {
    try {
      await waAdapter.handleWebhookPayload(req.body);
      res.sendStatus(200);
    } catch (err) {
      console.error('💥 Error processing WhatsApp webhook:', err);
      res.sendStatus(500);
    }
  });

  // 3. Unified Message Handling Logic
  const createMessageHandler = (adapter: IPlatformAdapter) => {
    return async (msg: IncomingMessage) => {
      try {
        // Rate Limiting check
        if (!rateLimiter.isAllowed(msg.externalId)) {
          return; // Quietly ignore spammers
        }

        // First, check if it's a command (/start, /match, /stop, etc.)
        const isCommand = await commandHandler.handle(msg, adapter);
        if (isCommand) return;

        // If not a command, try to relay it to a match
        const relayed = await relayService.relayMessage(msg, adapter.getPlatform());
        
        if (!relayed) {
          // If not relayed and not a command, show the main menu
          await commandHandler.showMainMenu(msg.externalId, adapter);
        }
      } catch (error: any) {
        console.error(`Error handling message from ${msg.externalId} on ${adapter.getPlatform()}:`, error?.message || error);
      }
    };
  };

  // 4. Start Adapters
  for (const adapter of adapters) {
    try {
      adapter.onMessage(createMessageHandler(adapter));
      adapter.onTypingState(async (externalId) => {
        await relayService.relayTypingState(externalId, adapter.getPlatform());
      });
      adapter.onButtonSelected(async (externalId, buttonId) => {
        await commandHandler.handleButton(externalId, buttonId, adapter);
      });
      await adapter.initialize();
    } catch (error: any) {
      console.error(`❌ Failed to initialize ${adapter.getPlatform()} adapter:`, error?.message || error);
      console.log(`⚠️ Continuing without ${adapter.getPlatform()}...`);
    }
  }

  // 5. Background Tasks
  // End matches that have been active for more than 60 minutes
  setInterval(async () => {
    try {
      const expiredUserIds = await matchmakingService.endExpiredMatches(60);
      if (expiredUserIds.length > 0) {
        console.log(`🧹 Cleaned up ${expiredUserIds.length / 2} expired matches.`);
        for (const userId of expiredUserIds) {
          await relayService.notifyMatchEnded(userId, 'Inactivity timeout (60m)');
        }
      }
    } catch (err: any) {
      console.error('Error in background match cleanup:', err?.message || err);
    }
  }, 10 * 60 * 1000); // Run every 10 minutes

  console.log('✅ Moxie is online and listening for messages!');
}

bootstrap().catch(err => {
  console.error('💥 Failed to start Moxie:', err);
  process.exit(1);
});
