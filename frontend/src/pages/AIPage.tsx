import { useState, useEffect, useRef } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  sendChat,
  getHistory,
  sendOCR,
  undoAction,
  type ConversationRecord,
  type ActionResult,
} from '../services/aiService';

/**
 * 压缩图片：将图片缩放到 maxWidth 以内，转为 JPEG base64
 * 避免 5MB+ 的手机照片直接上传导致 body too large / OCR 过慢
 */
async function compressImage(file: File, maxWidth: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  actions?: ActionResult[];
}

const actionTypeLabels: Record<string, string> = {
  create_income: '创建收入',
  create_expense: '创建支出',
  create_asset: '创建资产',
  create_liability: '创建负债',
  delete_income: '删除收入',
  delete_expense: '删除支出',
  delete_asset: '删除资产',
  delete_liability: '删除负债',
  query_income: '查询收入',
  query_expense: '查询支出',
  query_assets: '查询资产',
  query_liabilities: '查询负债',
};

const quickCommands = [
  '午饭花了50块',
  '本月工资15000',
  '收到租金3000元',
  '我有10万股票',
  '还有50万房贷',
  '查看本月支出',
];

export default function AIPage() {
  const { currentFamily } = useFamilyStore();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentFamily) {
      loadHistory();
    }
  }, [currentFamily]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadHistory = async () => {
    if (!currentFamily) return;
    try {
      const history = await getHistory(currentFamily.id);
      const formatted: Message[] = history
        .filter((h: ConversationRecord) => h.type === 'chat')
        .reverse()
        .flatMap((h: ConversationRecord) => [
          { role: 'user' as const, content: h.content },
          { role: 'assistant' as const, content: h.response || h.content },
        ]);
      setMessages(formatted);
    } catch {
      // ignore history load errors
    }
  };

  const handleSend = async (text?: string) => {
    const userMsg = (text || input).trim();
    if (!userMsg || !currentFamily) return;

    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setLoading(true);

    try {
      const { response, actions, aiConfigured: configured } = await sendChat(currentFamily.id, userMsg);
      setAiConfigured(configured);
      setMessages((prev) => [...prev, { role: 'assistant', content: response, actions }]);
    } catch (error: any) {
      let msg: string;
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        msg = 'AI 响应超时，请稍后重试。如果数据已记录，可以在对应页面查看。';
      } else if (error.response?.status === 429) {
        msg = '请求过于频繁，请稍等片刻再试。';
      } else if (error.response?.data?.error) {
        msg = error.response.data.error;
      } else if (!error.response) {
        msg = '网络连接失败，请检查后端服务是否正常运行。';
      } else {
        msg = '请求失败，请稍后重试';
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async (action: ActionResult, messageIdx: number) => {
    if (!currentFamily || !action.record?.id) return;

    setUndoingId(action.record.id);
    try {
      await undoAction(currentFamily.id, action.type, action.record.id);
      // 更新消息中的 action 状态
      setMessages((prev) => prev.map((msg, idx) => {
        if (idx !== messageIdx || !msg.actions) return msg;
        return {
          ...msg,
          actions: msg.actions.map((a) =>
            a.record?.id === action.record.id
              ? { ...a, status: 'error' as const, message: '已撤销' }
              : a
          ),
        };
      }));
    } catch (error: any) {
      alert(error.response?.data?.error || '撤销失败');
    } finally {
      setUndoingId(null);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentFamily) return;

    setImageLoading(true);
    try {
      // 先压缩图片，避免 base64 过大导致请求失败
      const base64 = await compressImage(file, 1600, 0.85);

      const { data } = await sendOCR(currentFamily.id, base64);
      const summary = data.amount
        ? `识别结果：\n- 金额：${data.amount} 元\n- 日期：${data.date || '-'}\n- 类别：${data.category || '-'}\n- 描述：${data.description || '-'}`
        : data.raw || '无法识别图片内容';

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `[上传图片: ${file.name}]` },
        { role: 'assistant', content: summary },
      ]);
    } catch (error: any) {
      const msg = error.response?.data?.error || '图片识别失败，请稍后重试';
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
    } finally {
      setImageLoading(false);
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
    <div className="max-w-3xl mx-auto h-[calc(100vh-140px)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">AI 财务助手</h2>
        {!aiConfigured && (
          <div className="flex items-center text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full">
            <span className="mr-1">⚠️</span>
            <span>AI 未配置，使用本地规则回复</span>
          </div>
        )}
        {aiConfigured && (
          <div className="flex items-center text-xs text-green-700 bg-green-50 px-3 py-1.5 rounded-full">
            <span className="mr-1">✓</span>
            <span>AI 服务已连接</span>
          </div>
        )}
      </div>

      <div className="flex-1 bg-white rounded-lg shadow border border-gray-200 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-8">
              <p className="text-lg">你好！我是你的家庭财务助手</p>
              <p className="mt-2">可以直接告诉我你的收支情况，我会帮你自动记账</p>
              <div className="mt-6 max-w-md mx-auto">
                <p className="text-sm font-medium text-gray-500 mb-2">试试这些指令：</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {quickCommands.map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => handleSend(cmd)}
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-sm hover:bg-indigo-100 transition-colors"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${msg.role === 'user' ? '' : 'w-full'}`}>
                <div
                  className={`px-4 py-2 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
                </div>
                {/* 操作结果卡片 */}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {msg.actions.map((action, actionIdx) => (
                      <div
                        key={actionIdx}
                        className={`px-3 py-2 rounded-lg border text-sm flex items-center justify-between ${
                          action.status === 'success'
                            ? 'bg-green-50 border-green-200 text-green-800'
                            : 'bg-red-50 border-red-200 text-red-800'
                        }`}
                      >
                        <div className="flex items-center">
                          <span className="mr-2">
                            {action.status === 'success' ? '✅' : '❌'}
                          </span>
                          <div>
                            <span className="text-xs font-medium text-gray-500 mr-2">
                              {actionTypeLabels[action.type] || action.type}
                            </span>
                            <span>{action.message}</span>
                          </div>
                        </div>
                        {/* 撤销按钮：仅创建操作且成功时显示 */}
                        {action.status === 'success' &&
                          action.type.startsWith('create_') &&
                          action.record?.id && (
                            <button
                              onClick={() => handleUndo(action, idx)}
                              disabled={undoingId === action.record.id}
                              className="ml-2 text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
                            >
                              {undoingId === action.record.id ? '撤销中...' : '撤销'}
                            </button>
                          )}
                      </div>
                    ))}
                    {/* 查询结果详情 */}
                    {msg.actions.map((action, actionIdx) =>
                      action.records && action.records.length > 0 ? (
                        <div key={`records-${actionIdx}`} className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                          <div className="text-xs text-gray-500 mb-2">记录详情：</div>
                          <div className="space-y-1">
                            {action.records.slice(0, 10).map((r: any, ri: number) => (
                              <div key={ri} className="text-sm text-gray-700 flex justify-between">
                                <span>
                                  {r.category || r.name || '-'}
                                  {r.description ? ` (${r.description})` : ''}
                                </span>
                                <span className="font-medium">
                                  ¥{Number(r.amount || r.value || 0).toFixed(2)}
                                </span>
                              </div>
                            ))}
                            {action.records.length > 10 && (
                              <div className="text-xs text-gray-400 text-center pt-1">
                                还有 {action.records.length - 10} 条记录...
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {(loading || imageLoading) && (
            <div className="flex justify-start">
              <div className="bg-gray-100 px-4 py-2 rounded-lg text-gray-500 text-sm">思考中...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-gray-200 p-4">
          <div className="flex items-center space-x-2">
            <label className="cursor-pointer px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-600">
              📷
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="输入消息，如：午饭花了50块"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
