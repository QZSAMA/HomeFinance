import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { setRequestId } from '../utils/logger';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id'] as string | undefined;
  const trimmed = incomingId?.trim();
  const requestId = trimmed && trimmed.length > 0 ? trimmed : crypto.randomUUID();

  res.setHeader('X-Request-Id', requestId);
  setRequestId(requestId);
  next();
}
