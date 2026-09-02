import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
  },
}));

jest.mock('../services/aiProposalConfirmationService', () => ({
  confirmAiProposal: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { confirmAiProposal } from '../services/aiProposalConfirmationService';
import aiRoutes from './ai';

const mockedPrisma = prisma as any;
const mockedConfirm = confirmAiProposal as jest.MockedFunction<typeof confirmAiProposal>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/ai', aiRoutes);

const token = jwt.sign(
  { userId: 'user-1', email: 'user-1@example.test', name: 'User' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

describe('AI proposal confirmation route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'family-1', userId: 'user-1', role: 'member', family: { cacheVersion: 1 },
    });
    mockedConfirm.mockResolvedValue({
      operationId: 'operation-1',
      resourceId: 'proposal-1',
      version: 3,
      record: {
        proposalId: 'proposal-1', status: 'EXECUTED', version: 3, actions: [],
      },
      deduplicated: false,
    });
  });

  test('confirms only the server-owned proposal and forwards the final actions plus header key', async () => {
    const response = await request(app)
      .post('/api/families/family-1/ai/proposals/proposal-1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'confirm-1')
      .send({
        expectedVersion: 1,
        expectedHash: 'a'.repeat(64),
        actions: [{ type: 'create_income', data: { amount: 100, category: '工资' } }],
      });

    expect(response.status).toBe(200);
    expect(mockedConfirm).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorUserId: 'user-1',
      proposalId: 'proposal-1',
      expectedVersion: 1,
      expectedHash: 'a'.repeat(64),
      idempotencyKey: 'confirm-1',
      actions: [{ type: 'create_income', data: { amount: 100, category: '工资' } }],
    }, expect.any(Object));
    expect(response.body).toMatchObject({ operationId: 'operation-1', resourceId: 'proposal-1' });
  });

  test('accepts proposal item ids so edited actions remain bound to server-owned items', async () => {
    const response = await request(app)
      .post('/api/families/family-1/ai/proposals/proposal-1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'confirm-item-1')
      .send({
        expectedVersion: 1,
        expectedHash: 'a'.repeat(64),
        actions: [{
          proposalItemId: 'proposal-item-1',
          type: 'create_income',
          data: { amount: 100, category: '工资' },
        }],
      });

    expect(response.status).toBe(200);
    expect(mockedConfirm).toHaveBeenCalledWith(expect.objectContaining({
      actions: [{
        proposalItemId: 'proposal-item-1',
        type: 'create_income',
        data: { amount: 100, category: '工资' },
      }],
    }), expect.any(Object));
  });

  test('rejects client-owned items and never invokes the confirmation service', async () => {
    const response = await request(app)
      .post('/api/families/family-1/ai/proposals/proposal-1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'confirm-1')
      .send({
        expectedVersion: 1,
        expectedHash: 'a'.repeat(64),
        items: [{ type: 'create_income', data: { amount: 999 } }],
      });

    expect(response.status).toBe(400);
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  test('returns Idempotency-Replayed when confirmation is a replay', async () => {
    mockedConfirm.mockResolvedValueOnce({
      operationId: 'operation-1', resourceId: 'proposal-1', deduplicated: true,
      record: { proposalId: 'proposal-1', status: 'EXECUTED', version: 3, actions: [] },
    });

    const response = await request(app)
      .post('/api/families/family-1/ai/proposals/proposal-1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'confirm-1')
      .send({
        expectedVersion: 1,
        expectedHash: 'a'.repeat(64),
        actions: [{ type: 'create_income', data: { amount: 100, category: '工资' } }],
      });

    expect(response.status).toBe(200);
    expect(response.headers['idempotency-replayed']).toBe('true');
  });

  test('rejects the legacy raw action shape instead of executing client-owned actions', async () => {
    const response = await request(app)
      .post('/api/families/family-1/ai/execute-actions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'legacy-raw-1')
      .send({ actions: [{ type: 'create_income', data: { amount: 999, category: '伪造' } }] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  test('keeps the legacy URL as a strict proposal confirmation adapter', async () => {
    const response = await request(app)
      .post('/api/families/family-1/ai/execute-actions')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'legacy-adapter-1')
      .send({
        proposalId: 'proposal-1',
        expectedVersion: 1,
        expectedHash: 'a'.repeat(64),
        actions: [{ type: 'create_income', data: { amount: 100, category: '工资' } }],
      });

    expect(response.status).toBe(200);
    expect(mockedConfirm).toHaveBeenCalledWith(expect.objectContaining({
      familyId: 'family-1',
      proposalId: 'proposal-1',
      expectedVersion: 1,
      expectedHash: 'a'.repeat(64),
    }), expect.any(Object));
  });
});
