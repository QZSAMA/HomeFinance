import { useState, useEffect, useCallback } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import { getCashFlow } from '../services/reportService';
import CashFlowChart from '../components/charts/CashFlowChart';
import { formatAggregate, formatGroupedCurrency, nextLocalDate } from '../utils/financialFormatting';
import type { PeriodWindow } from '../services/reportService';

interface CashFlowData {
  operating: {
    income: number | null;
    expense: number | null;
    net: number | null;
  };
  investing: {
    income: number | null;
    expense: number | null;
    net: number | null;
  };
  financing: {
    income: number | null;
    expense: number | null;
    net: number | null;
  };
  other: {
    income: number | null;
    expense: number | null;
  };
  netCashFlow: number | null;
  startDate: string | null;
  endDate: string | null;
  timezone?: string;
  baseCurrency?: string;
  window?: PeriodWindow;
  totalsByCurrency?: Record<string, number>;
  expenseTotalsByCurrency?: Record<string, number>;
  conversionStatus?: 'exact' | 'unavailable' | 'partial';
  reconciliationStatus?: 'passed' | 'unavailable' | 'failed';
}

const CashFlowPage = () => {
  const { currentFamily } = useFamilyStore();
  const familyId = currentFamily?.id;
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadData = useCallback(async (requestedStart = '', requestedEnd = '') => {
    if (!familyId) return;
    setLoading(true);
    try {
      const result = await getCashFlow(
        familyId,
        requestedStart || undefined,
        requestedEnd ? nextLocalDate(requestedEnd) : undefined
      );
      setData(result);
    } catch (err) {
      console.error('加载现金流量表失败:', err);
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

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">现金流量表</h1>
          <p className="text-gray-500 mt-1">家庭现金流动分析</p>
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

      {!loading && data?.conversionStatus && data.conversionStatus !== 'exact' && (
        <div role="alert" className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          {formatAggregate(null, data.baseCurrency ?? currentFamily.baseCurrency ?? 'CNY', data.conversionStatus)}
          <div className="mt-1 text-sm">收入：{formatGroupedCurrency(data.totalsByCurrency)}；支出：{formatGroupedCurrency(data.expenseTotalsByCurrency)}</div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">经营现金流</div>
          <div className={`text-xl font-bold ${(data?.operating.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.operating.net)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">投资现金流</div>
          <div className={`text-xl font-bold ${(data?.investing.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.investing.net)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">筹资现金流</div>
          <div className={`text-xl font-bold ${(data?.financing.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.financing.net)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">净现金流</div>
          <div className={`text-xl font-bold ${(data?.netCashFlow || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.netCashFlow)}
          </div>
        </div>
      </div>

      {/* 现金流对比柱状图 */}
      {loading ? null : data ? (
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">现金流对比</h2>
          </div>
          <div className="p-6">
            <CashFlowChart
                operating={{ income: data.operating.income ?? 0, expense: data.operating.expense ?? 0, net: data.operating.net ?? 0 }}
                investing={{ income: data.investing.income ?? 0, expense: data.investing.expense ?? 0, net: data.investing.net ?? 0 }}
                financing={{ income: data.financing.income ?? 0, expense: data.financing.expense ?? 0, net: data.financing.net ?? 0 }}
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">经营活动</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
                <div>
                  <div className="text-sm text-gray-500 mb-1">经营收入</div>
                  <div className="text-lg font-bold text-green-600">{formatMoney(data?.operating.income)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">生活支出</div>
                  <div className="text-lg font-bold text-red-600">{formatMoney(data?.operating.expense)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">经营净现金流</div>
                  <div className={`text-lg font-bold ${(data?.operating.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatMoney(data?.operating.net)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">投资活动</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
                <div>
                  <div className="text-sm text-gray-500 mb-1">投资收入</div>
                  <div className="text-lg font-bold text-green-600">{formatMoney(data?.investing.income)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">投资支出</div>
                  <div className="text-lg font-bold text-red-600">{formatMoney(data?.investing.expense)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">投资净现金流</div>
                  <div className={`text-lg font-bold ${(data?.investing.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatMoney(data?.investing.net)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">其他活动</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                <div>
                  <div className="text-sm text-gray-500 mb-1">其他收入</div>
                  <div className="text-lg font-bold text-green-600">{formatMoney(data?.other.income)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">其他支出</div>
                  <div className="text-lg font-bold text-red-600">{formatMoney(data?.other.expense)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CashFlowPage;
