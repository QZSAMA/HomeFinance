import { uploadFileBuffer } from '../config/minio';
import { prisma } from '../app';
import { computePHash } from '../utils/phash';

/**
 * 将 OCR 上传的图片持久化到 MinIO，并创建 File 记录
 * 文件夹结构: {userId}/{familyId}/receipts/{YYYY}/{MM}/{DD}/{ts}-{random}.jpg
 *
 * 存储**失败不阻塞 OCR**（try/catch + 日志警告）
 *
 * @returns fileId 和 MinIO path；存储失败时返回 null
 */
export async function storeOcrImage(
  userId: string,
  familyId: string,
  imageBase64: string,
  originalName?: string,
): Promise<{ fileId: string; path: string } | null> {
  try {
    const buffer = base64ToBuffer(imageBase64);
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const timestamp = now.getTime();
    const random = Math.random().toString(36).substr(2, 6);
    const objectName = `${userId}/${familyId}/receipts/${YYYY}/${MM}/${DD}/${timestamp}-${random}.jpg`;

    await uploadFileBuffer(objectName, buffer, buffer.length, {
      'Content-Type': 'image/jpeg',
    });

    // 复用现有 phash 去重能力（失败不阻塞）
    let phash: string | null = null;
    try {
      phash = await computePHash(buffer);
    } catch {
      /* phash 失败不阻塞 */
    }

    const file = await prisma.file.create({
      data: {
        familyId,
        userId,
        name: originalName || `receipt-${timestamp}.jpg`,
        path: objectName,
        type: 'image/jpeg',
        mimeType: 'image/jpeg',
        size: buffer.length,
        phash,
      },
    });

    return { fileId: file.id, path: objectName };
  } catch (err) {
    console.warn('OCR 图片存储失败（不阻塞 OCR）:', err);
    return null;
  }
}

function base64ToBuffer(base64: string): Buffer {
  const pure = base64.includes(',') ? base64.split(',')[1] : base64;
  return Buffer.from(pure, 'base64');
}
