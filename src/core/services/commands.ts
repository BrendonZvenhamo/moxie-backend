import { UserService } from './user';
import { MatchmakingService } from './matchmaker';
import { RelayService } from './relay';
import { IncomingMessage, IPlatformAdapter } from '../interfaces/platform';
import { Platform, UserStatus } from '../../types/models';
import { getMoodDecoration } from '../../utils/mood';

export class CommandHandler {
  constructor(
    private userService: UserService,
    private matchmaker: MatchmakingService,
    private relayService: RelayService
  ) {}

  async handle(msg: IncomingMessage, adapter: IPlatformAdapter): Promise<boolean> {
    const user = await this.userService.getOrCreateUser(msg.externalId, adapter.getPlatform(), msg.username);
    const text = msg.text?.trim() || '';

    // 1. GLOBAL COMMANDS (Work everywhere, even in onboarding or matches)
    if (text.toLowerCase().startsWith('/feedback')) {
      const parts = text.split(' ');
      const feedback = parts.slice(1).join(' ');
      if (!feedback) {
        await adapter.sendMessage(msg.externalId, { type: 'text', content: '💬 Please tell us what you think! Usage: /feedback <your message>' });
      } else {
        await this.userService.saveFeedback(user.id, feedback);
        await adapter.sendMessage(msg.externalId, { type: 'text', content: '🙏 Thank you! Your feedback has been sent to our team.' });
      }
      return true;
    }

    // Check if user is banned
    if (user.isBanned) {
      await adapter.sendMessage(msg.externalId, {
        type: 'text',
        content: '🚫 Your account has been permanently banned for violating our community guidelines.'
      });
      return true;
    }

    // If user is in onboarding, guide them through the wizard
    if (user.onboardingStep !== 'completed') {
      if (text.toLowerCase() === '/cancel') {
        await this.userService.updateOnboardingStep(user.id, 'completed');
        await adapter.sendMessage(user.externalId, { type: 'text', content: 'Onboarding cancelled. You can edit your profile later.' });
        await this.showMainMenu(user.externalId, adapter);
        return true;
      }
      return this.handleOnboarding(user.externalId, text, user.onboardingStep, adapter);
    }

    // Special case: Recognize 'stop' or 'exit' without a slash while searching or in a match
    if ((user.status === UserStatus.MATCHED || user.status === UserStatus.SEARCHING) && (text.toLowerCase() === 'stop' || text.toLowerCase() === 'exit')) {
      await this.handleStop(user.id, user.externalId, adapter);
      return true;
    }

    if (!text.startsWith('/')) return false;

    const [command, ...args] = text.split(' ');

    switch (command.toLowerCase()) {
      case '/start':
      case '/profile':
        await this.showMainMenu(msg.externalId, adapter);
        break;

      case '/match':
        await this.initiateMatch(user.id, user.externalId, adapter);
        break;

      case '/stop':
        await this.handleStop(user.id, user.externalId, adapter);
        break;

      case '/block':
        await this.handleBlock(user.id, user.externalId, adapter);
        break;

      case '/add':
        await this.handleAddContact(user.id, user.externalId, adapter);
        break;

      case '/accept':
        await this.handleAcceptContact(user.id, adapter);
        break;

      case '/contacts':
        await this.handleListContacts(user.id, user.externalId, adapter);
        break;

      case '/reset':
        await this.handleResetProfile(user.id, user.externalId, adapter);
        break;

      case '/report':
        await this.handleReport(user.id, user.externalId, adapter);
        break;

      case '/broadcast':
        const adminIds = process.env.ADMIN_IDS?.split(',') || [];
        if (!adminIds.includes(msg.externalId)) {
          await adapter.sendMessage(msg.externalId, { type: 'text', content: '🚫 Admin only.' });
          break;
        }
        await this.handleBroadcast(args.join(' '), adapter);
        break;

      case '/help':
        await this.sendHelpMessage(user.externalId, adapter);
        break;

      case '/feedback':
        const feedback = args.join(' ');
        if (!feedback) {
          await adapter.sendMessage(msg.externalId, { type: 'text', content: '💬 Please tell us what you think! Usage: /feedback <your message>' });
        } else {
          await this.userService.saveFeedback(user.id, feedback);
          await adapter.sendMessage(msg.externalId, { type: 'text', content: '🙏 Thank you! Your feedback has been sent to our team.' });
        }
        return true;

      default:
        await this.showMainMenu(msg.externalId, adapter);
    }

    return true;
  }

