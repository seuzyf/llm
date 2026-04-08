export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  fileUrl?: string;
  fileName?: string;
  fileContent?: string;
  imageBase64?: string; // 新增：用于多模态视觉的Base64数据
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
