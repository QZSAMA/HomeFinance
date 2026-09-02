import { randomUUID } from 'crypto';
import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { DomainError } from '../services/ledgerErrors';
import { LedgerRecord, MutationResult } from '../services/ledgerTypes';

export const readIdempotencyKey = (req: AuthRequest): string => {
  const key = req.header('Idempotency-Key')?.trim();
  return key || randomUUID();
};

export const readExpectedVersion = (req: AuthRequest): number | undefined => {
  const raw = req.header('If-Match');
  if (!raw) return undefined;
  const normalized = raw.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized)) || Number(normalized) < 1) {
    throw new DomainError('VALIDATION_FAILED', 'If-Match must be a positive integer.', 400);
  }
  return Number(normalized);
};

export const sendLedgerMutationError = (error: unknown, res: Response, label: string) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      error: error.errors[0].message,
      code: 'VALIDATION_FAILED',
      retryable: false,
    });
  }
  if (error instanceof DomainError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      retryable: error.retryable,
    });
  }
  console.error(`${label}账本变更错误:`, error);
  return res.status(500).json({ error: '服务器内部错误', code: 'INTERNAL_ERROR', retryable: false });
};

export const mutationResource = (result: MutationResult<LedgerRecord>) => ({
  ...(result.record ?? { id: result.resourceId }),
  ...(result.version === undefined ? {} : { version: result.version }),
  operationId: result.operationId,
  deduplicated: result.deduplicated,
});

export const mutationDeleteResponse = (result: MutationResult<LedgerRecord>) => ({
  message: '删除成功',
  ...(result.version === undefined ? {} : { version: result.version }),
  operationId: result.operationId,
  deduplicated: result.deduplicated,
});

export const markIdempotencyReplay = (result: MutationResult, res: Response) => {
  if (result.deduplicated) res.set('Idempotency-Replayed', 'true');
};
