import { UserService } from './user';
import { MatchmakingService } from './matchmaker';
import { IncomingMessage, IPlatformAdapter } from '../interfaces/platform';
import { Platform } from '../../types/models';
import { getMoodDecoration } from '../../utils/mood';

export class RelayService {
  private adapters: Map<Platform, IPlatformAdapter> = new Map();
  private chatBuffers: Map<string, { sender: string, text: string }[]> = new Map();

  constructor(
    private userService: UserService,
    private matchmaker: MatchmakingService
  ) {}

  /**
   * Register platform adapters so the relay knows how to send messages
   */
  registerAdapter(platform: Platform, adapter: IPlatformAdapter) {
    this.adapters.set(platform, adapter);
  }

  /**
   * Forward a message from a sender to their matched partner.
   */
  async relayMessage(msg: IncomingMessage, sourcePlatform: Platform): Promise<boolean> {
    const user = await this.userService.getOrCreateUser(msg.externalId, sourcePlatform);
    
    if (!user.currentMatchId) return false;

    const match = await this.matchmaker.getActiveMatch(user.id);
    if (!match) return false;

    // Buffering for reports (keep last 5)
    if (msg.text) {
      const buffer = this.chatBuffers.get(match.id) || [];
      buffer.push({ sender: user.username || user.externalId, text: msg.text });
      if (buffer.length > 5) buffer.shift();
      this.chatBuffers.set(match.id, buffer);
    }

    // Find the partner's ID
    const partnerId = match.userIds.find(id => id !== user.id);
    if (!partnerId) return false;

    const partner = await this.userService.getUserById(partnerId);
    if (!partner) return false;

    const targetAdapter = this.adapters.get(partner.platform);
    if (!targetAdapter) {
      console.error(`No adapter found for platform: ${partner.platform}`);
      return false;
    }

    try {
      // Forward the message
      if (msg.text) {
        await targetAdapter.sendMessage(partner.externalId, {
          type: 'text',
          content: msg.text
        });
      } else if (msg.media) {
        // 5MB limit for Base64 (approx 6.8 million characters)
        const MAX_SIZE = 5 * 1024 * 1024 * 1.37;
        if (msg.media.url.length > MAX_SIZE) {
          const sourceAdapter = this.adapters.get(sourcePlatform);
          if (sourceAdapter) {
            await sourceAdapter.sendMessage(msg.externalId, {
              type: 'text',
              content: '⚠️ File too large! Please send files smaller than 5MB.'
            });
          }
          return false;
        }

        await targetAdapter.sendMessage(partner.externalId, {
          type: msg.media.type,
          url: msg.media.url,
          caption: msg.media.caption
        });
      }
      return true;
    } catch (err: any) {
      console.error(`💥 Relay Error to ${partner.platform}:`, err?.message || err);
      // Notify the sender that the message failed
      const sourceAdapter = this.adapters.get(sourcePlatform);
      if (sourceAdapter) {
        await sourceAdapter.sendMessage(msg.externalId, {
          type: 'text',
          content: '⚠️ Message delivery failed. The stranger might be offline or there was a connection error.'
        });
      }
      return false;
    }
  }

  /**
   * Relay typing state to the partner.
   */
  async relayTypingState(externalId: string, sourcePlatform: Platform) {
    const user = await this.userService.getOrCreateUser(externalId, sourcePlatform);
    if (!user.currentMatchId) return;

    const match = await this.matchmaker.getActiveMatch(user.id);
    if (!match) return;

    const partnerId = match.userIds.find(id => id !== user.id);
    if (!partnerId) return;

    const partner = await this.userService.getUserById(partnerId);
    if (!partner) return;

    const adapter = this.adapters.get(partner.platform);
    if (adapter) {
      await adapter.sendTypingState(partner.externalId);
    }
  }

