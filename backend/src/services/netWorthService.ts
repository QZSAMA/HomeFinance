import { prisma } from '../app';
import { toNumber } from '../utils/decimal';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('netWorthService');

export interface NetWorthSnapshot {
  familyId: string;
  date: Date;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  assetBreakdown: Record<string, number>;
}

interface AssetRecord {
  id: string;
  type: string;
  value: any;
  symbol: string | null;
  quantity: any;
  marketPrice: any;
}

interface LiabilityRecord {
  id: string;
  type: string;
  amount: any;
}

interface NetWorthHistoryRecord {
  id: string;
  familyId: string;
  date: Date;
  totalAssets: any;
  totalLiabilities: any;
  netWorth: any;
  assetBreakdown: any;
}

/**
 * 计算单项资产的当前价值：
 * - 有 symbol && quantity && marketPrice → 用 marketPrice * quantity
 * - 否则回退用 value
 */
function computeAssetValue(asset: {
  value: any;
  symbol: string | null;
  quantity: any;
  marketPrice: any;
}): number {
  if (asset.symbol && asset.quantity !== null && asset.marketPrice !== null) {
    return toNumber(asset.marketPrice) * toNumber(asset.quantity);
  }
  return toNumber(asset.value);
}

/**
 * 将日期归一化到 UTC 当天起点（0 时 0 分 0 秒 0 毫秒），
 * 保证同一天任意时刻触发的快照都写入同一条记录（familyId + date 唯一约束）。
 */
function startOfDayUTC(d: Date): Date {
  const result = new Date(d);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * 为单个家庭生成净值快照：
 * 1. 查询所有 Asset，按市价或 value 计算总资产
 * 2. 查询所有 Liability，汇总总负债
 * 3. netWorth = totalAssets - totalLiabilities
 * 4. 按 type 聚合 assetBreakdown
 * 5. upsert 到 NetWorthHistory（familyId + date 唯一）
 */
export async function takeSnapshot(familyId: string): Promise<NetWorthSnapshot> {
  const [assets, liabilities] = await Promise.all([
    prisma.asset.findMany({ where: { familyId } }),
    prisma.liability.findMany({ where: { familyId } }),
  ]);

  const totalAssets = assets.reduce(
    (sum, a) => sum + computeAssetValue(a as AssetRecord),
    0
  );
  const totalLiabilities = liabilities.reduce(
    (sum, l) => sum + toNumber((l as LiabilityRecord).amount),
    0
  );
  const netWorth = totalAssets - totalLiabilities;

  const assetBreakdown = assets.reduce((acc, a) => {
    const assetVal = computeAssetValue(a as AssetRecord);
    const type = (a as AssetRecord).type;
    acc[type] = (acc[type] || 0) + assetVal;
    return acc;
  }, {} as Record<string, number>);

  const date = startOfDayUTC(new Date());

  await prisma.netWorthHistory.upsert({
    where: {
      familyId_date: {
        familyId,
        date,
      },
    },
    create: {
      familyId,
      date,
      totalAssets,
      totalLiabilities,
      netWorth,
      assetBreakdown,
    },
    update: {
      totalAssets,
      totalLiabilities,
      netWorth,
      assetBreakdown,
    },
  });

  return {
    familyId,
    date,
    totalAssets,
    totalLiabilities,
    netWorth,
    assetBreakdown,
  };
}

/**
 * 查询家庭净值历史，按 date 升序返回。
 */
export async function getHistory(
  familyId: string,
  startDate: Date,
  endDate: Date
): Promise<NetWorthSnapshot[]> {
  const records = (await prisma.netWorthHistory.findMany({
    where: {
      familyId,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: 'asc' },
  })) as NetWorthHistoryRecord[];

  return records.map((r) => ({
    familyId: r.familyId,
    date: r.date,
    totalAssets: toNumber(r.totalAssets),
    totalLiabilities: toNumber(r.totalLiabilities),
    netWorth: toNumber(r.netWorth),
    assetBreakdown: (r.assetBreakdown as Record<string, number>) || {},
  }));
}

/**
 * 获取家庭最近一条净值快照。无历史数据时返回 null。
 */
export async function getLatestSnapshot(
  familyId: string
): Promise<NetWorthSnapshot | null> {
  const record = (await prisma.netWorthHistory.findFirst({
    where: { familyId },
    orderBy: { date: 'desc' },
  })) as NetWorthHistoryRecord | null;

  if (!record) {
    return null;
  }

  return {
    familyId: record.familyId,
    date: record.date,
    totalAssets: toNumber(record.totalAssets),
    totalLiabilities: toNumber(record.totalLiabilities),
    netWorth: toNumber(record.netWorth),
    assetBreakdown: (record.assetBreakdown as Record<string, number>) || {},
  };
}

/**
 * 为所有家庭生成净值快照，汇总成功/失败统计。
 * 单个家庭失败不影响其他家庭。
 */
export async function syncAllFamiliesNetWorth(): Promise<{
  total: number;
  success: number;
  failed: number;
}> {
  const families = await prisma.family.findMany();

  let success = 0;
  let failed = 0;
  for (const family of families) {
    try {
      await takeSnapshot(family.id);
      success++;
    } catch (err) {
      logger.error('生成家庭净值快照失败', {
        familyId: family.id,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  return { total: families.length, success, failed };
}
