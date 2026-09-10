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
  name: string;
  content: string;
  url?: string;
  type?: 'file' | 'history';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoningContent?: string;
  timestamp: number;
  files?: MessageFile[];
  images?: MessageImage[];
  citations?: Citation[];
  isUploading?: boolean;
  progress?: number;
  isTemplateCall?: boolean;
  speed?: string; // 【新增】用于记录生成速度
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}
