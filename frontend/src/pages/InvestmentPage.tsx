import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import { getSummary } from '../services/reportService';
import AssetAllocationChart from '../components/charts/AssetAllocationChart';

interface InvestmentAllocation {
  category: string;
  value: number;
  percentage: number;
}

interface InvestmentData {
  totalAssets: number;
  allocation: InvestmentAllocation[];
}

const categoryLabels: Record<string, string> = {
  STOCK: '股票/基金',
  BOND: '债券',
  GOLD: '黄金',
  CASH: '现金',
  OTHER: '其他',
};

const categoryColors: Record<string, string> = {
  STOCK: '#6366f1',
  BOND: '#22c55e',
  GOLD: '#f59e0b',
  CASH: '#3b82f6',
  OTHER: '#64748b',
};

const InvestmentPage = () => {
  const { currentFamily } = useFamilyStore();
  const [data, setData] = useState<InvestmentData | null>(null);
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
      const summary = await getSummary(currentFamily.id);
      setData({
        totalAssets: summary.balanceSheet.totalAssets,
        allocation: summary.investmentAllocation || [],
      });
    } catch (err) {
      console.error('加载投资配置失败:', err);
    } finally {
      setLoading(false);
    }
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
          <h1 className="text-2xl font-bold text-gray-900">投资配置</h1>
          <p className="text-gray-500 mt-1">家庭资产配置分析</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">总资产</div>
          <div className="text-2xl font-bold text-indigo-600">{loading ? '--' : formatMoney(data?.totalAssets || 0)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">权益类资产</div>
          <div className="text-2xl font-bold text-purple-600">
            {loading ? '--' : formatMoney(data?.allocation.find(a => a.category === 'STOCK')?.value || 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 mb-1">固收类资产</div>
          <div className="text-2xl font-bold text-green-600">
            {loading ? '--' : formatMoney(data?.allocation.find(a => a.category === 'BOND')?.value || 0)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">资产配置饼图</h2>
          </div>
          <div className="p-6 flex items-center justify-center">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <AssetAllocationChart
                allocation={data?.allocation || []}
                totalValue={data?.totalAssets}
                centerLabel="总资产"
              />
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">配置明细</h2>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-8 text-gray-500">加载中...</div>
            ) : (
              <div className="space-y-4">
                {data?.allocation.map((item) => (
                  <div key={item.category}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center">
                        <div
                          className="w-3 h-3 rounded-full mr-3"
                          style={{ backgroundColor: categoryColors[item.category] }}
                        />
                        <span className="text-sm text-gray-700">{categoryLabels[item.category]}</span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-sm text-gray-500 mr-2">{formatMoney(item.value)}</span>
                        <span className="text-sm font-medium text-gray-900">{item.percentage}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${item.percentage}%`,
                          backgroundColor: categoryColors[item.category],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvestmentPage;