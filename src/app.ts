import dotenv from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import { query } from './infrastructure/database/pool';
import { UserService } from './core/services/user';
import { MatchmakingService } from './core/services/matchmaker';
import { CommandHandler } from './core/services/commands';
import { RelayService } from './core/services/relay';
import { DashboardService } from './core/services/dashboard';
import { RateLimiter } from './utils/rate-limiter';
import { TelegramAdapter } from './adapters/telegram/adapter';
import { OfficialWhatsAppAdapter } from './adapters/whatsapp/official';
import { Platform } from './types/models';

dotenv.config();

/**
 * Ensures the database schema is up to date for new features.
 */
async function syncDatabase() {
  console.log('Syncing database schema...');
  try {
    // 1. Ensure feedbacks table exists
    await query(`
      CREATE TABLE IF NOT EXISTS feedbacks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Ensure reports table exists
    await query(`
      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        reporter_id UUID REFERENCES users(id),
        reported_id UUID REFERENCES users(id),
        reason TEXT,
        chat_log JSONB DEFAULT '[]',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Ensure pref_gender column exists in users
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS pref_gender TEXT,
      ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS accept_media BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS is_ready BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS last_match_attempt_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    `);

    // 4. Ensure last_activity_at exists in matches
    await query(`
      ALTER TABLE matches
      ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    `);

    console.log('✅ Database sync complete.');
  } catch (err: any) {
    console.warn('⚠️ Database sync warning (tables might already exist or need manual setup):', err.message);
  }
}

/**
 * Returns the visual HTML for the Admin Dashboard.
 */
const DASHBOARD_HTML = (password: string) => {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <title>Moxie Admin Dashboard</title>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <style>',
    '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #1c1e21; }',
    '    .container { max-width: 1000px; margin: 0 auto; }',
    '    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }',
    '    h1 { margin: 0; font-size: 24px; display: flex; align-items: center; gap: 10px; }',
    '    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }',
    '    .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }',
    '    .card h3 { margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; color: #65676b; }',
    '    .card .value { font-size: 32px; font-weight: bold; color: #1877f2; }',
    '    .section { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 30px; }',
    '    .section h2 { margin-top: 0; font-size: 18px; border-bottom: 1px solid #ebedf0; padding-bottom: 10px; margin-bottom: 15px; }',
    '    table { width: 100%; border-collapse: collapse; }',
    '    th { text-align: left; font-size: 12px; color: #65676b; text-transform: uppercase; padding: 10px; border-bottom: 1px solid #ebedf0; }',
    '    td { padding: 10px; border-bottom: 1px solid #f0f2f5; font-size: 14px; }',
    '    .refresh-btn { background: #1877f2; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; }',
    '    #login-screen { display: none; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; margin: 100px auto; text-align: center; }',
    '    input { width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <div id="login-screen">',
    '    <h1>🦁 Moxie Admin</h1>',
    '    <p>Please enter the dashboard password:</p>',
    '    <input type="password" id="pw-input" placeholder="Password">',
    '    <button class="refresh-btn" id="login-btn">Login</button>',
    '  </div>',
    '  <div id="main-content" style="display:none">',
    '    <div class="container">',
    '      <header>',
    '        <h1>🦁 Moxie Admin Dashboard <span style="font-size: 12px; background: #e4e6eb; padding: 4px 8px; border-radius: 20px; color: #65676b;">v1.1.2</span></h1>',
    '        <button class="refresh-btn" id="refresh-btn">Refresh Data</button>',
    '      </header>',
    '      <div id="stats" class="stats-grid">',
    '        <div class="card"><h3>Total Users</h3><div class="value" id="totalUsers">...</div></div>',
    '        <div class="card"><h3>Active Matches</h3><div class="value" id="activeMatches">...</div></div>',
    '        <div class="card"><h3>Searching</h3><div class="value" id="searchingUsers">...</div></div>',
    '        <div class="card"><h3>Matched</h3><div class="value" id="matchedUsers">...</div></div>',
    '      </div>',
    '      <div class="section">',
    '        <h2>Recent Matches</h2>',
    '        <table>',
    '          <thead><tr><th>Started</th><th>User 1</th><th>User 2</th><th>Interests</th></tr></thead>',
    '          <tbody id="recentMatches"></tbody>',
    '        </table>',
    '      </div>',
    '      <div class="section"><h2>Recent Feedback</h2><div id="feedbacks"></div></div>',
    '      <div class="section"><h2>Recent Reports</h2><div id="reports"></div></div>',
    '    </div>',
    '  </div>',
    '  <script>',
    '    (function() {',
    '      var urlPw = "' + password + '";',
    '      var storageKey = "moxie_admin_pw";',
    '      async function loadStats(inputPw) {',
    '        var checkPw = inputPw || urlPw || sessionStorage.getItem(storageKey);',
    '        if (!checkPw) {',
    '          document.getElementById("login-screen").style.display = "block";',
    '          document.getElementById("main-content").style.display = "none";',
    '          return;',
    '        }',
    '        try {',
    '          var res = await fetch("/api/stats?pw=" + encodeURIComponent(checkPw));',
    '          if (!res.ok) {',
    '            sessionStorage.removeItem(storageKey);',
    '            document.getElementById("login-screen").style.display = "block";',
    '            document.getElementById("main-content").style.display = "none";',
    '            if (inputPw) alert("Invalid Password");',
    '            return;',
    '          }',
    '          sessionStorage.setItem(storageKey, checkPw);',
    '          var data = await res.json();',
    '          document.getElementById("login-screen").style.display = "none";',
    '          document.getElementById("main-content").style.display = "block";',
    '          document.getElementById("totalUsers").textContent = data.totalUsers;',
    '          document.getElementById("activeMatches").textContent = data.activeMatches;',
    '          document.getElementById("searchingUsers").textContent = data.searchingUsers;',
    '          document.getElementById("matchedUsers").textContent = data.matchedUsers;',
    '          var recentMatchesHtml = data.recentMatches.map(function(m) {',
    '            return "<tr><td>" + new Date(m.started_at).toLocaleString() + "</td>" +',
    '              "<td>" + (m.user1 || "Anon") + "</td>" +',
    '              "<td>" + (m.user2 || "Anon") + "</td>" +',
    '              "<td><small>" + (m.shared_interests || []).join(", ") + "</small></td></tr>";',
    '          }).join("");',
    '          document.getElementById("recentMatches").innerHTML = recentMatchesHtml || "<tr><td colspan=\'4\'>No recent matches</td></tr>";',
    '          var feedbackHtml = data.feedbacks.map(function(f) {',
    '            return "<div style=\'padding: 10px; border-bottom: 1px solid #f0f2f5;\'>" +',
    '              "<strong>" + (f.username || "Anon") + "</strong> <small style=\'color: #65676b;\'>" + new Date(f.created_at).toLocaleString() + "</small>" +',
    '              "<p style=\'margin: 5px 0 0 0;\'>" + f.content + "</p></div>";',
    '          }).join("");',
    '          document.getElementById("feedbacks").innerHTML = feedbackHtml || "<p>No feedback yet</p>";',
    '          var reportHtml = data.reports.map(function(r) {',
    '            return "<div style=\'padding: 10px; border-bottom: 1px solid #f0f2f5; color: #d93025;\'>" +',
    '              "<strong>" + (r.reporter || "Anon") + "</strong> reported <strong>" + (r.reported || "Anon") + "</strong>" +',
    '              "<p style=\'margin: 5px 0 0 0;\'>Reason: " + r.reason + "</p></div>";',
    '          }).join("");',
    '          document.getElementById("reports").innerHTML = reportHtml || "<p>No reports</p>";',
    '        } catch (err) { console.error("Failed to load stats:", err); }',
    '      }',
    '      document.getElementById("login-btn").onclick = function() {',
    '        loadStats(document.getElementById("pw-input").value);',
    '      };',
    '      document.getElementById("refresh-btn").onclick = function() {',
    '        loadStats();',
    '      };',
    '      loadStats();',
    '    })();',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');
};

async function bootstrap() {
  console.log('--- MOXIE BOOTSTRAP STARTING (v1.1.2) ---');
  
  // 1. Sync Database first
  await syncDatabase();

  try {
    const userService = new UserService();
    const matchmakingService = new MatchmakingService(userService);
    const relayService = new RelayService(userService, matchmakingService);
    const commandHandler = new CommandHandler(userService, matchmakingService, relayService);
    const dashboardService = new DashboardService();
    const rateLimiter = new RateLimiter();

    const app = express();
    const port = Number(process.env.PORT) || 3000;
    app.use(bodyParser.json({ limit: '50mb' }));

    // Public routes
    app.get('/health', (req, res) => res.status(200).send('OK'));
    app.get('/version', (req, res) => res.send('Moxie v1.1.2 Online'));
    app.get('/', (req, res) => res.send(DASHBOARD_HTML(String(req.query.pw || ''))));
    
    app.get('/privacy', (req, res) => {
      res.send('<html><body><h1>Privacy Policy</h1><p>We do NOT store messages.</p></body></html>');
    });

    // API stats
    app.get('/api/stats', async (req, res) => {
      const password = (process.env.DASHBOARD_PASSWORD || '').trim();
      const provided = (String(req.query.pw || req.headers['x-dashboard-pw'] || '')).trim();
      if (!password) return res.status(500).json({ error: 'Config error' });
      if (provided === password) return res.json(await dashboardService.getStats());
      res.status(401).json({ error: 'Unauthorized' });
    });

    // BIND TO PORT IMMEDIATELY
    app.listen(port, '0.0.0.0', () => {
      console.log('HTTP Server is listening on 0.0.0.0:' + port);
    });

    // Background Maintenance: Run every minute
    setInterval(async () => {
      // 1. Cleanup stale handshakes (2 min timeout)
      const endedHandshakes = await matchmakingService.cleanupPendingHandshakes(2);
      for (const userId of endedHandshakes) {
        await relayService.notifyMatchEnded(userId, 'Match timed out (no confirmation)');
      }

      // 2. Cleanup inactive matches (20 min timeout)
      const inactiveMatches = await matchmakingService.cleanupInactiveMatches(20);
      for (const userId of inactiveMatches) {
        await relayService.notifyMatchEnded(userId, 'Match ended due to inactivity');
      }
    }, 60000);

    // Handle adapters
    const adapters: any[] = [];
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_token') {
      try {
        const tg = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN);
        adapters.push(tg);
        relayService.registerAdapter(Platform.TELEGRAM, tg);
      } catch (e) { console.error('Telegram registration failed'); }
    }

    try {
      const wa = new OfficialWhatsAppAdapter();
      adapters.push(wa);
      relayService.registerAdapter(Platform.WHATSAPP, wa);
    } catch (e) { console.error('WhatsApp registration failed'); }

    app.post('/webhooks/whatsapp', async (req, res) => {
      try {
        const wa = adapters.find(a => a.getPlatform && a.getPlatform() === Platform.WHATSAPP);
        if (wa) await wa.handleWebhookPayload(req.body);
        res.sendStatus(200);
      } catch (err) { res.sendStatus(500); }
    });

    // Initialize adapters in background
    (async () => {
      for (const adapter of adapters) {
        try {
          adapter.onMessage(async (msg: any) => {
            if (!rateLimiter.isAllowed(msg.externalId)) return;
            if (await commandHandler.handle(msg, adapter)) return;
            await relayService.relayMessage(msg, adapter.getPlatform());
          });
          if (adapter.onTypingState) adapter.onTypingState(async (id: string) => relayService.relayTypingState(id, adapter.getPlatform()));
          if (adapter.onButtonSelected) adapter.onButtonSelected(async (id: string, btn: string) => commandHandler.handleButton(id, btn, adapter));
          await adapter.initialize();
          console.log(adapter.getPlatform() + ' fully initialized.');
        } catch (error) {
          console.error('Adapter initialization crash');
        }
      }
    })();

  } catch (err) {
    console.error('CRITICAL STARTUP ERROR:', err);
    process.exit(1);
  }
}

bootstrap().catch(err => { console.error('BOOTSTRAP FATAL:', err); });
