import { query, withTransaction } from '../infrastructure/database/pool';

/** PostgreSQL-backed rate limiter. The database is the source of truth. */
export class RateLimiter {
  private readonly WINDOW_SECONDS = 5;
  private readonly MAX_MESSAGES = 10;
  private readonly BLOCK_SECONDS = 30;

  async isAllowed(userId: string): Promise<boolean> {
    return withTransaction(async client => {
      await client.query(
        `INSERT INTO rate_limits (key, window_started_at, message_count, blocked_until)
         VALUES ($1, CURRENT_TIMESTAMP, 0, NULL)
         ON CONFLICT (key) DO NOTHING`,
        [userId]
      );

      const rowResult = await client.query(
        `SELECT window_started_at, message_count, blocked_until
         FROM rate_limits WHERE key = $1 FOR UPDATE`,
        [userId]
      );
      const row = rowResult.rows[0];
      const now = new Date();

      if (row.blocked_until && new Date(row.blocked_until) > now) return false;

      const windowAgeMs = now.getTime() - new Date(row.window_started_at).getTime();
      let count = Number(row.message_count);
      let windowStartedAt = row.window_started_at;

      if (windowAgeMs >= this.WINDOW_SECONDS * 1000) {
        count = 0;
        windowStartedAt = now.toISOString();
      }

      count += 1;
      if (count > this.MAX_MESSAGES) {
        await client.query(
          `UPDATE rate_limits
           SET message_count = $2,
               window_started_at = $3,
               blocked_until = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
               updated_at = CURRENT_TIMESTAMP
           WHERE key = $1`,
          [userId, count, windowStartedAt, this.BLOCK_SECONDS]
        );
        return false;
      }

      await client.query(
        `UPDATE rate_limits
         SET message_count = $2, window_started_at = $3,
             blocked_until = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE key = $1`,
        [userId, count, windowStartedAt]
      );
      return true;
    });
  }
}
