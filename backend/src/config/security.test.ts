import { validateJwtSecret, validateSecurityEnv } from './security';

describe('security config', () => {
  describe('validateJwtSecret', () => {
    test('测试环境跳过校验（使用固定 secret 是正常的）', () => {
      const result = validateJwtSecret('short', 'test');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('未设置 JWT_SECRET 时返回错误', () => {
      const result = validateJwtSecret(undefined, 'production');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('未设置');
    });

    test('弱默认值 change-this-in-production 返回错误', () => {
      const result = validateJwtSecret('change-this-in-production', 'production');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('弱默认值'))).toBe(true);
    });

    test('长度 < 32 返回错误', () => {
      const result = validateJwtSecret('short-secret-only-20-chars', 'production');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('长度不足'))).toBe(true);
    });

    test('合法 secret（32+ 字符）通过校验', () => {
      const result = validateJwtSecret('a-very-secure-random-secret-with-32+chars!!', 'production');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('同时是弱默认值且长度不足，返回两个错误', () => {
      // 'change-this-in-production' 长度 26 字符 < 32
      const result = validateJwtSecret('change-this-in-production', 'production');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('validateSecurityEnv', () => {
    const originalSecret = process.env.JWT_SECRET;
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.JWT_SECRET = originalSecret;
      process.env.NODE_ENV = originalEnv;
    });

    test('生产环境 + 弱默认 secret 抛错', () => {
      process.env.JWT_SECRET = 'change-this-in-production';
      process.env.NODE_ENV = 'production';
      expect(() => validateSecurityEnv()).toThrow('安全配置校验失败');
    });

    test('测试环境不抛错（即使 secret 很短）', () => {
      process.env.JWT_SECRET = 'short';
      process.env.NODE_ENV = 'test';
      expect(() => validateSecurityEnv()).not.toThrow();
    });

    test('生产环境 + 合法 secret（32+ 字符）不抛错', () => {
      process.env.JWT_SECRET = 'a-very-secure-random-secret-with-32+chars!!';
      process.env.NODE_ENV = 'production';
      expect(() => validateSecurityEnv()).not.toThrow();
    });

    test('开发环境 + 未设置 secret 抛错', () => {
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = 'development';
      expect(() => validateSecurityEnv()).toThrow('未设置');
    });
  });
});
