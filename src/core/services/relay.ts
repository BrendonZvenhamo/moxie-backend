import { UserService } from './user';
import { MatchmakingService } from './matchmaker';
import { IncomingMessage, IPlatformAdapter } from '../interfaces/platform';
import { Platform } from '../../types/models';
import { withTransaction } from '../../infrastructure/database/pool';
import { enqueueOutbox, enqueueOutboxStandalone } from '../../infrastructure/database/outbox';

export class RelayService {
  public adapters: Map<Platform, IPlatformAdapter> = new Map();

  constructor(
    private userService: UserService,
    private matchmaker: MatchmakingService
  ) {}

  registerAdapter(platform: Platform, adapter: IPlatformAdapter): void {
    this.adapters.set(platform, adapter);
  }

  /** Durable inbound -> outbound relay. DB state and outbound intent commit atomically. */
  async relayMessage(msg: IncomingMessage, sourcePlatform: Platform): Promise<boolean> {
    const result = await withTransaction(async client => {
      const userResult = await client.query(
        'SELECT * FROM users WHERE external_id = $1 AND platform = $2 FOR UPDATE',
        [msg.externalId, sourcePlatform]
      );
      if (!userResult.rows.length) return { ok: false };
      const user = userResult.rows[0];

      let partner: any = null;
      let matchId: string | null = null;
      if (user.current_match_id) {
        const matchResult = await client.query(
          `SELECT m.*, p.id AS partner_id, p.external_id AS partner_external_id,
                  p.platform AS partner_platform, p.is_ready AS partner_is_ready
           FROM matches m
           JOIN users p ON p.id = CASE WHEN m.user_1_id = $1 THEN m.user_2_id ELSE m.user_1_id END
           WHERE m.id = $2 AND m.ended_at IS NULL
           FOR UPDATE OF m, p`,
          [user.id, user.current_match_id]
        );
        if (matchResult.rows.length) {
          const m = matchResult.rows[0];
          if (!user.is_ready || !m.partner_is_ready) return { ok: false, waiting: true };
          partner = {
            id: m.partner_id,
            externalId: m.partner_external_id,
            platform: m.partner_platform
          };
          matchId = m.id;

          await client.query('UPDATE matches SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1', [m.id]);
          await client.query('UPDATE users SET last_activity_at = CURRENT_TIMESTAMP WHERE id IN ($1, $2)', [user.id, partner.id]);

          if (msg.text || msg.media) {
            await client.query(
              `INSERT INTO match_messages (match_id, sender_id, content_type, text_content, media_metadata)
               VALUES ($1, $2, $3, $4, $5::jsonb)`,
              [
                matchId,
                user.id,
                msg.text ? 'text' : msg.media?.type || 'media',
                msg.text || null,
                msg.media ? JSON.stringify({ type: msg.media.type, caption: msg.media.caption || null }) : null
              ]
            );
          }
        }
      } else if (user.active_contact_id) {
        const partnerResult = await client.query(
          'SELECT id, external_id, platform FROM users WHERE id = $1 FOR UPDATE',
          [user.active_contact_id]
        );
        partner = partnerResult.rows[0] || null;
      }

      if (!partner) return { ok: false };

      if (msg.media) {
        const maxSize = 5 * 1024 * 1024 * 1.37;
        if (msg.media.url.length > maxSize) return { ok: false, tooLarge: true };
      }

      const payload: any = msg.text
        ? { type: 'text', content: msg.text }
        : { type: msg.media?.type, url: msg.media?.url, caption: msg.media?.caption };

      const dedupe = matchId
        ? `relay:${matchId}:sender:${user.id}:event:${msg.timestamp.getTime()}:${Buffer.from(JSON.stringify(payload)).toString('base64url').slice(0, 120)}`
        : `relay:contact:${user.id}:${partner.id}:${msg.timestamp.getTime()}:${Buffer.from(JSON.stringify(payload)).toString('base64url').slice(0, 120)}`;

      await enqueueOutbox(client, {
        dedupeKey: dedupe,
        platform: partner.platform,
        recipientExternalId: partner.externalId,
        message: payload
      });
      return { ok: true };
    });

    if (result.waiting || result.tooLarge) {
      const content = result.waiting
        ? '⏳ Waiting for both users to click "I\'m Ready" before opening the chat.'
        : '⚠️ File too large! Please send files smaller than 5MB.';
      const reason = result.waiting ? 'waiting' : 'too_large';
      await enqueueOutboxStandalone({
        dedupeKey: `relay:${reason}:${sourcePlatform}:${msg.externalId}:${msg.timestamp.getTime()}`,
        platform: sourcePlatform,
        recipientExternalId: msg.externalId,
        message: { type: 'text', content }
      });
    }
    return Boolean(result.ok);
  }

  async relayTypingState(externalId: string, sourcePlatform: Platform): Promise<void> {
    const user = await this.userService.getOrCreateUser(externalId, sourcePlatform);
    if (!user.currentMatchId) return;
    const match = await this.matchmaker.getActiveMatch(user.id);
    if (!match) return;
    const partnerId = match.userIds.find(id => id !== user.id);
    if (!partnerId) return;
    const partner = await this.userService.getUserById(partnerId);
    if (!partner) return;
    // Typing indicators are intentionally ephemeral and are not persisted in the outbox.
    const adapter = this.adapters.get(partner.platform);
    if (adapter) await adapter.sendTypingState(partner.externalId);
  }

  async notifyFriendRequest(fromUserId: string, toUserId: string): Promise<void> {
    const fromUser = await this.userService.getUserById(fromUserId);
    const toUser = await this.userService.getUserById(toUserId);
    if (!fromUser || !toUser) return;
    await enqueueOutboxStandalone({
      dedupeKey: `friend-request:${fromUserId}:${toUserId}`,
      platform: toUser.platform,
      recipientExternalId: toUser.externalId,
      message: {
        type: 'buttons', title: '👥 FRIEND REQUEST',
        body: `${fromUser.username} wants to add you to their contacts. Do you accept?`,
        buttons: [{ id: 'accept_friend', text: '✅ Accept' }, { id: 'decline_friend', text: '❌ Decline' }]
      } as any
    });
  }

  async notifyFriendAccepted(userId1: string, userId2: string): Promise<void> {
    const u1 = await this.userService.getUserById(userId1);
    const u2 = await this.userService.getUserById(userId2);
    if (!u1 || !u2) return;
    await Promise.all([
      enqueueOutboxStandalone({
        dedupeKey: `friend-accepted:${userId1}:${userId2}:a`,
        platform: u1.platform,
        recipientExternalId: u1.externalId,
        message: { type: 'text', content: `✅ You are now friends with ${u2.username}!` }
      }),
      enqueueOutboxStandalone({
        dedupeKey: `friend-accepted:${userId1}:${userId2}:b`,
        platform: u2.platform,
        recipientExternalId: u2.externalId,
        message: { type: 'text', content: `✅ You are now friends with ${u1.username}!` }
      })
    ]);
  }


  async getChatLog(matchId: string): Promise<{ sender: string, text: string }[]> {
    const result = await import('../../infrastructure/database/pool').then(({ query }) => query(
      `SELECT u.username, u.external_id, mm.text_content
       FROM match_messages mm
       JOIN users u ON u.id = mm.sender_id
       WHERE mm.match_id = $1 AND mm.text_content IS NOT NULL
       ORDER BY mm.created_at DESC LIMIT 5`, [matchId]
    ));
    return result.rows.reverse().map(row => ({ sender: row.username || row.external_id, text: row.text_content }));
  }

  clearChatLog(_matchId: string): void {}
}
