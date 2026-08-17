import { useState, useEffect } from 'react';
import {
  getSupportedCurrencies,
  getRate,
  setManualRate,
  type ExchangeRate,
} from '../services/exchangeRateService';

const formatDateTime = (dateStr?: string) => {
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

const ExchangeRatePage = () => {
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [loadingCurrencies, setLoadingCurrencies] = useState(true);

  // 查询表单
  const [queryFrom, setQueryFrom] = useState('');
  const [queryTo, setQueryTo] = useState('');
  const [currentRate, setCurrentRate] = useState<ExchangeRate | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState('');

  // 手动录入表单
  const [manualForm, setManualForm] = useState({ from: '', to: '', rate: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const loadCurrencies = async () => {
      try {
        const data = await getSupportedCurrencies();
        setCurrencies(data);
        // 默认选择前两个货币，方便快速查询
        if (data.length >= 1 && !queryFrom) setQueryFrom(data[0]);
        if (data.length >= 2 && !queryTo) setQueryTo(data[1]);
        if (manualForm.from === '' && data.length > 0) {
          setManualForm((f) => ({ ...f, from: data[0] }));
        }
        if (manualForm.to === '' && data.length > 1) {
          setManualForm((f) => ({ ...f, to: data[1] }));
        }
      } catch (err: any) {
        setQueryError(err.response?.data?.error || '加载货币列表失败');
      } finally {
        setLoadingCurrencies(false);
      }
    };
    loadCurrencies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryFrom || !queryTo) {
      setQueryError('请选择源货币和目标货币');
      return;
    }
    setQueryLoading(true);
    setQueryError('');
    setCurrentRate(null);
    try {
      const data = await getRate(queryFrom, queryTo);
      setCurrentRate(data);
    } catch (err: any) {
      setQueryError(err.response?.data?.error || '查询汇率失败');
    } finally {
      setQueryLoading(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitMsg('');

    if (!manualForm.from || !manualForm.to) {
      setSubmitError('请选择源货币和目标货币');
      return;
    }
    if (manualForm.from === manualForm.to) {
      setSubmitError('源货币与目标货币不能相同');
      return;
    }
    const rate = parseFloat(manualForm.rate);
    if (isNaN(rate) || rate <= 0) {
      setSubmitError('请输入有效汇率（大于 0）');
      return;
    }

    setSubmitting(true);
    try {
      const result = await setManualRate({
        from: manualForm.from,
        to: manualForm.to,
        rate,
      });
      setSubmitMsg(
        `已保存 ${result.from} → ${result.to} = ${result.rate}（来源：${result.source === 'MANUAL' ? '手动' : '实时'}）`
      );
      // 若刚保存的汇率正好是当前查询项，自动刷新查询结果
      if (currentRate && queryFrom === result.from && queryTo === result.to) {
        setCurrentRate(result);
      }
    } catch (err: any) {
      setSubmitError(err.response?.data?.error || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">汇率管理</h1>

      {/* 支持的货币列表 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">支持的货币</h2>
        {loadingCurrencies ? (
          <div className="text-sm text-gray-500">加载中...</div>
        ) : currencies.length === 0 ? (
          <div className="text-sm text-gray-500">暂无可用货币</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {currencies.map((c) => (
              <span
                key={c}
                className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm font-mono"
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 查询汇率 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">查询汇率</h2>
          {queryError && (
            <div className="mb-4 text-red-700 text-sm bg-red-50 p-3 rounded">{queryError}</div>
          )}
          <form onSubmit={handleQuery} className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex-1 min-w-[100px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">源货币</label>
              <select
                value={queryFrom}
                onChange={(e) => setQueryFrom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              >
                <option value="">选择</option>
                {currencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="text-gray-400 pb-2">→</div>
            <div className="flex-1 min-w-[100px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">目标货币</label>
              <select
                value={queryTo}
                onChange={(e) => setQueryTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              >
                <option value="">选择</option>
                {currencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={queryLoading}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {queryLoading ? '查询中...' : '查询'}
            </button>
          </form>

          {currentRate && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
              <div className="text-sm text-gray-600 mb-1">
                {currentRate.from} → {currentRate.to}
              </div>
              <div className="text-3xl font-bold text-indigo-700">
                {currentRate.rate.toFixed(4)}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <span>
                  来源：{currentRate.source === 'MANUAL' ? '手动' : '实时'}
                </span>
                <span>更新于 {formatDateTime(currentRate.updatedAt)}</span>
              </div>
              <button
                type="button"
                onClick={(e) => handleQuery(e as unknown as React.FormEvent)}
                disabled={queryLoading}
                className="mt-3 text-sm text-indigo-600 hover:text-indigo-800"
              >
                ↻ 刷新
              </button>
            </div>
          )}
        </div>

        {/* 手动录入汇率 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">手动录入汇率</h2>
          {submitError && (
            <div className="mb-4 text-red-700 text-sm bg-red-50 p-3 rounded">{submitError}</div>
          )}
          {submitMsg && (
            <div className="mb-4 text-green-700 text-sm bg-green-50 p-3 rounded">{submitMsg}</div>
          )}
          <form onSubmit={handleManualSubmit}>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">源货币</label>
                <select
                  value={manualForm.from}
                  onChange={(e) => setManualForm({ ...manualForm, from: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                >
                  <option value="">选择</option>
                  {currencies.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">目标货币</label>
                <select
                  value={manualForm.to}
                  onChange={(e) => setManualForm({ ...manualForm, to: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                >
                  <option value="">选择</option>
                  {currencies.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">汇率</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                inputMode="decimal"
                value={manualForm.rate}
                onChange={(e) => setManualForm({ ...manualForm, rate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="例如 7.1234"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                1 {manualForm.from || '源'} = N {manualForm.to || '目标'}
              </p>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? '提交中...' : '提交'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ExchangeRatePage;