  /**
   * Helper to notify both users when a match is made.
   */
  async notifyMatch(userId1: string, userId2: string, interests: string[]) {
    const u1 = await this.userService.getUserById(userId1);
    const u2 = await this.userService.getUserById(userId2);

    if (u1 && u2) {
      const interestList = interests.join(', ');
      
      const a1 = this.adapters.get(u1.platform);
      const a2 = this.adapters.get(u2.platform);

      const m1 = getMoodDecoration(u1.purpose);
      const m2 = getMoodDecoration(u2.purpose);

      if (a1) {
        await a1.sendMessage(u1.externalId, {
          type: 'text',
          content: `🎉 *MATCH FOUND!*\n\n${m1.header}\nYou both like: ${interestList}\n\nSay hi! 👋\n\n🤝 /add | 🛡️ /block | 🚪 /stop`
        });
      }

      if (a2) {
        await a2.sendMessage(u2.externalId, {
          type: 'text',
          content: `🎉 *MATCH FOUND!*\n\n${m2.header}\nYou both like: ${interestList}\n\nSay hi! 👋\n\n🤝 /add | 🛡️ /block | 🚪 /stop`
        });
      }
    }
  }

  /**
   * Notify a user about a pending friend request.
   */
  async notifyFriendRequest(fromUserId: string, toUserId: string) {
    const fromUser = await this.userService.getUserById(fromUserId);
    const toUser = await this.userService.getUserById(toUserId);

    if (fromUser && toUser) {
      const adapter = this.adapters.get(toUser.platform);
      if (adapter) {
        await adapter.sendMessage(toUser.externalId, {
          type: 'buttons',
          title: '👥 FRIEND REQUEST',
          body: `${fromUser.username} wants to add you to their contacts. Do you accept?`,
          buttons: [
            { id: 'accept_friend', text: '✅ Accept' },
            { id: 'decline_friend', text: '❌ Decline' }
          ]
        });
      }
    }
  }

  /**
   * Notify users that a friend request was accepted.
   */
  async notifyFriendAccepted(userId1: string, userId2: string) {
    const u1 = await this.userService.getUserById(userId1);
    const u2 = await this.userService.getUserById(userId2);

    if (u1 && u2) {
      const a1 = this.adapters.get(u1.platform);
      const a2 = this.adapters.get(u2.platform);

      if (a1) await a1.sendMessage(u1.externalId, { type: 'text', content: `✅ You are now friends with ${u2.username}!` });
      if (a2) await a2.sendMessage(u2.externalId, { type: 'text', content: `✅ You are now friends with ${u1.username}!` });
    }
  }

  /**
   * Notify a user that their match has ended and show the main menu.
   */
  async notifyMatchEnded(userId: string, reason: string) {
    const user = await this.userService.getUserById(userId);
    if (user) {
      const adapter = this.adapters.get(user.platform);
      if (adapter) {
        await adapter.sendMessage(user.externalId, {
          type: 'text',
          content: `🚪 Match ended: ${reason}.`
        });
        
        // Show Main Menu immediately after
        await adapter.sendMessage(user.externalId, {
          type: 'buttons',
          title: '🏠 MOXIE MAIN MENU',
          body: `Status: ${user.status.toUpperCase()}\nInterests: ${user.interests.join(', ') || 'None'}\n\nWhat would you like to do?`,
          buttons: [
            { id: 'match_now', text: '🔎 Find Match' },
            { id: 'view_profile', text: '👤 View Profile' },
            { id: 'start_onboarding', text: '📝 Edit Profile' },
            { id: 'reset_profile', text: '🔄 Reset All' }
          ]
        });
      }
    }
  }

  /**
   * Get the buffered chat log for a match.
   */
  getChatLog(matchId: string): { sender: string, text: string }[] {
    return this.chatBuffers.get(matchId) || [];
  }

  /**
   * Clear the buffered chat log for a match.
   */
  clearChatLog(matchId: string) {
    this.chatBuffers.delete(matchId);
  }
}
