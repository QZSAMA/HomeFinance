import { useState, useEffect, useRef } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  sendChat,
  getHistory,
  sendOCR,
  undoAction,
  executeProposedActions,
  type ConversationRecord,
  type ActionResult,
  type AIAction,
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
  proposedActions?: AIAction[];
  rawText?: string;
  duplicateFlags?: boolean[];
}

interface ManualForm {
  type: 'expense' | 'income';
  amount: string;
  category: string;
  description: string;
  date: string;
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
  const [ocrProgress, setOcrProgress] = useState('');
  const [aiConfigured, setAiConfigured] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [confirmingIdx, setConfirmingIdx] = useState<number | null>(null);
  const [manualForms, setManualForms] = useState<Record<number, ManualForm>>({});
  const [manualSubmitting, setManualSubmitting] = useState<number | null>(null);
  // 行内可编辑的 proposedActions 副本：{ [messageIdx]: AIAction[] }
  const [editableActions, setEditableActions] = useState<Record<number, AIAction[]>>({});
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
    setOcrProgress('正在压缩图片...');
    try {
      // 先压缩图片，避免 base64 过大导致请求失败
      const base64 = await compressImage(file, 1600, 0.85);
      setOcrProgress('正在 OCR 识别 + AI 解析（约 10-30 秒）...');

      const { data, fileId, proposedActions, duplicateFlags } = await sendOCR(currentFamily.id, base64);
      const sourceLabel =
        data.source === 'vision' ? '[AI视觉]' :
        data.source === 'merged' ? '[合并]' : '[本地OCR]';

      // 优先用 proposedActions 数量生成摘要（多笔交易场景）
      let summary: string;
      if (proposedActions && proposedActions.length > 0) {
        const itemCount = proposedActions.length;
        const totalAmount = proposedActions.reduce((sum, a) => sum + Number(a.data.amount || 0), 0);
        const hasIncome = proposedActions.some(a => a.type === 'create_income');
        const hasExpense = proposedActions.some(a => a.type === 'create_expense');
        const typeText = hasIncome && hasExpense ? '收支混合' : hasIncome ? '收入' : '支出';
        summary = `识别结果 ${sourceLabel}：\n- 共 ${itemCount} 笔交易（${typeText}）\n- 合计金额：¥${totalAmount.toFixed(2)}${fileId ? '\n- 原图已归档' : ''}`;
      } else if (data.amount) {
        // 单条交易（旧格式兼容）
        const typeLabel = data.type === 'income' ? '收入' : data.type === 'expense' ? '支出' : '-';
        summary = `识别结果 ${sourceLabel}：\n- 类型：${typeLabel}\n- 金额：${data.amount} 元\n- 日期：${data.date || '-'}\n- 类别：${data.category || '-'}\n- 描述：${data.description || '-'}${fileId ? '\n- 原图已归档' : ''}`;
      } else {
        summary = data.raw || '无法识别图片内容';
      }

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `[上传图片: ${file.name}]` },
        {
          role: 'assistant',
          content: summary,
          proposedActions: proposedActions && proposedActions.length > 0 ? proposedActions : undefined,
          rawText: data.rawText,
          duplicateFlags,
        },
      ]);
    } catch (error: any) {
      const msg = error.response?.data?.error || '图片识别失败，请稍后重试';
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
    } finally {
      setImageLoading(false);
      setOcrProgress('');
    }
  };

  const handleConfirmActions = async (messageIdx: number) => {
    if (!currentFamily) return;
    const msg = messages[messageIdx];
    // 优先用编辑后的副本，回退到原始 proposedActions
    const actionsToConfirm = editableActions[messageIdx] || msg?.proposedActions;
    if (!actionsToConfirm || actionsToConfirm.length === 0) {
      alert('没有可确认的记账项');
      return;
    }

    setConfirmingIdx(messageIdx);
    try {
      const { actions } = await executeProposedActions(currentFamily.id, actionsToConfirm);
      // 确认成功：清空 proposedActions + editableActions，设置已执行的 actions
      setMessages((prev) => prev.map((m, idx) => {
        if (idx !== messageIdx) return m;
        return { ...m, proposedActions: undefined, actions };
      }));
      setEditableActions((prev) => {
        const next = { ...prev };
        delete next[messageIdx];
        return next;
      });
    } catch (error: any) {
      alert(error.response?.data?.error || '确认记账失败，请稍后重试');
    } finally {
      setConfirmingIdx(null);
    }
  };

  // 初始化某条消息的可编辑副本（首次渲染 proposedActions 时调用）
  const initEditable = (messageIdx: number, actions: AIAction[]) => {
    setEditableActions((prev) => {
      if (prev[messageIdx]) return prev; // 已初始化则不覆盖
      return { ...prev, [messageIdx]: actions.map((a) => ({ ...a, data: { ...a.data } })) };
    });
  };

  // 更新某条消息的第 actionIdx 个 action 的字段
  const updateEditableAction = (
    messageIdx: number,
    actionIdx: number,
    field: 'type' | 'amount' | 'category' | 'description' | 'date',
    value: string,
  ) => {
    setEditableActions((prev) => {
      const list = prev[messageIdx];
      if (!list || !list[actionIdx]) return prev;
      const next = [...list];
      const action = { ...next[actionIdx], data: { ...next[actionIdx].data } };
      if (field === 'type') {
        action.type = value === 'income' ? 'create_income' : 'create_expense';
      } else if (field === 'amount') {
        action.data.amount = Number(value) || 0;
      } else if (field === 'date') {
        if (value) action.data.date = value;
        else delete action.data.date;
      } else {
        action.data[field] = value || undefined;
      }
      next[actionIdx] = action;
      return { ...prev, [messageIdx]: next };
    });
  };

  // 删除某条消息的第 actionIdx 个 action
  const deleteEditableAction = (messageIdx: number, actionIdx: number) => {
    setEditableActions((prev) => {
      const list = prev[messageIdx];
      if (!list) return prev;
      const next = list.filter((_, i) => i !== actionIdx);
      const result = { ...prev };
      if (next.length === 0) delete result[messageIdx];
      else result[messageIdx] = next;
      return result;
    });
  };

  const updateManualForm = (idx: number, field: keyof ManualForm, value: string) => {
    setManualForms((prev) => {
      const existing: ManualForm = prev[idx] || {
        type: 'expense',
        amount: '',
        category: '',
        description: '',
        date: new Date().toISOString().slice(0, 10),
      };
      return { ...prev, [idx]: { ...existing, [field]: value } };
    });
  };

  const handleManualSubmit = async (messageIdx: number) => {
    if (!currentFamily) return;
    const form = manualForms[messageIdx];
    if (!form || !form.amount || Number(form.amount) <= 0) {
      alert('请填写有效金额');
      return;
    }

    const action: AIAction = {
      type: form.type === 'income' ? 'create_income' : 'create_expense',
      data: {
        amount: Number(form.amount),
        category: form.category || (form.type === 'income' ? '其他收入' : '其他支出'),
        ...(form.description ? { description: form.description } : {}),
        ...(form.date ? { date: form.date } : {}),
      },
    };

    setManualSubmitting(messageIdx);
    try {
      const { actions } = await executeProposedActions(currentFamily.id, [action]);
      setMessages((prev) => prev.map((m, idx) => {
        if (idx !== messageIdx) return m;
        return { ...m, rawText: undefined, actions };
      }));
      setManualForms((prev) => {
        const next = { ...prev };
        delete next[messageIdx];
        return next;
      });
    } catch (error: any) {
      alert(error.response?.data?.error || '手动记账失败，请稍后重试');
    } finally {
      setManualSubmitting(null);
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
                {/* 提议动作卡片（OCR 识别后待确认，行内可编辑） */}
                {msg.proposedActions && msg.proposedActions.length > 0 && (
                  <ProposedActionsCard
                    messageIdx={idx}
                    proposedActions={msg.proposedActions}
                    editableActions={editableActions}
                    initEditable={initEditable}
                    updateEditableAction={updateEditableAction}
                    deleteEditableAction={deleteEditableAction}
                    onConfirm={handleConfirmActions}
                    confirmingIdx={confirmingIdx}
                    duplicateFlags={msg.duplicateFlags}
                  />
                )}
                {/* 手动记账兜底：OCR 有文字但 AI 未识别出结构化信息时展示 */}
                {msg.role === 'assistant' && msg.rawText && !msg.proposedActions && !msg.actions && (
                  <div className="mt-2 p-3 rounded-lg border border-amber-200 bg-amber-50">
                    <p className="text-xs text-amber-700 mb-2">AI 未能自动识别，可手动填写后记账：</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <select
                        value={manualForms[idx]?.type || 'expense'}
                        onChange={(e) => updateManualForm(idx, 'type', e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                      >
                        <option value="expense">支出</option>
                        <option value="income">收入</option>
                      </select>
                      <input
                        type="number"
                        placeholder="金额"
                        value={manualForms[idx]?.amount || ''}
                        onChange={(e) => updateManualForm(idx, 'amount', e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                      <input
                        type="text"
                        placeholder="类别（如餐饮）"
                        value={manualForms[idx]?.category || ''}
                        onChange={(e) => updateManualForm(idx, 'category', e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                      <input
                        type="text"
                        placeholder="描述（可选）"
                        value={manualForms[idx]?.description || ''}
                        onChange={(e) => updateManualForm(idx, 'description', e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                      <input
                        type="date"
                        value={manualForms[idx]?.date || new Date().toISOString().slice(0, 10)}
                        onChange={(e) => updateManualForm(idx, 'date', e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                      <button
                        onClick={() => handleManualSubmit(idx)}
                        disabled={manualSubmitting === idx}
                        className="col-span-2 px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 transition-colors text-sm"
                      >
                        {manualSubmitting === idx ? '记账中...' : '手动记账'}
                      </button>
                    </div>
                  </div>
                )}
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
              <div className="bg-gray-100 px-4 py-2 rounded-lg text-gray-500 text-sm">
                {imageLoading && ocrProgress ? ocrProgress : '思考中...'}
              </div>
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

// 行内可编辑的 proposedActions 卡片（用 useEffect 初始化，避免 render 中 setState 导致 React #185）
function ProposedActionsCard({
  messageIdx,
  proposedActions,
  editableActions,
  initEditable,
  updateEditableAction,
  deleteEditableAction,
  onConfirm,
  confirmingIdx,
  duplicateFlags,
}: {
  messageIdx: number;
  proposedActions: AIAction[];
  editableActions: Record<number, AIAction[]>;
  initEditable: (idx: number, actions: AIAction[]) => void;
  updateEditableAction: (msgIdx: number, actionIdx: number, field: 'type' | 'amount' | 'category' | 'description' | 'date', value: string) => void;
  deleteEditableAction: (msgIdx: number, actionIdx: number) => void;
  onConfirm: (idx: number) => void;
  confirmingIdx: number | null;
  duplicateFlags?: boolean[];
}) {
  // 用 useEffect 初始化可编辑副本（不在 render 中调用 setState）
  useEffect(() => {
    if (!editableActions[messageIdx]) {
      initEditable(messageIdx, proposedActions);
    }
  }, [messageIdx, proposedActions, editableActions, initEditable]);

  const displayActions = editableActions[messageIdx] || proposedActions;
  if (displayActions.length === 0) return null;

  return (
    <div className="mt-2 p-3 rounded-lg border border-indigo-200 bg-indigo-50">
      <p className="text-xs text-indigo-700 mb-2">
        识别到 {displayActions.length} 笔交易，请核实后确认记账（可编辑/删除）：
      </p>
      <div className="space-y-2">
        {displayActions.map((action, actionIdx) => (
          <div
            key={actionIdx}
            className={`p-2 rounded bg-white border text-sm ${
              duplicateFlags?.[actionIdx] ? 'border-amber-400 bg-amber-50' : 'border-indigo-100'
            }`}
          >
            {duplicateFlags?.[actionIdx] && (
              <p className="text-xs text-amber-600 mb-1">⚠ 此条可能与已有记录重复</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <select
                value={action.type === 'create_income' ? 'income' : 'expense'}
                onChange={(e) => updateEditableAction(messageIdx, actionIdx, 'type', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="expense">支出</option>
                <option value="income">收入</option>
              </select>
              <input
                type="number"
                placeholder="金额"
                value={Number(action.data.amount || 0)}
                onChange={(e) => updateEditableAction(messageIdx, actionIdx, 'amount', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              />
              <input
                type="text"
                placeholder="类别"
                value={action.data.category || ''}
                onChange={(e) => updateEditableAction(messageIdx, actionIdx, 'category', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              />
              <input
                type="text"
                placeholder="描述"
                value={action.data.description || ''}
                onChange={(e) => updateEditableAction(messageIdx, actionIdx, 'description', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              />
              <input
                type="date"
                value={action.data.date || ''}
                onChange={(e) => updateEditableAction(messageIdx, actionIdx, 'date', e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              />
              <button
                onClick={() => deleteEditableAction(messageIdx, actionIdx)}
                className="px-2 py-1 text-xs text-red-600 border border-red-300 rounded hover:bg-red-50"
              >
                删除此条
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => onConfirm(messageIdx)}
          disabled={confirmingIdx === messageIdx || displayActions.length === 0}
          className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {confirmingIdx === messageIdx ? '记账中...' : `确认全部记账（${displayActions.length} 笔）`}
        </button>
      </div>
    </div>
  );
}
