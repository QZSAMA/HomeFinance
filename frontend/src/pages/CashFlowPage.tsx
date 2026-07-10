import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';

interface CashFlowData {
  operating: {
    income: number;
    expense: number;
    net: number;
  };
  investing: {
    income: number;
    expense: number;
    net: number;
  };
  financing: {
    income: number;
    expense: number;
    net: number;
  };
  other: {
    income: number;
    expense: number;
  };
  netCashFlow: number;
  startDate: string | null;
  endDate: string | null;
}

const CashFlowPage = () => {
  const { currentFamily } = useFamilyStore();
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (currentFamily) {
      loadData();
    }
  }, [currentFamily]);

  const loadData = async () => {
    if (!currentFamily) return;
    setLoading(true);
    try {
      let url = `/api/families/${currentFamily.id}/reports/cash-flow`;
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (params.size > 0) url += `?${params.toString()}`;

      const response = await fetch(url);
      const result = await response.json();
      if (response.ok) {
        setData(result);
      }
    } catch (err) {
      console.error('加载现金流量表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = () => {
    loadData();
  };

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    loadData();
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">现金流量表</h1>
          <p className="text-gray-500 mt-1">家庭现金流动分析</p>
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

      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">经营现金流</div>
          <div className={`text-xl font-bold ${(data?.operating.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.operating.net || 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">投资现金流</div>
          <div className={`text-xl font-bold ${(data?.investing.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.investing.net || 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">筹资现金流</div>
          <div className={`text-xl font-bold ${(data?.financing.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.financing.net || 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">净现金流</div>
          <div className={`text-xl font-bold ${(data?.netCashFlow || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {loading ? '--' : formatMoney(data?.netCashFlow || 0)}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">经营活动</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="grid grid-cols-3 gap-8">
                <div>
                  <div className="text-sm text-gray-500 mb-1">经营收入</div>
                  <div className="text-lg font-bold text-green-600">{formatMoney(data?.operating.income || 0)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">生活支出</div>
                  <div className="text-lg font-bold text-red-600">{formatMoney(data?.operating.expense || 0)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">经营净现金流</div>
                  <div className={`text-lg font-bold ${(data?.operating.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatMoney(data?.operating.net || 0)}
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
              <div className="grid grid-cols-3 gap-8">
                <div>
                  <div className="text-sm text-gray-500 mb-1">投资收入</div>
                  <div className="text-lg font-bold text-green-600">{formatMoney(data?.investing.income || 0)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">投资支出</div>
                  <div className="text-lg font-bold text-red-600">{formatMoney(data?.investing.expense || 0)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">投资净现金流</div>
                  <div className={`text-lg font-bold ${(data?.investing.net || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatMoney(data?.investing.net || 0)}
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
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <div className="text-sm text-gray-500 mb-1">其他收入</div>
                  <div className="text-lg font-bold text-green-600">{formatMoney(data?.other.income || 0)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">其他支出</div>
                  <div className="text-lg font-bold text-red-600">{formatMoney(data?.other.expense || 0)}</div>
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