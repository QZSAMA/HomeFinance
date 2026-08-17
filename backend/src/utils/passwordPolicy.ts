export interface PasswordStrengthResult {
  valid: boolean;
  reason?: string;
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, reason: '密码至少8位' };
  }

  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, reason: '密码必须包含字母' };
  }

  if (!/\d/.test(password)) {
    return { valid: false, reason: '密码必须包含数字' };
  }

  return { valid: true };
}
