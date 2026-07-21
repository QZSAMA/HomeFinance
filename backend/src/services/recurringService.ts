/**
 * 计算下次执行日期
 * @param from 基准日期
 * @param frequency 频率：DAILY/WEEKLY/MONTHLY/YEARLY
 * @param interval 间隔（默认 1）
 */
export function calculateNextDate(
  from: Date,
  frequency: string,
  interval: number = 1
): Date {
  const result = new Date(from);
  switch (frequency) {
    case 'DAILY':
      result.setDate(result.getDate() + interval);
      break;
    case 'WEEKLY':
      result.setDate(result.getDate() + interval * 7);
      break;
    case 'MONTHLY':
      result.setMonth(result.getMonth() + interval);
      break;
    case 'YEARLY':
      result.setFullYear(result.getFullYear() + interval);
      break;
    default:
      result.setDate(result.getDate() + interval);
  }
  return result;
}
