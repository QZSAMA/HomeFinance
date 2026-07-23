// 测试 MinIO 配置: presigned URL 应使用 MINIO_PUBLIC_ENDPOINT(浏览器可访问地址)
// 而非内部 MINIO_ENDPOINT(minio:9000,Docker 内部地址)

// Mock minio 模块，避免实际网络连接
jest.mock('minio', () => {
  return {
    Client: jest.fn().mockImplementation((config: any) => ({
      config,
      bucketExists: jest.fn().mockResolvedValue(true),
      makeBucket: jest.fn().mockResolvedValue(undefined),
      fPutObject: jest.fn().mockResolvedValue(undefined),
      putObject: jest.fn().mockResolvedValue(undefined),
      removeObject: jest.fn().mockResolvedValue(undefined),
      presignedGetObject: jest.fn().mockImplementation(function (this: any, bucket: string, objectName: string) {
        const proto = this.config.useSSL ? 'https' : 'http';
        const port = this.config.port;
        const host = this.config.endPoint;
        return Promise.resolve(`${proto}://${host}:${port}/${bucket}/${objectName}?X-Amz-Signature=mock`);
      }),
      // region 设置后 presignedGetObject 不需要连接服务器
      // 但 SDK 仍可能调用 bucketExists 验证,这里已 mock
    })),
  };
});

describe('MinIO 配置 - presigned URL host', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MINIO_ENDPOINT;
    delete process.env.MINIO_PORT;
    delete process.env.MINIO_PUBLIC_ENDPOINT;
    delete process.env.MINIO_PUBLIC_PORT;
    delete process.env.MINIO_USE_SSL;
    delete process.env.MINIO_PUBLIC_USE_SSL;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('未配置 MINIO_PUBLIC_ENDPOINT 时,getFileUrl 使用 MINIO_ENDPOINT', async () => {
    process.env.MINIO_ENDPOINT = 'minio';
    process.env.MINIO_PORT = '9000';
    const { getFileUrl } = require('./minio');
    const url = await getFileUrl('test/file.jpg');
    expect(url).toContain('minio:9000');
  });

  it('配置 MINIO_PUBLIC_ENDPOINT=localhost 时,getFileUrl 使用 localhost', async () => {
    process.env.MINIO_ENDPOINT = 'minio';
    process.env.MINIO_PORT = '9000';
    process.env.MINIO_PUBLIC_ENDPOINT = 'localhost';
    process.env.MINIO_PUBLIC_PORT = '9000';
    const { getFileUrl } = require('./minio');
    const url = await getFileUrl('test/file.jpg');
    expect(url).toContain('localhost:9000');
    expect(url).not.toContain('minio:9000');
  });

  it('配置 MINIO_PUBLIC_ENDPOINT 为生产域名时,getFileUrl 使用该域名', async () => {
    process.env.MINIO_ENDPOINT = 'minio';
    process.env.MINIO_PORT = '9000';
    process.env.MINIO_PUBLIC_ENDPOINT = 'files.example.com';
    process.env.MINIO_PUBLIC_PORT = '443';
    process.env.MINIO_PUBLIC_USE_SSL = 'true';
    const { getFileUrl } = require('./minio');
    const url = await getFileUrl('test/file.jpg');
    expect(url).toContain('files.example.com');
    expect(url).not.toContain('minio:9000');
  });
});
