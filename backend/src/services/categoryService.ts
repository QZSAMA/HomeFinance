import { prisma } from '../app';

/**
 * 基于历史交易描述推荐类别
 * 查询历史中 description 包含输入的记录，返回出现频次最高的 category
 * 无匹配返回 null
 */
export async function suggestCategory(
  description: string,
  familyId: string,
  type: 'INCOME' | 'EXPENSE'
): Promise<string | null> {
  if (!description.trim()) return null;

  const model = (type === 'INCOME' ? prisma.income : prisma.expense) as any;
  const matches: Array<{ category: string; description: string }> = await model.findMany({
    where: { familyId, description: { contains: description } },
    take: 20,
    orderBy: { date: 'desc' },
  });

  if (matches.length === 0) return null;

  // 取出现频次最高的 category
  const counter: Record<string, number> = {};
  matches.forEach((r: { category: string; description: string }) => {
    counter[r.category] = (counter[r.category] || 0) + 1;
  });

  return Object.entries(counter).sort((a, b) => b[1] - a[1])[0][0];
}
