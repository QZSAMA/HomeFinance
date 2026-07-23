import * as Minio from 'minio';

const MINIO_REGION = process.env.MINIO_REGION || 'us-east-1';

// 内部 client —— 用于容器间上传/下载（endPoint=minio）
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  region: MINIO_REGION,
});

// 外部 client —— 用于生成 presigned URL（浏览器可访问地址）
// 默认回退到内部 endpoint，开发环境设为 localhost，生产环境设为实际域名
// 设置 region 避免 presignedGetObject 连接服务器查询 region（外部地址在容器内不可达）
const minioPublicClient = new Minio.Client({
  endPoint: process.env.MINIO_PUBLIC_ENDPOINT || process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PUBLIC_PORT || process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_PUBLIC_USE_SSL === 'true' || (!process.env.MINIO_PUBLIC_ENDPOINT && process.env.MINIO_USE_SSL === 'true'),
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  region: MINIO_REGION,
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'family-finance';

export const ensureBucket = async () => {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
      console.log(`Bucket ${BUCKET_NAME} created`);
    }
  } catch (error) {
    console.error('Error ensuring bucket:', error);
  }
};

export const uploadFile = async (
  objectName: string,
  filePath: string,
  metaData?: Minio.ItemBucketMetadata
) => {
  await minioClient.fPutObject(BUCKET_NAME, objectName, filePath, metaData);
  return objectName;
};

export const uploadFileBuffer = async (
  objectName: string,
  buffer: Buffer,
  size: number,
  metaData?: Minio.ItemBucketMetadata
) => {
  await minioClient.putObject(BUCKET_NAME, objectName, buffer, size, metaData);
  return objectName;
};

export const getFileUrl = async (objectName: string, expires = 3600) => {
  return await minioPublicClient.presignedGetObject(BUCKET_NAME, objectName, expires);
};

export const deleteFile = async (objectName: string) => {
  await minioClient.removeObject(BUCKET_NAME, objectName);
};

export default minioClient;
