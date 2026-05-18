/**
 * Simple In-Memory Rate Limiter to prevent spam
 */
export class RateLimiter {
  private userMessages: Map<string, { count: number, lastReset: number, blockedUntil: number }> = new Map();
  
  private readonly WINDOW_MS = 5000; // 5 seconds
  private readonly MAX_MESSAGES = 10; // Max 10 messages per 5 seconds
  private readonly BLOCK_DURATION = 30000; // Block for 30 seconds if exceeded

  /**
   * Check if a user is allowed to send a message.
   * Returns true if allowed, false if rate limited.
   */
  isAllowed(userId: string): boolean {
    const now = Date.now();
    let user = this.userMessages.get(userId);

    // Initialize user if not exists
    if (!user) {
      user = { count: 0, lastReset: now, blockedUntil: 0 };
      this.userMessages.set(userId, user);
    }

    // Check if currently blocked
    if (now < user.blockedUntil) {
      return false;
    }

    // Reset window if needed
    if (now - user.lastReset > this.WINDOW_MS) {
      user.count = 0;
      user.lastReset = now;
    }

    // Increment count
    user.count++;

    // Check if limit exceeded
    if (user.count > this.MAX_MESSAGES) {
      user.blockedUntil = now + this.BLOCK_DURATION;
      console.warn(`🚦 Rate limit exceeded for user ${userId}. Blocked for 30s.`);
      return false;
    }

    return true;
  }
}
