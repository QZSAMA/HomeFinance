import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import aiRoutes from '../routes/ai';
import assetRoutes from '../routes/assets';
import budgetRoutes from '../routes/budgets';
import familyRoutes from '../routes/families';
import expenseRoutes from '../routes/expenses';
import fileRoutes from '../routes/files';
import goalRoutes from '../routes/goals';
import incomeRoutes from '../routes/incomes';
import importRoutes from '../routes/import';
import liabilityRoutes from '../routes/liabilities';
import recurringRoutes from '../routes/recurring';

const prisma = new PrismaClient();
const runId = randomUUID();
const familyId = `p1-role-matrix-family-${runId}`;
const adminId = `p1-role-matrix-admin-${runId}`;
const memberId = `p1-role-matrix-member-${runId}`;
const viewerId = `p1-role-matrix-viewer-${runId}`;
const unknownRoleId = `p1-role-matrix-unknown-${runId}`;
const outsiderId = `p1-role-matrix-outsider-${runId}`;

const app = express();
app.use(express.json());
app.use('/api/families', familyRoutes);
app.use('/api/families/:familyId/incomes', incomeRoutes);
app.use('/api/families/:familyId/expenses', expenseRoutes);
app.use('/api/families/:familyId/assets', assetRoutes);
app.use('/api/families/:familyId/liabilities', liabilityRoutes);
app.use('/api/families/:familyId/budgets', budgetRoutes);
app.use('/api/families/:familyId/goals', goalRoutes);
app.use('/api/families/:familyId/recurring', recurringRoutes);
app.use('/api/families/:familyId/files', fileRoutes);
app.use('/api/families/:familyId/import', importRoutes);
app.use('/api/families/:familyId/ai', aiRoutes);

const tokenFor = (userId: string) => jwt.sign(
  { userId, email: `${userId}@example.test`, name: userId },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const tokens = {
  admin: tokenFor(adminId),
  member: tokenFor(memberId),
  viewer: tokenFor(viewerId),
  unknown: tokenFor(unknownRoleId),
  outsider: tokenFor(outsiderId),
};

const incomePayload = {
  amount: 100,
  category: 'SALARY',
  description: 'role matrix income',
  date: '2026-09-01T00:00:00.000Z',
  source: 'Employer',
};

const expensePayload = {
  amount: 20,
  category: 'FOOD',
  description: 'role matrix expense',
  date: '2026-09-01T00:00:00.000Z',
  paymentMethod: 'CARD',
};

const mutationEntries: Array<{
  method: 'post' | 'put' | 'delete';
  path: string;
  body?: object;
}> = [
  { method: 'post', path: 'incomes', body: incomePayload },
  { method: 'put', path: 'incomes/not-a-real-id', body: incomePayload },
  { method: 'delete', path: 'incomes/not-a-real-id' },
  { method: 'post', path: 'expenses', body: expensePayload },
  { method: 'put', path: 'expenses/not-a-real-id', body: expensePayload },
  { method: 'delete', path: 'expenses/not-a-real-id' },
  { method: 'post', path: 'assets', body: { name: 'Asset', type: 'CASH', value: 1 } },
  { method: 'put', path: 'assets/not-a-real-id', body: { name: 'Asset', type: 'CASH', value: 1 } },
  { method: 'delete', path: 'assets/not-a-real-id' },
  { method: 'post', path: 'liabilities', body: { name: 'Liability', type: 'LOAN', amount: 1 } },
  { method: 'put', path: 'liabilities/not-a-real-id', body: { name: 'Liability', type: 'LOAN', amount: 1 } },
  { method: 'delete', path: 'liabilities/not-a-real-id' },
  { method: 'post', path: 'budgets', body: { category: 'FOOD', amount: 1, period: 'MONTHLY', startDate: '2026-09-01' } },
  { method: 'put', path: 'budgets/not-a-real-id', body: { amount: 1 } },
  { method: 'delete', path: 'budgets/not-a-real-id' },
  { method: 'post', path: 'goals', body: { title: 'Goal', type: 'SAVING', targetAmount: 1 } },
  { method: 'put', path: 'goals/not-a-real-id', body: { title: 'Goal' } },
  { method: 'delete', path: 'goals/not-a-real-id' },
  {
    method: 'post',
    path: 'recurring',
    body: { type: 'EXPENSE', category: 'FOOD', amount: 1, frequency: 'MONTHLY', nextDate: '2026-09-01' },
  },
  { method: 'post', path: 'recurring/not-a-real-id/execute' },
  { method: 'put', path: 'recurring/not-a-real-id', body: { description: 'changed' } },
  { method: 'delete', path: 'recurring/not-a-real-id' },
  { method: 'post', path: 'files/upload', body: { ignored: true } },
  { method: 'delete', path: 'files/not-a-real-id' },
  { method: 'post', path: 'import/csv', body: { format: 'alipay' } },
  { method: 'post', path: 'import/confirm', body: { items: [] } },
  { method: 'post', path: 'ai/chat', body: { content: 'record this' } },
  { method: 'post', path: 'ai/analyze', body: { period: 'month' } },
  { method: 'post', path: 'ai/ocr', body: { image: 'not-a-real-image' } },
  { method: 'post', path: 'ai/execute-actions', body: { actions: [] } },
  { method: 'put', path: 'family-admin', body: { name: 'Denied family update' } },
  { method: 'delete', path: 'family-admin' },
  { method: 'post', path: 'family-admin/invite', body: { email: `${outsiderId}@example.test`, role: 'member' } },
  { method: 'put', path: `family-admin/members/${viewerId}/role`, body: { role: 'viewer' } },
  { method: 'delete', path: `family-admin/members/${viewerId}` },
];

const familySnapshot = async () => Promise.all([
  prisma.income.count({ where: { familyId } }),
  prisma.expense.count({ where: { familyId } }),
  prisma.familyMember.count({ where: { familyId } }),
  prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { name: true } }),
]);

