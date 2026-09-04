import { query, withTransaction } from '../../infrastructure/database/pool';
import { enqueueOutbox } from '../../infrastructure/database/outbox';
import { User, UserStatus, Match } from '../../types/models';
import { UserService } from './user';
import { normalizeInterest } from '../../utils/interests';

const MATCH_MESSAGE = (interests: string[]) => {
  const hasInterests = interests.length > 0;
  const interestList = hasInterests ? interests.join(', ') : 'Random Vibes';
  const icebreakers = [
    "What's the most recent thing you did related to these interests?",
    'If you had to pick one of these for the rest of your life, which one?',
    'Who is your favorite person/creator in this space?',
    'Got any unpopular opinions about these?'
  ];
  // Deterministic for retries of the same transaction.
  const tip = icebreakers[interests.length % icebreakers.length];
  return {
    type: 'buttons',
    title: '🎉 MATCH FOUND!',
    body: `${hasInterests ? 'You both like: ' + interestList : '🎲 This is a Random Match!'}\n\n💡 *Icebreaker:* ${tip}\n\nClick below within 60 seconds to open the chat!`,
    buttons: [
      { id: 'ready_confirm', text: '✅ I\'m Ready!' },
      { id: 'stop', text: '🚪 Skip' }
    ]
  } as any;
};

const MATCH_ENDED_MESSAGE = (reason: string): any => ({
  type: 'text' as const,
  content: `🚪 Match ended: ${reason}.`
});

export class MatchmakingService {
  constructor(private userService: UserService) {}

  async findMatch(userId: string, isRandom = false, existingUser?: User): Promise<Match | null> {
    const user = existingUser || await this.userService.getUserById(userId);
    if (!user || user.status !== UserStatus.SEARCHING || (!isRandom && user.normalizedInterests.length === 0)) return null;

    return withTransaction(async client => {
      const current = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!current.rows[0] || current.rows[0].status !== UserStatus.SEARCHING) return null;
      const freshUser = this.userFromRow(current.rows[0]);

      const result = await client.query(`
        SELECT *,
          CASE WHEN $6 = TRUE THEN 1 ELSE (
            SELECT count(*) FROM unnest(normalized_interests) i WHERE i = ANY($2)
          ) END AS overlap_count
        FROM users
        WHERE status = 'searching'
          AND id != $1
          AND is_banned = FALSE
          AND platform = 'whatsapp'
          AND ($6 = TRUE OR normalized_interests && $2)
          AND (purpose = 'both' OR $3 = 'both' OR purpose = $3)
          AND ($4 = 'both' OR $4 = gender)
          AND (pref_gender = 'both' OR pref_gender = $5)
          AND (age IS NULL OR (age >= $9 AND age <= $10))
	  AND ($11::int IS NULL OR ($11::int >= pref_age_min AND $11::int <= pref_age_max))
          AND id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = $1)
          AND id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = $1)
        ORDER BY
          (CASE WHEN mood = $7 AND $7 != 'None' THEN 3 ELSE 0 END) +
          (CASE WHEN mood != 'None' THEN 1 ELSE 0 END) +
          (CASE WHEN $6 = TRUE THEN 1 ELSE (
            SELECT count(*) FROM unnest(normalized_interests) i WHERE i = ANY($2)
          ) END) DESC,
          ABS(trust_score - $8) ASC,
          created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `, [
        userId, freshUser.normalized_interests || [], freshUser.purpose || 'both',
        freshUser.prefGender || 'both', freshUser.gender || 'other', isRandom,
        freshUser.mood || '', freshUser.trustScore || 100, freshUser.prefAgeMin || 18,
        freshUser.prefAgeMax || 99, freshUser.age || null
      ]);

      if (!result.rows.length) {
        await client.query('UPDATE users SET last_match_attempt_at = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
        return null;
      }

      const partner = result.rows[0];
      const sharedInterests = (freshUser.interests || []).filter((interest: string) => {
        if (!interest) return false;
        const normalized = normalizeInterest(interest);
        return normalized.cluster && (partner.normalized_interests || []).includes(normalized.cluster);
      });

      const [u1, u2] = [userId, partner.id].sort();
      const matchResult = await client.query(
        `INSERT INTO matches (user_1_id, user_2_id, shared_interests)
         VALUES ($1, $2, $3) RETURNING *`,
        [u1, u2, sharedInterests]
      );
      const match = matchResult.rows[0];

      await client.query(
        `UPDATE users SET status = 'matched', current_match_id = $1, is_ready = FALSE,
                         last_activity_at = CURRENT_TIMESTAMP
         WHERE id IN ($2, $3)`,
        [match.id, userId, partner.id]
      );

      const u1Message = MATCH_MESSAGE(match.shared_interests || []);
      const u2Message = MATCH_MESSAGE(match.shared_interests || []);
      await enqueueOutbox(client, {
        dedupeKey: `match:${match.id}:user:${userId}:found`,
        platform: freshUser.platform,
        recipientExternalId: freshUser.externalId,
        message: u1Message
      });
      await enqueueOutbox(client, {
        dedupeKey: `match:${match.id}:user:${partner.id}:found`,
        platform: partner.platform,
        recipientExternalId: partner.external_id,
        message: u2Message
      });

      return {
        id: match.id,
        userIds: [match.user_1_id, match.user_2_id],
        startedAt: match.started_at,
        lastActivityAt: match.last_activity_at,
        interests: match.shared_interests || []
      };
    });
  }

