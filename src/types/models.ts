export enum Platform {
  WHATSAPP = 'whatsapp',
  TELEGRAM = 'telegram',
}

export enum UserStatus {
  IDLE = 'idle',
  SEARCHING = 'searching',
  MATCHED = 'matched',
}

export interface User {
  id: string; // Internal UUID
  externalId: string; // WhatsApp number or Telegram ID
  platform: Platform;
  username?: string;
  bio?: string;
  gender?: string;
  prefGender?: string;
  purpose?: string;
  onboardingStep: string;
  interests: string[];
  normalizedInterests: string[];
  status: UserStatus;
  currentMatchId?: string;
  activeContactId?: string;
  isReady: boolean;
  isBanned: boolean;
  trustScore: number;
  acceptMedia: boolean;
  lastMatchAttemptAt?: Date;
  lastActivityAt: Date;
  blockedUserIds: string[];
  contactIds: string[]; // Confirmed friends
  pendingContactIds: string[]; // Sent requests waiting for acceptance
  createdAt: Date;
}

export interface Match {
  id: string;
  userIds: [string, string];
  startedAt: Date;
  endedAt?: Date;
  lastActivityAt: Date;
  interests: string[]; // Shared interests that triggered the match
}
