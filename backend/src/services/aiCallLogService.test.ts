import { logAICall } from './aiCallLogService';

jest.mock('../app', () => ({
  prisma: {
    aiCallLog: {
      create: jest.fn(),
    },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

describe('aiCallLogService.logAICall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认成功创建
    mockedPrisma.aiCallLog.create.mockResolvedValue({});
  });

  test('成功写入数据库', async () => {
    mockedPrisma.aiCallLog.create.mockResolvedValue({ id: 'log_1' });

    await logAICall({
      userId: 'user_1',
      familyId: 'family_1',
      type: 'chat',
      model: 'gpt-4',
      tokenUsage: 200,
      latency: 350,
      success: true,
    });

    expect(mockedPrisma.aiCallLog.create).toHaveBeenCalledTimes(1);
    const callArgs = mockedPrisma.aiCallLog.create.mock.calls[0][0];
    expect(callArgs.data).toMatchObject({
      userId: 'user_1',
      familyId: 'family_1',
      type: 'chat',
      model: 'gpt-4',
      tokenUsage: 200,
      latency: 350,
      success: true,
    });
    // 失败字段 error 应未传入（success: true）
    expect(callArgs.data.error).toBeUndefined();
  });

  test('记录失败调用时 error 字段被写入', async () => {
    await logAICall({
      userId: 'user_1',
      type: 'ocr',
      success: false,
      error: 'AI 服务调用失败',
      latency: 100,
    });

    const callArgs = mockedPrisma.aiCallLog.create.mock.calls[0][0];
    expect(callArgs.data.success).toBe(false);
    expect(callArgs.data.error).toBe('AI 服务调用失败');
  });

  test('可选字段缺失时仍能写入', async () => {
    await logAICall({
      userId: 'user_1',
      type: 'category',
      success: true,
    });

    expect(mockedPrisma.aiCallLog.create).toHaveBeenCalledTimes(1);
    const callArgs = mockedPrisma.aiCallLog.create.mock.calls[0][0];
    expect(callArgs.data.userId).toBe('user_1');
    expect(callArgs.data.type).toBe('category');
    expect(callArgs.data.success).toBe(true);
    // 可选字段不传
    expect(callArgs.data.familyId).toBeUndefined();
    expect(callArgs.data.model).toBeUndefined();
    expect(callArgs.data.tokenUsage).toBeUndefined();
    expect(callArgs.data.latency).toBeUndefined();
  });

  test('数据库写入失败时不抛错（避免影响主流程）', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedPrisma.aiCallLog.create.mockRejectedValueOnce(new Error('DB connection failed'));

    // 不应抛出
    await expect(
      logAICall({
        userId: 'user_1',
        type: 'chat',
        success: true,
      })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
