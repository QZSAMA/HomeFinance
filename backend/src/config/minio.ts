import * as Minio from 'minio';

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
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
  return await minioClient.presignedGetObject(BUCKET_NAME, objectName, expires);
};

export const deleteFile = async (objectName: string) => {
  await minioClient.removeObject(BUCKET_NAME, objectName);
};

export default minioClient;