  async showMainMenu(externalId: string, adapter: IPlatformAdapter) {
    const user = await this.userService.getOrCreateUser(externalId, adapter.getPlatform());
    const mood = getMoodDecoration(user.purpose);
    const trending = await this.userService.getTrendingInterests();

    await adapter.sendMessage(externalId, {
      type: 'buttons',
      title: mood.header,
      body: `${mood.emoji} Status: ${user.status.toUpperCase()}\n${mood.accent} Interests: ${user.interests.join(', ') || 'None'}\n\n🔥 *Trending:* ${trending.join(', ')}\n\nWhat would you like to do?`,
      buttons: [
        { id: 'match_now', text: '🔎 Find Match' },
        { id: 'view_profile', text: '👤 View Profile' },
        { id: 'start_onboarding', text: '📝 Edit Profile' },
        { id: 'reset_profile', text: '🔄 Reset All' }
      ],
      footer: mood.footer
    });
  }

  async handleButton(externalId: string, buttonId: string, adapter: IPlatformAdapter) {
    const user = await this.userService.getOrCreateUser(externalId, adapter.getPlatform());

    switch (buttonId) {
      case 'accept_terms':
        await this.userService.updateOnboardingStep(user.id, 'purpose');
        await this.showPurposeSelection(externalId, adapter);
        break;

      case 'start_onboarding':
        await this.userService.updateOnboardingStep(user.id, 'terms');
        await adapter.sendMessage(externalId, {
          type: 'buttons',
          title: '⚖️ TERMS OF SERVICE',
          body: 'To keep Moxie safe, you agree to:\n1. Be respectful to others.\n2. No illegal or harmful content.\n3. Messages are 100% anonymous.\n\nWe NEVER store your chats.',
          buttons: [
            { id: 'accept_terms', text: '✅ I Agree' },
            { id: 'view_help', text: '❓ Help' }
          ]
        });
        break;

      case 'purpose_friendship':
      case 'purpose_dating':
      case 'purpose_both':
        const purpose = buttonId.split('_')[1];
        await this.userService.updatePurpose(user.id, purpose);
        await this.userService.updateOnboardingStep(user.id, 'interests');
        await this.showInterestSelection(externalId, adapter);
        break;

      case 'interest_gaming':
      case 'interest_music':
      case 'interest_sports':
      case 'interest_tech':
      case 'interest_movies':
      case 'interest_food':
      case 'interest_travel':
      case 'interest_art':
      case 'interest_reading':
      case 'interest_finance':
        const interest = buttonId.split('_')[1];
        await this.userService.updateInterests(user.id, [interest]);
        await this.userService.updateOnboardingStep(user.id, 'gender');
        await adapter.sendMessage(externalId, {
          type: 'buttons',
          title: '⚧ STEP 3: GENDER',
          body: 'Almost done! Your gender?',
          buttons: [
            { id: 'gender_male', text: '👨 Male' },
            { id: 'gender_female', text: '👩 Female' },
            { id: 'gender_other', text: '🌈 Other' }
          ]
        });
        break;

      case 'gender_male':
      case 'gender_female':
      case 'gender_other':
        const gender = buttonId.split('_')[1];
        await this.userService.updateGender(user.id, gender);
        await this.userService.updateOnboardingStep(user.id, 'pref_gender');
        await adapter.sendMessage(externalId, {
          type: 'buttons',
          title: '🎯 STEP 4: PREFERENCE',
          body: 'Who would you like to talk to?',
          buttons: [
            { id: 'pref_male', text: '👨 Men' },
            { id: 'pref_female', text: '👩 Women' },
            { id: 'pref_both', text: '🌟 Anyone' }
          ]
        });
        break;

      case 'pref_male':
      case 'pref_female':
      case 'pref_both':
        const pref = buttonId.split('_')[1];
        await this.userService.updatePrefGender(user.id, pref);
        await this.userService.updateOnboardingStep(user.id, 'completed');
        await adapter.sendMessage(externalId, {
          type: 'buttons',
          title: '🎉 ALL SET!',
          body: 'Ready to chat! Quick Guide:\n1. 🤝 /add - Save as friend\n2. 🛡️ /block - Hide users\n3. 🚪 /stop - End chat\n\nYour privacy is 100% guaranteed.',
          buttons: [
            { id: 'match_now', text: '🔎 Find Match' },
            { id: 'view_profile', text: '👤 View Profile' }
          ]
        });
        break;

      case 'confirm_delete_profile':
        await adapter.sendMessage(externalId, {
          type: 'buttons',
          title: '⚠️ DELETE PROFILE?',
          body: 'This will permanently erase your data. This CANNOT be undone.',
          buttons: [
            { id: 'delete_profile_now', text: '🛑 Yes, Delete' },
            { id: 'view_profile', text: '❌ Cancel' }
          ]
        });
        break;

      case 'delete_profile_now':
        await this.handleDeleteProfile(user.id, externalId, adapter);
        break;

      case 'reset_profile':
        await this.handleResetProfile(user.id, externalId, adapter);
        break;

      case 'match_now':
        await this.initiateMatch(user.id, externalId, adapter);
        break;

      case 'view_profile':
        await adapter.sendMessage(externalId, {
          type: 'text',
          content: `👤 *Your Profile*\n\nUsername: ${user.username}\nGender: ${user.gender || 'Not set'}\nInterested in: ${user.prefGender === 'male' ? 'Men 👨' : (user.prefGender === 'female' ? 'Women 👩' : 'Anyone 🌟')}\nPurpose: ${user.purpose || 'Not set'}\nInterests: ${user.interests.join(', ') || 'None'}`
        });
        await this.showMainMenu(externalId, adapter);
        break;
        
      case 'view_help':
        await this.sendHelpMessage(externalId, adapter);
        break;

      case 'accept_friend':
        await this.handleAcceptContact(user.id, adapter);
        break;

      case 'decline_friend':
        const requesterId = await this.userService.getPendingFriendRequest(user.id);
        if (requesterId) {
          await this.userService.declineFriendRequest(user.id, requesterId);
          await adapter.sendMessage(externalId, { type: 'text', content: '❌ Friend request declined.' });
        }
        break;
    }
  }

