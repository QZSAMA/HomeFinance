import { useState, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getHistory,
  getLatest,
  takeSnapshot,
  type NetWorthSnapshot,
} from '../services/netWorthService';
import AssetAllocationChart from '../components/charts/AssetAllocationChart';

// 时间范围选项：7 天 / 30 天 / 90 天 / 1 年
const RANGE_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 365, label: '1 年' },
];

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);

const formatMoneyShort = (amount: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount);

const formatPercent = (value: number) => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

// 将 assetBreakdown（Record<type, value>）转换为饼图所需的 allocation 结构
function buildAllocation(breakdown: Record<string, number>) {
  const entries = Object.entries(breakdown).filter(([, v]) => v > 0);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  return entries.map(([category, value]) => ({
    category,
    value,
    percentage: total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0,
  }));
}

const NetWorthPage = () => {
  const { currentFamily } = useFamilyStore();
  const [history, setHistory] = useState<NetWorthSnapshot[]>([]);
  const [latest, setLatest] = useState<NetWorthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshoting, setSnapshoting] = useState(false);
  const [error, setError] = useState('');
  const [range, setRange] = useState(30);

  const loadHistory = async (familyId: string, days: number) => {
    const startDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
    const endDate = dayjs().format('YYYY-MM-DD');
    return getHistory(familyId, startDate, endDate);
  };

  useEffect(() => {
    if (!currentFamily) return;
    setLoading(true);
    setError('');
    Promise.all([
      loadHistory(currentFamily.id, range),
      getLatest(currentFamily.id).catch(() => null),
    ])
      .then(([hist, lat]) => {
        setHistory(hist);
        setLatest(lat);
      })
      .catch((err) => {
        console.error('加载净值数据失败:', err);
        setError('加载净值数据失败');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFamily, range]);

  // 切换时间范围时仅刷新历史曲线
  const handleRangeChange = (days: number) => {
    setRange(days);
  };

  // 手动触发快照，刷新后重新加载历史与最新快照
  const handleTakeSnapshot = async () => {
    if (!currentFamily) return;
    setSnapshoting(true);
    setError('');
    try {
      const snapshot = await takeSnapshot(currentFamily.id);
      setLatest(snapshot);
      const hist = await loadHistory(currentFamily.id, range);
      setHistory(hist);
    } catch (err: any) {
      setError(err.response?.data?.error || '生成快照失败');
    } finally {
      setSnapshoting(false);
    }
  };

  // 日涨跌：对比最新两条快照的净值差
  const dailyChange = useMemo(() => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    const diff = last.netWorth - prev.netWorth;
    const percent = prev.netWorth !== 0 ? (diff / prev.netWorth) * 100 : 0;
    return { diff, percent };
  }, [history]);

  // 折线图数据：日期 + 净值/总资产/总负债
  const chartData = useMemo(
    () =>
      history.map((s) => ({
        date: dayjs(s.date).format('MM-DD'),
        净值: Number(s.netWorth.toFixed(2)),
        总资产: Number(s.totalAssets.toFixed(2)),
        总负债: Number(s.totalLiabilities.toFixed(2)),
      })),
    [history]
  );

  const allocation = useMemo(
    () => buildAllocation(latest?.assetBreakdown || {}),
    [latest]
  );

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">净值趋势</h1>
          <p className="text-gray-500 mt-1">家庭净资产历史走势与当前资产配置</p>
        </div>
        <button
          onClick={handleTakeSnapshot}
          disabled={snapshoting}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {snapshoting ? '生成中...' : '📸 手动快照'}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>
      )}

      {/* 关键指标卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">总资产</div>
          <div className="text-xl font-bold text-indigo-600">
            {loading ? '--' : formatMoney(latest?.totalAssets || 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">总负债</div>
          <div className="text-xl font-bold text-red-600">
            {loading ? '--' : formatMoney(latest?.totalLiabilities || 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">净值</div>
          <div className="text-xl font-bold text-green-600">
            {loading ? '--' : formatMoney(latest?.netWorth || 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm text-gray-500 mb-1">日涨跌</div>
          {dailyChange ? (
            <div
              className={`text-xl font-bold ${
                dailyChange.diff > 0
                  ? 'text-green-600'
                  : dailyChange.diff < 0
                  ? 'text-red-600'
                  : 'text-gray-500'
              }`}
            >
              <div>{formatMoney(dailyChange.diff)}</div>
              <div className="text-sm font-medium">{formatPercent(dailyChange.percent)}</div>
            </div>
          ) : (
            <div className="text-xl font-bold text-gray-400">-</div>
          )}
        </div>
      </div>

      {/* 净值趋势折线图 */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="p-5 border-b border-gray-200 flex flex-wrap justify-between items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900">净值趋势</h2>
          <div className="flex items-center space-x-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleRangeChange(opt.value)}
                className={`px-3 py-1 rounded-md text-sm transition-colors ${
                  range === opt.value
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : chartData.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无净值历史，点击“手动快照”生成首条记录
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(value: any) => formatMoneyShort(Number(value))} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="净值"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="总资产"
                  stroke="#22c55e"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="总负债"
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 资产配置饼图 */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-5 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">当前资产配置</h2>
        </div>
        <div className="p-5 flex items-center justify-center">
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : allocation.length === 0 ? (
            <div className="text-center py-8 text-gray-500">暂无资产配置数据</div>
          ) : (
            <AssetAllocationChart
              allocation={allocation}
              totalValue={latest?.totalAssets}
              centerLabel="总资产"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default NetWorthPage;
