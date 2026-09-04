import dotenv from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import { query } from './infrastructure/database/pool';
import { UserService } from './core/services/user';
import { MatchmakingService } from './core/services/matchmaker';
import { CommandHandler } from './core/services/commands';
import { RelayService } from './core/services/relay';
import { DashboardService } from './core/services/dashboard';
import { runMaintenanceOnce } from './core/services/maintenance';
import { OfficialWhatsAppAdapter } from './adapters/whatsapp/official';
import { Platform } from './types/models';
import { runMigrations } from './infrastructure/database/migrations';
import { ingestWebhookEvent, extractExternalEventId } from './infrastructure/database/webhook-events';

dotenv.config();

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
    '      <div class="stats-grid">',
    '        <div class="card">',
    '          <h3>Gender Poll (Total)</h3>',
    '          <div id="gender-poll" style="display:flex; height:24px; border-radius:12px; overflow:hidden; margin: 10px 0; background: #e4e6eb;"></div>',
    '          <div id="gender-legend" style="font-size: 11px; color: #65676b; display: flex; flex-wrap: wrap; gap: 10px;"></div>',
    '        </div>',
    '        <div class="card">',
    '          <h3>Live Online Genders</h3>',
    '          <div style="display:flex; justify-content: space-around; padding-top: 10px;">',
    '            <div style="text-align:center;"><div style="font-size:20px; font-weight:bold; color:#1877f2;" id="onlineMale">0</div><div style="font-size:10px; color:#65676b;">MEN</div></div>',
    '            <div style="text-align:center;"><div style="font-size:20px; font-weight:bold; color:#f02849;" id="onlineFemale">0</div><div style="font-size:10px; color:#65676b;">WOMEN</div></div>',
    '            <div style="text-align:center;"><div style="font-size:20px; font-weight:bold; color:#42b72a;" id="onlineOther">0</div><div style="font-size:10px; color:#65676b;">OTHER</div></div>',
    '          </div>',
    '        </div>',
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
    '          <thead><tr><th>Started</th><th>User 1</th><th>User 2</th><th>Interests</th><th>Duration</th></tr></thead>',
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
    '          // Populate Gender Stats',
    '          document.getElementById("onlineMale").textContent = data.genderStats.online.male || 0;',
    '          document.getElementById("onlineFemale").textContent = data.genderStats.online.female || 0;',
    '          document.getElementById("onlineOther").textContent = data.genderStats.online.other || 0;',
    '          var totalG = data.totalUsers || 1;',
    '          var colors = { male: "#1877f2", female: "#f02849", other: "#42b72a", unset: "#e4e6eb" };',
    '          var pollHtml = "";',
    '          var legendHtml = "";',
    '          Object.keys(data.genderStats.total).sort().forEach(function(g) {',
    '            var count = data.genderStats.total[g];',
    '            var pct = (count / totalG * 100).toFixed(1);',
    '            pollHtml += "<div style=\'width:" + pct + "%; background:" + (colors[g] || "#65676b") + "; height:100%;\'></div>";',
    '            legendHtml += "<div><span style=\'display:inline-block; width:8px; height:8px; background:" + (colors[g] || "#65676b") + "; border-radius:50%; margin-right:4px;\'></span>" + g.toUpperCase() + ": " + count + " (" + pct + "%)</div>";',
    '          });',
    '          document.getElementById("gender-poll").innerHTML = pollHtml;',
    '          document.getElementById("gender-legend").innerHTML = legendHtml;',
    '          var recentMatchesHtml = data.recentMatches.map(function(m) {',
    '            var dur = "";',
    '            if (m.duration_seconds !== undefined) {',
    '              var s = Math.floor(m.duration_seconds);',
    '              var hrs = Math.floor(s / 3600);',
    '              var mins = Math.floor((s % 3600) / 60);',
    '              var secs = s % 60;',
    '              if (hrs > 0) dur += hrs + "h ";',
    '              if (mins > 0 || hrs > 0) dur += mins + "m ";',
    '              dur += secs + "s";',
    '            }',
    '            return "<tr><td>" + new Date(m.started_at).toLocaleString() + "</td>" +',
    '              "<td><div class=\'user-info\'><span>" + (m.user1 || "Anon") + "</span><small>" + (m.phone1 || "") + "</small></div></td>" +',
    '              "<td><div class=\'user-info\'><span>" + (m.user2 || "Anon") + "</span><small>" + (m.phone2 || "") + "</small></div></td>" +',
    '              "<td><small>" + (m.shared_interests || []).join(", ") + "</small></td>" +',
    '              "<td>" + (m.ended_at ? dur : "<span style=\'color:#42b72a; font-weight:bold;\'>Active (" + dur + ")</span>") + "</td></tr>";',
    '          }).join("");',

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
  let ready = false;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const forward = req.headers['x-forwarded-for'] || 'no-proxy';
    console.log(`[INCOMING] ${req.method} ${req.url} | RealIP: ${forward} | LocalIP: ${req.ip}`);
    next();
  });
  app.use(bodyParser.json({ limit: '50mb' }));

  app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
  app.get('/ready', (_req, res) => {
    if (!ready) return res.status(503).json({ ok: false });
    res.status(200).json({ ok: true });
  });
  app.get('/version', (_req, res) => res.send('Moxie v2.0.0'));
  app.get('/', (req, res) => res.send(DASHBOARD_HTML(String(req.query.pw || ''))));
  app.get('/privacy', (_req, res) => res.send('<html><body><h1>Privacy Policy</h1><p>Moxie stores limited chat context for safety, reporting, and service recovery. Your identity is not exposed to other users unless you choose to reveal it.</p></body></html>'));

  try {
    console.log('--- MOXIE BOOTSTRAP ---');
    await runMigrations();

    const userService = new UserService();
    const matchmakingService = new MatchmakingService(userService);
    const relayService = new RelayService(userService, matchmakingService);
    const commandHandler = new CommandHandler(userService, matchmakingService, relayService);
    const dashboardService = new DashboardService();

    const adapters = new Map<Platform, OfficialWhatsAppAdapter>();
    const wa = new OfficialWhatsAppAdapter();
    adapters.set(Platform.WHATSAPP, wa);
    relayService.registerAdapter(Platform.WHATSAPP, wa);
    await wa.initialize();
    const dbCheck = await query('SELECT 1 AS ok');
    if (!dbCheck.rows.length) throw new Error('Database readiness query returned no result');
    if (!wa.isReady()) throw new Error('WhatsApp adapter is not configured');

    // Reconcile durable state on every cold boot. This is a recovery pass, not a timer.
    const recovery = await runMaintenanceOnce(userService, matchmakingService);
    console.log(`🔄 Startup reconciliation: ${JSON.stringify(recovery)}`);

    const verifyDashboardAuth = (req: Request): boolean => {
      const password = (process.env.DASHBOARD_PASSWORD || '').trim();
      if (!password) return false;
      const provided = String(req.query.pw || req.headers['x-dashboard-pw'] || req.query.password || '').trim();
      return provided === password;
    };

    app.get('/api/stats', async (req, res) => {
      if (!verifyDashboardAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      res.json(await dashboardService.getStats(date));
    });

    app.post('/api/reset', async (req, res) => {
      if (!verifyDashboardAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      await dashboardService.resetStats();
      res.json({ success: true });
    });

    app.post('/api/broadcast', async (req, res) => {
      if (!verifyDashboardAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.body.message) return res.status(400).json({ error: 'Broadcast failed' });
      await commandHandler.handleBroadcast(req.body.message, wa);
      res.json({ success: true });
    });

    // Meta verification challenge.
    app.get('/webhooks/whatsapp', (req, res) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(String(challenge));
      return res.sendStatus(403);
    });

    // Ingestion is deliberately fast and durable. Business logic is processed by webhook-worker.ts.
    app.post('/webhooks/whatsapp', async (req, res) => {
      try {
        const eventId = extractExternalEventId(req.body);
        if (!eventId) return res.sendStatus(200);
        await ingestWebhookEvent(Platform.WHATSAPP, eventId, req.body);
        return res.sendStatus(200);
      } catch (error) {
        console.error('Webhook ingestion failure:', error);
        return res.sendStatus(503);
      }
    });

    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`🚀 MOXIE SERVER v2.0.0 LISTENING ON PORT ${port}`);
    });

    ready = true;
    console.log('✅ Moxie is READY. Webhooks are durable-ingestion only.');

    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}; draining HTTP server.`);
      ready = false;
      await new Promise<void>(resolve => server.close(() => resolve()));
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    // Keep references alive for route callbacks; all business execution is now worker-driven.
    void userService;
    void matchmakingService;
    void relayService;
  } catch (err) {
    console.error('CRITICAL STARTUP ERROR:', err);
    process.exit(1);
  }
}

bootstrap().catch(err => { console.error('BOOTSTRAP FATAL:', err); process.exit(1); });
