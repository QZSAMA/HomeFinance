import {
  reconcileBalanceSheet,
  reconcileCashFlow,
  reconcileIncome,
  reconcilePerCurrency,
} from './reconciliation';

describe('reconciliation helpers', () => {
  test('keeps all reconciliation identities explicit', () => {
    expect(reconcileIncome(100, 40, 60)).toBe(true);
    expect(reconcileCashFlow([{ net: 10 }, { net: -3 }, { net: 2 }], 9)).toBe(true);
    expect(reconcileBalanceSheet(150, 90, 60)).toBe(true);
  });

  test('rejects broken identities while tolerating cent-level floating-point noise', () => {
    expect(reconcileIncome(100, 40, 59.999999)).toBe(true);
    expect(reconcileCashFlow([{ net: 10.005 }, { net: -3.005 }], 7)).toBe(true);
    expect(reconcileBalanceSheet(150, 90, 61)).toBe(false);
    expect(reconcileIncome(Number.NaN, 1, 0)).toBe(false);
  });

  test('reconciles net income independently for each currency', () => {
    expect(reconcilePerCurrency(
      { baseCurrency: 'CNY', totalsByCurrency: { CNY: 100, USD: 20 }, totalInBaseCurrency: null, conversionStatus: 'unavailable' },
      { baseCurrency: 'CNY', totalsByCurrency: { CNY: 40, EUR: 3 }, totalInBaseCurrency: null, conversionStatus: 'unavailable' },
    )).toEqual({ CNY: 60, USD: 20, EUR: -3 });
  });
});
