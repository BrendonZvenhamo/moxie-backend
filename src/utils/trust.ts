/**
 * Maps a trust score to a user-facing rank.
 */
export function getTrustRank(score: number): { name: string, emoji: string } {
  if (score >= 500) return { name: 'Moxie Legend', emoji: '👑' };
  if (score >= 300) return { name: 'Elite Citizen', emoji: '💎' };
  if (score >= 200) return { name: 'Veteran', emoji: '🏅' };
  if (score >= 100) return { name: 'Verified', emoji: '✅' };
  if (score < 50) return { name: 'Probation', emoji: '⚠️' };
  return { name: 'Newcomer', emoji: '🥚' };
}