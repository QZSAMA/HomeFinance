import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getImportSources,
  createImportSource,
  updateImportSource,
  deleteImportSource,
  syncImportSource,
  type ImportSource,
  type ImportSourceType,
  type ImportSourceInput,
} from '../services/importSourceService';

// 类型 → 中文名标签，与 ImportPage 的 FORMAT_OPTIONS 保持一致
const TYPE_LABELS: Record<ImportSourceType, string> = {
  alipay: '支付宝',
  wechat: '微信',
  cmb: '招商银行',
  icbc: '工商银行',
  boc: '中国银行',
};

const STATUS_LABELS: Record<ImportSource['syncStatus'], { label: string; cls: string }> = {
  IDLE: { label: '空闲', cls: 'bg-gray-100 text-gray-600' },
  RUNNING: { label: '同步中', cls: 'bg-blue-100 text-blue-700' },
  SUCCESS: { label: '已同步', cls: 'bg-green-100 text-green-700' },
  FAILED: { label: '失败', cls: 'bg-red-100 text-red-700' },
  DISABLED: { label: '已禁用', cls: 'bg-gray-100 text-gray-500' },
};

const formatDateTime = (dateStr?: string | null) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const ImportSourcesPage = () => {
  const { currentFamily } = useFamilyStore();
  const [list, setList] = useState<ImportSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'alipay' as ImportSourceType,
    watchPath: '',
  });

  const loadData = async () => {
    if (!currentFamily) return;
    setLoading(true);
    setError('');
    try {
      const data = await getImportSources(currentFamily.id);
      setList(data);
    } catch (err: any) {
      setError(err.response?.data?.error || '加载同步配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentFamily) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFamily]);

  const resetForm = () => {
    setFormData({ name: '', type: 'alipay', watchPath: '' });
    setEditingId(null);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFamily) return;
    setError('');

    if (!formData.name.trim()) {
      setError('请输入名称');
      return;
    }
    if (!formData.watchPath.trim()) {
      setError('请输入监听目录');
      return;
    }

    const payload: ImportSourceInput = {
      name: formData.name.trim(),
      type: formData.type,
      watchPath: formData.watchPath.trim(),
    };

    try {
      if (editingId) {
        const updated = await updateImportSource(currentFamily.id, editingId, payload);
        setList(list.map((it) => (it.id === editingId ? updated : it)));
      } else {
        const created = await createImportSource(currentFamily.id, payload);
        setList([created, ...list]);
      }
      resetForm();
      setShowModal(false);
    } catch (err: any) {
      setError(err.response?.data?.error || '保存失败');
    }
  };

  const handleEdit = (item: ImportSource) => {
    setEditingId(item.id);
    setFormData({ name: item.name, type: item.type, watchPath: item.watchPath });
    setError('');
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!currentFamily) return;
    if (!confirm('确定要删除这条同步配置吗？')) return;
    try {
      await deleteImportSource(currentFamily.id, id);
      setList(list.filter((it) => it.id !== id));
    } catch (err: any) {
      alert(err.response?.data?.error || '删除失败');
    }
  };

  const handleSync = async (id: string) => {
    if (!currentFamily) return;
    setSyncingId(id);
    try {
      const result = await syncImportSource(currentFamily.id, id);
      // 触发同步后立即重新加载列表，拿到最新 syncStatus / lastSyncedAt
      await loadData();
      const msg =
        result.message ||
        (result.status === 'SUCCESS'
          ? `同步成功${result.importedCount ? `，导入 ${result.importedCount} 条` : ''}`
          : '同步已完成');
      alert(msg);
    } catch (err: any) {
      alert(err.response?.data?.error || '同步失败');
    } finally {
      setSyncingId(null);
    }
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">同步配置</h1>
          <p className="text-sm text-gray-500 mt-1">
            管理家庭账单同步源，配置监听目录后可自动导入新增账单文件。
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 新建配置
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : list.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            暂无同步配置，点击右上角"新建配置"开始
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">监听目录</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">同步状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">最后同步时间</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {list.map((item) => {
                  const status = STATUS_LABELS[item.syncStatus] ?? STATUS_LABELS.IDLE;
                  return (
                    <tr key={item.id}>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {TYPE_LABELS[item.type] ?? item.type}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 font-mono">
                        {item.watchPath}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-2 py-1 rounded text-xs ${status.cls}`}>
                          {status.label}
                        </span>
                        {item.lastError && (
                          <div
                            className="text-xs text-red-500 mt-1 max-w-xs truncate"
                            title={item.lastError}
                          >
                            {item.lastError}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 whitespace-nowrap">
                        {formatDateTime(item.lastSyncedAt)}
                      </td>
                      <td className="px-6 py-4 text-right text-sm whitespace-nowrap">
                        <button
                          onClick={() => handleSync(item.id)}
                          disabled={syncingId === item.id}
                          className="text-green-600 hover:text-green-900 mr-3 disabled:opacity-50"
                        >
                          {syncingId === item.id ? '同步中...' : '同步'}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新建/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">{editingId ? '编辑配置' : '新建配置'}</h2>
            {error && (
              <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="例如：支付宝主账户"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as ImportSourceType })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">监听目录</label>
                <input
                  type="text"
                  value={formData.watchPath}
                  onChange={(e) => setFormData({ ...formData, watchPath: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="例如：/data/imports/alipay"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  后端将监听该目录下的新增账单文件并自动导入。
                </p>
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

export default ImportSourcesPage;
