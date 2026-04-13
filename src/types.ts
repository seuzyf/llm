// src/types.ts
export interface MessageFile {
  name: string;
  url: string;
  content: string;
  isTruncated?: boolean; // 新增：标记是否因为过长而被截断
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoningContent?: string;
  timestamp: number;
  files?: MessageFile[];
  imageBase64?: string;
  isUploading?: boolean;
  progress?: number;
  isTemplateCall?: boolean; // 新增：标记是否为特殊模板调用，用于隐藏原始prompt并渲染专属UI
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
