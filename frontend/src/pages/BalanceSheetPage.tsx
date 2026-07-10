import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';

interface BalanceSheetData {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  assets: Record<string, number>;
  liabilities: Record<string, number>;
}

const assetTypeLabels: Record<string, string> = {
  CASH: '现金',
  STOCK: '股票',
  BOND: '长期国债',
  GOLD: '黄金',
  FUND: '基金',
  REAL_ESTATE: '房产',
  OTHER: '其他',
};

const liabilityTypeLabels: Record<string, string> = {
  MORTGAGE: '房贷',
  CAR_LOAN: '车贷',
  STUDENT_LOAN: '助学贷款',
  CREDIT_CARD: '信用卡',
  PERSONAL_LOAN: '个人贷款',
  OTHER: '其他',
};

const BalanceSheetPage = () => {
  const { currentFamily } = useFamilyStore();
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentFamily) {
      loadData();
    }
  }, [currentFamily]);

  const loadData = async () => {
    if (!currentFamily) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/families/${currentFamily.id}/reports/balance-sheet`);
      const result = await response.json();
      if (response.ok) {
        setData(result);
      }
    } catch (err) {
      console.error('加载资产负债表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);
  };

  const formatPercentage = (value: number, total: number) => {
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
          <h1 className="text-2xl font-bold text-gray-900">资产负债表</h1>
          <p className="text-gray-500 mt-1">家庭财务状况概览</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">总资产</div>
          <div className="text-2xl font-bold text-indigo-600">{loading ? '--' : formatMoney(data?.totalAssets || 0)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">总负债</div>
          <div className="text-2xl font-bold text-red-600">{loading ? '--' : formatMoney(data?.totalLiabilities || 0)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">净资产</div>
          <div className="text-2xl font-bold text-green-600">{loading ? '--' : formatMoney(data?.netWorth || 0)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">资产</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="space-y-4">
                {Object.entries(data?.assets || {}).map(([type, value]) => (
                  <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs mr-3">
                        {assetTypeLabels[type] || type}
                      </span>
                      <span className="text-sm text-gray-700">{formatMoney(value)}</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatPercentage(value, data?.totalAssets || 0)}
                    </span>
                  </div>
                ))}
                <div className="pt-4 border-t border-gray-200 flex items-center justify-between">
                  <span className="font-medium text-gray-900">合计</span>
                  <span className="font-bold text-indigo-600">{formatMoney(data?.totalAssets || 0)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">负债</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="space-y-4">
                {Object.entries(data?.liabilities || {}).map(([type, value]) => (
                  <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs mr-3">
                        {liabilityTypeLabels[type] || type}
                      </span>
                      <span className="text-sm text-gray-700">{formatMoney(value)}</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatPercentage(value, data?.totalLiabilities || 0)}
                    </span>
                  </div>
                ))}
                <div className="pt-4 border-t border-gray-200 flex items-center justify-between">
                  <span className="font-medium text-gray-900">合计</span>
                  <span className="font-bold text-red-600">{formatMoney(data?.totalLiabilities || 0)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BalanceSheetPage;