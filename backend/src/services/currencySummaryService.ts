import { Decimal } from '@prisma/client/runtime/library';
import { DomainError } from './ledgerErrors';

export type ConversionStatus = 'exact' | 'unavailable' | 'partial';

export interface CurrencySummary {
  baseCurrency: string;
  totalsByCurrency: Record<string, number>;
  totalInBaseCurrency: number | null;
  conversionStatus: ConversionStatus;
}

type CurrencyRow = { amount: number | string | Decimal; currency: string };

const invalidCurrency = (): never => {
  throw new DomainError('VALIDATION_FAILED', 'Currency must be a three-letter ISO code.', 400);
};

const invalidAmount = (): never => {
  throw new DomainError('VALIDATION_FAILED', 'Amount must be a finite decimal.', 400);
};

const normalizeCurrency = (value: unknown): string => {
  if (typeof value !== 'string') return invalidCurrency();
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return invalidCurrency();
  return currency;
};

const toDecimal = (value: unknown): Decimal => {
  try {
    const decimal = new Decimal(value as any);
    if (!decimal.isFinite()) return invalidAmount();
    return decimal;
  } catch {
    return invalidAmount();
  }
};

const serializeCents = (totals: ReadonlyMap<string, Decimal>): Record<string, number> => {
  const serialized: Record<string, number> = {};
  for (const [currency, amount] of totals) {
    serialized[currency] = amount.toDecimalPlaces(2).toNumber();
  }
  return serialized;
};

const normalizedRates = (rates: Readonly<Record<string, number>> | undefined): Map<string, number> => {
  const result = new Map<string, number>();
  if (!rates) return result;
  for (const [currency, rate] of Object.entries(rates)) {
    if (!/^[A-Za-z]{3}$/.test(currency)) continue;
    result.set(currency.toUpperCase(), rate);
  }
  return result;
};

const isUsableRate = (rate: number | undefined): rate is number => (
  rate !== undefined && Number.isFinite(rate) && rate > 0
);

export const summarizeByCurrency = (
  rows: ReadonlyArray<CurrencyRow>,
  baseCurrency: string,
  rates?: Readonly<Record<string, number>>,
): CurrencySummary => {
  const normalizedBase = normalizeCurrency(baseCurrency);
  const totals = new Map<string, Decimal>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') return invalidAmount();
    const currency = normalizeCurrency(row.currency);
    const amount = toDecimal(row.amount);
    totals.set(currency, (totals.get(currency) ?? new Decimal(0)).plus(amount));
  }

  const currencies = [...totals.keys()];
  const nonBaseCurrencies = currencies.filter((currency) => currency !== normalizedBase);
  const ratesByCurrency = normalizedRates(rates);
  const usableRates = nonBaseCurrencies.filter((currency) => isUsableRate(ratesByCurrency.get(currency)));
  const complete = usableRates.length === nonBaseCurrencies.length;
  const conversionStatus: ConversionStatus = complete
    ? 'exact'
    : usableRates.length > 0 ? 'partial' : 'unavailable';

  let totalInBaseCurrency: number | null = null;
  if (complete) {
    let total = totals.get(normalizedBase) ?? new Decimal(0);
    for (const currency of nonBaseCurrencies) {
      total = total.plus(totals.get(currency)!.times(ratesByCurrency.get(currency)!));
    }
    totalInBaseCurrency = total.toDecimalPlaces(2).toNumber();
  }

  return {
    baseCurrency: normalizedBase,
    totalsByCurrency: serializeCents(totals),
    totalInBaseCurrency,
    conversionStatus,
  };
};

export const reconcilePerCurrency = (
  income: CurrencySummary,
  expense: CurrencySummary,
): Record<string, number> => {
  const currencies = new Set([
    ...Object.keys(income.totalsByCurrency),
    ...Object.keys(expense.totalsByCurrency),
  ]);
  const result: Record<string, number> = {};
  for (const currency of currencies) {
    const incomeAmount = toDecimal(income.totalsByCurrency[currency] ?? 0);
    const expenseAmount = toDecimal(expense.totalsByCurrency[currency] ?? 0);
    result[currency] = incomeAmount.minus(expenseAmount).toDecimalPlaces(2).toNumber();
  }
  return result;
};
