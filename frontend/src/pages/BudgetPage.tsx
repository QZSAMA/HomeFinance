import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getBudgetProgress,
  createBudget,
  updateBudget,
  deleteBudget,
  type BudgetProgress,
  type BudgetInput,
} from '../services/budgetService';

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: '每月',
  QUARTERLY: '每季',
  YEARLY: '每年',
};

const BudgetPage = () => {
  const { currentFamily } = useFamilyStore();
  const [progress, setProgress] = useState<BudgetProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<BudgetInput>({
    category: '',
    amount: 0,
    period: 'MONTHLY',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
  });

  useEffect(() => {
    if (currentFamily) {
      loadProgress();
    }
  }, [currentFamily]);

  const loadProgress = async () => {
    if (!currentFamily) return;
    setLoading(true);
    setError('');
    try {
      const data = await getBudgetProgress(currentFamily.id);
      setProgress(data);
    } catch (err: any) {
      setError(err.response?.data?.error || '加载预算失败');
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormData({
      category: '',
      amount: 0,
      period: 'MONTHLY',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
    });
    setShowModal(true);
  };

  const openEditModal = (item: BudgetProgress) => {
    setEditingId(item.budget.id);
    setFormData({
      category: item.budget.category,
      amount: item.budget.amount,
      period: item.budget.period,
      startDate: item.budget.startDate.slice(0, 10),
      endDate: item.budget.endDate ? item.budget.endDate.slice(0, 10) : '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFamily) return;
    try {
      const payload: BudgetInput = {
        category: formData.category,
        amount: Number(formData.amount),
        period: formData.period,
        startDate: formData.startDate,
        endDate: formData.endDate || undefined,
      };
      if (editingId) {
        await updateBudget(currentFamily.id, editingId, payload);
      } else {
        await createBudget(currentFamily.id, payload);
      }
      setShowModal(false);
      loadProgress();
    } catch (err: any) {
      setError(err.response?.data?.error || '保存预算失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!currentFamily) return;
    if (!confirm('确定要删除此预算吗？')) return;
    try {
      await deleteBudget(currentFamily.id, id);
      loadProgress();
    } catch (err: any) {
      setError(err.response?.data?.error || '删除预算失败');
    }
  };

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);

  const getProgressColor = (percentage: number) => {
    if (percentage > 100) return 'bg-red-500';
    if (percentage >= 80) return 'bg-orange-500';
    return 'bg-green-500';
  };

  const getPercentageTextColor = (percentage: number) => {
    if (percentage > 100) return 'text-red-600';
    if (percentage >= 80) return 'text-orange-600';
    return 'text-green-600';
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">预算管理</h1>
          <p className="text-gray-500 mt-1">为家庭支出设定预算并跟踪使用情况</p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          新建预算
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : progress.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
          暂无预算，点击"新建预算"开始
        </div>
      ) : (
        <div className="space-y-4">
          {progress.map((item) => (
            <div key={item.budget.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{item.budget.category}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {PERIOD_LABELS[item.budget.period] || item.budget.period} ·{' '}
                    {new Date(item.budget.startDate).toLocaleDateString('zh-CN')}
                    {item.budget.endDate
                      ? ` ~ ${new Date(item.budget.endDate).toLocaleDateString('zh-CN')}`
                      : ' 起'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEditModal(item)}
                    className="text-sm text-indigo-600 hover:text-indigo-800 px-2 py-1"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleDelete(item.budget.id)}
                    className="text-sm text-red-600 hover:text-red-800 px-2 py-1"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-baseline mb-2">
                <div className="text-sm text-gray-600">
                  已花费 <span className="font-medium text-gray-900">{formatMoney(item.spent)}</span>
                  {' / '}
                  预算 <span className="font-medium text-gray-900">{formatMoney(item.budget.amount)}</span>
                </div>
                <div className={`text-sm font-medium ${getPercentageTextColor(item.percentage)}`}>
                  {item.percentage}%
                </div>
              </div>

              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`${getProgressColor(item.percentage)} h-3 rounded-full transition-all`}
                  style={{ width: `${Math.min(100, item.percentage)}%` }}
                ></div>
              </div>

              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>
                  剩余{' '}
                  <span className={item.remaining >= 0 ? 'text-gray-700' : 'text-red-600'}>
                    {formatMoney(item.remaining)}
                  </span>
                </span>
                {item.percentage > 100 && (
                  <span className="text-red-600">已超出预算 {item.percentage - 100}%</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">{editingId ? '编辑预算' : '新建预算'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类别</label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="如：餐饮、交通、娱乐"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">预算金额</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">周期</label>
                  <select
                    value={formData.period}
                    onChange={(e) => setFormData({ ...formData, period: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="MONTHLY">每月</option>
                    <option value="QUARTERLY">每季</option>
                    <option value="YEARLY">每年</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    结束日期（可选）
                  </label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
                >
                  {editingId ? '保存' : '创建'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetPage;
