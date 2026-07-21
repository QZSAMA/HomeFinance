import { useState, useEffect } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getCompareSummary, type FamilyCompareItem } from '../services/compareService';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7'];

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount);

const ComparePage = () => {
  const [data, setData] = useState<FamilyCompareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await getCompareSummary();
        setData(result);
      } catch (err: any) {
        setError(err.response?.data?.error || '加载失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }
  if (error) {
    return <div className="text-center py-12 text-red-600">{error}</div>;
  }
  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        你还没有加入任何家庭，请先在"家庭管理"中加入或创建家庭。
      </div>
    );
  }

  // 跨家庭汇总
  const totals = data.reduce(
    (acc, item) => ({
      totalAssets: acc.totalAssets + item.totalAssets,
      totalLiabilities: acc.totalLiabilities + item.totalLiabilities,
      netWorth: acc.netWorth + item.netWorth,
      thisMonthIncome: acc.thisMonthIncome + item.thisMonthIncome,
      thisMonthExpense: acc.thisMonthExpense + item.thisMonthExpense,
    }),
    { totalAssets: 0, totalLiabilities: 0, netWorth: 0, thisMonthIncome: 0, thisMonthExpense: 0 }
  );

  // 雷达图数据：每个维度一个对象，键为家庭名
  const dimensions = [
    { key: 'totalAssets', label: '总资产' },
    { key: 'totalLiabilities', label: '总负债' },
    { key: 'netWorth', label: '净资产' },
    { key: 'thisMonthIncome', label: '本月收入' },
    { key: 'thisMonthExpense', label: '本月支出' },
  ];

  // 归一化：每个维度除以该维度最大值，避免数量级差异导致雷达图压扁
  const maxByDim: Record<string, number> = {};
  dimensions.forEach((d) => {
    maxByDim[d.key] = Math.max(...data.map((item) => (item as any)[d.key] as number), 1);
  });

  const radarData = dimensions.map((d) => {
    const point: Record<string, any> = { dimension: d.label };
    data.forEach((item) => {
      const v = (item as any)[d.key] as number;
      point[item.familyName] = Math.round((v / maxByDim[d.key]) * 100);
    });
    return point;
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">家庭对比</h1>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">总资产合计</div>
          <div className="text-2xl font-bold text-indigo-600 mt-2">
            {formatMoney(totals.totalAssets)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">总负债合计</div>
          <div className="text-2xl font-bold text-red-600 mt-2">
            {formatMoney(totals.totalLiabilities)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500">总净资产合计</div>
          <div className="text-2xl font-bold text-green-600 mt-2">
            {formatMoney(totals.netWorth)}
          </div>
        </div>
      </div>

      {/* 雷达图 */}
      {data.length > 1 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">维度对比（归一化 %）</h2>
          <ResponsiveContainer width="100%" height={400}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="dimension" />
              <PolarRadiusAxis angle={30} domain={[0, 100]} />
              {data.map((item, idx) => (
                <Radar
                  key={item.familyId}
                  name={item.familyName}
                  dataKey={item.familyName}
                  stroke={COLORS[idx % COLORS.length]}
                  fill={COLORS[idx % COLORS.length]}
                  fillOpacity={0.15}
                />
              ))}
              <Tooltip
                formatter={(value: any, name: any) => [`${value}%`, name]}
              />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 每个家庭的卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.map((item, idx) => (
          <div key={item.familyId} className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-4">
              <div
                className="w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: COLORS[idx % COLORS.length] }}
              />
              <h3 className="text-lg font-semibold text-gray-900">{item.familyName}</h3>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">总资产</span>
                <span className="font-medium text-indigo-600">
                  {formatMoney(item.totalAssets)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">总负债</span>
                <span className="font-medium text-red-600">
                  {formatMoney(item.totalLiabilities)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">净资产</span>
                <span className="font-medium text-green-600">{formatMoney(item.netWorth)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">本月收入</span>
                <span className="font-medium text-indigo-600">
                  {formatMoney(item.thisMonthIncome)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">本月支出</span>
                <span className="font-medium text-red-600">
                  {formatMoney(item.thisMonthExpense)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ComparePage;
