import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getRecurring,
  getDueRecurring,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  executeRecurring,
  type RecurringTransaction,
  type RecurringInput,
} from '../services/recurringService';

const RecurringPage = () => {
  const { currentFamily } = useFamilyStore();
  const [list, setList] = useState<RecurringTransaction[]>([]);
  const [dueList, setDueList] = useState<RecurringTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    type: 'INCOME' as 'INCOME' | 'EXPENSE',
    category: '',
    amount: '',
    description: '',
    frequency: 'MONTHLY' as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
    interval: '1',
    nextDate: new Date().toISOString().split('T')[0],
    endDate: '',
  });

  const incomeCategories = ['工资', '奖金', '投资收益', '兼职收入', '租金收入', '其他收入'];
  const expenseCategories = ['餐饮', '交通', '购物', '娱乐', '医疗', '教育', '住房', '水电', '通讯', '其他支出'];

  const loadData = async () => {
    if (!currentFamily) return;
    setLoading(true);
    try {
      const [all, due] = await Promise.all([
        getRecurring(currentFamily.id),
        getDueRecurring(currentFamily.id),
      ]);
      setList(all);
      setDueList(due);
    } catch (err) {
      console.error('加载定期规则失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentFamily) {
      loadData();
    }
  }, [currentFamily]);

  const resetForm = () => {
    setFormData({
      type: 'INCOME',
      category: '',
      amount: '',
      description: '',
      frequency: 'MONTHLY',
      interval: '1',
      nextDate: new Date().toISOString().split('T')[0],
      endDate: '',
    });
    setEditingId(null);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFamily) return;

    setError('');
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      setError('请输入有效金额');
      return;
    }
    if (!formData.category) {
      setError('请选择类别');
      return;
    }
    const interval = parseInt(formData.interval);
    if (isNaN(interval) || interval < 1) {
      setError('间隔必须 ≥ 1');
      return;
    }

    const payload: RecurringInput = {
      type: formData.type,
      category: formData.category,
      amount,
      description: formData.description || undefined,
      frequency: formData.frequency,
      interval,
      nextDate: formData.nextDate,
      endDate: formData.endDate || undefined,
    };

    try {
      if (editingId) {
        const updated = await updateRecurring(currentFamily.id, editingId, payload);
        setList(list.map((item) => (item.id === editingId ? updated : item)));
      } else {
        const created = await createRecurring(currentFamily.id, payload);
        setList([created, ...list]);
      }
      resetForm();
      setShowModal(false);
      // 刷新到期列表
      const due = await getDueRecurring(currentFamily.id);
      setDueList(due);
    } catch (err: any) {
      setError(err.response?.data?.error || '提交失败');
    }
  };

  const handleEdit = (item: RecurringTransaction) => {
    setEditingId(item.id);
    setFormData({
      type: item.type,
      category: item.category,
      amount: item.amount.toString(),
      description: item.description || '',
      frequency: item.frequency,
      interval: item.interval.toString(),
      nextDate: item.nextDate.split('T')[0],
      endDate: item.endDate ? item.endDate.split('T')[0] : '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!currentFamily) return;
    if (!confirm('确定要删除这条规则吗？')) return;
    try {
      await deleteRecurring(currentFamily.id, id);
      setList(list.filter((item) => item.id !== id));
      setDueList(dueList.filter((item) => item.id !== id));
    } catch (err: any) {
      alert(err.response?.data?.error || '删除失败');
    }
  };

  const handleExecute = async (id: string) => {
    if (!currentFamily) return;
    setExecutingId(id);
    try {
      const result = await executeRecurring(currentFamily.id, id);
      alert(result.message);
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || '执行失败');
    } finally {
      setExecutingId(null);
    }
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('zh-CN');
  const formatMoney = (amount: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);

  const categories = formData.type === 'INCOME' ? incomeCategories : expenseCategories;

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">定期记账</h1>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 新建规则
        </button>
      </div>

      {/* 到期规则卡片 */}
      {dueList.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-red-700 mb-4">
            到期规则（{dueList.length}）
          </h2>
          <div className="space-y-3">
            {dueList.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-lg p-4 flex justify-between items-center border-l-4 border-red-500"
              >
                <div>
                  <span className="text-sm font-medium text-gray-900">{item.category}</span>
                  <span className="text-sm text-gray-500 ml-2">
                    {item.type === 'INCOME' ? '收入' : '支出'} · {formatMoney(item.amount)}
                  </span>
                  <div className="text-xs text-red-600 mt-1">
                    到期日期：{formatDate(item.nextDate)}
                  </div>
                </div>
                <button
                  onClick={() => handleExecute(item.id)}
                  disabled={executingId === item.id}
                  className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700 disabled:opacity-50"
                >
                  {executingId === item.id ? '执行中...' : '立即执行'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 规则列表 */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">所有规则</h2>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="text-center py-12 text-gray-500">加载中...</div>
          ) : list.length === 0 ? (
            <div className="text-center py-12 text-gray-500">暂无规则，点击"新建规则"开始</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">类别</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">金额</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">频率</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">下次执行</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {list.map((item) => (
                    <tr key={item.id}>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            item.type === 'INCOME'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {item.type === 'INCOME' ? '收入' : '支出'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{item.category}</td>
                      <td className="px-6 py-4 text-sm text-right font-medium text-gray-900">
                        {formatMoney(item.amount)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {item.frequency === 'DAILY' ? '每天' : item.frequency === 'WEEKLY' ? '每周' : item.frequency === 'MONTHLY' ? '每月' : '每年'}
                        {item.interval > 1 ? ` ×${item.interval}` : ''}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{formatDate(item.nextDate)}</td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            item.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {item.isActive ? '生效中' : '已停用'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm">
                        <button
                          onClick={() => handleExecute(item.id)}
                          disabled={executingId === item.id || !item.isActive}
                          className="text-green-600 hover:text-green-900 mr-3 disabled:opacity-30"
                        >
                          执行
                        </button>
                        <button
                          onClick={() => handleEdit(item)}
                          className="text-indigo-600 hover:text-indigo-900 mr-3"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 新建/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{editingId ? '编辑' : '新建'}定期规则</h2>
            {error && <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                <select
                  value={formData.type}
                  onChange={(e) =>
                    setFormData({ ...formData, type: e.target.value as 'INCOME' | 'EXPENSE', category: '' })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="INCOME">收入</option>
                  <option value="EXPENSE">支出</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">类别</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">请选择</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">金额</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  inputMode="decimal"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">描述（可选）</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">频率</label>
                  <select
                    value={formData.frequency}
                    onChange={(e) =>
                      setFormData({ ...formData, frequency: e.target.value as typeof formData.frequency })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="DAILY">每天</option>
                    <option value="WEEKLY">每周</option>
                    <option value="MONTHLY">每月</option>
                    <option value="YEARLY">每年</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">间隔</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.interval}
                    onChange={(e) => setFormData({ ...formData, interval: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">下次执行日期</label>
                <input
                  type="date"
                  value={formData.nextDate}
                  onChange={(e) => setFormData({ ...formData, nextDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">结束日期（可选）</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
                >
                  {editingId ? '保存' : '创建'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
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

export default RecurringPage;
