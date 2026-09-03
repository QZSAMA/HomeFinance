import { Decimal } from '@prisma/client/runtime/library';
import { DomainError } from './ledgerErrors';
import {
  summarizeByCurrency,
} from './currencySummaryService';

describe('currencySummaryService', () => {
  test('groups mixed currencies and refuses a fake base total', () => {
    expect(summarizeByCurrency([
      { amount: '10.00', currency: 'CNY' },
      { amount: '2.00', currency: 'USD' },
    ], 'CNY')).toEqual({
      baseCurrency: 'CNY',
      totalsByCurrency: { CNY: 10, USD: 2 },
      totalInBaseCurrency: null,
      conversionStatus: 'unavailable',
    });
  });

  test('returns an exact base total for base-only rows with Decimal-safe rounding', () => {
    const summary = summarizeByCurrency([
      { amount: '10.105', currency: 'cny' },
      { amount: new Decimal('0.005'), currency: 'CNY' },
    ], 'CNY');
    expect(summary.totalsByCurrency).toEqual({ CNY: 10.11 });
    expect(summary.totalInBaseCurrency).toBe(10.11);
    expect(summary.conversionStatus).toBe('exact');
  });

  test('converts every non-base currency only when all positive finite rates exist', () => {
    const exact = summarizeByCurrency([
      { amount: '10', currency: 'CNY' },
      { amount: '2', currency: 'USD' },
      { amount: '3', currency: 'EUR' },
    ], 'CNY', { USD: 7.2, EUR: 7.8 });
    expect(exact.totalInBaseCurrency).toBe(47.8);
    expect(exact.conversionStatus).toBe('exact');

    const partial = summarizeByCurrency([
      { amount: '10', currency: 'CNY' },
      { amount: '2', currency: 'USD' },
      { amount: '3', currency: 'EUR' },
    ], 'CNY', { USD: 7.2 });
    expect(partial.totalInBaseCurrency).toBeNull();
    expect(partial.conversionStatus).toBe('partial');
  });

  test('treats empty input as an exact zero and rejects invalid currencies or amounts', () => {
    expect(summarizeByCurrency([], 'CNY')).toEqual({
      baseCurrency: 'CNY',
      totalsByCurrency: {},
      totalInBaseCurrency: 0,
      conversionStatus: 'exact',
    });
    for (const currency of ['', 'CN', 'USDX', '人民币', null]) {
      expect(() => summarizeByCurrency([{ amount: 1, currency: currency as string }], 'CNY'))
        .toThrow(DomainError);
    }
    expect(() => summarizeByCurrency([{ amount: 'not-a-number', currency: 'CNY' }], 'CNY'))
      .toThrow(DomainError);
  });
});
