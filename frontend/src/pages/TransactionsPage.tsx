import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getIncomes,
  getExpenses,
  createIncome,
  createExpense,
  updateIncome,
  updateExpense,
  deleteIncome,
  deleteExpense,
  checkIncomeDuplicate,
  checkExpenseDuplicate,
  type Income,
  type Expense,
} from '../services/financeService';

const TransactionsPage = () => {
  const { currentFamily } = useFamilyStore();
  const [activeTab, setActiveTab] = useState<'income' | 'expense'>('income');
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    amount: '',
    category: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    source: '',
    paymentMethod: '',
  });
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [error, setError] = useState('');

  const incomeCategories = ['工资', '奖金', '投资收益', '兼职收入', '租金收入', '其他收入'];
  const expenseCategories = ['餐饮', '交通', '购物', '娱乐', '医疗', '教育', '住房', '水电', '通讯', '其他支出'];

  useEffect(() => {
    if (currentFamily) {
      loadData();
    }
  }, [currentFamily, activeTab]);

  const loadData = async () => {
    if (!currentFamily) return;
    setLoading(true);
    try {
      if (activeTab === 'income') {
        const data = await getIncomes(currentFamily.id);
        setIncomes(data);
      } else {
        const data = await getExpenses(currentFamily.id);
        setExpenses(data);
      }
    } catch (err) {
      setError('加载数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const checkDuplicate = async () => {
    if (!currentFamily || !formData.amount || !formData.date) return;
    
    const amount = parseFloat(formData.amount);
    if (isNaN(amount)) return;

    try {
      const data = { amount, date: formData.date, description: formData.description };
      let result;
      if (activeTab === 'income') {
        result = await checkIncomeDuplicate(currentFamily.id, data);
      } else {
        result = await checkExpenseDuplicate(currentFamily.id, data);
      }
      if (result.hasDuplicate) {
        setDuplicateWarning('检测到可能的重复记录，请确认是否继续提交');
      } else {
        setDuplicateWarning(null);
      }
    } catch (err) {
      console.error('检测重复失败:', err);
    }
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

    try {
      if (activeTab === 'income') {
        if (editingId) {
          const updatedIncome = await updateIncome(currentFamily.id, editingId, {
            amount,
            category: formData.category,
            description: formData.description || undefined,
            date: formData.date,
            source: formData.source || undefined,
          });
          setIncomes(incomes.map((item) => (item.id === editingId ? updatedIncome : item)));
          setShowEditModal(false);
        } else {
          const newIncome = await createIncome(currentFamily.id, {
            amount,
            category: formData.category,
            description: formData.description || undefined,
            date: formData.date,
            source: formData.source || undefined,
          });
          setIncomes([newIncome, ...incomes]);
          setShowAddModal(false);
        }
      } else {
        if (editingId) {
          const updatedExpense = await updateExpense(currentFamily.id, editingId, {
            amount,
            category: formData.category,
            description: formData.description || undefined,
            date: formData.date,
            paymentMethod: formData.paymentMethod || undefined,
          });
          setExpenses(expenses.map((item) => (item.id === editingId ? updatedExpense : item)));
          setShowEditModal(false);
        } else {
          const newExpense = await createExpense(currentFamily.id, {
            amount,
            category: formData.category,
            description: formData.description || undefined,
            date: formData.date,
            paymentMethod: formData.paymentMethod || undefined,
          });
          setExpenses([newExpense, ...expenses]);
          setShowAddModal(false);
        }
      }
      resetForm();
    } catch (err: any) {
      setError(err.response?.data?.error || '提交失败');
    }
  };

  const handleEdit = (item: Income | Expense) => {
    setEditingId(item.id);
    setFormData({
      amount: item.amount.toString(),
      category: item.category,
      description: item.description || '',
      date: item.date,
      source: 'source' in item ? item.source || '' : '',
      paymentMethod: 'paymentMethod' in item ? item.paymentMethod || '' : '',
    });
    setShowEditModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!currentFamily) return;
    if (!confirm('确定要删除这条记录吗？')) return;

    try {
      if (activeTab === 'income') {
        await deleteIncome(currentFamily.id, id);
        setIncomes(incomes.filter((item) => item.id !== id));
      } else {
        await deleteExpense(currentFamily.id, id);
        setExpenses(expenses.filter((item) => item.id !== id));
      }
    } catch (err: any) {
      alert(err.response?.data?.error || '删除失败');
    }
  };

  const resetForm = () => {
    setFormData({
      amount: '',
      category: '',
      description: '',
      date: new Date().toISOString().split('T')[0],
      source: '',
      paymentMethod: '',
    });
    setDuplicateWarning(null);
    setError('');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN');
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">交易记录</h1>
        <button
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 新增记录
        </button>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab('income')}
              className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${
                activeTab === 'income'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              收入
            </button>
            <button
              onClick={() => setActiveTab('expense')}
              className={`py-4 px-6 text-center border-b-2 font-medium text-sm ${
                activeTab === 'expense'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              支出
            </button>
          </nav>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-12 text-gray-500">加载中...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      日期
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      类别
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      描述
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      金额
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {activeTab === 'income'
                    ? incomes.map((item) => (
                        <tr key={item.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDate(item.date)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.category}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {item.description || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-green-600">
                            +{formatMoney(item.amount)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
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
                      ))
                    : expenses.map((item) => (
                        <tr key={item.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDate(item.date)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {item.category}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {item.description || '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-red-600">
                            -{formatMoney(item.amount)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
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
              {((activeTab === 'income' && incomes.length === 0) ||
                (activeTab === 'expense' && expenses.length === 0)) && (
                <div className="text-center py-12 text-gray-500">暂无记录</div>
              )}
            </div>
          )}
        </div>
      </div>

      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {showEditModal ? '编辑' : '新增'}{activeTab === 'income' ? '收入' : '支出'}
            </h2>
            {error && <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>}
            {duplicateWarning && (
              <div className="mb-4 text-yellow-700 text-sm bg-yellow-50 p-3 rounded">
                ⚠️ {duplicateWarning}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">金额</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => {
                    setFormData({ ...formData, amount: e.target.value });
                    setDuplicateWarning(null);
                  }}
                  onBlur={checkDuplicate}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入金额"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">类别</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">请选择类别</option>
                  {(activeTab === 'income' ? incomeCategories : expenseCategories).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => {
                    setFormData({ ...formData, date: e.target.value });
                    setDuplicateWarning(null);
                  }}
                  onBlur={checkDuplicate}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {activeTab === 'income' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">来源</label>
                  <input
                    type="text"
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="收入来源（可选）"
                  />
                </div>
              )}
              {activeTab === 'expense' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">支付方式</label>
                  <input
                    type="text"
                    value={formData.paymentMethod}
                    onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="支付方式（可选）"
                  />
                </div>
              )}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => {
                    setFormData({ ...formData, description: e.target.value });
                    setDuplicateWarning(null);
                  }}
                  onBlur={checkDuplicate}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                  placeholder="描述信息（可选）"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setShowEditModal(false);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
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

export default TransactionsPage;
