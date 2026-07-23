jest.mock('../config/minio', () => ({
  uploadFileBuffer: jest.fn(),
}));

jest.mock('../app', () => ({
  prisma: {
    file: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../utils/phash', () => ({
  computePHash: jest.fn(),
}));

import { storeOcrImage } from './fileStorageService';
import { uploadFileBuffer } from '../config/minio';
import { prisma } from '../app';
import { computePHash } from '../utils/phash';

const mockedUploadFileBuffer = uploadFileBuffer as jest.MockedFunction<typeof uploadFileBuffer>;
const mockedPrisma = prisma as any;
const mockedComputePHash = computePHash as jest.MockedFunction<typeof computePHash>;

describe('fileStorageService.storeOcrImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认成功场景的 mock
    mockedUploadFileBuffer.mockResolvedValue('test-path');
    mockedComputePHash.mockResolvedValue('abc1234567890def');
    mockedPrisma.file.create.mockResolvedValue({ id: 'file_1' });
  });

  test('成功：返回 { fileId, path }，path 格式为 {userId}/{familyId}/receipts/{YYYY}/{MM}/{DD}/{ts}-{random}.jpg', async () => {
    const result = await storeOcrImage('user_1', 'family_1', 'aGVsbG8=');

    expect(result).not.toBeNull();
    expect(result!.fileId).toBe('file_1');
    // 验证 path 格式（timestamp 和 random 是动态的，用正则）
    expect(result!.path).toMatch(/^user_1\/family_1\/receipts\/\d{4}\/\d{2}\/\d{2}\/\d+-[a-z0-9]+\.jpg$/);
    // 验证调用了 uploadFileBuffer 和 prisma.file.create
    expect(mockedUploadFileBuffer).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.file.create).toHaveBeenCalledTimes(1);
    // 验证 prisma.file.create 收到正确的数据结构
    const createArgs = mockedPrisma.file.create.mock.calls[0][0];
    expect(createArgs.data.familyId).toBe('family_1');
    expect(createArgs.data.userId).toBe('user_1');
    expect(createArgs.data.type).toBe('image/jpeg');
    expect(createArgs.data.mimeType).toBe('image/jpeg');
    expect(createArgs.data.phash).toBe('abc1234567890def');
    expect(createArgs.data.path).toBe(result!.path);
  });

  test('data URL 前缀的 base64 正确剥离（uploadFileBuffer 收到的 buffer 不含前缀）', async () => {
    const dataUrl = 'data:image/jpeg;base64,aGVsbG8=';
    // 纯 base64 'aGVsbG8=' 解码为 'hello'，长度 5
    const expectedBuffer = Buffer.from('aGVsbG8=', 'base64');

    await storeOcrImage('user_1', 'family_1', dataUrl);

    const [objectName, buffer, size] = mockedUploadFileBuffer.mock.calls[0];
    expect(buffer).toEqual(expectedBuffer);
    expect(size).toBe(expectedBuffer.length);
  });

  test('MinIO 上传失败 → 返回 null，不调用 prisma.file.create', async () => {
    mockedUploadFileBuffer.mockRejectedValue(new Error('MinIO connection refused'));

    const result = await storeOcrImage('user_1', 'family_1', 'aGVsbG8=');

    expect(result).toBeNull();
    expect(mockedPrisma.file.create).not.toHaveBeenCalled();
  });

  test('phash 失败不阻塞 → prisma.file.create 收到 phash=null，仍返回 fileId', async () => {
    mockedComputePHash.mockRejectedValue(new Error('sharp processing error'));

    const result = await storeOcrImage('user_1', 'family_1', 'aGVsbG8=');

    expect(result).not.toBeNull();
    expect(result!.fileId).toBe('file_1');
    // phash 失败 → prisma.file.create 收到 phash=null
    const createArgs = mockedPrisma.file.create.mock.calls[0][0];
    expect(createArgs.data.phash).toBeNull();
  });

  test('prisma.file.create 失败 → 返回 null', async () => {
    mockedPrisma.file.create.mockRejectedValue(new Error('DB connection lost'));

    const result = await storeOcrImage('user_1', 'family_1', 'aGVsbG8=');

    expect(result).toBeNull();
    // uploadFileBuffer 仍被调用（先上传再创建记录）
    expect(mockedUploadFileBuffer).toHaveBeenCalledTimes(1);
  });

  test('originalName 提供 → File.name 使用 originalName；未提供时格式为 receipt-{timestamp}.jpg', async () => {
    // 提供 originalName
    await storeOcrImage('user_1', 'family_1', 'aGVsbG8=', 'my-receipt.jpg');
    let createArgs = mockedPrisma.file.create.mock.calls[0][0];
    expect(createArgs.data.name).toBe('my-receipt.jpg');

    jest.clearAllMocks();
    mockedUploadFileBuffer.mockResolvedValue('test-path');
    mockedComputePHash.mockResolvedValue('abc');
    mockedPrisma.file.create.mockResolvedValue({ id: 'file_2' });

    // 未提供 originalName
    await storeOcrImage('user_1', 'family_1', 'aGVsbG8=');
    createArgs = mockedPrisma.file.create.mock.calls[0][0];
    expect(createArgs.data.name).toMatch(/^receipt-\d+\.jpg$/);
  });
});