  private async handleResetProfile(userId: string, externalId: string, adapter: IPlatformAdapter) {
    await this.userService.updateOnboardingStep(userId, 'start');
    await adapter.sendMessage(externalId, { type: 'text', content: '🔄 Profile reset! Let\'s start over.' });
    await this.sendWelcomeMessage(externalId, adapter);
  }

  private async handleOnboarding(externalId: string, text: string, step: string, adapter: IPlatformAdapter): Promise<boolean> {
    const user = await this.userService.getOrCreateUser(externalId, adapter.getPlatform());

    // Edge case: User sends media/buttons when we expect text (interests)
    if (!text && step === 'interests') {
      await adapter.sendMessage(externalId, { type: 'text', content: '💬 Please send your response as a text message.' });
      return true;
    }

    if (step === 'start') {
      await this.sendWelcomeMessage(externalId, adapter);
      return true;
    }

    if (step === 'terms') {
      await adapter.sendMessage(externalId, {
        type: 'buttons',
        title: '⚖️ TERMS OF SERVICE',
        body: 'To keep Moxie safe, you agree to:\n1. Be respectful to others.\n2. No illegal or harmful content.\n3. Messages are 100% anonymous.\n\nWe NEVER store your chats.',
        buttons: [
          { id: 'accept_terms', text: '✅ I Agree' },
          { id: 'view_help', text: '❓ Help' }
        ]
      });
      return true;
    }

    if (step === 'interests') {
      const interests = text.split(',').map(i => i.trim().toLowerCase()).filter(i => i.length > 0);
      if (interests.length === 0) {
        await this.showInterestSelection(externalId, adapter);
      } else {
        await this.userService.updateInterests(user.id, interests);
        await this.userService.updateOnboardingStep(user.id, 'gender');
        await adapter.sendMessage(externalId, {
          type: 'buttons',
          title: '⚧ STEP 3: GENDER',
          body: 'Almost done! Your gender?',
          buttons: [
            { id: 'gender_male', text: '👨 Male' },
            { id: 'gender_female', text: '👩 Female' },
            { id: 'gender_other', text: '🌈 Other' }
          ]
        });
      }
      return true;
    }

    if (step === 'gender') {
      await adapter.sendMessage(externalId, {
        type: 'buttons',
        title: '⚧ STEP 3: GENDER',
        body: 'Please select your gender using the buttons below:',
        buttons: [
          { id: 'gender_male', text: '👨 Male' },
          { id: 'gender_female', text: '👩 Female' },
          { id: 'gender_other', text: '🌈 Other' }
        ]
      });
      return true;
    }

    if (step === 'pref_gender') {
      await adapter.sendMessage(externalId, {
        type: 'buttons',
        title: '🎯 STEP 4: PREFERENCE',
        body: 'Who would you like to talk to? Please use the buttons:',
        buttons: [
          { id: 'pref_male', text: '👨 Men' },
          { id: 'pref_female', text: '👩 Women' },
          { id: 'pref_both', text: '🌟 Anyone' }
        ]
      });
      return true;
    }

    return false;
  }

