import api from './api';

export interface ExchangeRate {
  from: string;
  to: string;
  rate: number;
  source: 'LIVE' | 'MANUAL';
  updatedAt: string;
}

export interface ManualRateInput {
  from: string;
  to: string;
  rate: number;
}

export const getSupportedCurrencies = () =>
  api.get<string[]>(`/exchange-rates/currencies`).then((r) => r.data);

export const getRate = (from: string, to: string) =>
  api
    .get<ExchangeRate>(`/exchange-rates`, { params: { from, to } })
    .then((r) => r.data);

export const setManualRate = (input: ManualRateInput) =>
  api.post<ExchangeRate>(`/exchange-rates/manual`, input).then((r) => r.data);
