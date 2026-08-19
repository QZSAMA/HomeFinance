import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  type Asset,
} from '../services/financeService';
import { refreshAllPrices } from '../services/marketDataService';

const assetTypes = [
  { value: 'CASH', label: '现金' },
  { value: 'STOCK', label: '股票' },
  { value: 'BOND', label: '长期国债' },
  { value: 'GOLD', label: '黄金' },
  { value: 'FUND', label: '基金' },
  { value: 'REAL_ESTATE', label: '房产' },
  { value: 'OTHER', label: '其他' },
];

// 投资类资产类型：拥有证券代码时支持行情刷新与市值追踪
const investableTypes = ['STOCK', 'BOND', 'GOLD', 'FUND'];

const initialFormData = {
  name: '',
  type: 'CASH',
  category: '',
  value: '',
  costBasis: '',
  currency: 'CNY',
  purchaseDate: '',
  description: '',
  // V3.3.4：证券代码、持有数量、单位
  symbol: '',
  quantity: '',
  unit: '份',
};

const AssetsPage = () => {
  const { currentFamily } = useFamilyStore();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState(initialFormData);

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

  // 刷新家庭所有可交易资产行情，刷新后重新加载资产列表
  const handleRefreshPrices = async () => {
    if (!currentFamily) return;
    setRefreshing(true);
    setError('');
    try {
      const result = await refreshAllPrices(currentFamily.id);
      await loadAssets();
      const detail =
        result.failed > 0
          ? `（成功 ${result.updated}，失败 ${result.failed}）`
          : `（已更新 ${result.updated} 项）`;
      alert(`行情刷新完成${detail}`);
    } catch (err: any) {
      setError(err.response?.data?.error || '行情刷新失败');
    } finally {
      setRefreshing(false);
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

    // 证券代码、持有数量、单位：投资类资产才需填写，但允许任意类型填写
    const payload = {
      name: formData.name,
      type: formData.type,
      category: formData.category || undefined,
      value,
      costBasis: formData.costBasis ? parseFloat(formData.costBasis) : undefined,
      currency: formData.currency,
      purchaseDate: formData.purchaseDate || undefined,
      description: formData.description || undefined,
      symbol: formData.symbol.trim() || undefined,
      quantity: formData.quantity ? parseFloat(formData.quantity) : undefined,
      unit: formData.unit || undefined,
    };

    try {
      if (editingId) {
        const updatedAsset = await updateAsset(currentFamily.id, editingId, payload);
        setAssets(assets.map((a) => (a.id === editingId ? updatedAsset : a)));
        setShowEditModal(false);
      } else {
        const newAsset = await createAsset(currentFamily.id, payload);
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
      symbol: asset.symbol || '',
      quantity: asset.quantity?.toString() || '',
      unit: asset.unit || '份',
    });
    setShowEditModal(true);
  };

  const resetForm = () => {
    setFormData(initialFormData);
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

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      maximumFractionDigits: 4,
    }).format(amount);
  };

  const formatPercent = (value: number) => {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const getAssetTypeLabel = (type: string) => {
    return assetTypes.find((t) => t.value === type)?.label || type;
  };

  // 市值：有 symbol+quantity+marketPrice 时用 marketPrice*quantity，否则回退 value
  const computeMarketValue = (asset: Asset): number => {
    if (asset.symbol && asset.quantity != null && asset.marketPrice != null) {
      return asset.marketPrice * asset.quantity;
    }
    return asset.value;
  };

  const isInvestable = (type: string) => investableTypes.includes(type);

  // 表格底部合计：所有资产行用 computeMarketValue 汇总
  const totalValue = assets.reduce((sum, a) => sum + computeMarketValue(a), 0);

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">资产管理</h1>
          <p className="text-gray-500 mt-1">
            总市值: <span className="font-bold text-indigo-600">{formatMoney(totalValue)}</span>
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRefreshPrices}
            disabled={refreshing}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="刷新所有可交易资产的最新行情"
          >
            {refreshing ? '刷新中...' : '🔄 刷新行情'}
          </button>
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
      </div>

      {error && (
        <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : assets.length === 0 ? (
          <div className="text-center py-12 text-gray-500">暂无资产记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    名称
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    类型
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    最新市价
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    涨跌幅
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    市值
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    成本
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assets.map((asset) => {
                  const hasMarketPrice =
                    asset.symbol != null &&
                    asset.quantity != null &&
                    asset.marketPrice != null;
                  const marketValue = computeMarketValue(asset);
                  return (
                    <tr key={asset.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{asset.name}</div>
                        {asset.symbol && (
                          <div className="text-xs text-gray-400">
                            {asset.symbol}
                            {asset.quantity != null && (
                              <span className="ml-1">
                                · {asset.quantity} {asset.unit || '份'}
                              </span>
                            )}
                          </div>
                        )}
                        {asset.description && (
                          <div className="text-sm text-gray-500">{asset.description}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs">
                          {getAssetTypeLabel(asset.type)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {hasMarketPrice ? formatPrice(asset.marketPrice!) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                        {asset.changePercent != null ? (
                          <span
                            className={
                              asset.changePercent > 0
                                ? 'text-green-600'
                                : asset.changePercent < 0
                                ? 'text-red-600'
                                : 'text-gray-500'
                            }
                          >
                            {formatPercent(asset.changePercent)}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-right text-gray-900">
                        {formatMoney(marketValue)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
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
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-6 py-3 text-right text-sm font-medium text-gray-700">
                    总市值
                  </td>
                  <td className="px-6 py-3 text-right text-sm font-bold text-indigo-600">
                    {formatMoney(totalValue)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
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
                  inputMode="decimal"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="请输入当前价值"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  证券代码（可选）
                </label>
                <input
                  type="text"
                  value={formData.symbol}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="如 sh600519、sz000001、hk00700"
                />
                {isInvestable(formData.type) && (
                  <p className="mt-1 text-xs text-gray-400">
                    投资类资产填写证券代码后可使用“刷新行情”获取最新市价与市值
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">持有数量</label>
                  <input
                    type="number"
                    step="0.0001"
                    inputMode="decimal"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="如 100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">单位</label>
                  <input
                    type="text"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="份"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">成本价（可选）</label>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
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
