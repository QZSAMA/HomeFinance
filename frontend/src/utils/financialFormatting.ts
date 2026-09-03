export type ConversionStatus = 'exact' | 'unavailable' | 'partial';

export const conversionReason = (status: ConversionStatus = 'exact'): string => (
  status === 'partial' ? '部分汇率缺失' : '缺少可靠汇率'
);

export const formatAggregate = (
  amount: number | null | undefined,
  currency = 'CNY',
  status: ConversionStatus = 'exact',
): string => {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return `暂无法合计（${conversionReason(status)}）`;
  }
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amount);
};

export const formatGroupedCurrency = (totals: Record<string, number> | undefined): string => {
  if (!totals || Object.keys(totals).length === 0) return '暂无数据';
  return Object.entries(totals)
    .map(([currency, amount]) => formatAggregate(amount, currency))
    .join(' · ');
};

export const nextLocalDate = (date: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return value.toISOString().slice(0, 10);
};
