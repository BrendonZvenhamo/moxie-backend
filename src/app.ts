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
      ADD COLUMN IF NOT EXISTS active_contact_id UUID,
      ADD COLUMN IF NOT EXISTS mood TEXT,
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

    // 5. Ensure indexes exist for performance
    await query(`CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(last_activity_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_trust_score ON users(trust_score)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_matches_last_activity ON matches(last_activity_at)`);

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
    '    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; flex-wrap: wrap; gap: 20px; }',
    '    h1 { margin: 0; font-size: 24px; display: flex; align-items: center; gap: 10px; }',
    '    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin-bottom: 30px; }',
    '    .card { background: white; padding: 15px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }',
    '    .card h3 { margin: 0 0 5px 0; font-size: 12px; text-transform: uppercase; color: #65676b; }',
    '    .card .value { font-size: 28px; font-weight: bold; color: #1877f2; }',
    '    .section { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 30px; overflow-x: auto; }',
    '    .section h2 { margin-top: 0; font-size: 18px; border-bottom: 1px solid #ebedf0; padding-bottom: 10px; margin-bottom: 15px; }',
    '    table { width: 100%; border-collapse: collapse; min-width: 600px; }',
    '    th { text-align: left; font-size: 11px; color: #65676b; text-transform: uppercase; padding: 10px; border-bottom: 1px solid #ebedf0; }',
    '    td { padding: 10px; border-bottom: 1px solid #f0f2f5; font-size: 13px; }',
    '    .user-info { display: flex; flex-direction: column; }',
    '    .user-info span { font-weight: 600; }',
    '    .user-info small { color: #65676b; font-size: 11px; }',
    '    .refresh-btn { background: #1877f2; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 14px; white-space: nowrap; }',
    '    .btn-group { display: flex; gap: 10px; flex-wrap: wrap; }',
    '    @media (max-width: 600px) {',
    '      body { padding: 10px; }',
    '      header { flex-direction: column; align-items: flex-start; }',
    '      .btn-group { width: 100%; }',
    '      .refresh-btn { flex: 1; text-align: center; }',
    '    }',
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
    '        <h1>🦁 Moxie Admin Dashboard <span style="font-size: 12px; background: #e4e6eb; padding: 4px 8px; border-radius: 20px; color: #65676b;">v1.1.3</span></h1>',
    '        <div style="display:flex; gap:10px;">',
    '        <button class="refresh-btn" id="refresh-btn">Refresh Data</button>',
    '        <button class="refresh-btn" id="broadcast-btn" style="background: #007bff;">Broadcast Message</button>',
    '        <button class="refresh-btn" id="reset-btn" style="background: #d93025;">Reset for Update</button>',
    '        </div>',
    '      </header>',
    '      <div id="stats" class="stats-grid">',
    '        <div class="card"><h3>Total Users</h3><div class="value" id="totalUsers">...</div></div>',
    '        <div class="card"><h3>Active Matches</h3><div class="value" id="activeMatches">...</div></div>',
    '        <div class="card"><h3>Searching</h3><div class="value" id="searchingUsers">...</div></div>',
    '        <div class="card"><h3>Matched</h3><div class="value" id="matchedUsers">...</div></div>',
    '      </div>',
    '      <div class="section">',
    '        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #ebedf0; padding-bottom: 10px; margin-bottom: 15px;">',
    '          <h2 style="margin:0; border:none; padding:0;">Matches</h2>',
    '          <div style="display:flex; gap:10px; align-items:center;">',
    '            <input type="date" id="date-filter" style="margin:0; padding:4px 8px; font-size:14px; width:auto;">',
    '            <button class="refresh-btn" id="clear-filter" style="padding:4px 12px; background:#65676b;">Clear</button>',
    '          </div>',
    '        </div>',
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
    '      var urlPw = ' + JSON.stringify(password) + ';',
    '      var storageKey = "moxie_admin_pw";',
    '      var currentDateFilter = "";',
    '      async function loadStats(inputPw, date) {',
    '        var checkPw = inputPw || urlPw || sessionStorage.getItem(storageKey);',
    '        if (!checkPw) {',
    '          document.getElementById("login-screen").style.display = "block";',
    '          document.getElementById("main-content").style.display = "none";',
    '          return;',
    '        }',
    '        if (date !== undefined) currentDateFilter = date;',
    '        try {',
    '          var url = "/api/stats?pw=" + encodeURIComponent(checkPw);',
    '          if (currentDateFilter) url += "&date=" + currentDateFilter;',
    '          var res = await fetch(url);',
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
    var recentMatchesHtml = data.recentMatches.map(function(m) {
      return "<tr><td>" + new Date(m.started_at).toLocaleString() + "</td>" +
        "<td><div class='user-info'><span>" + (m.user1 || "Anon") + "</span><small>" + (m.phone1 || "") + "</small></div></td>" +
        "<td><div class='user-info'><span>" + (m.user2 || "Anon") + "</span><small>" + (m.phone2 || "") + "</small></div></td>" +
        "<td><small>" + (m.shared_interests || []).join(", ") + "</small></td></tr>";
    }).join("");

    '          document.getElementById("recentMatches").innerHTML = recentMatchesHtml || "<tr><td colspan=\'4\'>No matches found for this period</td></tr>";',
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
    '      document.getElementById("date-filter").onchange = function(e) {',
    '        loadStats(null, e.target.value);',
    '      };',
    '      document.getElementById("clear-filter").onclick = function() {',
    '        document.getElementById("date-filter").value = "";',
    '        loadStats(null, "");',
    '      };',
    '      document.getElementById("broadcast-btn").onclick = async function() {',
    '        var message = prompt("Enter message to broadcast to all users:");',
    '        if (!message) return;',
    '        var checkPw = sessionStorage.getItem(storageKey);',
    '        try {',
    '          var res = await fetch("/api/broadcast?pw=" + encodeURIComponent(checkPw), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message }) });',
    '          if (res.ok) {',
    '            alert("Broadcast successful!");',
    '          } else { alert("Broadcast failed: Status " + res.status); }',
    '        } catch (err) { alert("Error: " + err.message); }',
    '      };',
    '      document.getElementById("reset-btn").onclick = async function() {',
    '        if (!confirm("⚠️ RESET SYSTEM FOR UPDATE?\\n\\nThis will:\\n1. Reset ALL user profiles (onboarding start)\\n2. Clear ALL active matches\\n3. Set all users to idle\\n\\nFeedback and Match History will NOT be deleted.")) return;',
    '        var checkPw = sessionStorage.getItem(storageKey);',
    '        try {',
    '          var res = await fetch("/api/reset?pw=" + encodeURIComponent(checkPw), { method: "POST" });',
    '          if (res.ok) {',
    '            alert("System reset successful!");',
    '            loadStats();',
    '          } else { alert("Reset failed: Status " + res.status); }',
    '        } catch (err) { alert("Error: " + err.message); }',
    '      };',
    '      loadStats();',
    '    })();',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');
};

