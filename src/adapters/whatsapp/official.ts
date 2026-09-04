import axios from 'axios';
import { IPlatformAdapter, IncomingMessage } from '../../core/interfaces/platform';
import { Platform } from '../../types/models';
import { Message, ButtonMessage } from '../../types/messages';

export class OfficialWhatsAppAdapter implements IPlatformAdapter {
  private messageHandler?: (msg: IncomingMessage) => Promise<void>;
  private typingHandler?: (externalId: string) => Promise<void>;
  private buttonHandler?: (externalId: string, buttonId: string) => Promise<void>;

  private readonly token: string;
  private readonly phoneId: string;
  private readonly version: string;
  private readonly baseUrl: string;

  constructor() {
    this.token = process.env.WHATSAPP_TOKEN || '';
    this.phoneId = process.env.WHATSAPP_PHONE_ID || '';
    this.version = process.env.WHATSAPP_API_VERSION || 'v19.0';
    this.baseUrl = `https://graph.facebook.com/${this.version}/${this.phoneId}`;
  }

  async initialize(): Promise<void> {
    console.log('✅ Official WhatsApp Adapter (Webhook-based) ready.');
    if (!this.token || !this.phoneId) {
      console.warn('⚠️ WHATSAPP_TOKEN or WHATSAPP_PHONE_ID missing in .env');
    }
  }

  getPlatform(): Platform {
    return Platform.WHATSAPP;
  }

  async sendMessage(targetExternalId: string, message: Partial<Message>): Promise<void> {
    try {
      let data: any = {
        messaging_product: 'whatsapp',
        to: targetExternalId,
      };

      if (message.type === 'text' && message.content) {
        data.type = 'text';
        data.text = { body: message.content };
      } 
      else if (message.type === 'buttons') {
        const btnMsg = message as ButtonMessage;
        data.type = 'interactive';
        
        if (btnMsg.buttons.length <= 3) {
          // Use Quick Reply Buttons (Max 3)
          data.interactive = {
            type: 'button',
            body: { text: btnMsg.body },
            header: { type: 'text', text: btnMsg.title },
            action: {
              buttons: btnMsg.buttons.map(btn => ({
                type: 'reply',
                reply: { id: btn.id, title: btn.text.substring(0, 20) }
              }))
            }
          };
        } else {
          // Use List Menu (Max 10)
          data.interactive = {
            type: 'list',
            header: { type: 'text', text: btnMsg.title },
            body: { text: btnMsg.body },
            action: {
              button: 'Select Option',
              sections: [{
                title: 'Available Options',
                rows: btnMsg.buttons.slice(0, 10).map(btn => ({
                  id: btn.id,
                  title: btn.text.substring(0, 24),
                  // Optional: description: ''
                }))
              }]
            }
          };
        }

        if (btnMsg.footer) {
          data.interactive.footer = { text: btnMsg.footer };
        }
      }
      else if (['image', 'video', 'audio', 'document'].includes(message.type!) && 'url' in message) {
        const type = message.type as string;
        
        // If the URL is a Data URL (Base64), we MUST upload it to Meta first
        // as Meta doesn't allow sending raw Base64 strings in the 'link' field.
        let mediaId: string | null = null;
        if (message.url?.startsWith('data:')) {
          mediaId = await this.uploadMedia(message.url);
        }

        data.type = type;
        data[type] = mediaId ? { id: mediaId } : { link: message.url };

        // Meta API Fix: Audio does NOT support captions.
        if (type !== 'audio' && message.caption) {
          data[type].caption = message.caption;
        }
      }

      await axios.post(`${this.baseUrl}/messages`, data, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (error: any) {
      console.error('❌ Failed to send Official WhatsApp message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Uploads Base64 media to Meta and returns a Media ID
   */
  private async uploadMedia(dataUrl: string): Promise<string | null> {
    try {
      const [meta, base64Data] = dataUrl.split(';base64,');
      const mimeType = meta.split(':')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      // Create a FormData-like body for the binary upload
      const formData = new (require('form-data'))();
      formData.append('file', buffer, {
        filename: `media.${mimeType.split('/')[1]}`,
        contentType: mimeType,
      });
      formData.append('messaging_product', 'whatsapp');

      const response = await axios.post(`https://graph.facebook.com/${this.version}/${this.phoneId}/media`, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${this.token}`,
        },
      });

      return response.data.id;
    } catch (error: any) {
      console.error('❌ Failed to upload media to Meta:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Internal hook to process messages coming from the Webhook route
   */
  async handleWebhookPayload(payload: any): Promise<void> {
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    const contact = value?.contacts?.[0];
    const username = contact?.profile?.name || from;

    // Handle Buttons (Interactive Replies)
    if (message.type === 'interactive') {
      let buttonId = '';
      if (message.interactive?.button_reply) {
        buttonId = message.interactive.button_reply.id;
      } else if (message.interactive?.list_reply) {
        buttonId = message.interactive.list_reply.id;
      }

      if (buttonId && this.buttonHandler) {
        await this.buttonHandler(from, buttonId);
      }
      return;
    }

    // Handle Text & Media
    if (this.messageHandler) {
      const incoming: IncomingMessage = {
        externalId: from,
        username: username,
        timestamp: new Date(parseInt(message.timestamp) * 1000),
      };

      if (message.type === 'text') {
        incoming.text = message.text.body;
      } 
      else if (['image', 'video', 'audio', 'document'].includes(message.type)) {
        const mediaData = message[message.type];
        // We'll download the media using the ID in a separate step if needed,
        // for now we pass the ID as a placeholder or fetch the URL.
        const mediaUrl = await this.getMediaUrl(mediaData.id);
        incoming.media = {
          type: message.type === 'image' ? 'image' : (message.type === 'video' ? 'video' : (message.type === 'audio' ? 'audio' : 'document')),
          url: mediaUrl || '',
          caption: mediaData.caption || '',
        };
      }

      await this.messageHandler(incoming);
    }
  }

  private async getMediaUrl(mediaId: string): Promise<string | null> {
    try {
      const response = await axios.get(`https://graph.facebook.com/${this.version}/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      
      const downloadUrl = response.data.url;
      
      // Download the file and convert to Base64 to stay compatible with existing relay logic
      const fileResponse = await axios.get(downloadUrl, {
        headers: { 'Authorization': `Bearer ${this.token}` },
        responseType: 'arraybuffer'
      });

      const mimeType = response.data.mime_type;
      const base64 = Buffer.from(fileResponse.data, 'binary').toString('base64');
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      console.error('❌ Failed to fetch Meta media:', error);
      return null;
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
    // Official API uses "mark_seen" or specific "typing" indicators in some versions
    // For simplicity in the test phase, we can skip or use:
    try {
      await axios.post(`${this.baseUrl}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: targetExternalId,
        sender_action: 'typing_on'
      }, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
    } catch (e) {}
  }

  isReady(): boolean {
    return !!this.token && !!this.phoneId;
  }
}
