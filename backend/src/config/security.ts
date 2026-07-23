/**
 * 安全配置校验
 *
 * 在应用启动时调用 `validateSecurityEnv()`，若 JWT_SECRET 未设置、使用弱默认值或长度不足，
 * 则抛错退出，防止生产环境使用不安全配置。
 */

const WEAK_DEFAULTS = ['change-this-in-production', 'your-jwt-secret', 'secret'];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 校验 JWT_SECRET 是否安全
 * @param secret JWT_SECRET 值（来自 process.env）
 * @param nodeEnv 当前 NODE_ENV（测试环境跳过）
 */
export function validateJwtSecret(
  secret: string | undefined,
  nodeEnv: string = process.env.NODE_ENV || 'development'
): ValidationResult {
  // 测试环境跳过（使用固定 secret 是正常的）
  if (nodeEnv === 'test') {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  if (!secret) {
    errors.push('JWT_SECRET 环境变量未设置');
    return { valid: false, errors };
  }

  if (WEAK_DEFAULTS.includes(secret)) {
    errors.push(`JWT_SECRET 使用了弱默认值 "${secret}"，存在安全风险`);
  }

  if (secret.length < 32) {
    errors.push(`JWT_SECRET 长度不足（当前 ${secret.length} 字符，要求至少 32 字符）`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 启动时校验安全配置，失败则抛错退出
 */
export function validateSecurityEnv(): void {
  const result = validateJwtSecret(process.env.JWT_SECRET);
  if (!result.valid) {
    const message = [
      '安全配置校验失败：',
      ...result.errors.map(e => `  - ${e}`),
      '请在 .env 文件或环境变量中配置安全的 JWT_SECRET（至少 32 字符的随机字符串）。',
    ].join('\n');
    throw new Error(message);
  }
}
