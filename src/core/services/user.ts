import { query } from '../../infrastructure/database/pool';
import { User, Platform, UserStatus } from '../../types/models';
import { normalizeInterests } from '../../utils/interests';

export class UserService {
  /**
   * Find a user by their platform-specific ID or create a new one if they don't exist.
   */
  async getOrCreateUser(externalId: string, platform: Platform, username?: string): Promise<User> {
    const sanitizedUsername = username ? this.sanitize(username) : undefined;
    
    const findSql = `
      SELECT * FROM users 
      WHERE external_id = $1 AND platform = $2
    `;
    const findResult = await query(findSql, [externalId, platform]);

    if (findResult.rows.length > 0) {
      const user = findResult.rows[0];
      // Update username if it changed
      if (sanitizedUsername && user.username !== sanitizedUsername) {
        await query('UPDATE users SET username = $1 WHERE id = $2', [sanitizedUsername, user.id]);
        user.username = sanitizedUsername;
      }
      return this.mapRowToUser(user);
    }

    const createSql = `
      INSERT INTO users (external_id, platform, username, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const createResult = await query(createSql, [externalId, platform, sanitizedUsername, UserStatus.IDLE]);
    return this.mapRowToUser(createResult.rows[0]);
  }

  /**
   * Simple HTML sanitization to prevent XSS in dashboard
   */
  private sanitize(str: string): string {
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m] || m)).substring(0, 100);
  }

  /**
   * Update a user's interests.
   */
  async updateInterests(userId: string, interests: string[]): Promise<void> {
    const results = normalizeInterests(interests);
    const normalized = results.map(r => r.cluster).filter(c => c !== null) as string[];
    
    const sql = `
      UPDATE users 
      SET interests = $1, normalized_interests = $2 
      WHERE id = $3
    `;
    await query(sql, [interests, normalized, userId]);
  }

  /**
   * Update a user's status (e.g., idle -> searching).
   */
  async updateStatus(userId: string, status: UserStatus, currentMatchId: string | null = null, activeContactId: string | null = null): Promise<void> {
    const sql = `
      UPDATE users 
      SET status = $1, current_match_id = $2, active_contact_id = $3, is_ready = FALSE, last_activity_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `;
    await query(sql, [status, currentMatchId, activeContactId, userId]);
  }

  /**
   * Update a user's readiness for a match.
   */
  async updateReadyStatus(userId: string, isReady: boolean): Promise<void> {
    const sql = `UPDATE users SET is_ready = $1 WHERE id = $2`;
    await query(sql, [isReady, userId]);
  }

  /**
   * Get the count of users currently searching for a match.
   */
  async getSearchingCount(gender?: string): Promise<number> {
    let sql = "SELECT count(*) FROM users WHERE status = 'searching'";
    const params: any[] = [];
    
    if (gender && gender !== 'both') {
      sql += " AND gender = $1";
      params.push(gender);
    }
    
    const result = await query(sql, params);
    return parseInt(result.rows[0].count);
  }

  /**
   * Get all users currently in the searching state.
   */
  async getSearchingUsers(limit: number = 100): Promise<User[]> {
    const result = await query("SELECT * FROM users WHERE status = 'searching' LIMIT $1", [limit]);
    return result.rows.map(row => this.mapRowToUser(row));
  }

  /**
   * Get the most popular interests across the platform.
   */
  async getTrendingInterests(): Promise<string[]> {
    const sql = `
      SELECT interest, count(*) 
      FROM users, unnest(normalized_interests) as interest 
      GROUP BY interest 
      ORDER BY count DESC 
      LIMIT 5
    `;
    const result = await query(sql);
    return result.rows.map(r => r.interest.replace('_cluster', ''));
  }

  /**
   * Get global stats for social proof.
   */
  async getGlobalStats(gender?: string): Promise<{ activeNow: number, matchesToday: number }> {
    let activeSql = "SELECT count(*) FROM users WHERE last_activity_at > (CURRENT_TIMESTAMP - INTERVAL '15 minutes')";
    const activeParams: any[] = [];
    
    // Strict gender filtering for active users
    if (gender === 'male' || gender === 'female' || gender === 'other') {
      activeSql += " AND gender = $1";
      activeParams.push(gender);
    }

    const activeResult = await query(activeSql, activeParams);
    const matchesResult = await query(
      "SELECT count(*) FROM matches WHERE started_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours')"
    );
    return {
      activeNow: parseInt(activeResult.rows[0].count),
      matchesToday: parseInt(matchesResult.rows[0].count)
    };
  }

  /**
   * Update a user's mood.
   */
  async updateMood(userId: string, mood: string): Promise<void> {
    await query('UPDATE users SET mood = $1 WHERE id = $2', [mood, userId]);
  }

  /**
   * Update last activity for a user.
   */
  async updateLastActivity(userId: string): Promise<void> {
    await query('UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
  }

  /**
   * Update last match attempt for a user.
   */
  async updateLastMatchAttempt(userId: string): Promise<void> {
    await query('UPDATE users SET last_match_attempt_at = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
  }

  /**
   * Toggle media acceptance.
   */
  async toggleMedia(userId: string, accept: boolean): Promise<void> {
    await query('UPDATE users SET accept_media = $1 WHERE id = $2', [accept, userId]);
  }

  /**
   * Claim daily activity reward.
   */
  async claimDailyReward(userId: string): Promise<boolean> {
    const checkSql = `
      SELECT last_reward_at FROM users 
      WHERE id = $1 AND (last_reward_at IS NULL OR last_reward_at < CURRENT_DATE)
    `;
    const result = await query(checkSql, [userId]);
    
    if (result.rows.length > 0) {
      await query('UPDATE users SET trust_score = trust_score + 2, last_reward_at = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
      return true;
    }
    return false;
  }

  /**
   * Update trust score.
   */
  async updateTrustScore(userId: string, delta: number): Promise<void> {
    await query('UPDATE users SET trust_score = trust_score + $1 WHERE id = $2', [delta, userId]);
  }

  /**
   * Update a user's bio.
   */
  async updateBio(userId: string, bio: string): Promise<void> {
    await query('UPDATE users SET bio = $1 WHERE id = $2', [bio, userId]);
  }

  /**
   * Update a user's age.
   */
  async updateAge(userId: string, age: number): Promise<void> {
    await query('UPDATE users SET age = $1 WHERE id = $2', [age, userId]);
  }

  /**
   * Update a user's age preference.
   */
  async updatePrefAge(userId: string, min: number, max: number): Promise<void> {
    await query('UPDATE users SET pref_age_min = $1, pref_age_max = $2 WHERE id = $3', [min, max, userId]);
  }

  /**
   * Update a user's gender.
   */
  async updateGender(userId: string, gender: string): Promise<void> {
    await query('UPDATE users SET gender = $1 WHERE id = $2', [gender, userId]);
  }

  /**
   * Update a user's gender preference.
   */
  async updatePrefGender(userId: string, gender: string): Promise<void> {
    await query('UPDATE users SET pref_gender = $1 WHERE id = $2', [gender, userId]);
  }

  /**
   * Update a user's purpose.
   */
  async updatePurpose(userId: string, purpose: string): Promise<void> {
    await query('UPDATE users SET purpose = $1 WHERE id = $2', [purpose, userId]);
  }

  /**
   * Update a user's onboarding step.
   */
  async updateOnboardingStep(userId: string, step: string): Promise<void> {
    await query('UPDATE users SET onboarding_step = $1 WHERE id = $2', [step, userId]);
  }

  /**
   * Block a user.
   */
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    const sql = `
      INSERT INTO blocked_users (blocker_id, blocked_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `;
    await query(sql, [blockerId, blockedId]);
  }

  /**
   * Send a friend request.
   */
  async sendFriendRequest(userId: string, contactId: string): Promise<void> {
    const sql = `
      INSERT INTO contacts (user_id, contact_id, status)
      VALUES ($1, $2, 'pending')
      ON CONFLICT DO NOTHING
    `;
    await query(sql, [userId, contactId]);
  }

  /**
   * Accept a friend request.
   */
  async acceptFriendRequest(userId: string, contactId: string): Promise<void> {
    const sql = `
      UPDATE contacts 
      SET status = 'accepted' 
      WHERE (user_id = $1 AND contact_id = $2) 
      OR (user_id = $2 AND contact_id = $1)
    `;
    await query(sql, [userId, contactId]);
    
    // Also ensure the reverse relationship exists as accepted
    const ensureSql = `
      INSERT INTO contacts (user_id, contact_id, status)
      VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')
      ON CONFLICT (user_id, contact_id) DO UPDATE SET status = 'accepted'
    `;
    await query(ensureSql, [userId, contactId]);

    // Issue #4: Reward both users for a successful connection
    await this.updateTrustScore(userId, 10);
    await this.updateTrustScore(contactId, 10);
  }

  /**
   * Decline a friend request.
   */
  async declineFriendRequest(userId: string, contactId: string): Promise<void> {
    const sql = `
      DELETE FROM contacts 
      WHERE (user_id = $1 AND contact_id = $2 AND status = 'pending')
      OR (user_id = $2 AND contact_id = $1 AND status = 'pending')
    `;
    await query(sql, [userId, contactId]);
  }

  /**
   * Get all accepted contacts for a user.
   */
  async getContacts(userId: string): Promise<User[]> {
    const sql = `
      SELECT u.* FROM users u
      JOIN contacts c ON u.id = c.contact_id
      WHERE c.user_id = $1 AND c.status = 'accepted'
    `;
    const result = await query(sql, [userId]);
    return result.rows.map(row => this.mapRowToUser(row));
  }

  /**
   * Check if two users are contacts.
   */
  async areContacts(userId1: string, userId2: string): Promise<boolean> {
    const sql = `
      SELECT 1 FROM contacts 
      WHERE user_id = $1 AND contact_id = $2 AND status = 'accepted'
    `;
    const result = await query(sql, [userId1, userId2]);
    return result.rows.length > 0;
  }

  /**
   * Get a pending friend request for a user.
   */
  async getPendingFriendRequest(userId: string): Promise<string | null> {
    const sql = `
      SELECT user_id FROM contacts 
      WHERE contact_id = $1 AND status = 'pending' 
      LIMIT 1
    `;
    const result = await query(sql, [userId]);
    return result.rows.length > 0 ? result.rows[0].user_id : null;
  }

  /**
   * Delete a user profile.
   */
  async deleteUser(userId: string): Promise<void> {
    // Delete all related data to satisfy foreign key constraints
    await query('DELETE FROM contacts WHERE user_id = $1 OR contact_id = $1', [userId]);
    await query('DELETE FROM blocked_users WHERE blocker_id = $1 OR blocked_id = $1', [userId]);
    await query('DELETE FROM matches WHERE user_1_id = $1 OR user_2_id = $1', [userId]);
    await query('DELETE FROM reports WHERE reporter_id = $1 OR reported_id = $1', [userId]);
    
    // Finally delete the user
    await query('DELETE FROM users WHERE id = $1', [userId]);
  }

  /**
   * Report a user.
   */
  async reportUser(reporterId: string, reportedId: string, reason: string, chatLog: any[] = []): Promise<void> {
    await query('INSERT INTO reports (reporter_id, reported_id, reason, chat_log) VALUES ($1, $2, $3, $4)', [reporterId, reportedId, reason, JSON.stringify(chatLog)]);
    
    // Auto-ban logic: if user has 3 or more reports, ban them
    const countResult = await query('SELECT count(*) FROM reports WHERE reported_id = $1', [reportedId]);
    if (parseInt(countResult.rows[0].count) >= 3) {
      await query('UPDATE users SET is_banned = TRUE WHERE id = $1', [reportedId]);
    }
  }

  /**
   * Save user feedback.
   */
  async saveFeedback(userId: string, content: string): Promise<void> {
    await query('INSERT INTO feedbacks (user_id, content) VALUES ($1, $2)', [userId, content]);
  }

  /**
   * Map database row to User interface.
   */
  private mapRowToUser(row: any): User {
    return {
      id: row.id,
      externalId: row.external_id,
      platform: row.platform as Platform,
      username: row.username,
      bio: row.bio,
      gender: row.gender,
      prefGender: row.pref_gender,
      age: row.age,
      prefAgeMin: row.pref_age_min,
      prefAgeMax: row.pref_age_max,
      purpose: row.purpose,
      mood: row.mood,
      onboardingStep: row.onboarding_step || 'start',
      interests: row.interests || [],
      normalizedInterests: row.normalized_interests || [],
      status: row.status as UserStatus,
      currentMatchId: row.current_match_id,
      activeContactId: row.active_contact_id,
      isReady: row.is_ready || false,
      isBanned: row.is_banned || false,
      trustScore: row.trust_score,
      acceptMedia: row.accept_media,
      lastMatchAttemptAt: row.last_match_attempt_at,
      lastActivityAt: row.last_activity_at,
      blockedUserIds: [], // These could be loaded via a separate join if needed
      contactIds: [],
      pendingContactIds: [],
      createdAt: row.created_at,
    };
  }

  /**
   * Get a user by internal UUID.
   */
  async getUserById(id: string): Promise<User | null> {
    const sql = 'SELECT * FROM users WHERE id = $1';
    const result = await query(sql, [id]);
    return result.rows.length > 0 ? this.mapRowToUser(result.rows[0]) : null;
  }
}
