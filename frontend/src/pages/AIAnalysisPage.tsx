import { useState } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import { getAnalysis } from '../services/aiService';

export default function AIAnalysisPage() {
  const { currentFamily } = useFamilyStore();
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!currentFamily) return;
    setLoading(true);
    setReport('');
    try {
      const { report: text } = await getAnalysis(currentFamily.id);
      setReport(text);
    } catch (error: any) {
      const msg = error.response?.data?.error || '生成报告失败，请稍后重试';
      setReport(`**错误**：${msg}`);
    } finally {
      setLoading(false);
    }
  };

  if (!currentFamily) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">请先选择一个家庭</h2>
        <p className="text-gray-500 mt-2">在顶部下拉框中选择或创建一个家庭</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">AI 财务分析</h2>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '生成中...' : '生成分析报告'}
        </button>
      </div>

      {report && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="prose max-w-none">
            {report.split('\n').map((line, idx) => {
              if (line.startsWith('## ')) {
                return (
                  <h3 key={idx} className="text-lg font-bold text-gray-900 mt-4 mb-2">
                    {line.replace('## ', '')}
                  </h3>
                );
              }
              if (line.startsWith('# ')) {
                return (
                  <h2 key={idx} className="text-xl font-bold text-gray-900 mt-4 mb-2">
                    {line.replace('# ', '')}
                  </h2>
                );
              }
              if (line.startsWith('- ')) {
                return (
                  <li key={idx} className="ml-4 text-gray-700 mb-1">
                    {line.replace('- ', '')}
                  </li>
                );
              }
              if (line.trim() === '') {
                return <div key={idx} className="h-2" />;
              }
              return (
                <p key={idx} className="text-gray-700 mb-2">
                  {line}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {!report && !loading && (
        <div className="text-center py-16 bg-white rounded-lg shadow border border-gray-200">
          <p className="text-gray-500 text-lg">点击上方按钮生成 AI 财务分析报告</p>
          <p className="text-gray-400 mt-2">报告将基于您家庭的资产、负债、收支数据进行分析</p>
        </div>
      )}

      {loading && (
        <div className="text-center py-16 bg-white rounded-lg shadow border border-gray-200">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto" />
            <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto" />
            <div className="h-4 bg-gray-200 rounded w-2/3 mx-auto" />
            <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto" />
          </div>
          <p className="text-gray-500 mt-4">AI 正在分析您的财务数据...</p>
        </div>
      )}
    </div>
  );
}
