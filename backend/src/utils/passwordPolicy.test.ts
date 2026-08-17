import { validatePasswordStrength } from './passwordPolicy';

describe('validatePasswordStrength', () => {
  test('password123 为有效密码（8位+字母+数字）', () => {
    const result = validatePasswordStrength('password123');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('纯数字 12345678 无效（缺少字母）', () => {
    const result = validatePasswordStrength('12345678');
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('纯字母 abcdefgh 无效（缺少数字）', () => {
    const result = validatePasswordStrength('abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('Pass1 无效（不足8位）', () => {
    const result = validatePasswordStrength('Pass1');
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('Password123 为有效密码（含大小写+数字+8位以上）', () => {
    const result = validatePasswordStrength('Password123');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('空字符串无效', () => {
    const result = validatePasswordStrength('');
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
