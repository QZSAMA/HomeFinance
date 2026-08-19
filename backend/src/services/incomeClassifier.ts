import { prisma } from '../app';

export const INCOME_TYPES = ['SALARY', 'INVESTMENT', 'DIVIDEND', 'INTEREST', 'RENT', 'OTHER'] as const;
export type IncomeType = typeof INCOME_TYPES[number];

// 关键词映射规则（按优先级排序：更具体的类型在前，INVESTMENT 作为兜底投资类在后）
const KEYWORD_MAP: Array<{ type: IncomeType; keywords: string[] }> = [
  { type: 'SALARY', keywords: ['工资', '薪水', '薪资', 'SALARY'] },
  { type: 'DIVIDEND', keywords: ['分红', '股息', '派息', 'DIVIDEND'] },
  { type: 'INTEREST', keywords: ['利息', '理财收益', 'INTEREST'] },
  { type: 'RENT', keywords: ['租金', '出租', 'RENT'] },
  { type: 'INVESTMENT', keywords: ['投资', 'INVESTMENT'] },
];

export function classifyIncome(category: string, description?: string): IncomeType {
  const haystacks = [category, description || ''].map((s) => s.toLowerCase());

  for (const { type, keywords } of KEYWORD_MAP) {
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (haystacks.some((h) => h.includes(kwLower))) {
        return type;
      }
    }
  }

  return 'OTHER';
}

export async function migrateExistingIncomes(): Promise<{
  total: number;
  classified: number;
  details: Record<string, number>;
}> {
  const incomes = await prisma.income.findMany({ where: { incomeType: null } });

  const details: Record<string, number> = {};
  let classified = 0;

  for (const income of incomes) {
    try {
      const type = classifyIncome(income.category, income.description || undefined);
      await prisma.income.update({
        where: { id: income.id },
        data: { incomeType: type },
      });
      details[type] = (details[type] || 0) + 1;
      classified++;
    } catch (error) {
      // 出错时不中断，记录错误继续处理后续记录
      console.error(`迁移 Income ${income.id} 失败:`, error);
    }
  }

  return {
    total: incomes.length,
    classified,
    details,
  };
}
