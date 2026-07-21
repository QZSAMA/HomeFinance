import { useState, useEffect } from 'react';
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from 'recharts';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getGoalProgress,
  createGoal,
  updateGoal,
  deleteGoal,
  type GoalProgress,
  type GoalType,
} from '../services/goalService';

const TYPE_LABELS: Record<GoalType, string> = {
  SAVING: '储蓄',
  DEBT_PAYOFF: '还债',
  INVESTMENT: '投资',
};

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount);

const GoalsPage = () => {
  const { currentFamily } = useFamilyStore();
  const [progress, setProgress] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    type: 'SAVING' as GoalType,
    targetAmount: '',
    deadline: '',
  });

  const load = async () => {
    if (!currentFamily) return;
    setLoading(true);
    try {
      const data = await getGoalProgress(currentFamily.id);
      setProgress(data);
    } catch (err: any) {
      setError(err.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentFamily) load();
  }, [currentFamily]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFamily) return;
    setError('');
    const targetAmount = parseFloat(formData.targetAmount);
    if (isNaN(targetAmount) || targetAmount <= 0) {
      setError('请输入有效目标金额');
      return;
    }
    try {
      const payload = {
        title: formData.title,
        type: formData.type,
        targetAmount,
        deadline: formData.deadline || undefined,
      };
      if (editingId) {
        await updateGoal(currentFamily.id, editingId, payload);
      } else {
        await createGoal(currentFamily.id, payload);
      }
      setShowModal(false);
      setEditingId(null);
      setFormData({ title: '', type: 'SAVING', targetAmount: '', deadline: '' });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || '保存失败');
    }
  };

  const handleEdit = (item: GoalProgress) => {
    setEditingId(item.goal.id);
    setFormData({
      title: item.goal.title,
      type: item.goal.type,
      targetAmount: item.goal.targetAmount.toString(),
      deadline: item.goal.deadline ? item.goal.deadline.split('T')[0] : '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!currentFamily) return;
    if (!confirm('确定要删除这个目标吗？')) return;
    try {
      await deleteGoal(currentFamily.id, id);
      await load();
    } catch (err: any) {
      alert(err.response?.data?.error || '删除失败');
    }
  };

  const resetForm = () => {
    setFormData({ title: '', type: 'SAVING', targetAmount: '', deadline: '' });
    setEditingId(null);
    setError('');
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }
  if (loading) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">财务目标</h1>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 新建目标
        </button>
      </div>

      {progress.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-lg shadow">
          暂无目标，点击右上角创建第一个目标
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {progress.map((item) => {
            const data = [{ name: item.goal.title, value: item.percentage, fill: '#6366f1' }];
            const deadline = item.goal.deadline
              ? new Date(item.goal.deadline)
              : null;
            const daysLeft = deadline
              ? Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : null;
            return (
              <div key={item.goal.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{item.goal.title}</h3>
                    <span className="text-xs text-gray-500">
                      {TYPE_LABELS[item.goal.type]} · 目标 {formatMoney(item.goal.targetAmount)}
                    </span>
                  </div>
                  {item.percentage >= 100 && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                      已完成
                    </span>
                  )}
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart
                      innerRadius="70%"
                      outerRadius="100%"
                      data={data}
                      startAngle={90}
                      endAngle={-270}
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                      <RadialBar background dataKey="value" cornerRadius={10} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-center -mt-24 mb-12 pointer-events-none">
                  <div className="text-2xl font-bold text-indigo-600">{item.percentage}%</div>
                  <div className="text-xs text-gray-500">
                    {formatMoney(item.currentAmount)}
                  </div>
                </div>
                <div className="mt-2 text-sm text-gray-600 space-y-1">
                  <div className="flex justify-between">
                    <span>当前进度</span>
                    <span>{formatMoney(item.currentAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>目标金额</span>
                    <span>{formatMoney(item.goal.targetAmount)}</span>
                  </div>
                  {daysLeft !== null && (
                    <div className="flex justify-between">
                      <span>剩余天数</span>
                      <span className={daysLeft < 30 ? 'text-red-600' : ''}>
                        {daysLeft > 0 ? `${daysLeft} 天` : '已过期'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex justify-end mt-4 space-x-2">
                  <button
                    onClick={() => handleEdit(item)}
                    className="text-indigo-600 hover:text-indigo-900 text-sm"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(item.goal.id)}
                    className="text-red-600 hover:text-red-900 text-sm"
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">{editingId ? '编辑目标' : '新建目标'}</h2>
            {error && <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="例如：买房首付"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as GoalType })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="SAVING">储蓄（按净资产计算进度）</option>
                  <option value="DEBT_PAYOFF">还债（按剩余负债反向计算）</option>
                  <option value="INVESTMENT">投资（按总资产计算进度）</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">目标金额</label>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={formData.targetAmount}
                  onChange={(e) => setFormData({ ...formData, targetAmount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入金额"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">截止日期（可选）</label>
                <input
                  type="date"
                  value={formData.deadline}
                  onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                  确认
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoalsPage;