  private async showInterestSelection(externalId: string, adapter: IPlatformAdapter) {
    await adapter.sendMessage(externalId, {
      type: 'buttons',
      title: '🎯 STEP 2: INTERESTS',
      body: 'What are you most interested in? Select a category to find people with similar vibes.',
      buttons: [
        { id: 'interest_gaming', text: '🎮 Gaming' },
        { id: 'interest_music', text: '🎵 Music' },
        { id: 'interest_sports', text: '⚽ Sports' },
        { id: 'interest_tech', text: '💻 Tech' },
        { id: 'interest_movies', text: '🎬 Movies' },
        { id: 'interest_food', text: '🍕 Food' },
        { id: 'interest_travel', text: '✈️ Travel' },
        { id: 'interest_art', text: '🎨 Art' },
        { id: 'interest_reading', text: '📚 Reading' },
        { id: 'interest_finance', text: '💰 Finance' }
      ]
    });
  }

  private async initiateMatch(userId: string, externalId: string, adapter: IPlatformAdapter) {
    const user = await this.userService.getUserById(userId);
    if (!user) return;
    if (user.status === UserStatus.MATCHED) {
      await adapter.sendMessage(externalId, { type: 'text', content: 'Already in a match! Use /stop.' });
      return;
    }

    const waitingCount = await this.userService.getSearchingCount();
    const queueMsg = waitingCount > 0 ? `There are ${waitingCount} people searching right now!` : "You're the first one here—I'll notify you the moment someone joins!";

    await adapter.sendMessage(externalId, { 
      type: 'text', 
      content: `🔎 Searching for: ${user.interests.join(', ')}...\n\n👥 ${queueMsg}\n\n💡 Use /stop to cancel.` 
    });

    const match = await this.matchmaker.findMatch(userId);
    if (match) {
      await this.relayService.notifyMatch(match.userIds[0], match.userIds[1], match.interests);
    } else {
      // Issue #6: Re-engagement - Notify idle users who might want to match
      const potentials = await this.matchmaker.findPotentialPartners(userId);
      for (const p of potentials) {
        await this.relayService.notifyPotentialMatch(p.id, p.interests);
      }
    }
  }

  private async handleStop(userId: string, externalId: string, adapter: IPlatformAdapter) {
    const activeMatch = await this.matchmaker.getActiveMatch(userId);
    if (activeMatch) {
      const partnerId = activeMatch.userIds.find(id => id !== userId);
      await this.matchmaker.endMatch(activeMatch.id);
      await this.showMainMenu(externalId, adapter);
      if (partnerId) await this.relayService.notifyMatchEnded(partnerId, 'Stranger left');
    } else {
      await this.userService.updateStatus(userId, UserStatus.IDLE, null, null);
      await adapter.sendMessage(externalId, { type: 'text', content: 'Stopped.' });
      await this.showMainMenu(externalId, adapter);
    }
  }

