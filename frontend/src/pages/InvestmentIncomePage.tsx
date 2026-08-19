import { useState, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import { useFamilyStore } from '../store/useFamilyStore';
import { getIncomes, type Income } from '../services/financeService';
import { getInvestmentIncomeReport } from '../services/reportService';

// 投资收益类型及其展示信息
const INCOME_TYPE_INFO: Record<string, { label: string; color: string }> = {
  DIVIDEND: { label: '分红', color: 'bg-purple-50 text-purple-700' },
  INTEREST: { label: '利息', color: 'bg-blue-50 text-blue-700' },
  RENT: { label: '租金', color: 'bg-green-50 text-green-700' },
  INVESTMENT: { label: '投资收益', color: 'bg-amber-50 text-amber-700' },
};

const INVESTMENT_INCOME_TYPES = ['DIVIDEND', 'INTEREST', 'RENT', 'INVESTMENT'];

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);

const InvestmentIncomePage = () => {
  const { currentFamily } = useFamilyStore();
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [report, setReport] = useState<{
    total: number;
    byType: Record<string, number>;
    byAsset: { assetId: string; name: string | null; total: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  useEffect(() => {
    if (!currentFamily) return;
    setLoading(true);
    setError('');

    // 年度区间：当年 1 月 1 日 ~ 12 月 31 日
    const yearStart = dayjs().startOf('year').format('YYYY-MM-DD');
    const yearEnd = dayjs().endOf('year').format('YYYY-MM-DD');

    Promise.all([
      getIncomes(currentFamily.id),
      getInvestmentIncomeReport(currentFamily.id, yearStart, yearEnd),
    ])
      .then(([allIncomes, rpt]) => {
        // 仅保留投资类收益（DIVIDEND/INTEREST/RENT/INVESTMENT）
        setIncomes(allIncomes.filter((i) => INVESTMENT_INCOME_TYPES.includes(i.incomeType || '')));
        setReport(rpt);
      })
      .catch((err) => {
        console.error('加载投资收益失败:', err);
        setError('加载投资收益失败');
      })
      .finally(() => setLoading(false));
  }, [currentFamily]);

  const getIncomeTypeLabel = (type?: string) => {
    if (!type) return '投资收益';
    return INCOME_TYPE_INFO[type]?.label || type;
  };

  const getIncomeTypeColor = (type?: string) => {
    const fallback = 'bg-gray-50 text-gray-700';
    if (!type) return fallback;
    return INCOME_TYPE_INFO[type]?.color || fallback;
  };

  // 按类型筛选列表
  const filteredIncomes = useMemo(() => {
    if (typeFilter === 'ALL') return incomes;
    return incomes.filter((i) => i.incomeType === typeFilter);
  }, [incomes, typeFilter]);

  // 年度分类型汇总（来自报表，已按当年区间聚合）
  const annualByType = useMemo(() => {
    const result: { type: string; total: number }[] = [];
    for (const type of INVESTMENT_INCOME_TYPES) {
      const total = report?.byType?.[type] || 0;
      result.push({ type, total });
    }
    return result;
  }, [report]);

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">投资收益</h1>
        <p className="text-gray-500 mt-1">
          分红 / 利息 / 租金 / 投资收益 · {dayjs().year()} 年度汇总
        </p>
      </div>

      {error && (
        <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>
      )}

      {/* 年度收益汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-5 md:col-span-1">
          <div className="text-sm text-gray-500 mb-1">{dayjs().year()} 年总收益</div>
          <div className="text-xl font-bold text-indigo-600">
            {loading ? '--' : formatMoney(report?.total || 0)}
          </div>
        </div>
        {annualByType.map(({ type, total }) => (
          <div key={type} className="bg-white rounded-lg shadow p-5">
            <div className="text-sm text-gray-500 mb-1">{getIncomeTypeLabel(type)}</div>
            <div className="text-lg font-bold text-gray-900">
              {loading ? '--' : formatMoney(total)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* 按资产分组的收益统计 */}
        <div className="bg-white rounded-lg shadow lg:col-span-1">
          <div className="p-5 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">按资产分组（{dayjs().year()} 年）</h2>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="text-center py-6 text-gray-500">加载中...</div>
            ) : !report?.byAsset || report.byAsset.length === 0 ? (
              <div className="text-center py-6 text-gray-500">暂无关联资产的投资收益</div>
            ) : (
              <div className="space-y-3">
                {report.byAsset
                  .slice()
                  .sort((a, b) => b.total - a.total)
                  .map((item) => (
                    <div
                      key={item.assetId}
                      className="flex items-center justify-between border-b border-gray-100 pb-2 last:border-b-0 last:pb-0"
                    >
                      <span className="text-sm text-gray-700 truncate">
                        {item.name || '未命名资产'}
                      </span>
                      <span className="text-sm font-medium text-indigo-600 ml-2">
                        {formatMoney(item.total)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* 投资收益列表 */}
        <div className="bg-white rounded-lg shadow lg:col-span-2">
          <div className="p-5 border-b border-gray-200 flex flex-wrap justify-between items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">收益明细</h2>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            >
              <option value="ALL">全部类型</option>
              {INVESTMENT_INCOME_TYPES.map((type) => (
                <option key={type} value={type}>
                  {getIncomeTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="text-center py-12 text-gray-500">加载中...</div>
            ) : filteredIncomes.length === 0 ? (
              <div className="text-center py-12 text-gray-500">暂无投资收益记录</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      日期
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      类型
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      类别
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      金额
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredIncomes.map((income) => (
                    <tr key={income.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {dayjs(income.date).format('YYYY-MM-DD')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 rounded text-xs ${getIncomeTypeColor(income.incomeType)}`}
                        >
                          {getIncomeTypeLabel(income.incomeType)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {income.category}
                        </div>
                        {income.description && (
                          <div className="text-xs text-gray-500">{income.description}</div>
                        )}
                        {income.source && (
                          <div className="text-xs text-gray-400">来源：{income.source}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-right text-green-600">
                        {formatMoney(income.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={3} className="px-6 py-3 text-right text-sm font-medium text-gray-700">
                      合计
                    </td>
                    <td className="px-6 py-3 text-right text-sm font-bold text-indigo-600">
                      {formatMoney(filteredIncomes.reduce((s, i) => s + i.amount, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvestmentIncomePage;
