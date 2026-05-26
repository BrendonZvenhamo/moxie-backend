import { query } from '../../infrastructure/database/pool';

export interface DashboardStats {
  totalUsers: number;
  searchingUsers: number;
  matchedUsers: number;
  idleUsers: number;
  platformStats: {
    whatsapp: number;
  };
  activeMatches: number;
  recentMatches: any[];
  feedbacks: any[];
  reports: any[];
}

export class DashboardService {
  async getStats(date?: string): Promise<DashboardStats> {
    const stats: any = {
      totalUsers: 0,
      searchingUsers: 0,
      matchedUsers: 0,
      idleUsers: 0,
      platformStats: { whatsapp: 0 },
      activeMatches: 0,
      recentMatches: [],
      feedbacks: [],
      reports: []
    };

    try {
      const totalResult = await query('SELECT count(*) FROM users');
      stats.totalUsers = parseInt(totalResult.rows[0].count);
      
      const sResult = await query("SELECT count(*) FROM users WHERE status = 'searching'");
      stats.searchingUsers = parseInt(sResult.rows[0].count);
      
      const mResult = await query("SELECT count(*) FROM users WHERE status = 'matched'");
      stats.matchedUsers = parseInt(mResult.rows[0].count);
      
      const iResult = await query("SELECT count(*) FROM users WHERE status = 'idle'");
      stats.idleUsers = parseInt(iResult.rows[0].count);
      
      const waResult = await query("SELECT count(*) FROM users WHERE platform = 'whatsapp'");
      stats.platformStats.whatsapp = parseInt(waResult.rows[0].count);
      
      const amResult = await query("SELECT count(*) FROM matches WHERE ended_at IS NULL");
      stats.activeMatches = parseInt(amResult.rows[0].count);

      // Matches
      try {
        let matchesSql = `
          SELECT m.*, u1.username as user1, u1.external_id as phone1, u2.username as user2, u2.external_id as phone2
          FROM matches m
          JOIN users u1 ON m.user_1_id = u1.id
          JOIN users u2 ON m.user_2_id = u2.id
        `;
        const params: any[] = [];
        
        if (date) {
          matchesSql += ` WHERE m.started_at::date = $1::date ORDER BY m.started_at DESC`;
          params.push(date);
        } else {
          matchesSql += ` ORDER BY m.started_at DESC LIMIT 10`;
        }

        const rmResult = await query(matchesSql, params);
        stats.recentMatches = rmResult.rows.map(m => ({
          ...m,
          user1: m.user1 || 'Anon',
          phone1: m.phone1,
          user2: m.user2 || 'Anon',
          phone2: m.phone2
        }));
      } catch (e) { console.error('Dashboard: matches table query failed'); }

      // Feedbacks
      try {
        const fResult = await query(`
          SELECT f.*, u.username 
          FROM feedbacks f
          JOIN users u ON f.user_id = u.id
          ORDER BY f.created_at DESC
          LIMIT 10
        `);
        stats.feedbacks = fResult.rows.map(f => ({
          ...f,
          username: f.username || 'Anon'
        }));
      } catch (e) { console.error('Dashboard: feedbacks table missing'); }

      // Reports
      try {
        const rResult = await query(`
          SELECT r.*, u1.username as reporter, u2.username as reported 
          FROM reports r
          JOIN users u1 ON r.reporter_id = u1.id
          JOIN users u2 ON r.reported_id = u2.id
          ORDER BY r.created_at DESC
          LIMIT 10
        `);
        stats.reports = rResult.rows.map(r => ({
          ...r,
          reporter: r.reporter || 'Anon',
          reported: r.reported || 'Anon'
        }));
      } catch (e) { console.error('Dashboard: reports table missing'); }

    } catch (err) {
      console.error('CRITICAL: Basic dashboard stats query failed', err);
    }

    return stats;
  }

  async resetStats(): Promise<void> {
    try {
      // Reset user statuses and onboarding for updates
      await query(`
        UPDATE users 
        SET status = 'idle', 
            onboarding_step = 'start', 
            current_match_id = NULL, 
            active_contact_id = NULL, 
            interests = '{}', 
            normalized_interests = '{}',
            is_ready = FALSE
      `);
      // End all active matches without deleting history
      await query("UPDATE matches SET ended_at = CURRENT_TIMESTAMP WHERE ended_at IS NULL");
    } catch (e) {
      console.error('Dashboard reset error:', e);
      throw e;
    }
  }
}