async function bootstrap() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  // A. HIGH-VISIBILITY LOGGER (First Priority)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const forward = req.headers['x-forwarded-for'] || 'no-proxy';
    console.log(`[INCOMING] ${req.method} ${req.url} | RealIP: ${forward} | LocalIP: ${req.ip}`);
    next();
  });

  app.use(bodyParser.json({ limit: '50mb' }));

  // B. STATIC ROUTES (Defined BEFORE listen)
  app.get('/health', (req, res) => res.status(200).send('OK'));
  app.get('/version', (req, res) => {
    res.send('Moxie v1.2.0 Online');
  });

  app.get('/', (req, res) => {
    res.send(DASHBOARD_HTML(String(req.query.pw || '')));
  });

  app.get('/privacy', (req, res) => {
    res.send('<html><body><h1>Privacy Policy</h1><p>We do NOT store messages.</p></body></html>');
  });

  // C. START LISTENING
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 MOXIE SERVER v1.2.0 LISTENING ON PORT ${port}`);
  });

  console.log('--- MOXIE BOOTSTRAP INITIALIZED ---');
  
  try {
    // 3. DATABASE SYNC (Async)
    console.log('Starting background initialization...');
    await syncDatabase();

    const userService = new UserService();
    const matchmakingService = new MatchmakingService(userService);
    const relayService = new RelayService(userService, matchmakingService);
    const commandHandler = new CommandHandler(userService, matchmakingService, relayService);
    const dashboardService = new DashboardService();
    const rateLimiter = new RateLimiter();
    
    const verifyDashboardAuth = (req: Request): boolean => {
      const password = (process.env.DASHBOARD_PASSWORD || '').trim();
      if (!password) {
        console.warn('DASHBOARD_PASSWORD not set in environment!');
        return false;
      }
      const provided = (String(req.query.pw || req.headers['x-dashboard-pw'] || req.query.password || '')).trim();
      const isMatch = provided === password;
      if (!isMatch && provided) {
        console.warn(`Unauthorized dashboard attempt. Provided: "${provided}", Expected: "${password}"`);
      }
      return isMatch;
    };

    // API stats
    app.get('/api/stats', async (req, res) => {
      if (!verifyDashboardAuth(req)) {
        console.warn('Unauthorized access attempt to /api/stats');
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      res.json(await dashboardService.getStats(date));
    });

    // API Reset
    app.post('/api/reset', async (req, res) => {
      if (!verifyDashboardAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      await dashboardService.resetStats();
      res.json({ success: true });
    });

    // API Broadcast
    app.post('/api/broadcast', async (req, res) => {
      if (!verifyDashboardAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (adapters.length > 0 && req.body.message) {
        await commandHandler.handleBroadcast(req.body.message, adapters[0]);
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Broadcast failed' });
      }
    });

    // Background Maintenance: Run every 60 seconds
    setInterval(async () => {
      try {
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

        // 3. Periodic Match Re-check (limited batch for stability)
        const batch = await userService.getSearchingUsers(5);
        
        for (const s of batch) {
          // If waiting for more than 3 minutes, automatically try a random match
          const waitTime = Date.now() - new Date(s.lastMatchAttemptAt || s.createdAt).getTime();
          const shouldRandomize = waitTime > 3 * 60000;

          const match = await matchmakingService.findMatch(s.id, shouldRandomize, s);
          if (match) {
            await relayService.notifyMatch(match.userIds[0], match.userIds[1], match.interests);
          }
        }
      } catch (e) {
        console.error('Background maintenance error:', e);
      }
    }, 60000);

    // Handle adapters
    const adapters: any[] = [];

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
