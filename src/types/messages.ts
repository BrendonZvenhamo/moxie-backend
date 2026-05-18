import { Platform } from './models';

export interface BaseMessage {
  id: string;
  senderId: string; // Internal User ID
  platform: Platform;
  timestamp: Date;
}

export interface TextMessage extends BaseMessage {
  type: 'text';
  content: string;
}

export interface MediaMessage extends BaseMessage {
  type: 'image' | 'video' | 'audio' | 'document';
  url: string;
  caption?: string;
}

export type Message = TextMessage | MediaMessage | ButtonMessage;

export interface Button {
  id: string;
  text: string;
}

export interface ButtonMessage extends BaseMessage {
  type: 'buttons';
  title: string;
  body: string;
  footer?: string;
  buttons: Button[];
}

export interface RelayMetadata {
  originalMessageId: string;
  targetUserId: string;
  targetPlatform: Platform;
}
