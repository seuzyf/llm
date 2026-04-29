// src/types.ts
export interface MessageFile {
  name: string;
  url: string;
  content: string;
  isTruncated?: boolean; 
  hasError?: boolean;
}

export interface MessageImage {
  name: string;
  base64: string; 
}

export interface Citation {
  id: string;
  type: 'file' | 'chat';
  name: string;
  url?: string;
  content: string;
  score?: number;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoningContent?: string;
  timestamp: number;
  files?: MessageFile[];
  images?: MessageImage[]; 
  imageBase64?: string;
  isUploading?: boolean;
  progress?: number;
  isTemplateCall?: boolean; 
  citations?: Citation[]; 
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}

export interface ModelInfo {
  id: string;
  object: string;
  owned_by: string;
}
