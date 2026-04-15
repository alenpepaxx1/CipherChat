export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export type User = { 
  id: string; 
  name: string; 
  username: string; 
  email: string; 
  avatar: string; 
  isOnline: boolean; 
  publicKey?: string; 
};

export type Reaction = { emoji: string; userIds: string[] };

export type Attachment = {
  name: string;
  size: number;
  type: string;
  dataUrl: string;
};

export type Message = {
  id: string;
  senderId: string;
  text: string;
  timestamp: Date;
  isEphemeral: boolean;
  ttlSeconds?: number;
  viewedAt?: Date;
  isEncryptedState?: boolean;
  encryptedData?: {
    ciphertext: string;
    iv: string;
  } | string;
  reactions?: Reaction[];
  attachment?: Attachment;
  status?: 'pending' | 'sent' | 'delivered' | 'failed';
  isPinned?: boolean;
  isEdited?: boolean;
  originalText?: string;
};

export type Story = {
  id: string;
  userId: string;
  type: 'image' | 'video';
  url: string;
  timestamp: Date;
  viewers: string[];
};

export type CallState = {
  id?: string;
  chatId: string;
  type: 'audio' | 'video';
  status: 'calling' | 'connecting' | 'connected' | 'reconnecting' | 'connection_lost';
  participants: User[];
  callerId?: string;
};

export type ChatSettings = {
  readReceipts: boolean;
  defaultTtl: number;
  notifications: boolean;
  encryptionProtocol: 'standard' | 'quantum-resistant';
  autoDownload: 'all' | 'wifi-only' | 'never';
  typingIndicators: boolean;
  linkPreviews: boolean;
  themeColor?: string;
};

export type Chat = {
  id: string;
  name: string;
  isGroup: boolean;
  participants: User[];
  messages: Message[];
  typingUserIds?: string[];
  settings?: ChatSettings;
};
