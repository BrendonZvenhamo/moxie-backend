import { UserService } from './user';
import { MatchmakingService } from './matchmaker';

export async function runMaintenanceOnce(users: UserService, matchmaker: MatchmakingService): Promise<{
  timedOut: number;
  inactive: number;
  matchesCreated: number;
}> {
  const timedOut = await matchmaker.cleanupPendingHandshakes(2);
  const inactive = await matchmaker.cleanupInactiveMatches(20);
  const searching = await users.getSearchingUsers(50);
  let matchesCreated = 0;

  for (const user of searching) {
    const waitMs = Date.now() - new Date(user.lastMatchAttemptAt || user.createdAt).getTime();
    const match = await matchmaker.findMatch(user.id, waitMs > 3 * 60_000, user);
    if (match) matchesCreated += 1;
  }

  return { timedOut: timedOut.length, inactive: inactive.length, matchesCreated };
}
