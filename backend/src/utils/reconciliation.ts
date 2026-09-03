import { Decimal } from '@prisma/client/runtime/library';
import { CurrencySummary, reconcilePerCurrency } from '../services/currencySummaryService';

const cents = (value: number): Decimal | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  try {
    return new Decimal(value).toDecimalPlaces(2);
  } catch {
    return null;
  }
};

const equalCents = (left: number, right: number): boolean => {
  const leftCents = cents(left);
  const rightCents = cents(right);
  return leftCents !== null && rightCents !== null && leftCents.eq(rightCents);
};

export const reconcileIncome = (income: number, expense: number, netIncome: number): boolean => {
  const incomeCents = cents(income);
  const expenseCents = cents(expense);
  const netCents = cents(netIncome);
  return incomeCents !== null
    && expenseCents !== null
    && netCents !== null
    && netCents.eq(incomeCents.minus(expenseCents));
};

export const reconcileCashFlow = (
  classes: ReadonlyArray<{ net: number }>,
  netCashFlow: number,
): boolean => {
  const expected = classes.reduce<Decimal | null>((sum, item) => {
    if (!sum) return null;
    const value = cents(item.net);
    return value ? sum.plus(value) : null;
  }, new Decimal(0));
  const actual = cents(netCashFlow);
  return expected !== null && actual !== null && expected.eq(actual);
};

export const reconcileBalanceSheet = (assets: number, liabilities: number, netWorth: number): boolean => {
  const assetsCents = cents(assets);
  const liabilitiesCents = cents(liabilities);
  const netWorthCents = cents(netWorth);
  return assetsCents !== null
    && liabilitiesCents !== null
    && netWorthCents !== null
    && assetsCents.eq(liabilitiesCents.plus(netWorthCents));
};

export { reconcilePerCurrency };
export type { CurrencySummary };
