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
  fileId: string | null;
  createdAt: string;
  proposal?: {
    id: string;
    version: number;
    originalHash: string;
    expiresAt: string;
    status: string;
    items: AIAction[];
  };
}

export type OCRSource = 'vision' | 'tesseract' | 'merged';

export interface OCRResult {
  amount?: number;
  date?: string;
  category?: string;
  description?: string;
  type?: 'income' | 'expense';
  raw?: string;
  rawText?: string;
  source: OCRSource;
}

export interface AIAction {
  type: string;
  data: Record<string, any>;
  proposalItemId?: string;
}

export interface OCRResponse {
  data: OCRResult;
  aiConfigured: boolean;
  visionConfigured: boolean;
  fileId: string | null;
  proposedActions?: AIAction[];
  duplicateFlags?: boolean[];
  proposalId?: string;
  proposalVersion?: number;
  proposalHash?: string;
  proposalExpiresAt?: string;
  proposalItems?: AIAction[];
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
  proposedActions?: AIAction[];
  duplicateFlags?: boolean[];
  fileIds?: string[];
  proposalId?: string;
  proposalVersion?: number;
  proposalHash?: string;
  proposalExpiresAt?: string;
  proposalItems?: AIAction[];
  aiConfigured: boolean;
}

export interface ConfirmAiProposalInput {
  familyId: string;
  proposalId: string;
  expectedVersion: number;
  expectedHash: string;
  actions: AIAction[];
}

export interface ConfirmedAiAction {
  ordinal: number;
  type: string;
  resourceId: string;
  version?: number;
}

export interface ConfirmAiProposalResponse {
  operationId: string;
  resourceId: string;
  version?: number;
  deduplicated: boolean;
  record?: {
    proposalId: string;
    status: 'EXECUTED';
    version: number;
    actions: ConfirmedAiAction[];
  };
}

export const sendChat = async (
  familyId: string,
  content: string,
  images?: string[],
): Promise<ChatResponse> => {
  const body: Record<string, unknown> = {};
  if (content.trim()) body.content = content;
  if (images && images.length > 0) body.images = images;
  const response = await api.post<ChatResponse>(
    `/families/${familyId}/ai/chat`,
    body,
    // 含图片时延长超时到 120s（OCR 较慢）
    images && images.length > 0 ? { timeout: 120000 } : undefined,
  );
  return response.data;
};

export const getAnalysis = async (familyId: string): Promise<{ report: string; aiConfigured: boolean }> => {
  const response = await api.post<{ report: string; aiConfigured: boolean }>(`/families/${familyId}/ai/analyze`, {});
  return response.data;
};

export const sendOCR = async (familyId: string, image: string): Promise<OCRResponse> => {
  // OCR 需要 Tesseract.js 本地文字提取 + AI 解析，大图片可能较慢，设 120 秒超时
  const response = await api.post<OCRResponse>(
    `/families/${familyId}/ai/ocr`,
    { image },
    { timeout: 120000 }
  );
  return response.data;
};

export const confirmAiProposal = async (
  input: ConfirmAiProposalInput,
  idempotencyKey: string,
): Promise<ConfirmAiProposalResponse> => {
  const response = await api.post<ConfirmAiProposalResponse>(
    `/families/${input.familyId}/ai/proposals/${input.proposalId}/confirm`,
    {
      expectedVersion: input.expectedVersion,
      expectedHash: input.expectedHash,
      actions: input.actions,
    },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
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
