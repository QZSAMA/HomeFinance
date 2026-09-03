import { useCallback, useEffect, useRef, useState } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import { getBalanceSheet, getCashFlow, getIncomeStatement, getSummary } from '../services/reportService';
import { exportBalanceSheet } from '../services/exportService';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import CashFlowChart from '../components/charts/CashFlowChart';
import AssetAllocationChart from '../components/charts/AssetAllocationChart';
import { formatAggregate, formatGroupedCurrency, nextLocalDate } from '../utils/financialFormatting';
import type { ConversionStatus, PeriodWindow, ReconciliationStatus } from '../services/reportService';

// ===== 类型定义 =====
interface BalanceSheetData {
  totalAssets: number | null;
  totalLiabilities: number | null;
  netWorth: number | null;
  assets: Record<string, number | null>;
  liabilities: Record<string, number | null>;
  timezone?: string;
  baseCurrency?: string;
  window?: PeriodWindow;
  totalsByCurrency?: Record<string, number>;
  liabilityTotalsByCurrency?: Record<string, number>;
  conversionStatus?: ConversionStatus;
  reconciliationStatus?: ReconciliationStatus;
}

interface IncomeStatementData {
  totalIncome: number | null;
  totalExpense: number | null;
  netIncome: number | null;
  incomeByCategory: Record<string, number | null>;
  expenseByCategory: Record<string, number | null>;
  startDate: string | null;
  endDate: string | null;
  timezone?: string;
  baseCurrency?: string;
  window?: PeriodWindow;
  totalsByCurrency?: Record<string, number>;
  expenseTotalsByCurrency?: Record<string, number>;
  conversionStatus?: ConversionStatus;
  reconciliationStatus?: ReconciliationStatus;
}

interface CashFlowData {
  operating: { income: number | null; expense: number | null; net: number | null };
  investing: { income: number | null; expense: number | null; net: number | null };
  financing: { income: number | null; expense: number | null; net: number | null };
  other: { income: number | null; expense: number | null; net: number | null };
  netCashFlow: number | null;
  startDate: string | null;
  endDate: string | null;
  timezone?: string;
  baseCurrency?: string;
  window?: PeriodWindow;
  totalsByCurrency?: Record<string, number>;
  expenseTotalsByCurrency?: Record<string, number>;
  conversionStatus?: ConversionStatus;
  reconciliationStatus?: ReconciliationStatus;
}

interface InvestmentAllocation {
  category: string;
  value: number | null;
  percentage: number | null;
}

// ===== 常量 =====
const assetTypeLabels: Record<string, string> = {
  CASH: '现金', STOCK: '股票', BOND: '长期国债', GOLD: '黄金',
  FUND: '基金', REAL_ESTATE: '房产', OTHER: '其他',
};

const liabilityTypeLabels: Record<string, string> = {
  MORTGAGE: '房贷', CAR_LOAN: '车贷', STUDENT_LOAN: '助学贷款',
  CREDIT_CARD: '信用卡', PERSONAL_LOAN: '个人贷款', OTHER: '其他',
};

const categoryLabels: Record<string, string> = {
  STOCK: '股票/基金', BOND: '债券', GOLD: '黄金', CASH: '现金', OTHER: '其他',
};

const categoryColors: Record<string, string> = {
  STOCK: '#6366f1', BOND: '#22c55e', GOLD: '#f59e0b', CASH: '#3b82f6', OTHER: '#64748b',
};

const formatMoney = (
  amount: number | null | undefined,
  currency = 'CNY',
  conversionStatus: ConversionStatus = 'exact',
) => formatAggregate(amount, currency, conversionStatus);

