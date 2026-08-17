import { detectMimeType, isAllowedImage, ALLOWED_IMAGE_TYPES } from './fileSignature';

// 真实文件头构造（仅保留 magic number + 少量后续字节以模拟真实文件）
const JPEG_BUFFER = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
]);
// RIFF....WEBP
const WEBP_BUFFER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4C,
]);
const GIF_BUFFER = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
]);
// MZ 头（Windows PE/EXE）— 伪造为 .jpg
const EXE_BUFFER = Buffer.from([
  0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
]);

describe('fileSignature utils', () => {
  describe('detectMimeType', () => {
    test('识别 JPEG 文件头返回 image/jpeg', () => {
      expect(detectMimeType(JPEG_BUFFER)).toBe('image/jpeg');
    });

    test('识别 PNG 文件头返回 image/png', () => {
      expect(detectMimeType(PNG_BUFFER)).toBe('image/png');
    });

    test('识别 WebP 文件头返回 image/webp', () => {
      expect(detectMimeType(WEBP_BUFFER)).toBe('image/webp');
    });

    test('识别 GIF 文件头返回 image/gif', () => {
      expect(detectMimeType(GIF_BUFFER)).toBe('image/gif');
    });

    test('伪造扩展名（.jpg 但实际是 EXE 的 MZ 头）返回 null', () => {
      expect(detectMimeType(EXE_BUFFER)).toBeNull();
    });

    test('空 buffer 返回 null', () => {
      expect(detectMimeType(Buffer.alloc(0))).toBeNull();
    });

    test('太短的 buffer 返回 null', () => {
      expect(detectMimeType(Buffer.from([0xFF, 0xD8]))).toBeNull();
    });

    test('未知文件头返回 null', () => {
      expect(detectMimeType(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0]))).toBeNull();
    });
  });

  describe('isAllowedImage', () => {
    test('正常 JPEG buffer 返回 true', () => {
      expect(isAllowedImage(JPEG_BUFFER)).toBe(true);
    });

    test('正常 PNG buffer 返回 true', () => {
      expect(isAllowedImage(PNG_BUFFER)).toBe(true);
    });

    test('正常 WebP buffer 返回 true', () => {
      expect(isAllowedImage(WEBP_BUFFER)).toBe(true);
    });

    test('正常 GIF buffer 返回 true', () => {
      expect(isAllowedImage(GIF_BUFFER)).toBe(true);
    });

    test('伪造扩展名的 EXE buffer 返回 false', () => {
      expect(isAllowedImage(EXE_BUFFER)).toBe(false);
    });

    test('空 buffer 返回 false', () => {
      expect(isAllowedImage(Buffer.alloc(0))).toBe(false);
    });
  });

  describe('ALLOWED_IMAGE_TYPES', () => {
    test('包含 jpeg/png/gif/webp 四种类型', () => {
      expect(ALLOWED_IMAGE_TYPES).toEqual([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ]);
    });
  });
});
