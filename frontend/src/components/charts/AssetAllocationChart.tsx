import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface AllocationItem {
  category: string;
  value: number;
  percentage: number;
}

interface AssetAllocationChartProps {
  allocation: AllocationItem[];
  totalValue?: number;
  centerLabel?: string;
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

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount);
};

const AssetAllocationChart = ({
  allocation,
  totalValue,
  centerLabel = '总资产',
}: AssetAllocationChartProps) => {
  // 过滤掉 value 为 0 的项，避免饼图出现空切片
  const data = allocation
    .filter((item) => item.value > 0)
    .map((item) => ({
      name: categoryLabels[item.category] || item.category,
      value: item.value,
      category: item.category,
      percentage: item.percentage,
    }));

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        暂无资产数据，请先添加资产
      </div>
    );
  }

  const total = totalValue ?? data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
          >
            {data.map((entry) => (
              <Cell
                key={entry.category}
                fill={categoryColors[entry.category] || '#9ca3af'}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: any, _name: any, props: any) => [
              `${formatMoney(Number(value))} (${props.payload.percentage}%)`,
              props.payload.name,
            ]}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value: string) => (
              <span className="text-xs text-gray-600">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ top: '-15%' }}>
        <div className="text-xl font-bold text-gray-900">{formatMoney(total)}</div>
        <div className="text-xs text-gray-500">{centerLabel}</div>
      </div>
    </div>
  );
};

export default AssetAllocationChart;