describe('Phase 1 real PostgreSQL role x method matrix', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        { id: adminId, email: `${adminId}@example.test`, passwordHash: 'test', name: 'Admin' },
        { id: memberId, email: `${memberId}@example.test`, passwordHash: 'test', name: 'Member' },
        { id: viewerId, email: `${viewerId}@example.test`, passwordHash: 'test', name: 'Viewer' },
        { id: unknownRoleId, email: `${unknownRoleId}@example.test`, passwordHash: 'test', name: 'Unknown role' },
        { id: outsiderId, email: `${outsiderId}@example.test`, passwordHash: 'test', name: 'Outsider' },
      ],
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Role matrix family',
        members: {
          create: [
            { userId: adminId, role: 'admin' },
            { userId: memberId, role: 'member' },
            { userId: viewerId, role: 'viewer' },
            { userId: unknownRoleId, role: 'auditor' },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, memberId, viewerId, unknownRoleId, outsiderId] } },
    });
    await prisma.$disconnect();
  });

  test('enforces authentication and family roles before Income/Expense writes', async () => {
    const before = await familySnapshot();
    const deniedActors: Array<[string, string | undefined]> = [
      ['unauthenticated', undefined],
      ['viewer', tokens.viewer],
      ['unknown role', tokens.unknown],
      ['non-member', tokens.outsider],
    ];

    for (const [label, token] of deniedActors) {
      const incomeRequest = request(app)
        .post(`/api/families/${familyId}/incomes`)
        .set('Idempotency-Key', `denied-income-${label}`)
        .send(incomePayload);
      if (token) incomeRequest.set('Authorization', `Bearer ${token}`);
      const incomeResponse = await incomeRequest;
      expect(incomeResponse.status).toBe(token ? 403 : 401);

      const expenseRequest = request(app)
        .post(`/api/families/${familyId}/expenses`)
        .set('Idempotency-Key', `denied-expense-${label}`)
        .send(expensePayload);
      if (token) expenseRequest.set('Authorization', `Bearer ${token}`);
      const expenseResponse = await expenseRequest;
      expect(expenseResponse.status).toBe(token ? 403 : 401);
      await expect(familySnapshot()).resolves.toEqual(before);
    }

    const memberIncome = await request(app)
      .post(`/api/families/${familyId}/incomes`)
      .set('Authorization', `Bearer ${tokens.member}`)
      .set('Idempotency-Key', 'member-income')
      .send(incomePayload);
    expect(memberIncome.status).toBe(201);

    const adminExpense = await request(app)
      .post(`/api/families/${familyId}/expenses`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .set('Idempotency-Key', 'admin-expense')
      .send(expensePayload);
    expect(adminExpense.status).toBe(201);
  });

  test('rejects every registered family mutation entry before its handler side effects', async () => {
    const before = await familySnapshot();
    const deniedActors: Array<[string, string | undefined]> = [
      ['unauthenticated', undefined],
      ['viewer', tokens.viewer],
      ['unknown-role', tokens.unknown],
      ['non-member', tokens.outsider],
    ];

    for (const entry of mutationEntries) {
      for (const [label, token] of deniedActors) {
        const path = entry.path === 'family-admin'
          ? `/api/families/${familyId}`
          : entry.path.startsWith('family-admin/')
            ? `/api/families/${familyId}/${entry.path.slice('family-admin/'.length)}`
            : `/api/families/${familyId}/${entry.path}`;
        const mutationRequest = request(app)[entry.method](path)
          .set('Idempotency-Key', `matrix-${entry.method}-${entry.path}-${label}`);
        if (token) mutationRequest.set('Authorization', `Bearer ${token}`);
        if (entry.body) mutationRequest.send(entry.body);

        const response = await mutationRequest;
        expect(response.status).toBe(token ? 403 : 401);
      }
    }

    await expect(familySnapshot()).resolves.toEqual(before);
  });

  test('allows members and admins to mutate non-ledger resources within the family', async () => {
    const assetCreated = await request(app)
      .post(`/api/families/${familyId}/assets`)
      .set('Authorization', `Bearer ${tokens.member}`)
      .send({ name: 'Member asset', type: 'CASH', value: 10 });
    expect(assetCreated.status).toBe(201);

    const assetUpdated = await request(app)
      .put(`/api/families/${familyId}/assets/${assetCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'Admin updated asset', type: 'CASH', value: 11 });
    expect(assetUpdated.status).toBe(200);

    const assetDeleted = await request(app)
      .delete(`/api/families/${familyId}/assets/${assetCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.member}`);
    expect(assetDeleted.status).toBe(200);

    const liabilityCreated = await request(app)
      .post(`/api/families/${familyId}/liabilities`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'Admin liability', type: 'OTHER', amount: 20 });
    expect(liabilityCreated.status).toBe(201);

    const liabilityUpdated = await request(app)
      .put(`/api/families/${familyId}/liabilities/${liabilityCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.member}`)
      .send({ name: 'Member updated liability', type: 'OTHER', amount: 21 });
    expect(liabilityUpdated.status).toBe(200);

    const liabilityDeleted = await request(app)
      .delete(`/api/families/${familyId}/liabilities/${liabilityCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(liabilityDeleted.status).toBe(200);

    const budgetCreated = await request(app)
      .post(`/api/families/${familyId}/budgets`)
      .set('Authorization', `Bearer ${tokens.member}`)
      .send({ category: 'FOOD', amount: 100, period: 'MONTHLY', startDate: '2026-09-01' });
    expect(budgetCreated.status).toBe(201);

    const budgetUpdated = await request(app)
      .put(`/api/families/${familyId}/budgets/${budgetCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ category: 'FOOD', amount: 110, period: 'MONTHLY', startDate: '2026-09-01' });
    expect(budgetUpdated.status).toBe(200);

    const budgetDeleted = await request(app)
      .delete(`/api/families/${familyId}/budgets/${budgetCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.member}`);
    expect(budgetDeleted.status).toBe(200);

    const goalCreated = await request(app)
      .post(`/api/families/${familyId}/goals`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ title: 'Admin goal', type: 'SAVING', targetAmount: 500 });
    expect(goalCreated.status).toBe(201);

    const goalUpdated = await request(app)
      .put(`/api/families/${familyId}/goals/${goalCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.member}`)
      .send({ title: 'Member updated goal' });
    expect(goalUpdated.status).toBe(200);

    const goalDeleted = await request(app)
      .delete(`/api/families/${familyId}/goals/${goalCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(goalDeleted.status).toBe(200);

    const recurringCreated = await request(app)
      .post(`/api/families/${familyId}/recurring`)
      .set('Authorization', `Bearer ${tokens.member}`)
      .send({
        type: 'EXPENSE',
        category: 'FOOD',
        amount: 30,
        frequency: 'MONTHLY',
        nextDate: '2026-09-01',
      });
    expect(recurringCreated.status).toBe(201);

    const recurringUpdated = await request(app)
      .put(`/api/families/${familyId}/recurring/${recurringCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ description: 'Admin updated recurring rule' });
    expect(recurringUpdated.status).toBe(200);

    const recurringExecuted = await request(app)
      .post(`/api/families/${familyId}/recurring/${recurringCreated.body.id}/execute`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(recurringExecuted.status).toBe(200);

    const recurringDeleted = await request(app)
      .delete(`/api/families/${familyId}/recurring/${recurringCreated.body.id}`)
      .set('Authorization', `Bearer ${tokens.member}`);
    expect(recurringDeleted.status).toBe(200);

    const csvPreview = await request(app)
      .post(`/api/families/${familyId}/import/csv`)
      .set('Authorization', `Bearer ${tokens.member}`)
      .field('format', 'alipay')
      .attach(
        'file',
        Buffer.from('交易时间,商品名称,金额,收/支,交易分类\n2026-09-01 10:00:00,Role matrix CSV,50,收入,OTHER\n'),
        'role-matrix.csv',
      );
    expect(csvPreview.status).toBe(200);
    expect(csvPreview.headers['x-import-batch-id']).toMatch(/^c[a-z0-9]+$/);
    expect(csvPreview.headers['x-import-preview-hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(csvPreview.body).toEqual([expect.objectContaining({
      description: 'Role matrix CSV',
      amount: 50,
      type: 'INCOME',
    })]);
    const previewBatch = await prisma.importBatch.findUniqueOrThrow({
      where: { id: csvPreview.headers['x-import-batch-id'] },
      include: { rows: true },
    });
    expect(previewBatch).toMatchObject({
      familyId,
      actorUserId: memberId,
      format: 'alipay',
      parserVersion: 'csv-v1',
      previewHash: csvPreview.headers['x-import-preview-hash'],
      status: 'PREVIEWED',
      rowCount: 1,
      rows: [expect.objectContaining({
        rowNumber: 1,
        status: 'VALID',
        canonicalPayload: expect.objectContaining({
          description: 'Role matrix CSV',
          amount: 50,
          type: 'INCOME',
        }),
      })],
    });

    const imported = await request(app)
      .post(`/api/families/${familyId}/import/confirm`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .set('Idempotency-Key', 'role-matrix-import-confirm')
      .send({
        batchId: csvPreview.headers['x-import-batch-id'],
        expectedPreviewHash: csvPreview.headers['x-import-preview-hash'],
      });
    expect(imported.status).toBe(200);
    expect(imported.body.successCount).toBe(1);
    expect(imported.body.batchId).toBe(csvPreview.headers['x-import-batch-id']);

    const file = await prisma.file.create({
      data: {
        familyId,
        userId: memberId,
        name: 'role-matrix.txt',
        path: `${familyId}/role-matrix.txt`,
        type: 'text/plain',
        size: 4,
        mimeType: 'text/plain',
      },
    });
    const fileDeleted = await request(app)
      .delete(`/api/families/${familyId}/files/${file.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(fileDeleted.status).toBe(200);
  });

  test('restricts family administration to admins and preserves the final administrator', async () => {
    const deniedFamilyMutation = async (
      method: 'put' | 'post' | 'delete',
      path: string,
      token: string | undefined,
      body?: object,
    ) => {
      const requestBuilder = request(app)[method](path);
      if (token) requestBuilder.set('Authorization', `Bearer ${token}`);
      if (body) requestBuilder.send(body);
      return requestBuilder;
    };

    const initial = await familySnapshot();
    const familyWriteCases: Array<[string, string, string | undefined, object | undefined]> = [
      ['update', 'put', undefined, { name: 'Denied unauthenticated', description: 'unchanged' }],
      ['update', 'put', tokens.member, { name: 'Denied member', description: 'unchanged' }],
      ['update', 'put', tokens.viewer, { name: 'Denied viewer', description: 'unchanged' }],
      ['update', 'put', tokens.unknown, { name: 'Denied unknown', description: 'unchanged' }],
      ['update', 'put', tokens.outsider, { name: 'Denied outsider', description: 'unchanged' }],
      ['invite', 'post', undefined, { email: `${outsiderId}@example.test`, role: 'member' }],
      ['invite', 'post', tokens.member, { email: `${outsiderId}@example.test`, role: 'member' }],
      ['invite', 'post', tokens.viewer, { email: `${outsiderId}@example.test`, role: 'member' }],
      ['invite', 'post', tokens.unknown, { email: `${outsiderId}@example.test`, role: 'member' }],
      ['invite', 'post', tokens.outsider, { email: `${outsiderId}@example.test`, role: 'member' }],
    ];

    for (const [label, method, token, body] of familyWriteCases) {
      const path = label === 'update'
        ? `/api/families/${familyId}`
        : `/api/families/${familyId}/invite`;
      const response = await deniedFamilyMutation(method as 'put' | 'post', path, token, body);
      expect(response.status).toBe(token ? 403 : 401);
      await expect(familySnapshot()).resolves.toEqual(initial);
    }

    const updated = await request(app)
      .put(`/api/families/${familyId}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'Admin updated family', description: 'admin mutation' });
    expect(updated.status).toBe(200);

    const invited = await request(app)
      .post(`/api/families/${familyId}/invite`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ email: `${outsiderId}@example.test`, role: 'member' });
    expect(invited.status).toBe(201);

    const roleDenied = await request(app)
      .put(`/api/families/${familyId}/members/${viewerId}/role`)
      .set('Authorization', `Bearer ${tokens.viewer}`)
      .send({ role: 'viewer' });
    expect(roleDenied.status).toBe(403);

    const roleUpdated = await request(app)
      .put(`/api/families/${familyId}/members/${viewerId}/role`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ role: 'viewer' });
    expect(roleUpdated.status).toBe(200);

    const finalAdminDemotion = await request(app)
      .put(`/api/families/${familyId}/members/${adminId}/role`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ role: 'viewer' });
    expect(finalAdminDemotion.status).toBe(400);
    expect(finalAdminDemotion.body.error).toContain('管理员');

    const viewerSelfRemoval = await request(app)
      .delete(`/api/families/${familyId}/members/${viewerId}`)
      .set('Authorization', `Bearer ${tokens.viewer}`);
    expect(viewerSelfRemoval.status).toBe(403);

    const adminRemovesInvitedMember = await request(app)
      .delete(`/api/families/${familyId}/members/${outsiderId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(adminRemovesInvitedMember.status).toBe(200);

    const memberSelfRemoval = await request(app)
      .delete(`/api/families/${familyId}/members/${memberId}`)
      .set('Authorization', `Bearer ${tokens.member}`);
    expect(memberSelfRemoval.status).toBe(200);

    const viewerDeleteFamily = await request(app)
      .delete(`/api/families/${familyId}`)
      .set('Authorization', `Bearer ${tokens.viewer}`);
    expect(viewerDeleteFamily.status).toBe(403);

    const adminDeleteFamily = await request(app)
      .delete(`/api/families/${familyId}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(adminDeleteFamily.status).toBe(200);
  });
});