  private async handleReadyConfirm(userId: string, adapter: IPlatformAdapter) {
    const user = await this.userService.getUserById(userId);
    if (!user || !user.currentMatchId) return;

    await this.userService.updateReadyStatus(userId, true);
    
    const match = await this.matchmaker.getActiveMatch(userId);
    if (!match) return;

    const partnerId = match.userIds.find(id => id !== userId);
    const partner = partnerId ? await this.userService.getUserById(partnerId) : null;

    if (partner) {
      if (partner.isReady) {
        const startMsg = "🚀 *CONNECTED!* You can now send messages. Have fun!\n\n🤝 /add | 🛡️ /block | 🚪 /stop";
        await adapter.sendMessage(user.externalId, { type: 'text', content: startMsg });
        
        const partnerAdapter = this.relayService['adapters'].get(partner.platform);
        if (partnerAdapter) await partnerAdapter.sendMessage(partner.externalId, { type: 'text', content: startMsg });
      } else {
        await adapter.sendMessage(user.externalId, { type: 'text', content: '✅ Status: Ready. Waiting for the stranger...' });
      }
    }
  }

  private async handleBlock(userId: string, externalId: string, adapter: IPlatformAdapter) {
    const match = await this.matchmaker.getActiveMatch(userId);
    if (match) {
      const partnerId = match.userIds.find(id => id !== userId);
      if (partnerId) {
        await this.userService.blockUser(userId, partnerId);
        await this.matchmaker.endMatch(match.id);
        await this.showMainMenu(externalId, adapter);
        await this.relayService.notifyMatchEnded(partnerId, 'Stranger ended chat');
      }
    }
  }

  private async handleReport(userId: string, externalId: string, adapter: IPlatformAdapter) {
    const match = await this.matchmaker.getActiveMatch(userId);
    if (match) {
      const partnerId = match.userIds.find(id => id !== userId);
      if (partnerId) {
        const chatLog = this.relayService.getChatLog(match.id);
        await this.userService.reportUser(userId, partnerId, 'Reported via /report', chatLog);
        await this.handleBlock(userId, externalId, adapter);
        await adapter.sendMessage(externalId, { type: 'text', content: '🚩 User reported and blocked.' });
      }
    } else {
      await adapter.sendMessage(externalId, { type: 'text', content: 'Only while in match.' });
    }
  }

  private async handleBroadcast(message: string, adapter: IPlatformAdapter) {
    if (!message) return;
    const { query } = require('../../infrastructure/database/pool');
    const result = await query('SELECT external_id, platform FROM users WHERE is_banned = FALSE');
    const users = result.rows.filter((r: any) => r.platform === adapter.getPlatform());
    for (const user of users) {
      try {
        await adapter.sendMessage(user.external_id, { type: 'text', content: `📢 ADMIN:\n\n${message}` });
      } catch (err) {}
    }
  }

  private async showPurposeSelection(externalId: string, adapter: IPlatformAdapter) {
    await adapter.sendMessage(externalId, {
      type: 'buttons',
      title: '🎯 STEP 1: PURPOSE',
      body: 'What are you here for?',
      buttons: [
        { id: 'purpose_friendship', text: '🤝 Friendship' },
        { id: 'purpose_dating', text: '💘 Dating' },
        { id: 'purpose_both', text: '🌟 Both' }
      ]
    });
  }

  private async handleAddContact(userId: string, externalId: string, adapter: IPlatformAdapter) {
    const match = await this.matchmaker.getActiveMatch(userId);
    if (match) {
      const partnerId = match.userIds.find(id => id !== userId);
      if (partnerId) {
        await this.userService.sendFriendRequest(userId, partnerId);
        await adapter.sendMessage(externalId, { type: 'text', content: 'Request sent! Waiting for them to /accept.' });
        await this.relayService.notifyFriendRequest(userId, partnerId);
      }
    } else {
      await adapter.sendMessage(externalId, { type: 'text', content: 'You can only add a contact while in an active match.' });
    }
  }

