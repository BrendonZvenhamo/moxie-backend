import { Message } from '../../types/messages';
import { Platform } from '../../types/models';

export interface IncomingMessage {
  externalId: string; // Platform-specific ID (WhatsApp number)
  username?: string;
  text?: string;
  media?: {
    type: 'image' | 'video' | 'audio' | 'document';
    url: string;
    caption?: string;
  };
  timestamp: Date;
}

export interface IPlatformAdapter {
  /**
   * Initialize the platform (e.g., Meta API connection)
   */
  initialize(): Promise<void>;

  /**
   * Get the platform identifier (whatsapp)
   */
  getPlatform(): Platform;

  /**
   * Send a text or media message to a specific external user ID
   */
  sendMessage(targetExternalId: string, message: Partial<Message>): Promise<void>;

  /**
   * Register a callback for incoming messages
   */
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;

  /**
   * Check if the platform is currently connected and ready
   */
  isReady(): boolean;

  /**
   * Send a typing indicator to a specific external user ID
   */
  sendTypingState(targetExternalId: string): Promise<void>;

  /**
   * Register a callback for when a user starts typing
   */
  onTypingState(handler: (externalId: string) => Promise<void>): void;

  /**
   * Register a callback for when a button is clicked
   */
  onButtonSelected(handler: (externalId: string, buttonId: string) => Promise<void>): void;
}