const formatMoneyShort = (amount: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(amount);

const formatPercentage = (value: number | null, total: number | null) => {
  if (value === null || total === null) return '—';
  if (total === 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
};

const isUnavailable = (status?: ConversionStatus) => status !== undefined && status !== 'exact';
const isReconciliationFailed = (status?: ReconciliationStatus) => status === 'failed';

// ===== Section 1: 资产负债表 =====
function BalanceSheetSection({ familyId }: { familyId: string }) {
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const requestIdRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!familyId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await getBalanceSheet(familyId);
      if (requestId === requestIdRef.current) {
        setData(result);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setError('资产负债表加载失败，请稍后重试');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [familyId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportBalanceSheet(familyId);
    } catch (err: any) {
      alert(err.response?.data?.error || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const chartData = (() => {
    if (!data) return [];
    const assetEntries = Object.entries(data.assets).flatMap(([type, value]) => value === null ? [] : [{
      name: assetTypeLabels[type] || type, 资产: value, 负债: 0,
    }]);
    const liabilityEntries = Object.entries(data.liabilities).flatMap(([type, value]) => value === null ? [] : [{
      name: liabilityTypeLabels[type] || type, 资产: 0, 负债: value,
    }]);
    return [...assetEntries, ...liabilityEntries];
  })();
  const hasChartData = chartData.some(item => item.资产 > 0 || item.负债 > 0);

  return (
    <section id="balance-sheet" className="scroll-mt-20">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">资产负债表</h2>
          <p className="text-sm text-gray-500 mt-1">家庭财务状况概览</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || Boolean(error)}
          className="bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm"
        >
          {exporting ? '导出中...' : '导出 Excel'}
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <>
      {!loading && isUnavailable(data?.conversionStatus) && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {formatAggregate(null, data?.baseCurrency ?? 'CNY', data?.conversionStatus)}
          <div className="mt-1">资产：{formatGroupedCurrency(data?.totalsByCurrency)}；负债：{formatGroupedCurrency(data?.liabilityTotalsByCurrency)}</div>
        </div>
      )}
      {!loading && isReconciliationFailed(data?.reconciliationStatus) && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">资产负债表未通过勾稽校验</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">总资产</div>
          <div className="text-xl font-bold text-indigo-600">{loading ? '--' : formatMoney(data?.totalAssets, data?.baseCurrency, data?.conversionStatus)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">总负债</div>
          <div className="text-xl font-bold text-red-600">{loading ? '--' : formatMoney(data?.totalLiabilities, data?.baseCurrency, data?.conversionStatus)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">净资产</div>
          <div className="text-xl font-bold text-green-600">{loading ? '--' : formatMoney(data?.netWorth, data?.baseCurrency, data?.conversionStatus)}</div>
        </div>
      </div>

      {!loading && hasChartData && (
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-5 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-900">资产 vs 负债对比</h3>
          </div>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value: any) => formatMoneyShort(Number(value))} />
                <Legend />
                <Bar dataKey="资产" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="负债" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow">
          <div className="p-5 border-b border-gray-200"><h3 className="text-base font-semibold text-gray-900">资产</h3></div>
          <div className="p-5">
            {loading ? <div className="text-center py-6 text-gray-500">加载中...</div> : (
              <div className="space-y-3">
                {Object.entries(data?.assets || {}).map(([type, value]) => (
                  <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs mr-3">{assetTypeLabels[type] || type}</span>
                      <span className="text-sm text-gray-700">{formatMoney(value, data?.baseCurrency, data?.conversionStatus)}</span>
                    </div>
                    <span className="text-sm text-gray-500">{formatPercentage(value, data?.totalAssets ?? null)}</span>
                  </div>
                ))}
                <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
                  <span className="font-medium text-gray-900">合计</span>
                  <span className="font-bold text-indigo-600">{formatMoney(data?.totalAssets, data?.baseCurrency, data?.conversionStatus)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow">
          <div className="p-5 border-b border-gray-200"><h3 className="text-base font-semibold text-gray-900">负债</h3></div>
          <div className="p-5">
            {loading ? <div className="text-center py-6 text-gray-500">加载中...</div> : (
              <div className="space-y-3">
                {Object.entries(data?.liabilities || {}).map(([type, value]) => (
                  <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs mr-3">{liabilityTypeLabels[type] || type}</span>
                      <span className="text-sm text-gray-700">{formatMoney(value, data?.baseCurrency, data?.conversionStatus)}</span>
                    </div>
                    <span className="text-sm text-gray-500">{formatPercentage(value, data?.totalLiabilities ?? null)}</span>
                  </div>
                ))}
                <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
                  <span className="font-medium text-gray-900">合计</span>
                  <span className="font-bold text-red-600">{formatMoney(data?.totalLiabilities, data?.baseCurrency, data?.conversionStatus)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
        </>
      )}
    </section>
  );
}

// ===== Section 2: 利润表 =====
function IncomeStatementSection({ familyId }: { familyId: string }) {
  const [data, setData] = useState<IncomeStatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const requestIdRef = useRef(0);

  const loadData = useCallback(async (requestedStart = '', requestedEnd = '') => {
    if (!familyId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await getIncomeStatement(
        familyId,
        requestedStart || undefined,
        requestedEnd ? nextLocalDate(requestedEnd) : undefined,
      );
      if (requestId === requestIdRef.current) {
        setData(result);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setError('利润表加载失败，请稍后重试');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [familyId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadData]);

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    void loadData();
  };

  return (
    <section id="income-statement" className="scroll-mt-20">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">利润表</h2>
          <p className="text-sm text-gray-500 mt-1">家庭收支情况分析</p>
          {data?.window && <p className="text-xs text-gray-400 mt-1">统计窗口：{data.window.startLocal} – {data.window.endLocalExclusive}（{data.window.timezone}）</p>}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="income-start-date" className="block text-xs font-medium text-gray-700 mb-1">开始日期</label>
            <input
              id="income-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          <div>
            <label htmlFor="income-end-date" className="block text-xs font-medium text-gray-700 mb-1">结束日期</label>
            <input
              id="income-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() => void loadData(startDate, endDate)}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-sm"
            >
              查询
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
            >
              重置
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm text-gray-500 mb-1">总收入</div>
            <div className="text-xl font-bold text-green-600">{loading ? '--' : formatMoney(data?.totalIncome, data?.baseCurrency, data?.conversionStatus)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm text-gray-500 mb-1">总支出</div>
            <div className="text-xl font-bold text-red-600">{loading ? '--' : formatMoney(data?.totalExpense, data?.baseCurrency, data?.conversionStatus)}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm text-gray-500 mb-1">净收益</div>
            <div className={`text-xl font-bold ${(data?.netIncome ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {loading ? '--' : formatMoney(data?.netIncome, data?.baseCurrency, data?.conversionStatus)}
            </div>
          </div>
        </div>
      )}

      {!error && !loading && isUnavailable(data?.conversionStatus) && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {formatAggregate(null, data?.baseCurrency ?? 'CNY', data?.conversionStatus)}
          <div className="mt-1">收入：{formatGroupedCurrency(data?.totalsByCurrency)}；支出：{formatGroupedCurrency(data?.expenseTotalsByCurrency)}</div>
        </div>
      )}
      {!error && !loading && isReconciliationFailed(data?.reconciliationStatus) && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">利润表未通过勾稽校验</div>
      )}

      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg shadow">
            <div className="p-5 border-b border-gray-200"><h3 className="text-base font-semibold text-gray-900">收入明细</h3></div>
            <div className="p-5">
              {loading ? <div className="text-center py-6 text-gray-500">加载中...</div> : (
                <div className="space-y-3">
                  {Object.entries(data?.incomeByCategory || {}).map(([category, value]) => (
                    <div key={category} className="flex items-center justify-between">
                      <div className="flex items-center">
                        <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs mr-3">{category}</span>
                        <span className="text-sm text-gray-700">{formatMoney(value, data?.baseCurrency, data?.conversionStatus)}</span>
                      </div>
                      <span className="text-sm text-gray-500">{formatPercentage(value, data?.totalIncome ?? null)}</span>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
                    <span className="font-medium text-gray-900">合计</span>
                    <span className="font-bold text-green-600">{formatMoney(data?.totalIncome, data?.baseCurrency, data?.conversionStatus)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow">
            <div className="p-5 border-b border-gray-200"><h3 className="text-base font-semibold text-gray-900">支出明细</h3></div>
            <div className="p-5">
              {loading ? <div className="text-center py-6 text-gray-500">加载中...</div> : (
                <div className="space-y-3">
                  {Object.entries(data?.expenseByCategory || {}).map(([category, value]) => (
                    <div key={category} className="flex items-center justify-between">
                      <div className="flex items-center">
                        <span className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs mr-3">{category}</span>
                        <span className="text-sm text-gray-700">{formatMoney(value, data?.baseCurrency, data?.conversionStatus)}</span>
                      </div>
                      <span className="text-sm text-gray-500">{formatPercentage(value, data?.totalExpense ?? null)}</span>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
                    <span className="font-medium text-gray-900">合计</span>
                    <span className="font-bold text-red-600">{formatMoney(data?.totalExpense, data?.baseCurrency, data?.conversionStatus)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ===== Section 3: 现金流量表 =====
function CashFlowSection({ familyId }: { familyId: string }) {
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const requestIdRef = useRef(0);

  const loadData = useCallback(async (requestedStart = '', requestedEnd = '') => {
    if (!familyId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await getCashFlow(
        familyId,
        requestedStart || undefined,
        requestedEnd ? nextLocalDate(requestedEnd) : undefined,
      );
      if (requestId === requestIdRef.current) {
        setData(result);
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setError('现金流量表加载失败，请稍后重试');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [familyId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadData]);

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    void loadData();
  };

  return (
    <section id="cash-flow" className="scroll-mt-20">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">现金流量表</h2>
          <p className="text-sm text-gray-500 mt-1">家庭现金流动分析</p>
          {data?.window && <p className="text-xs text-gray-400 mt-1">统计窗口：{data.window.startLocal} – {data.window.endLocalExclusive}（{data.window.timezone}）</p>}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="cash-flow-start-date" className="block text-xs font-medium text-gray-700 mb-1">开始日期</label>
            <input
              id="cash-flow-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          <div>
            <label htmlFor="cash-flow-end-date" className="block text-xs font-medium text-gray-700 mb-1">结束日期</label>
            <input
              id="cash-flow-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() => void loadData(startDate, endDate)}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors text-sm"
            >
              查询
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
            >
              重置
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <>
      {!loading && isUnavailable(data?.conversionStatus) && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {formatAggregate(null, data?.baseCurrency ?? 'CNY', data?.conversionStatus)}
          <div className="mt-1">收入：{formatGroupedCurrency(data?.totalsByCurrency)}；支出：{formatGroupedCurrency(data?.expenseTotalsByCurrency)}</div>
        </div>
      )}
      {!loading && isReconciliationFailed(data?.reconciliationStatus) && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">现金流量表未通过勾稽校验</div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">经营现金流</div>
          <div className={`text-lg font-bold ${(data?.operating.net ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.operating.net, data?.baseCurrency, data?.conversionStatus)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">投资现金流</div>
          <div className={`text-lg font-bold ${(data?.investing.net ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.investing.net, data?.baseCurrency, data?.conversionStatus)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">筹资现金流</div>
          <div className={`text-lg font-bold ${(data?.financing.net ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.financing.net, data?.baseCurrency, data?.conversionStatus)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">净现金流</div>
          <div className={`text-lg font-bold ${(data?.netCashFlow ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.netCashFlow, data?.baseCurrency, data?.conversionStatus)}
          </div>
        </div>
      </div>

      {!loading && data && data.conversionStatus === 'exact' && (
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-5 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-900">现金流对比</h3>
          </div>
          <div className="p-5">
            <CashFlowChart
              operating={{ income: data.operating.income ?? 0, expense: data.operating.expense ?? 0, net: data.operating.net ?? 0 }}
              investing={{ income: data.investing.income ?? 0, expense: data.investing.expense ?? 0, net: data.investing.net ?? 0 }}
              financing={{ income: data.financing.income ?? 0, expense: data.financing.expense ?? 0, net: data.financing.net ?? 0 }}
            />
          </div>
        </div>
      )}

      <div className="space-y-4">
        {[
          { title: '经营活动', dataKey: 'operating', labels: ['经营收入', '生活支出', '经营净现金流'] },
          { title: '投资活动', dataKey: 'investing', labels: ['投资收入', '投资支出', '投资净现金流'] },
        ].map(section => (
          <div key={section.dataKey} className="bg-white rounded-lg shadow">
            <div className="p-5 border-b border-gray-200"><h3 className="text-base font-semibold text-gray-900">{section.title}</h3></div>
            <div className="p-5">
              {loading ? <div className="text-center py-6 text-gray-500">加载中...</div> : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-gray-500 mb-1">{section.labels[0]}</div>
                    <div className="text-lg font-bold text-green-600">{formatMoney((data as any)?.[section.dataKey].income, data?.baseCurrency, data?.conversionStatus)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">{section.labels[1]}</div>
                    <div className="text-lg font-bold text-red-600">{formatMoney((data as any)?.[section.dataKey].expense, data?.baseCurrency, data?.conversionStatus)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">{section.labels[2]}</div>
                    <div className={`text-lg font-bold ${((data as any)?.[section.dataKey].net ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatMoney((data as any)?.[section.dataKey].net, data?.baseCurrency, data?.conversionStatus)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="bg-white rounded-lg shadow">
          <div className="p-5 border-b border-gray-200"><h3 className="text-base font-semibold text-gray-900">其他活动</h3></div>
          <div className="p-5">
            {loading ? <div className="text-center py-6 text-gray-500">加载中...</div> : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-500 mb-1">其他收入</div>
                  <div className="text-lg font-bold text-green-600">{formatMoney(data?.other.income, data?.baseCurrency, data?.conversionStatus)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">其他支出</div>
                  <div className="text-lg font-bold text-red-600">{formatMoney(data?.other.expense, data?.baseCurrency, data?.conversionStatus)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
        </>
      )}
    </section>
  );
}

// ===== Section 4: 投资配置 =====
function InvestmentSection({ familyId }: { familyId: string }) {
  const [data, setData] = useState<{
    totalAssets: number | null;
    allocation: InvestmentAllocation[];
    baseCurrency?: string;
    window?: PeriodWindow;
    totalsByCurrency?: Record<string, number>;
    conversionStatus?: ConversionStatus;
    reconciliationStatus?: ReconciliationStatus;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!familyId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const summary = await getSummary(familyId);
      if (requestId === requestIdRef.current) {
        setData({
          totalAssets: summary.balanceSheet.totalAssets,
          allocation: summary.investmentAllocation || [],
          baseCurrency: summary.baseCurrency,
          window: summary.window,
          totalsByCurrency: summary.totalsByCurrency,
          conversionStatus: summary.conversionStatus,
          reconciliationStatus: summary.reconciliationStatus,
        });
      }
    } catch {
      if (requestId === requestIdRef.current) {
        setError('投资配置加载失败，请稍后重试');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [familyId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadData]);

  return (
    <section id="investment" className="scroll-mt-20">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">投资配置</h2>
          <p className="text-sm text-gray-500 mt-1">家庭资产配置分析</p>
          {data?.window && <p className="text-xs text-gray-400 mt-1">估值窗口：{data.window.startLocal} – {data.window.endLocalExclusive}（{data.window.timezone}）</p>}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <>
      {!loading && isUnavailable(data?.conversionStatus) && (
        <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {formatAggregate(null, data?.baseCurrency ?? 'CNY', data?.conversionStatus)}
          <div className="mt-1">资产：{formatGroupedCurrency(data?.totalsByCurrency)}</div>
        </div>
      )}
      {!loading && isReconciliationFailed(data?.reconciliationStatus) && (
        <div role="alert" className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">投资配置未通过资产勾稽校验</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">总资产</div>
          <div className="text-xl font-bold text-indigo-600">{loading ? '--' : formatMoney(data?.totalAssets, data?.baseCurrency, data?.conversionStatus)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">权益类资产</div>
          <div className="text-xl font-bold text-purple-600">
            {loading ? '--' : formatMoney(data?.allocation.find(a => a.category === 'STOCK')?.value, data?.baseCurrency, data?.conversionStatus)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">固收类资产</div>
          <div className="text-xl font-bold text-green-600">
            {loading ? '--' : formatMoney(data?.allocation.find(a => a.category === 'BOND')?.value, data?.baseCurrency, data?.conversionStatus)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow">
          <div className="p-5 border-b border-gray-200"><h3 className="text-base font-semibold text-gray-900">资产配置饼图</h3></div>
          <div className="p-5 flex items-center justify-center">
            {loading ? <div className="text-center py-6 text-gray-500">加载中...</div> : data?.conversionStatus !== 'exact' ? (
              <div className="text-center py-6 text-gray-500">币种无法统一时暂不展示配置图</div>
            ) : (
              <AssetAllocationChart
                allocation={(data?.allocation || []).flatMap((item) => item.value === null || item.percentage === null ? [] : [{ category: item.category, value: item.value, percentage: item.percentage }])}
                totalValue={data?.totalAssets ?? undefined}
                centerLabel="总资产"
              />
            )}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow">
          <div className="p-5 border-b border-gray-200"><h3 className="text-base font-semibold text-gray-900">配置明细</h3></div>
          <div className="p-5">
            {loading ? <div className="text-center py-6 text-gray-500">加载中...</div> : (
              <div className="space-y-3">
                {data?.allocation.map(item => (
                  <div key={item.category}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center">
                        <div className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: categoryColors[item.category] }} />
                        <span className="text-sm text-gray-700">{categoryLabels[item.category]}</span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-sm text-gray-500 mr-2">{formatMoney(item.value, data?.baseCurrency, data?.conversionStatus)}</span>
                        <span className="text-sm font-medium text-gray-900">{item.percentage}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{ width: `${item.percentage}%`, backgroundColor: categoryColors[item.category] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
        </>
      )}
    </section>
  );
}

// ===== 主页面 =====
const ReportsPage = () => {
  const { currentFamily } = useFamilyStore();

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">财务报表</h1>
        <p className="text-gray-500 mt-1">家庭财务全貌：资产负债 / 收支情况 / 现金流量 / 投资配置</p>
      </div>
      <div className="space-y-10">
        <BalanceSheetSection familyId={currentFamily.id} />
        <IncomeStatementSection familyId={currentFamily.id} />
        <CashFlowSection familyId={currentFamily.id} />
        <InvestmentSection familyId={currentFamily.id} />
      </div>
    </div>
  );
};

export default ReportsPage;