  private async handleAcceptContact(userId: string, adapter: IPlatformAdapter) {
    const requesterId = await this.userService.getPendingFriendRequest(userId);
    if (requesterId) {
      await this.userService.acceptFriendRequest(requesterId, userId);
      await this.relayService.notifyFriendAccepted(requesterId, userId);
    } else {
      const user = await this.userService.getUserById(userId);
      if (user) await adapter.sendMessage(user.externalId, { type: 'text', content: 'You have no pending friend requests.' });
    }
  }

  private async handleListContacts(userId: string, externalId: string, adapter: IPlatformAdapter) {
    const contacts = await this.userService.getContacts(userId);
    if (contacts.length === 0) {
      await adapter.sendMessage(externalId, { type: 'text', content: "No contacts yet." });
    } else {
      await adapter.sendMessage(externalId, {
        type: 'buttons',
        title: '👥 YOUR CONTACTS',
        body: 'Select a friend to start a private conversation.',
        buttons: contacts.slice(0, 10).map(c => ({
          id: `chat_with_${c.id}`,
          text: `💬 Chat: ${c.username}`
        }))
      });
    }
  }

  private async startPrivateChat(userId: string, friendId: string, adapter: IPlatformAdapter) {
    const friend = await this.userService.getUserById(friendId);
    if (friend) {
      await this.userService.updateStatus(userId, UserStatus.IDLE, null, friendId);
      await adapter.sendMessage(adapter.getPlatform() === friend.platform ? friend.externalId : '', { 
        type: 'text', 
        content: `🔔 *SYSTEM:* Your friend is messaging you! Type /contacts to chat back.` 
      });
      await adapter.sendMessage(adapter.getPlatform() === friend.platform ? '' : '', { type: 'text', content: `Switched to chat with ${friend.username}. Send a message!` });
    }
  }

  private async handleDeleteProfile(userId: string, externalId: string, adapter: IPlatformAdapter) {
    const activeMatch = await this.matchmaker.getActiveMatch(userId);
    if (activeMatch) {
      const partnerId = activeMatch.userIds.find(id => id !== userId);
      await this.matchmaker.endMatch(activeMatch.id);
      if (partnerId) await this.relayService.notifyMatchEnded(partnerId, 'Stranger left');
    }
    await this.userService.deleteUser(userId);
    await adapter.sendMessage(externalId, { type: 'text', content: '🗑️ Deleted. Goodbye!' });
  }

  private async sendWelcomeMessage(externalId: string, adapter: IPlatformAdapter) {
    await adapter.sendMessage(externalId, {
      type: 'buttons',
      title: '🌟 WELCOME TO MOXIE',
      body: 'Connect anonymously with strangers based on shared interests.\n\n🔒 PRIVACY: We do NOT store your messages, and your identity is hidden until you choose to reveal it.\n\n💬 Have feedback? Use /feedback to tell us what you think!',
      buttons: [
        { id: 'start_onboarding', text: '📝 Create Profile' },
        { id: 'view_help', text: '❓ How it works' }
      ]
    });
  }

  private async sendHelpMessage(externalId: string, adapter: IPlatformAdapter) {
    await adapter.sendMessage(externalId, {
      type: 'text',
      content: '📖 *Moxie Guide*\n\n' +
        '🔎 *Match:* /match - Find a stranger who shares your interests.\n' +
        '🚪 *Stop:* /stop - End your current chat safely.\n' +
        '🛡️ *Block:* /block - Stop someone from matching with you again.\n' +
        '🚩 *Report:* /report - Report abuse to the admin.\n' +
        '🤝 *Add:* /add - Send a friend request to stay in touch.\n' +
        '👤 *Profile:* /profile - View or edit your interests.\n' +
        '💬 *Feedback:* /feedback - Share your thoughts with the team.\n\n' +
        'Need more help? Just message us!'
    });
  }
}
