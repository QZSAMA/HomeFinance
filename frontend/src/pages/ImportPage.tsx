import { useState } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  previewCSV,
  confirmImport,
  type ImportFormat,
  type ImportedTransaction,
} from '../services/importService';

const CATEGORY_OPTIONS = [
  '餐饮', '交通', '购物', '娱乐', '医疗', '教育', '住房', '水电', '通讯',
  '工资', '奖金', '投资收益', '兼职收入', '租金收入', '其他',
];

// 格式元数据：标签 + 列格式说明，用于下拉选项与帮助文本
const FORMAT_OPTIONS: { value: ImportFormat; label: string; description: string }[] = [
  { value: 'alipay', label: '支付宝', description: '支持列：交易号、商家订单号、交易创建时间、付款时间、最近修改时间、交易来源地、类型、对方、商品名称、金额（元）、收/支、交易状态' },
  { value: 'wechat', label: '微信', description: '支持列：交易时间、交易类型、交易对方、商品、收/支、金额（元）、支付方式、当前状态、交易单号、商户单号、备注' },
  { value: 'cmb', label: '招商银行', description: '支持列：交易日期、交易时间、交易金额、人民币金额、钞汇标志、交易摘要、交易渠道、对方账户、商户编号、交易附言' },
  { value: 'icbc', label: '工商银行', description: '支持列：交易日期、摘要、交易金额、余额、币种、对方账户、对方户名、交易类型、交易渠道、交易状态' },
  { value: 'boc', label: '中国银行', description: '支持列：交易日期、交易时间、摘要、交易金额、账户余额、币种、对方账号、对方户名、交易类型、交易渠道、备注' },
];

const ImportPage = () => {
  const { currentFamily } = useFamilyStore();
  const [format, setFormat] = useState<ImportFormat>('alipay');
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<ImportedTransaction[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  const selectedFormat = FORMAT_OPTIONS.find((o) => o.value === format)!;

  const handlePreview = async () => {
    if (!file) {
      setError('请先选择文件');
      return;
    }
    setError('');
    setSuccessMsg('');
    setParsing(true);
    try {
      const result = await previewCSV(currentFamily.id, file, format);
      setItems(result);
      if (result.length === 0) {
        setError('CSV 文件中未识别到任何交易记录');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '解析失败');
      setItems([]);
    } finally {
      setParsing(false);
    }
  };

  const handleItemChange = (idx: number, patch: Partial<ImportedTransaction>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleConfirm = async () => {
    if (items.length === 0) return;
    setError('');
    setSuccessMsg('');
    setImporting(true);
    try {
      const count = await confirmImport(currentFamily.id, items);
      setSuccessMsg(`成功导入 ${count} 条记录`);
      setItems([]);
      setFile(null);
    } catch (err: any) {
      setError(err.response?.data?.error || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">数据导入</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">账单格式</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ImportFormat)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">CSV 文件</label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setItems([]);
                setSuccessMsg('');
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
        {/* 当前格式说明 */}
        <div className="mb-4 text-xs text-gray-500 bg-gray-50 p-3 rounded border border-gray-100">
          <span className="font-medium text-gray-700">{selectedFormat.label}：</span>
          {selectedFormat.description}
        </div>
        <button
          onClick={handlePreview}
          disabled={!file || parsing}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {parsing ? '解析中...' : '解析预览'}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-red-700 text-sm bg-red-50 p-3 rounded">{error}</div>
      )}
      {successMsg && (
        <div className="mb-4 text-green-700 text-sm bg-green-50 p-3 rounded">{successMsg}</div>
      )}

      {items.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div className="text-sm text-gray-700">
              共识别 <span className="font-semibold">{items.length}</span> 条记录，可编辑类别后确认导入
            </div>
            <button
              onClick={handleConfirm}
              disabled={importing}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {importing ? '导入中...' : '确认导入'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">描述</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">类别</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">金额</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">{item.date}</td>
                    <td className="px-4 py-3 text-sm">
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
                    <td className="px-4 py-3 text-sm text-gray-700">{item.description}</td>
                    <td className="px-4 py-3 text-sm">
                      <select
                        value={item.category || ''}
                        onChange={(e) => handleItemChange(idx, { category: e.target.value })}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      >
                        <option value="">未分类</option>
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm text-right whitespace-nowrap font-medium">
                      ¥{item.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportPage;
