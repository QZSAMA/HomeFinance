import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import { getSummary, type SummaryResponse } from '../services/reportService';

const DashboardPage = () => {
  const { currentFamily } = useFamilyStore();
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (currentFamily) {
      loadSummary();
    }
  }, [currentFamily]);

  const loadSummary = async () => {
    if (!currentFamily) return;
    setLoading(true);
    setError('');
    try {
      const data = await getSummary(currentFamily.id);
      setSummary(data);
    } catch (err) {
      setError('加载数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      STOCK: '股票/基金',
      BOND: '长期国债',
      GOLD: '黄金',
      CASH: '现金',
      OTHER: '其他',
    };
    return labels[category] || category;
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      STOCK: 'bg-blue-500',
      BOND: 'bg-green-500',
      GOLD: 'bg-yellow-500',
      CASH: 'bg-gray-500',
      OTHER: 'bg-purple-500',
    };
    return colors[category] || 'bg-gray-400';
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">{error}</p>
        <button
          onClick={loadSummary}
          className="mt-4 text-indigo-600 hover:text-indigo-800"
        >
          重试
        </button>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">财务概览</h1>
        <p className="text-gray-500 mt-1">{currentFamily.name} 的财务状况</p>
      </div>

      {/* 资产负债卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">总资产</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {formatMoney(summary.balanceSheet.totalAssets)}
              </p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-2xl">
              💰
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">总负债</p>
              <p className="text-2xl font-bold text-red-600 mt-1">
                {formatMoney(summary.balanceSheet.totalLiabilities)}
              </p>
            </div>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-2xl">
              💳
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">净资产</p>
              <p className={`text-2xl font-bold mt-1 ${
                summary.balanceSheet.netWorth >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {formatMoney(summary.balanceSheet.netWorth)}
              </p>
            </div>
            <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-2xl">
              📊
            </div>
          </div>
        </div>
      </div>

      {/* 本月收支 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">本月收支</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">本月收入</span>
              <span className="text-green-600 font-medium">
                +{formatMoney(summary.incomeStatement.thisMonthIncome)}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full"
                style={{
                  width: `${Math.min(100, 
                    (summary.incomeStatement.thisMonthIncome / 
                      Math.max(summary.incomeStatement.thisMonthIncome + summary.incomeStatement.thisMonthExpense, 1)) * 100
                  )}%`
                }}
              ></div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">本月支出</span>
              <span className="text-red-600 font-medium">
                -{formatMoney(summary.incomeStatement.thisMonthExpense)}
              </span>
            </div>
            <div className="pt-4 border-t border-gray-100">
              <div className="flex justify-between items-center">
                <span className="text-gray-700 font-medium">本月结余</span>
                <span className={`font-bold ${
                  summary.incomeStatement.netIncome >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {formatMoney(summary.incomeStatement.netIncome)}
                </span>
              </div>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>
                收入环比: {summary.incomeStatement.incomeChange >= 0 ? '+' : ''}
                {summary.incomeStatement.incomeChange.toFixed(1)}%
              </span>
              <span>
                支出环比: {summary.incomeStatement.expenseChange >= 0 ? '+' : ''}
                {summary.incomeStatement.expenseChange.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* 投资配置 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">投资配置</h3>
          {summary.investmentAllocation.every((a) => a.value === 0) ? (
            <div className="text-center py-8 text-gray-500">
              暂无资产数据，请先添加资产
            </div>
          ) : (
            <div className="space-y-4">
              {summary.investmentAllocation.map((item) => (
                <div key={item.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">{getCategoryLabel(item.category)}</span>
                    <span className="text-gray-900 font-medium">
                      {item.percentage}% ({formatMoney(item.value)})
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className={`${getCategoryColor(item.category)} h-3 rounded-full transition-all duration-500`}
                      style={{ width: `${item.percentage}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 最近交易 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">最近收入</h3>
          {summary.recentTransactions.incomes.length === 0 ? (
            <div className="text-center py-8 text-gray-500">暂无收入记录</div>
          ) : (
            <div className="space-y-3">
              {summary.recentTransactions.incomes.map((item: any) => (
                <div key={item.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.category}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(item.date).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <span className="text-green-600 font-medium">
                    +{formatMoney(item.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">最近支出</h3>
          {summary.recentTransactions.expenses.length === 0 ? (
            <div className="text-center py-8 text-gray-500">暂无支出记录</div>
          ) : (
            <div className="space-y-3">
              {summary.recentTransactions.expenses.map((item: any) => (
                <div key={item.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.category}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(item.date).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                  <span className="text-red-600 font-medium">
                    -{formatMoney(item.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
