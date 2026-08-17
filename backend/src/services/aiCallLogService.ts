import { prisma } from '../app';

export interface AICallLogData {
  userId: string;
  familyId?: string;
  type: string; // "chat" | "ocr" | "category"
  model?: string;
  tokenUsage?: number;
  latency?: number;
  success: boolean;
  error?: string;
}

/**
 * 记录一次 AI 调用日志到 AiCallLog 表。
 * 失败时不抛错（只 console.error），避免影响主流程。
 */
export async function logAICall(data: AICallLogData): Promise<void> {
  try {
    await prisma.aiCallLog.create({
      data: {
        userId: data.userId,
        familyId: data.familyId,
        type: data.type,
        model: data.model,
        tokenUsage: data.tokenUsage,
        latency: data.latency,
        success: data.success,
        error: data.error,
      },
    });
  } catch (error) {
    console.error(
      '记录 AI 调用日志失败:',
      error instanceof Error ? error.message : error
    );
  }
}
