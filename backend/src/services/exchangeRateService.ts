import { prisma } from '../app';
import { toNumber } from '../utils/decimal';

const SUPPORTED_CURRENCIES = [
  'CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD', 'SGD', 'AUD', 'CAD', 'KRW',
];

const EXCHANGE_RATE_API_BASE = 'https://api.exchangerate-api.com/v4/latest';

/**
 * 将日期归一化到 UTC 当天的起点（0 时 0 分 0 秒 0 毫秒），
 * 保证同一天任意时刻获取的汇率都能命中当日缓存。
 */
function startOfDayUTC(d: Date): Date {
  const result = new Date(d);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * 调用 exchangerate-api.com v4 免费接口获取汇率（无需 API key）。
 * 响应格式：{ rates: { USD: ..., CNY: ..., ... } }
 */
async function fetchRateFromAPI(from: string, to: string): Promise<number> {
  const url = `${EXCHANGE_RATE_API_BASE}/${encodeURIComponent(from)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `汇率 API 请求失败：${response.status} ${response.statusText} ${body}`
    );
  }

  const payload = (await response.json()) as { rates?: Record<string, number> };
  const rate = payload?.rates?.[to];
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error(`汇率 API 响应缺少目标币种 ${to}`);
  }
  return rate;
}

/**
 * 获取汇率。
 * 1) 同币种直接返回 1
 * 2) 优先查数据库缓存（当日 ExchangeRate 记录）
 * 3) 缓存未命中时调用外部 API（成功后写入数据库缓存）
 * 4) API 不可用时降级查最近一次缓存（历史记录）
 * 5) 完全无数据时抛错
 */
export async function getRate(
  from: string,
  to: string,
  date?: Date
): Promise<number> {
  if (from === to) return 1;

  const lookupDate = startOfDayUTC(date ?? new Date());

  const cached = await prisma.exchangeRate.findUnique({
    where: {
      from_to_date: { from, to, date: lookupDate },
    },
  });
  if (cached) {
    return toNumber(cached.rate);
  }

  try {
    const apiRate = await fetchRateFromAPI(from, to);
    // 写入缓存；并发或重复写入因唯一约束冲突时静默忽略
    await prisma.exchangeRate
      .create({
        data: {
          from,
          to,
          rate: apiRate,
          date: lookupDate,
          source: 'exchangerate-api',
        },
      })
      .catch((err: unknown) => {
        // Prisma P2002 唯一约束冲突视为缓存已写入，忽略
        const code = (err as { code?: string })?.code;
        if (code !== 'P2002') {
          console.error('写入汇率缓存失败:', err);
        }
      });
    return apiRate;
  } catch (err) {
    // API 不可用：降级查最近一次历史缓存
    const historical = await prisma.exchangeRate.findFirst({
      where: { from, to, date: { lt: lookupDate } },
      orderBy: { date: 'desc' },
    });
    if (historical) {
      return toNumber(historical.rate);
    }
    throw new Error(
      `无法获取汇率 ${from} → ${to}：API 不可用且无历史缓存（${
        err instanceof Error ? err.message : String(err)
      }）`
    );
  }
}

/**
 * 将指定币种金额换算为人民币。
 * - from === 'CNY' 时直接返回原值
 */
export async function convertToCNY(
  amount: number,
  from: string,
  date?: Date
): Promise<number> {
  if (from === 'CNY') return amount;
  const rate = await getRate(from, 'CNY', date);
  return amount * rate;
}

/**
 * 跨币种金额换算。
 */
export async function convertAmount(
  amount: number,
  from: string,
  to: string,
  date?: Date
): Promise<number> {
  if (from === to) return amount;
  const rate = await getRate(from, to, date);
  return amount * rate;
}

/**
 * 返回支持的货币列表。
 */
export function getSupportedCurrencies(): string[] {
  return [...SUPPORTED_CURRENCIES];
}

/**
 * 手动录入汇率（覆盖当日记录）。
 */
export async function setManualRate(
  from: string,
  to: string,
  rate: number
): Promise<void> {
  const lookupDate = startOfDayUTC(new Date());
  await prisma.exchangeRate.upsert({
    where: {
      from_to_date: { from, to, date: lookupDate },
    },
    update: { rate, source: 'manual' },
    create: {
      from,
      to,
      rate,
      date: lookupDate,
      source: 'manual',
    },
  });
}
