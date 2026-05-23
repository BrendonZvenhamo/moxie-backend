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
  async findMatch(userId: string): Promise<Match | null> {
    const user = await this.userService.getUserById(userId);
    if (!user || user.normalizedInterests.length === 0) return null;

    return withTransaction(async (client) => {
      // Find another user who is 'searching', not the same user, 
      // has at least one overlapping NORMALIZED interest,
      // has a compatible purpose, is NOT banned,
      // and satisfies GENDER PREFERENCES for BOTH parties.
      const findMatchSql = `
        SELECT *, (
          SELECT count(*) 
          FROM unnest(normalized_interests) i 
          WHERE i = ANY($2)
        ) as overlap_count
        FROM users 
        WHERE status = 'searching' 
        AND id != $1 
        AND is_banned = FALSE
        AND normalized_interests && $2
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
        ORDER BY overlap_count DESC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;
      `;

      const result = await client.query(findMatchSql, [
        userId, 
        user.normalizedInterests, 
        user.purpose || 'both',
        user.prefGender || 'both',
        user.gender || 'other'
      ]);

      if (result.rows.length === 0) {
        // No match found, ensure user is in 'searching' status
        await client.query("UPDATE users SET status = 'searching' WHERE id = $1", [userId]);
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

      // Update both users to 'matched' status
      const updateStatusSql = `
        UPDATE users 
        SET status = 'matched', current_match_id = $1 
        WHERE id = $2
      `;
      await client.query(updateStatusSql, [match.id, userId]);
      await client.query(updateStatusSql, [match.id, partner.id]);

      return {
        id: match.id,
        userIds: [match.user_1_id, match.user_2_id],
        startedAt: match.started_at,
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
