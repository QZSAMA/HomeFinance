import { useState, useEffect, useCallback } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import { formatAggregate, formatGroupedCurrency, nextLocalDate } from '../utils/financialFormatting';
import type { PeriodWindow } from '../services/reportService';

interface IncomeStatementData {
  totalIncome: number | null;
  totalExpense: number | null;
  netIncome: number | null;
  incomeByCategory: Record<string, number | null>;
  expenseByCategory: Record<string, number | null>;
  startDate: string | null;
  endDate: string | null;
  baseCurrency?: string;
  window?: PeriodWindow;
  totalsByCurrency?: Record<string, number>;
  expenseTotalsByCurrency?: Record<string, number>;
  conversionStatus?: 'exact' | 'unavailable' | 'partial';
  reconciliationStatus?: 'passed' | 'unavailable' | 'failed';
}

const IncomeStatementPage = () => {
  const { currentFamily } = useFamilyStore();
  const familyId = currentFamily?.id;
  const [data, setData] = useState<IncomeStatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadData = useCallback(async (requestedStart = '', requestedEnd = '') => {
    if (!familyId) return;
    setLoading(true);
    try {
      let url = `/api/families/${familyId}/reports/income-statement`;
      const params = new URLSearchParams();
      if (requestedStart) params.append('startDate', requestedStart);
      if (requestedEnd) params.append('endDate', nextLocalDate(requestedEnd));
      if (params.size > 0) url += `?${params.toString()}`;

      const response = await fetch(url);
      const result = await response.json();
      if (response.ok) {
        setData(result);
      }
    } catch (err) {
      console.error('加载利润表失败:', err);
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleFilter = () => {
    void loadData(startDate, endDate);
  };

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    void loadData('', '');
  };

  const formatMoney = (amount: number | null | undefined) => formatAggregate(
    amount,
    data?.baseCurrency ?? currentFamily?.baseCurrency ?? 'CNY',
    data?.conversionStatus ?? 'exact',
  );

  const formatPercentage = (value: number | null, total: number | null) => {
    if (value === null || total === null) return '—';
    if (total === 0) return '0%';
    return `${((value / total) * 100).toFixed(1)}%`;
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">利润表</h1>
          <p className="text-gray-500 mt-1">家庭收支情况分析</p>
          {data?.window && <p className="text-xs text-gray-400 mt-1">统计窗口：{data.window.startLocal} – {data.window.endLocalExclusive}（{data.window.timezone}）</p>}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">结束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleFilter}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              查询
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
            >
              重置
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">总收入</div>
          <div className="text-2xl font-bold text-green-600">{loading ? '--' : formatMoney(data?.totalIncome)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">总支出</div>
          <div className="text-2xl font-bold text-red-600">{loading ? '--' : formatMoney(data?.totalExpense)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">净收益</div>
          <div className={`text-2xl font-bold ${(data?.netIncome ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.netIncome)}
          </div>
        </div>
      </div>

      {!loading && data?.conversionStatus && data.conversionStatus !== 'exact' && (
        <div role="alert" className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          {formatAggregate(null, data.baseCurrency ?? currentFamily.baseCurrency ?? 'CNY', data.conversionStatus)}
          <div className="mt-1 text-sm">收入：{formatGroupedCurrency(data.totalsByCurrency)}；支出：{formatGroupedCurrency(data.expenseTotalsByCurrency)}</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">收入明细</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="space-y-4">
                {Object.entries(data?.incomeByCategory || {}).map(([category, value]) => (
                  <div key={category} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs mr-3">
                        {category}
                      </span>
                      <span className="text-sm text-gray-700">{formatMoney(value)}</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatPercentage(value, data?.totalIncome ?? null)}
                    </span>
                  </div>
                ))}
                <div className="pt-4 border-t border-gray-200 flex items-center justify-between">
                  <span className="font-medium text-gray-900">合计</span>
                  <span className="font-bold text-green-600">{formatMoney(data?.totalIncome)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">支出明细</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="space-y-4">
                {Object.entries(data?.expenseByCategory || {}).map(([category, value]) => (
                  <div key={category} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs mr-3">
                        {category}
                      </span>
                      <span className="text-sm text-gray-700">{formatMoney(value)}</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatPercentage(value, data?.totalExpense ?? null)}
                    </span>
                  </div>
                ))}
                <div className="pt-4 border-t border-gray-200 flex items-center justify-between">
                  <span className="font-medium text-gray-900">合计</span>
                  <span className="font-bold text-red-600">{formatMoney(data?.totalExpense)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomeStatementPage;
