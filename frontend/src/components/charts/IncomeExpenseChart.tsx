import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface IncomeExpenseChartProps {
  thisMonthIncome: number;
  thisMonthExpense: number;
  lastMonthIncome: number;
  lastMonthExpense: number;
}

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount);
};

const IncomeExpenseChart = ({
  thisMonthIncome,
  thisMonthExpense,
  lastMonthIncome,
  lastMonthExpense,
}: IncomeExpenseChartProps) => {
  const data = [
    {
      name: '上月',
      收入: lastMonthIncome,
      支出: lastMonthExpense,
    },
    {
      name: '本月',
      收入: thisMonthIncome,
      支出: thisMonthExpense,
    },
  ];

  const hasData =
    thisMonthIncome > 0 ||
    thisMonthExpense > 0 ||
    lastMonthIncome > 0 ||
    lastMonthExpense > 0;

  if (!hasData) {
    return (
      <div className="text-center py-8 text-gray-500">暂无收支数据</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(value: any) => formatMoney(Number(value))} />
        <Legend />
        <Bar dataKey="收入" fill="#22c55e" radius={[4, 4, 0, 0]} />
        <Bar dataKey="支出" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default IncomeExpenseChart;
