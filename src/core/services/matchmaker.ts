import { query, withTransaction } from '../../infrastructure/database/pool';
import { User, UserStatus, Match } from '../../types/models';
import { UserService } from './user';
import { normalizeInterest } from '../../utils/interests';

export class MatchmakingService {
  constructor(private userService: UserService) {}

  /**
   * Attempt to find a match for a user based on shared interests.
   * If a match is found, it creates the match in the DB and updates both users.
   */
  async findMatch(userId: string, isRandom: boolean = false): Promise<Match | null> {
    const user = await this.userService.getUserById(userId);
    if (!user || user.status !== UserStatus.SEARCHING || (!isRandom && user.normalizedInterests.length === 0)) return null;

    return withTransaction(async (client) => {
      // Find another user who is 'searching', not the same user, 
      // has at least one overlapping NORMALIZED interest,
      // has a compatible purpose, is NOT banned,
      // and satisfies GENDER PREFERENCES for BOTH parties.
      const findMatchSql = `
        SELECT *, (
          CASE WHEN $6 = TRUE THEN 1 ELSE (
            SELECT count(*) 
            FROM unnest(normalized_interests) i 
            WHERE i = ANY($2)
          ) END
        ) as overlap_count
        FROM users 
        WHERE status = 'searching' 
        AND id != $1 
        AND is_banned = FALSE
        AND ($6 = TRUE OR normalized_interests && $2)
        AND (
          purpose = 'both' OR $3 = 'both' OR purpose = $3
        )
        -- Gender Preference Logic
        AND (
          $4 = 'both' OR $4 = gender
        )
        AND (
          pref_gender = 'both' OR pref_gender = $5
        )
        AND id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = $1)
        AND id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = $1)
        -- Issue #4: Prioritize users with similar quality/behavior scores
        -- Similarity is calculated by minimizing the absolute difference in trust_score
        ORDER BY overlap_count DESC, ABS(trust_score - (SELECT trust_score FROM users WHERE id = $1)) ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;
      `;

      const result = await client.query(findMatchSql, [
        userId, 
        user.normalizedInterests, 
        user.purpose || 'both',
        user.prefGender || 'both',
        user.gender || 'other',
        isRandom,
        user.mood || ''
      ]);

      if (result.rows.length === 0) {
        // No match found, ensure user is in 'searching' status
        await client.query("UPDATE users SET status = 'searching', last_match_attempt_at = CURRENT_TIMESTAMP WHERE id = $1", [userId]);
        return null;
      }

      const partner = result.rows[0];

      // For shared interests, we'll show the actual words that overlapped
      const sharedInterests = user.interests.filter(i => {
        const res = normalizeInterest(i);
        return res.cluster && partner.normalized_interests.includes(res.cluster);
      });

      // Create the match
      const createMatchSql = `
        INSERT INTO matches (user_1_id, user_2_id, shared_interests)
        VALUES ($1, $2, $3)
        RETURNING *
      `;
      
      const [u1, u2] = [userId, partner.id].sort();
      const matchResult = await client.query(createMatchSql, [u1, u2, sharedInterests]);
      const match = matchResult.rows[0];

      // Issue #5: Update status and reset ready check
      const updateStatusSql = `
        UPDATE users 
        SET status = 'matched', current_match_id = $1, is_ready = FALSE
        WHERE id = $2
      `;
      await client.query(updateStatusSql, [match.id, userId]);
      await client.query(updateStatusSql, [match.id, partner.id]);

      return {
        id: match.id,
        userIds: [match.user_1_id, match.user_2_id],
        startedAt: match.started_at,
        lastActivityAt: match.last_activity_at,
        interests: match.shared_interests,
      };
    });
  }

  /**
   * End a match for both users.
   */
  async endMatch(matchId: string): Promise<void> {
    const endMatchSql = `
      UPDATE matches 
      SET ended_at = CURRENT_TIMESTAMP 
      WHERE id = $1 
      RETURNING user_1_id, user_2_id
    `;
    const result = await query(endMatchSql, [matchId]);

    if (result.rows.length > 0) {
      const { user_1_id, user_2_id } = result.rows[0];
      await this.userService.updateStatus(user_1_id, UserStatus.IDLE, null);
      await this.userService.updateStatus(user_2_id, UserStatus.IDLE, null);
    }
  }

  /**
   * Update the activity timestamp for a match.
   */
  async updateMatchActivity(matchId: string): Promise<void> {
    await query('UPDATE matches SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1', [matchId]);
  }

  /**
   * Automatically end matches that have been inactive (no messages) for a certain time.
   */
  async cleanupInactiveMatches(minutes: number): Promise<string[]> {
    const sql = `
      SELECT id, user_1_id, user_2_id
      FROM matches
      WHERE ended_at IS NULL
      AND last_activity_at < (CURRENT_TIMESTAMP - INTERVAL '${minutes} minutes')
    `;
    const result = await query(sql);
    const endedUserIds: string[] = [];

    for (const row of result.rows) {
      await this.endMatch(row.id);
      endedUserIds.push(row.user_1_id, row.user_2_id);
    }
    return endedUserIds;
  }

  /**
   * Automatically end matches where one or both users failed to click "Ready" in time.
   */
  async cleanupPendingHandshakes(timeoutMinutes: number): Promise<string[]> {
    const sql = `
      SELECT m.id, m.user_1_id, m.user_2_id
      FROM matches m
      JOIN users u1 ON m.user_1_id = u1.id
      JOIN users u2 ON m.user_2_id = u2.id
      WHERE m.ended_at IS NULL
      AND (u1.is_ready = FALSE OR u2.is_ready = FALSE)
      AND m.started_at < (CURRENT_TIMESTAMP - INTERVAL '${timeoutMinutes} minutes')
    `;
    const result = await query(sql);
    const endedUserIds: string[] = [];

    for (const row of result.rows) {
      await this.endMatch(row.id);
      endedUserIds.push(row.user_1_id, row.user_2_id);
    }
    return endedUserIds;
  }

  /**
   * Get the current active match for a user.
   */
  async getActiveMatch(userId: string): Promise<Match | null> {
    const sql = `
      SELECT * FROM matches 
      WHERE (user_1_id = $1 OR user_2_id = $1) 
      AND ended_at IS NULL 
      LIMIT 1
    `;
    const result = await query(sql, [userId]);
    if (result.rows.length === 0) return null;

    const m = result.rows[0];
    return {
      id: m.id,
      userIds: [m.user_1_id, m.user_2_id],
      startedAt: m.started_at,
      lastActivityAt: m.last_activity_at,
      interests: m.shared_interests,
    };
  }

  /**
   * Automatically end matches that have been inactive for a certain time.
   */
  async endExpiredMatches(minutes: number): Promise<string[]> {
    const sql = `
      UPDATE matches 
      SET ended_at = CURRENT_TIMESTAMP 
      WHERE ended_at IS NULL 
      AND started_at < (CURRENT_TIMESTAMP - INTERVAL '${minutes} minutes')
      RETURNING id, user_1_id, user_2_id
    `;
    const result = await query(sql);
    
    const endedUserIds: string[] = [];
    for (const row of result.rows) {
      await this.userService.updateStatus(row.user_1_id, UserStatus.IDLE, null);
      await this.userService.updateStatus(row.user_2_id, UserStatus.IDLE, null);
      endedUserIds.push(row.user_1_id, row.user_2_id);
    }
    return endedUserIds;
  }
}
