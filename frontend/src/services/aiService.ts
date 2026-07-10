import api from './api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationRecord {
  id: string;
  familyId: string;
  userId: string;
  content: string;
  response: string;
  type: 'chat' | 'analysis' | 'ocr';
  createdAt: string;
}

export interface OCRResult {
  amount?: number;
  date?: string;
  category?: string;
  description?: string;
  raw?: string;
}

export interface ActionResult {
  type: string;
  status: 'success' | 'error';
  message: string;
  record?: any;
  records?: any[];
}

export interface ChatResponse {
  response: string;
  actions: ActionResult[];
  aiConfigured: boolean;
}

export const sendChat = async (familyId: string, content: string): Promise<ChatResponse> => {
  const response = await api.post<ChatResponse>(`/families/${familyId}/ai/chat`, { content });
  return response.data;
};

export const getAnalysis = async (familyId: string): Promise<{ report: string; aiConfigured: boolean }> => {
  const response = await api.post<{ report: string; aiConfigured: boolean }>(`/families/${familyId}/ai/analyze`, {});
  return response.data;
};

export const sendOCR = async (familyId: string, image: string): Promise<{ data: OCRResult; aiConfigured: boolean }> => {
  const response = await api.post<{ data: OCRResult; aiConfigured: boolean }>(`/families/${familyId}/ai/ocr`, { image });
  return response.data;
};

export const getAIStatus = async (): Promise<{ configured: boolean; message: string }> => {
  const response = await api.get<{ configured: boolean; message: string }>(`/families/0/ai/status`);
  return response.data;
};

export const getHistory = async (familyId: string): Promise<ConversationRecord[]> => {
  const response = await api.get<ConversationRecord[]>(`/families/${familyId}/ai/history`);
  return response.data;
};

// 撤销 AI 创建的记录
export const undoAction = async (familyId: string, actionType: string, recordId: string): Promise<void> => {
  const resourceMap: Record<string, string> = {
    create_income: 'incomes',
    create_expense: 'expenses',
    create_asset: 'assets',
    create_liability: 'liabilities',
  };
  const resource = resourceMap[actionType];
  if (!resource) return;
  await api.delete(`/families/${familyId}/${resource}/${recordId}`);
};