  async endMatch(matchId: string, reason = 'Chat ended', notify = true): Promise<string[]> {
    return withTransaction(async client => {
      const result = await client.query(
        `UPDATE matches SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
         WHERE id = $1 AND ended_at IS NULL
         RETURNING id, user_1_id, user_2_id`, [matchId]
      );
      if (!result.rows.length) return [];
      const row = result.rows[0];

      const users = await client.query('SELECT id, external_id, platform FROM users WHERE id IN ($1, $2) FOR UPDATE', [row.user_1_id, row.user_2_id]);
      await client.query(
        `UPDATE users SET status = 'idle', current_match_id = NULL, is_ready = FALSE,
                         last_activity_at = CURRENT_TIMESTAMP
         WHERE id IN ($1, $2)`,
        [row.user_1_id, row.user_2_id]
      );

      if (notify) {
        for (const u of users.rows) {
          await enqueueOutbox(client, {
            dedupeKey: `match:${matchId}:user:${u.id}:ended`,
            platform: u.platform,
            recipientExternalId: u.external_id,
            message: MATCH_ENDED_MESSAGE(reason)
          });
        }
      }
      return [row.user_1_id, row.user_2_id];
    });
  }

  async updateMatchActivity(matchId: string): Promise<void> {
    await query('UPDATE matches SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1 AND ended_at IS NULL', [matchId]);
  }

  async getActiveMatch(userId: string): Promise<Match | null> {
    const result = await query(
      `SELECT * FROM matches WHERE (user_1_id = $1 OR user_2_id = $1) AND ended_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!result.rows.length) return null;
    const m = result.rows[0];
    return {
      id: m.id,
      userIds: [m.user_1_id, m.user_2_id],
      startedAt: m.started_at,
      endedAt: m.ended_at || undefined,
      lastActivityAt: m.last_activity_at,
      interests: m.shared_interests || []
    };
  }

  async cleanupInactiveMatches(minutes: number): Promise<string[]> {
    const result = await withTransaction(async client => {
      const rows = await client.query(
        `SELECT id FROM matches
         WHERE ended_at IS NULL
           AND last_activity_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 minute')
         ORDER BY last_activity_at
         FOR UPDATE SKIP LOCKED LIMIT 100`, [minutes]
      );
      const ids = rows.rows.map((r: any) => r.id);
      const users: string[] = [];
      for (const id of ids) {
        const ended = await this.endMatchInTransaction(client, id, 'Match ended due to inactivity');
        users.push(...ended);
      }
      return users;
    });
    return result;
  }

  async cleanupPendingHandshakes(timeoutMinutes: number): Promise<string[]> {
    return withTransaction(async client => {
      const rows = await client.query(
        `SELECT m.id FROM matches m
         JOIN users u1 ON m.user_1_id = u1.id
         JOIN users u2 ON m.user_2_id = u2.id
         WHERE m.ended_at IS NULL
           AND (u1.is_ready = FALSE OR u2.is_ready = FALSE)
           AND m.started_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 minute')
         ORDER BY m.started_at
         FOR UPDATE OF m SKIP LOCKED LIMIT 100`, [timeoutMinutes]
      );
      const users: string[] = [];
      for (const row of rows.rows) users.push(...await this.endMatchInTransaction(client, row.id, 'Match timed out (no confirmation)'));
      return users;
    });
  }

  private async endMatchInTransaction(client: any, matchId: string, reason: string): Promise<string[]> {
    const result = await client.query(
      `UPDATE matches SET ended_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND ended_at IS NULL
       RETURNING id, user_1_id, user_2_id`, [matchId]
    );
    if (!result.rows.length) return [];
    const row = result.rows[0];
    const users = await client.query('SELECT id, external_id, platform FROM users WHERE id IN ($1, $2) FOR UPDATE', [row.user_1_id, row.user_2_id]);
    await client.query(
      `UPDATE users SET status='idle', current_match_id=NULL, is_ready=FALSE,
                        last_activity_at=CURRENT_TIMESTAMP
       WHERE id IN ($1, $2)`, [row.user_1_id, row.user_2_id]
    );
    for (const u of users.rows) {
      await enqueueOutbox(client, {
        dedupeKey: `match:${matchId}:user:${u.id}:ended`,
        platform: u.platform,
        recipientExternalId: u.external_id,
        message: MATCH_ENDED_MESSAGE(reason)
      });
    }
    return [row.user_1_id, row.user_2_id];
  }

  private userFromRow(row: any): any {
    return {
      externalId: row.external_id, platform: row.platform, username: row.username,
      purpose: row.purpose, normalized_interests: row.normalized_interests || [],
      normalizedInterests: row.normalized_interests || [], interests: row.interests || [],
      prefGender: row.pref_gender, gender: row.gender, age: row.age,
      prefAgeMin: row.pref_age_min, prefAgeMax: row.pref_age_max, mood: row.mood,
      trustScore: row.trust_score
    };
  }
}
