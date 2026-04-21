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
  base64: string; // 用于前端预览和直接发送给大模型的 Base64 字符串
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoningContent?: string;
  timestamp: number;
  files?: MessageFile[];
  images?: MessageImage[]; // 新增：保存用户上传或粘贴的图片
  imageBase64?: string;
  isUploading?: boolean;
  progress?: number;
  isTemplateCall?: boolean; 
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
