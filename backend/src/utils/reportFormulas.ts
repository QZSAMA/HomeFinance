export interface CashFlowComponents {
  operating: number;
  investing: number;
  financing: number;
  other: number;
}

export function calculateNetCashFlow(components: CashFlowComponents): number {
  return components.operating + components.investing + components.financing + components.other;
}

export type CashFlowBucket = 'operating' | 'investing' | 'other';

const includesAny = (category: string, keywords: string[]) => (
  keywords.some((keyword) => category.includes(keyword))
);

export function classifyCashFlowCategory(
  category: string,
  kind: 'income' | 'expense',
): CashFlowBucket {
  if (kind === 'income') {
    if (
      includesAny(category, ['工资', '薪资', '兼职', '经营'])
      || category === 'SALARY'
      || category === 'BUSINESS'
    ) {
      return 'operating';
    }
    if (
      includesAny(category, ['投资', '利息', '股息', '理财'])
      || category === 'INVESTMENT'
      || category === 'INTEREST'
    ) {
      return 'investing';
    }
    return 'other';
  }

  if (
    includesAny(category, ['餐饮', '交通', '购物', '娱乐', '医疗', '教育', '日用'])
    || ['FOOD', 'TRANSPORT', 'SHOPPING', 'ENTERTAINMENT', 'HEALTHCARE', 'EDUCATION'].includes(category)
  ) {
    return 'operating';
  }
  if (includesAny(category, ['投资', '理财'])) {
    return 'investing';
  }
  return 'other';
}
