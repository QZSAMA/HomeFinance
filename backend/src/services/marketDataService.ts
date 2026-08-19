import { prisma } from '../app';
import { toNumber } from '../utils/decimal';

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change?: number;
  changePercent?: number;
}

const SINA_HQ_URL = 'https://hq.sinajs.cn/list=';
const SINA_REFERER = 'https://finance.sina.com.cn';

/**
 * 将日期归一化到 UTC 当天起点（0 时 0 分 0 秒 0 毫秒），
 * 保证同一天任意时刻获取的行情都能命中当日缓存。
 */
function startOfDayUTC(d: Date): Date {
  const result = new Date(d);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * 调用新浪行情接口获取单只证券行情。
 * 新浪 A 股返回格式：
 *   var hq_str_sh600519="贵州茅台,1800.00,1795.00,1810.50,1820.00,1790.00,...";
 * 字段顺序（0-indexed）：[0]=name, [1]=open, [2]=yesterdayClose, [3]=current, [4]=high, [5]=low
 */
export async function fetchQuoteFromSina(symbol: string): Promise<MarketQuote> {
  const url = `${SINA_HQ_URL}${symbol}`;
  const response = await fetch(url, {
    headers: {
      Referer: SINA_REFERER,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `行情 API 请求失败：${response.status} ${response.statusText} ${body}`
    );
  }

  const text = await response.text();
  // 解析 var hq_str_<symbol>="....";
  const match = text.match(/="([^"]*)"/);
  if (!match) {
    throw new Error(`行情 API 响应无法解析：${symbol}`);
  }

  const fields = match[1].split(',');
  // A 股至少需要 6 个字段才能计算涨跌
  if (fields.length < 6 || !fields[0] || !fields[2] || !fields[3]) {
    throw new Error(`行情 API 响应字段不完整：${symbol}`);
  }

  const name = fields[0];
  const yesterdayClose = parseFloat(fields[2]);
  const current = parseFloat(fields[3]);

  if (!Number.isFinite(yesterdayClose) || !Number.isFinite(current)) {
    throw new Error(`行情 API 响应价格无效：${symbol}`);
  }

  const change = current - yesterdayClose;
  const changePercent =
    yesterdayClose !== 0 ? (change / yesterdayClose) * 100 : undefined;

  return {
    symbol,
    name,
    price: current,
    change: Number(change.toFixed(4)),
    changePercent: changePercent !== undefined
      ? Number(changePercent.toFixed(4))
      : undefined,
  };
}

/**
 * 获取单只证券行情。
 * 1) 优先查 MarketData 表缓存（当日记录）
 * 2) 缓存未命中时调用 fetchQuoteFromSina（成功后写入缓存）
 * 3) API 不可用时降级查最近一次历史缓存
 * 4) 完全无数据时抛错
 */
export async function getQuote(symbol: string): Promise<MarketQuote> {
  const lookupDate = startOfDayUTC(new Date());

  const cached = await prisma.marketData.findFirst({
    where: {
      symbol,
      date: { gte: lookupDate },
    },
    orderBy: { date: 'desc' },
  });
  if (cached) {
    return {
      symbol: cached.symbol,
      name: cached.name ?? symbol,
      price: toNumber(cached.price),
      change: cached.change !== null ? toNumber(cached.change) : undefined,
      changePercent:
        cached.changePercent !== null ? toNumber(cached.changePercent) : undefined,
    };
  }

  try {
    const quote = await fetchQuoteFromSina(symbol);
    // 写入缓存；唯一约束冲突时静默忽略
    await prisma.marketData
      .create({
        data: {
          symbol: quote.symbol,
          name: quote.name,
          price: quote.price,
          change: quote.change ?? null,
          changePercent: quote.changePercent ?? null,
          source: 'sina',
          date: lookupDate,
        },
      })
      .catch((err: unknown) => {
        const code = (err as { code?: string })?.code;
        if (code !== 'P2002') {
          console.error('写入行情缓存失败:', err);
        }
      });
    return quote;
  } catch (err) {
    // API 不可用：降级查最近一次历史缓存
    const historical = await prisma.marketData.findFirst({
      where: {
        symbol,
        date: { lt: lookupDate },
      },
      orderBy: { date: 'desc' },
    });
    if (historical) {
      return {
        symbol: historical.symbol,
        name: historical.name ?? symbol,
        price: toNumber(historical.price),
        change:
          historical.change !== null ? toNumber(historical.change) : undefined,
        changePercent:
          historical.changePercent !== null
            ? toNumber(historical.changePercent)
            : undefined,
      };
    }
    throw new Error(
      `无法获取行情数据: ${symbol}（${
        err instanceof Error ? err.message : String(err)
      }）`
    );
  }
}

/**
 * 批量获取多只证券行情。
 * 使用 Promise.allSettled 容错，部分失败不影响整体。
 */
export async function getQuotes(symbols: string[]): Promise<MarketQuote[]> {
  const results = await Promise.allSettled(symbols.map((s) => getQuote(s)));
  const quotes: MarketQuote[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      quotes.push(r.value);
    }
  }
  return quotes;
}

/**
 * 刷新单个资产的最新行情价格。
 */
export async function refreshAssetPrice(assetId: string): Promise<{
  success: boolean;
  price?: number;
  error?: string;
}> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) {
    return { success: false, error: '资产不存在' };
  }
  if (!asset.symbol) {
    return { success: false, error: '该资产未设置证券代码' };
  }

  try {
    const quote = await getQuote(asset.symbol);
    await prisma.asset.update({
      where: { id: assetId },
      data: {
        marketPrice: quote.price,
        marketPriceDate: new Date(),
      },
    });
    return { success: true, price: quote.price };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 刷新家庭下所有有证券代码的资产的最新行情。
 */
export async function refreshAllAssetPrices(familyId: string): Promise<{
  updated: number;
  failed: number;
  details: Array<{
    assetId: string;
    name: string;
    success: boolean;
    price?: number;
    error?: string;
  }>;
}> {
  const assets = await prisma.asset.findMany({
    where: {
      familyId,
      symbol: { not: null },
    },
    select: { id: true, name: true, symbol: true },
  });

  const details: Array<{
    assetId: string;
    name: string;
    success: boolean;
    price?: number;
    error?: string;
  }> = [];

  let updated = 0;
  let failed = 0;

  for (const asset of assets) {
    const result = await refreshAssetPrice(asset.id);
    details.push({
      assetId: asset.id,
      name: asset.name,
      success: result.success,
      price: result.price,
      error: result.error,
    });
    if (result.success) {
      updated++;
    } else {
      failed++;
    }
  }

  return { updated, failed, details };
}
