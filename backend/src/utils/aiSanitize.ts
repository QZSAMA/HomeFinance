/**
 * AI Prompt 注入防护工具（V3.1.2）
 *
 * 仅作用于用户输入，不应用于系统提示词。
 */

export const MAX_USER_INPUT_LENGTH = 2000;

const TRUNCATE_SUFFIX = '...[已截断]';

// 角色标记（大小写不敏感匹配）
const ROLE_MARKERS = [
  '<|system|>',
  '<|user|>',
  '<|assistant|>',
  '<|im_start|>',
  '<|im_end|>',
];

// 注入短语（中英文，大小写不敏感）
// 每次调用都重新构造 RegExp，避免全局匹配 lastIndex 状态残留
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|the\s+)?previous\s+instructions?/gi,
  /ignore\s+(?:the\s+)?above\s+instructions?/gi,
  /disregard\s+(?:all\s+|the\s+)?previous\s+instructions?/gi,
  /forget\s+(?:all\s+|the\s+)?previous\s+instructions?/gi,
  /忽略之前的指令/g,
  /忽略之前的所有指令/g,
  /忽略上面的指令/g,
  /忽略先前的指令/g,
  /忽略以上指令/g,
  /无视之前的指令/g,
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 截断超长输入。超过 maxLength 时截断并追加 ...[已截断]
 */
export function truncateInput(input: string, maxLength: number = MAX_USER_INPUT_LENGTH): string {
  if (input.length <= maxLength) {
    return input;
  }
  return input.slice(0, maxLength) + TRUNCATE_SUFFIX;
}

/**
 * 清理用户输入，防止 AI Prompt 注入：
 * 1. 移除角色标记（<|system|> 等，大小写不敏感）
 * 2. 移除 "ignore previous instructions" 等注入短语（中英文，大小写不敏感）
 * 3. 截断超长输入（超过 MAX_USER_INPUT_LENGTH）
 */
export function sanitizeUserInput(input: string): string {
  if (!input) {
    return '';
  }

  let result = input;

  // 移除角色标记
  for (const marker of ROLE_MARKERS) {
    result = result.replace(new RegExp(escapeRegExp(marker), 'gi'), '');
  }

  // 移除注入短语（重置 lastIndex 以支持复用）
  for (const pattern of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '');
  }

  // 截断超长输入
  result = truncateInput(result, MAX_USER_INPUT_LENGTH);

  return result;
}
