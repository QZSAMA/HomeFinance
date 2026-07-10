import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  type Asset,
} from '../services/financeService';

const assetTypes = [
  { value: 'CASH', label: '现金' },
  { value: 'STOCK', label: '股票' },
  { value: 'BOND', label: '长期国债' },
  { value: 'GOLD', label: '黄金' },
  { value: 'FUND', label: '基金' },
  { value: 'REAL_ESTATE', label: '房产' },
  { value: 'OTHER', label: '其他' },
];

const AssetsPage = () => {
  const { currentFamily } = useFamilyStore();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    type: 'CASH',
    category: '',
    value: '',
    costBasis: '',
    currency: 'CNY',
    purchaseDate: '',
    description: '',
  });

  useEffect(() => {
    if (currentFamily) {
      loadAssets();
    }
  }, [currentFamily]);

  const loadAssets = async () => {
    if (!currentFamily) return;
    setLoading(true);
    try {
      const data = await getAssets(currentFamily.id);
      setAssets(data);
    } catch (err) {
      setError('加载资产失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFamily) return;

    setError('');
    const value = parseFloat(formData.value);
    if (isNaN(value) || value < 0) {
      setError('请输入有效的资产价值');
      return;
    }
    if (!formData.name) {
      setError('请输入资产名称');
      return;
    }

    try {
      if (editingId) {
        const updatedAsset = await updateAsset(currentFamily.id, editingId, {
          name: formData.name,
          type: formData.type,
          category: formData.category || undefined,
          value,
          costBasis: formData.costBasis ? parseFloat(formData.costBasis) : undefined,
          currency: formData.currency,
          purchaseDate: formData.purchaseDate || undefined,
          description: formData.description || undefined,
        });
        setAssets(assets.map((a) => (a.id === editingId ? updatedAsset : a)));
        setShowEditModal(false);
      } else {
        const newAsset = await createAsset(currentFamily.id, {
          name: formData.name,
          type: formData.type,
          category: formData.category || undefined,
          value,
          costBasis: formData.costBasis ? parseFloat(formData.costBasis) : undefined,
          currency: formData.currency,
          purchaseDate: formData.purchaseDate || undefined,
          description: formData.description || undefined,
        });
        setAssets([newAsset, ...assets]);
        setShowAddModal(false);
      }
      resetForm();
    } catch (err: any) {
      setError(err.response?.data?.error || '操作失败');
    }
  };

  const handleEdit = (asset: Asset) => {
    setEditingId(asset.id);
    setFormData({
      name: asset.name,
      type: asset.type,
      category: asset.category || '',
      value: asset.value.toString(),
      costBasis: asset.costBasis?.toString() || '',
      currency: asset.currency,
      purchaseDate: asset.purchaseDate || '',
      description: asset.description || '',
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'CASH',
      category: '',
      value: '',
      costBasis: '',
      currency: 'CNY',
      purchaseDate: '',
      description: '',
    });
    setError('');
  };

  const handleDelete = async (id: string) => {
    if (!currentFamily) return;
    if (!confirm('确定要删除这项资产吗？')) return;

    try {
      await deleteAsset(currentFamily.id, id);
      setAssets(assets.filter((a) => a.id !== id));
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败');
    }
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);
  };

  const getAssetTypeLabel = (type: string) => {
    return assetTypes.find((t) => t.value === type)?.label || type;
  };

  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">资产管理</h1>
          <p className="text-gray-500 mt-1">
            总资产: <span className="font-bold text-indigo-600">{formatMoney(totalValue)}</span>
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 新增资产
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : assets.length === 0 ? (
          <div className="text-center py-12 text-gray-500">暂无资产记录</div>
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
                  当前价值
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  成本
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{asset.name}</div>
                    {asset.description && (
                      <div className="text-sm text-gray-500">{asset.description}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs">
                      {getAssetTypeLabel(asset.type)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {formatMoney(asset.value)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {asset.costBasis ? formatMoney(asset.costBasis) : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(asset)}
                      className="text-indigo-600 hover:text-indigo-900 mr-3"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(asset.id)}
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

      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">{showEditModal ? '编辑资产' : '新增资产'}</h2>
            {error && <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">资产名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入资产名称"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">资产类型</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {assetTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">当前价值</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入当前价值"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">成本价（可选）</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.costBasis}
                  onChange={(e) => setFormData({ ...formData, costBasis: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入成本价"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">购入日期（可选）</label>
                <input
                  type="date"
                  value={formData.purchaseDate}
                  onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
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

export default AssetsPage;
