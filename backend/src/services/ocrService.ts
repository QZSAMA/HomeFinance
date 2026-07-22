import Tesseract from 'tesseract.js';
import path from 'path';

/**
 * 本地 OCR 服务 —— 使用 Tesseract.js（纯 JS，免费，无需外部 API）
 * 首次调用会从 CDN 下载中文+英文语言包（约 15MB），之后使用本地缓存。
 */

// 语言数据缓存目录（容器内 / 本地均可写入）
const CACHE_PATH = path.join(process.cwd(), '.tessdata');

// 将 data URL（data:image/png;base64,...）或纯 base64 转为 Buffer
function base64ToBuffer(base64: string): Buffer {
  const pure = base64.includes(',')
    ? base64.split(',')[1]
    : base64;
  return Buffer.from(pure, 'base64');
}

/**
 * 从图片 base64 提取文字
 * @param imageBase64 data URL 或纯 base64 字符串
 * @returns 识别到的文字（已去首尾空白）
 */
export async function extractTextFromImage(imageBase64: string): Promise<string> {
  const imageBuffer = base64ToBuffer(imageBase64);

  const { data } = await Tesseract.recognize(
    imageBuffer,
    'chi_sim+eng',
    {
      // langPath 用默认 CDN（首次下载），cachePath 持久化到本地
      cachePath: CACHE_PATH,
    }
  );

  return (data.text || '').trim();
}
