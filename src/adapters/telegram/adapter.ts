import { Telegraf, Markup } from 'telegraf';
import { IPlatformAdapter, IncomingMessage } from '../../core/interfaces/platform';
import { Platform } from '../../types/models';
import { Message, ButtonMessage } from '../../types/messages';

export class TelegramAdapter implements IPlatformAdapter {
  private bot: Telegraf;
  private messageHandler?: (msg: IncomingMessage) => Promise<void>;
  private typingHandler?: (externalId: string) => Promise<void>;
  private buttonHandler?: (externalId: string, buttonId: string) => Promise<void>;
  private initialized: boolean = false;

  constructor(token: string) {
    this.bot = new Telegraf(token);
  }

  async initialize(): Promise<void> {
    this.bot.on('text', async (ctx) => {
      if (this.messageHandler) {
        await this.messageHandler({
          externalId: ctx.from.id.toString(),
          username: ctx.from.username || ctx.from.first_name,
          text: ctx.message.text,
          timestamp: new Date(),
        });
      }
    });

    this.bot.on('callback_query', async (ctx) => {
      if (this.buttonHandler && 'data' in ctx.callbackQuery) {
        await this.buttonHandler(ctx.from.id.toString(), ctx.callbackQuery.data as string);
        await ctx.answerCbQuery();
      }
    });

    this.bot.on(['photo', 'video', 'audio', 'document', 'voice', 'sticker'], async (ctx) => {
      if (this.messageHandler && ctx.from) {
        const msg: IncomingMessage = {
          externalId: ctx.from.id.toString(),
          username: ctx.from.username || ctx.from.first_name,
          timestamp: new Date(),
          media: {
            type: 'image',
            url: '', 
            caption: (ctx.message as any).caption,
          }
        };
        
        if ('photo' in ctx.message) msg.media!.type = 'image';
        else if ('video' in ctx.message) msg.media!.type = 'video';
        else if ('audio' in ctx.message) msg.media!.type = 'audio';
        else if ('voice' in ctx.message) msg.media!.type = 'audio';
        else if ('document' in ctx.message) msg.media!.type = 'document';
        else if ('sticker' in ctx.message) msg.media!.type = 'image'; // Treat stickers as images for simplicity

        await this.messageHandler(msg);
      }
    });

    await this.bot.launch();
    this.initialized = true;
    console.log('Telegram Bot started');
  }

  getPlatform(): Platform {
    return Platform.TELEGRAM;
  }

  async sendMessage(targetExternalId: string, message: Partial<Message>): Promise<void> {
    if (message.type === 'text' && message.content) {
      await this.bot.telegram.sendMessage(targetExternalId, message.content);
    } else if (message.type === 'image' && 'url' in message) {
      await this.bot.telegram.sendPhoto(targetExternalId, message.url!, { caption: message.caption });
    } else if (message.type === 'audio' && 'url' in message) {
      await this.bot.telegram.sendAudio(targetExternalId, message.url!);
    } else if (message.type === 'buttons') {
      const btnMsg = message as ButtonMessage;
      const keyboard = Markup.inlineKeyboard(
        btnMsg.buttons.map(b => Markup.button.callback(b.text, b.id))
      );
      await this.bot.telegram.sendMessage(targetExternalId, `*${btnMsg.title}*\n\n${btnMsg.body}`, {
        parse_mode: 'Markdown',
        ...keyboard
      });
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onTypingState(handler: (externalId: string) => Promise<void>): void {
    this.typingHandler = handler;
  }

  onButtonSelected(handler: (externalId: string, buttonId: string) => Promise<void>): void {
    this.buttonHandler = handler;
  }

  async sendTypingState(targetExternalId: string): Promise<void> {
    await this.bot.telegram.sendChatAction(targetExternalId, 'typing');
  }

  isReady(): boolean {
    return this.initialized;
  }
}
