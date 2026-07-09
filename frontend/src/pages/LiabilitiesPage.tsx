import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getLiabilities,
  createLiability,
  deleteLiability,
  type Liability,
} from '../services/financeService';

const liabilityTypes = [
  { value: 'MORTGAGE', label: '房贷' },
  { value: 'CAR_LOAN', label: '车贷' },
  { value: 'STUDENT_LOAN', label: '助学贷款' },
  { value: 'CREDIT_CARD', label: '信用卡' },
  { value: 'PERSONAL_LOAN', label: '个人贷款' },
  { value: 'OTHER', label: '其他' },
];

const LiabilitiesPage = () => {
  const { currentFamily } = useFamilyStore();
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    type: 'MORTGAGE',
    amount: '',
    interestRate: '',
    startDate: '',
    endDate: '',
    currency: 'CNY',
    description: '',
  });

  useEffect(() => {
    if (currentFamily) {
      loadLiabilities();
    }
  }, [currentFamily]);

  const loadLiabilities = async () => {
    if (!currentFamily) return;
    setLoading(true);
    try {
      const data = await getLiabilities(currentFamily.id);
      setLiabilities(data);
    } catch (err) {
      setError('加载负债失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFamily) return;

    setError('');
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount < 0) {
      setError('请输入有效的负债金额');
      return;
    }
    if (!formData.name) {
      setError('请输入负债名称');
      return;
    }

    try {
      const newLiability = await createLiability(currentFamily.id, {
        name: formData.name,
        type: formData.type,
        amount,
        interestRate: formData.interestRate ? parseFloat(formData.interestRate) : undefined,
        startDate: formData.startDate || undefined,
        endDate: formData.endDate || undefined,
        currency: formData.currency,
        description: formData.description || undefined,
      });
      setLiabilities([newLiability, ...liabilities]);
      setShowAddModal(false);
      resetForm();
    } catch (err: any) {
      setError(err.response?.data?.error || '创建失败');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'MORTGAGE',
      amount: '',
      interestRate: '',
      startDate: '',
      endDate: '',
      currency: 'CNY',
      description: '',
    });
    setError('');
  };

  const handleDelete = async (id: string) => {
    if (!currentFamily) return;
    if (!confirm('确定要删除这项负债吗？')) return;

    try {
      await deleteLiability(currentFamily.id, id);
      setLiabilities(liabilities.filter((l) => l.id !== id));
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败');
    }
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);
  };

  const getLiabilityTypeLabel = (type: string) => {
    return liabilityTypes.find((t) => t.value === type)?.label || type;
  };

  const totalAmount = liabilities.reduce((sum, l) => sum + l.amount, 0);

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">负债管理</h1>
          <p className="text-gray-500 mt-1">
            总负债: <span className="font-bold text-red-600">{formatMoney(totalAmount)}</span>
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 新增负债
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : liabilities.length === 0 ? (
          <div className="text-center py-12 text-gray-500">暂无负债记录</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  名称
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  类型
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  金额
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  利率
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {liabilities.map((liability) => (
                <tr key={liability.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{liability.name}</div>
                    {liability.description && (
                      <div className="text-sm text-gray-500">{liability.description}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs">
                      {getLiabilityTypeLabel(liability.type)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-red-600">
                    {formatMoney(liability.amount)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {liability.interestRate ? `${liability.interestRate}%` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleDelete(liability.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">新增负债</h2>
            {error && <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">负债名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入负债名称"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">负债类型</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {liabilityTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入负债金额"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">年利率（可选）</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.interestRate}
                  onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="年利率，如 4.9"
                />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">结束日期</label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">备注（可选）</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                  placeholder="备注信息"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
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

export default LiabilitiesPage;
