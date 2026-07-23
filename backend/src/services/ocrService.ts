import Tesseract from 'tesseract.js';
import path from 'path';
import { AI_VISION_CONFIG, isVisionConfigured } from '../config/ai';

/**
 * 本地 OCR 服务 —— 使用 Tesseract.js（纯 JS，免费，无需外部 API）
 * 首次调用会从 CDN 下载中文+英文语言包（约 15MB），之后使用本地缓存。
 *
 * 另提供视觉多模态 LLM 识别路径（可选），与 Tesseract 并行运行后合并结果。
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
 * 从图片 base64 提取文字（Tesseract.js 本地 OCR）
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

/**
 * 清洗 OCR 提取的原始文字，去除手机截图常见的 UI 噪音行
 * 保留含金额/数字的行，过滤状态栏、导航栏等无关文字
 */
export function cleanOcrText(rawText: string): string {
  if (!rawText) return '';

  // UI 噪音行的匹配模式（整行匹配才过滤）
  const noisePatterns = [
    /^\d{1,2}:\d{2}(\s|$)/,           // 纯时间 "11:10"
    /^\d{1,2}:\d{2}:\d{2}(\s|$)/,     // 纯时间 "11:10:30"
    /(5G|4G|LTE|WiFi|无线网|电量|信号|蓝牙|飞行模式)/, // 状态栏
    /^(搜索|返回|关闭|更多|完成|确定|取消)(\s|$)/,     // 导航按钮
    /^(交易记录|全部|支出|收入|转账|退款|订单|账单|明细)(\s*$)/, // 标签栏单独行
    /^(首页|我的|发现|消息)(\s*$)/,    // 底部 tab 栏
  ];

  // 金额/数字相关行应保留
  const amountPattern = /(元|￥|¥|\d+\.\d{2}|\d+\.?\d*\s*(元|块|RMB|rmb))/;

  const lines = rawText.split(/\r?\n/);
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // 合并连续空行：仅当上一行非空时才保留一个空行
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') {
        cleaned.push('');
      }
      continue;
    }

    // 噪音行过滤：匹配噪音模式 且 不含金额信息 → 跳过
    const isNoise = noisePatterns.some((p) => p.test(trimmed));
    const hasAmount = amountPattern.test(trimmed);
    if (isNoise && !hasAmount) {
      continue;
    }

    cleaned.push(trimmed);
  }

  // 去除尾部空行
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') {
    cleaned.pop();
  }

  return cleaned.join('\n');
}

// ===== 结构化 OCR 结果类型 =====

export interface ParsedOCR {
  amount?: number;
  date?: string;
  category?: string;
  description?: string;
  type?: 'income' | 'expense';
  raw?: string;
  rawText?: string; // Tesseract 原始文字（调试用）
}

export type OCRSource = 'vision' | 'tesseract' | 'merged';

export interface MergedOCR extends ParsedOCR {
  source: OCRSource;
}

// ===== 视觉多模态 LLM 识别 =====

const VISION_SYSTEM_PROMPT = `你是一位票据识别助手。用户会提供一张收据、发票或账单截图的图片。
请识别图片中的关键信息，并以 JSON 格式返回，字段包括：
- type: 交易类型，"income"（收入/收款）或 "expense"（支出/消费），默认 "expense"
- amount: 金额（数字，单位元）
- date: 日期（YYYY-MM-DD 格式）
- category: 类别。支出从以下选一：餐饮、交通、购物、娱乐、医疗、教育、日用、水电通讯、居住、其他支出；收入从以下选一：工资、奖金、投资收益、兼职收入、租金收入、其他收入
- description: 简短描述（如商家名称或交易摘要）

示例：
- 微信支付麦当劳 -35.00 → {"type":"expense","amount":35,"date":"2026-07-23","category":"餐饮","description":"麦当劳"}
- 收到转账 +15000 工资 → {"type":"income","amount":15000,"date":"2026-07-23","category":"工资","description":"工资"}

只返回 JSON，不要包含其他文字或 markdown 代码块标记。
如果无法识别，返回 {"error": "无法识别"}。`;

/**
 * 调用视觉多模态 LLM 识别票据（一步到位返回结构化 JSON）
 * 需要配置 AI_VISION_MODEL 环境变量
 */
export async function extractViaVision(imageBase64: string): Promise<ParsedOCR> {
  if (!isVisionConfigured()) {
    throw new Error('视觉模型未配置');
  }

  const response = await fetch(`${AI_VISION_CONFIG.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_VISION_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      model: AI_VISION_CONFIG.model,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别这张票据图片并返回 JSON。' },
            { type: 'image_url', image_url: { url: imageBase64 } },
          ],
        },
      ],
      max_tokens: AI_VISION_CONFIG.maxTokens,
      temperature: AI_VISION_CONFIG.temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`视觉模型调用失败 (${response.status})：${errorText || '请检查 API Key 和网络'}`);
  }

  const data = await response.json() as {
    choices: Array<{
      message: {
        role: string;
        content: string;
      };
    }>;
  };

  const content = data.choices[0]?.message?.content || '';

  try {
    const cleaned = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.error) {
      return { raw: content };
    }
    return {
      amount: typeof parsed.amount === 'number' ? parsed.amount : undefined,
      date: parsed.date,
      category: parsed.category,
      description: parsed.description,
      type: parsed.type === 'income' || parsed.type === 'expense' ? parsed.type : undefined,
    };
  } catch {
    return { raw: content };
  }
}

// ===== 结果合并 =====

/**
 * 合并 Tesseract 和视觉模型的 OCR 结果
 * 规则：按字段优先视觉模型，缺失字段用 Tesseract 结果填补
 */
export function mergeOcrResults(
  tesseract: ParsedOCR | null,
  vision: ParsedOCR | null,
): MergedOCR {
  // 两者都没有
  if (!tesseract && !vision) {
    return {
      amount: undefined,
      date: undefined,
      category: undefined,
      description: undefined,
      raw: 'OCR 识别失败：两条路径均未返回结果',
      source: 'tesseract',
    };
  }

  // 只有 Tesseract
  if (!vision) {
    return { ...(tesseract as ParsedOCR), source: 'tesseract' };
  }

  // 只有视觉
  if (!tesseract) {
    return { ...(vision as ParsedOCR), source: 'vision' };
  }

  // 两者都有：按字段优先视觉，缺失用 Tesseract 填补
  const merged: ParsedOCR = {
    amount: vision.amount ?? tesseract.amount,
    date: vision.date ?? tesseract.date,
    category: vision.category ?? tesseract.category,
    description: vision.description ?? tesseract.description,
    type: vision.type ?? tesseract.type,
    rawText: tesseract.rawText, // 保留 Tesseract 原始文字供调试
    raw: vision.raw || tesseract.raw,
  };

  // 判断是否真正合并（两个字段来源不同）
  const visionFields = ['amount', 'date', 'category', 'description', 'type'] as const;
  const tesseractFields = ['amount', 'date', 'category', 'description', 'type'] as const;
  const hasVision = visionFields.some((f) => vision[f] !== undefined);
  const hasTesseract = tesseractFields.some((f) => tesseract[f] !== undefined);

  return {
    ...merged,
    source: hasVision && hasTesseract ? 'merged' : hasVision ? 'vision' : 'tesseract',
  };
}
