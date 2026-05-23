import { query } from '../../infrastructure/database/pool';

export interface DashboardStats {
  totalUsers: number;
  searchingUsers: number;
  matchedUsers: number;
  idleUsers: number;
  platformStats: {
    whatsapp: number;
    telegram: number;
  };
  activeMatches: number;
  recentMatches: any[];
  feedbacks: any[];
  reports: any[];
}

export class DashboardService {
  async getStats(): Promise<DashboardStats> {
    const totalResult = await query('SELECT count(*) FROM users');
    const searchingResult = await query("SELECT count(*) FROM users WHERE status = 'searching'");
    const matchedResult = await query("SELECT count(*) FROM users WHERE status = 'matched'");
    const idleResult = await query("SELECT count(*) FROM users WHERE status = 'idle'");
    
    const waResult = await query("SELECT count(*) FROM users WHERE platform = 'whatsapp'");
    const tgResult = await query("SELECT count(*) FROM users WHERE platform = 'telegram'");
    
    const activeMatchesResult = await query("SELECT count(*) FROM matches WHERE ended_at IS NULL");
    
    const recentMatchesResult = await query(`
      SELECT m.*, u1.username as user1, u2.username as user2 
      FROM matches m
      JOIN users u1 ON m.user_1_id = u1.id
      JOIN users u2 ON m.user_2_id = u2.id
      ORDER BY m.started_at DESC
      LIMIT 5
    `);

    const feedbacksResult = await query(`
      SELECT f.*, u.username 
      FROM feedbacks f
      JOIN users u ON f.user_id = u.id
      ORDER BY f.created_at DESC
      LIMIT 10
    `);

    const reportsResult = await query(`
      SELECT r.*, u1.username as reporter, u2.username as reported 
      FROM reports r
      JOIN users u1 ON r.reporter_id = u1.id
      JOIN users u2 ON r.reported_id = u2.id
      ORDER BY r.created_at DESC
      LIMIT 10
    `);

    return {
      totalUsers: parseInt(totalResult.rows[0].count),
      searchingUsers: parseInt(searchingResult.rows[0].count),
      matchedUsers: parseInt(matchedResult.rows[0].count),
      idleUsers: parseInt(idleResult.rows[0].count),
      platformStats: {
        whatsapp: parseInt(waResult.rows[0].count),
        telegram: parseInt(tgResult.rows[0].count),
      },
      activeMatches: parseInt(activeMatchesResult.rows[0].count),
      recentMatches: recentMatchesResult.rows.map(m => ({
        ...m,
        user1: m.user1 || 'Anonymous',
        user2: m.user2 || 'Anonymous'
      })),
      feedbacks: feedbacksResult.rows.map(f => ({
        ...f,
        username: f.username || 'Anonymous'
      })),
      reports: reportsResult.rows.map(r => ({
        ...r,
        reporter: r.reporter || 'Anonymous',
        reported: r.reported || 'Anonymous'
      })),
    };
  }

  /**
   * Helper to mask sensitive IDs (e.g. phone numbers)
   */
  private maskId(id: string): string {
    if (!id) return 'Unknown';
    if (id.includes('@')) return id.split('@')[0].slice(0, 4) + '...'; // WhatsApp
    if (id.length <= 6) return id;
    return id.slice(0, 3) + '...' + id.slice(-3);
  }

  async resetStats(): Promise<void> {
    // Completely wipe all user-related data for a fresh launch
    // CASCADE ensures matches, reports, contacts, and blocked_users are also cleared
    await query("TRUNCATE TABLE users CASCADE");
    // Feedbacks and reports might need separate truncate if not cascaded
    await query("TRUNCATE TABLE feedbacks");
    await query("TRUNCATE TABLE reports");
  }
}
