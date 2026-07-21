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

interface CashFlowSegment {
  income: number;
  expense: number;
  net: number;
}

interface CashFlowChartProps {
  operating: CashFlowSegment;
  investing: CashFlowSegment;
  financing: CashFlowSegment;
}

const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount);
};

const segmentLabels: Record<string, string> = {
  operating: '经营活动',
  investing: '投资活动',
  financing: '筹资活动',
};

const CashFlowChart = ({ operating, investing, financing }: CashFlowChartProps) => {
  const data = [
    {
      name: segmentLabels.operating,
      流入: operating.income,
      流出: operating.expense,
      净额: operating.net,
    },
    {
      name: segmentLabels.investing,
      流入: investing.income,
      流出: investing.expense,
      净额: investing.net,
    },
    {
      name: segmentLabels.financing,
      流入: financing.income,
      流出: financing.expense,
      净额: financing.net,
    },
  ];

  const hasData =
    operating.income > 0 ||
    operating.expense > 0 ||
    investing.income > 0 ||
    investing.expense > 0 ||
    financing.income > 0 ||
    financing.expense > 0;

  if (!hasData) {
    return (
      <div className="text-center py-8 text-gray-500">暂无现金流数据</div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(value: any) => formatMoney(Number(value))} />
        <Legend />
        <Bar dataKey="流入" fill="#22c55e" radius={[4, 4, 0, 0]} />
        <Bar dataKey="流出" fill="#ef4444" radius={[4, 4, 0, 0]} />
        <Bar dataKey="净额" fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CashFlowChart;
