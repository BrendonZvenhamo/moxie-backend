import { Client, LocalAuth, Message as WAMessage, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { IPlatformAdapter, IncomingMessage } from '../../core/interfaces/platform';
import { Platform } from '../../types/models';
import { Message, ButtonMessage } from '../../types/messages';

export class WhatsAppAdapter implements IPlatformAdapter {
  private client: Client;
  private messageHandler?: (msg: IncomingMessage) => Promise<void>;
  private typingHandler?: (externalId: string) => Promise<void>;
  private buttonHandler?: (externalId: string, buttonId: string) => Promise<void>;
  private ready: boolean = false;
  // Store active menus to map numbers back to button IDs
  private activeMenus: Map<string, string[]> = new Map();

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        handleSIGINT: false,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-22d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        authTimeoutMs: 60000,
      }
    });
  }

  async initialize(): Promise<void> {
    console.log('⏳ Initializing WhatsApp browser...');

    this.client.on('qr', (qr) => {
      console.log('📲 WhatsApp QR Code received. Scan it with your phone:');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('authenticated', () => {
      console.log('🔓 WhatsApp Authenticated successfully!');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp Authentication failure:', msg);
    });

    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Loading WhatsApp: ${percent}% - ${message}`);
    });

    this.client.on('ready', () => {
      console.log('✅ WhatsApp Client is ready!');
      this.ready = true;
    });

    this.client.on('message', async (msg: WAMessage) => {
      if (
        msg.from.endsWith('@g.us') || 
        msg.from.endsWith('@broadcast') || 
        msg.from.endsWith('@newsletter')
      ) return;

      // Handle numeric responses for text-based menus
      const menu = this.activeMenus.get(msg.from);
      if (menu && /^\d+$/.test(msg.body)) {
        const index = parseInt(msg.body) - 1;
        if (index >= 0 && index < menu.length) {
          if (this.buttonHandler) {
            await this.buttonHandler(msg.from, menu[index]);
            return;
          }
        }
      }

      if (this.messageHandler) {
        const contact = await msg.getContact();
        
        const incoming: IncomingMessage = {
          externalId: msg.from,
          username: contact.pushname || contact.name || msg.from,
          text: msg.body,
          timestamp: new Date(msg.timestamp * 1000),
        };

        if (msg.hasMedia) {
          const media = await msg.downloadMedia();
          if (media) {
            incoming.media = {
              type: msg.type === 'video' ? 'video' : (msg.type === 'audio' || msg.type === 'ptt' ? 'audio' : 'image'),
              url: `data:${media.mimetype};base64,${media.data}`,
              caption: msg.body,
            };
          }
        }

        await this.messageHandler(incoming);
      }
    });

    try {
      await this.client.initialize();
      console.log('🚀 WhatsApp browser launched.');
    } catch (err) {
      console.error('💥 Failed to launch WhatsApp browser:', err);
      throw err;
    }
  }

  getPlatform(): Platform {
    return Platform.WHATSAPP;
  }

  async sendMessage(targetExternalId: string, message: Partial<Message>): Promise<void> {
    if (!this.ready) return;

    if (message.type === 'text' && message.content) {
      await this.client.sendMessage(targetExternalId, message.content);
    } else if (
      (message.type === 'image' || message.type === 'video' || message.type === 'audio' || message.type === 'document') && 
      'url' in message && message.url?.startsWith('data:')
    ) {
      const dataUrl = message.url!;
      const [meta, base64Data] = dataUrl.split(',');
      const mimetype = meta.split(':')[1].split(';')[0];
      const media = new MessageMedia(mimetype, base64Data);
      await this.client.sendMessage(targetExternalId, media, { caption: message.caption });
    } else if (message.type === 'buttons') {
      const btnMsg = message as ButtonMessage;
      
      // Fallback: Format buttons as a numbered text list
      let menuText = `*${btnMsg.title.toUpperCase()}*\n\n${btnMsg.body}\n\n`;
      btnMsg.buttons.forEach((btn, i) => {
        menuText += `${i + 1}. ${btn.text}\n`;
      });
      if (btnMsg.footer) menuText += `\n_${btnMsg.footer}_`;
      menuText += `\n\n*Reply with a number (1-${btnMsg.buttons.length})*`;

      // Save the button IDs for this user
      this.activeMenus.set(targetExternalId, btnMsg.buttons.map(b => b.id));
      
      await this.client.sendMessage(targetExternalId, menuText);
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
    try {
      const chat = await this.client.getChatById(targetExternalId);
      await chat.sendStateTyping();
    } catch (e) {}
  }

  isReady(): boolean {
    return this.ready;
  }
}
