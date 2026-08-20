import { useState, useEffect } from 'react';
import { useFamilyStore } from '../store/useFamilyStore';
import {
  getAlerts,
  detectAnomalies,
  markRead,
  markAllRead,
  TYPE_LABELS,
  type AnomalyAlert,
} from '../services/alertService';
import { getNotifications, type NotificationDelivery } from '../services/notificationService';

// severity 展示样式：HIGH 红 / MEDIUM 黄 / LOW 灰
const SEVERITY_LABELS: Record<AnomalyAlert['severity'], { label: string; cls: string }> = {
  HIGH: { label: '高', cls: 'bg-red-100 text-red-700' },
  MEDIUM: { label: '中', cls: 'bg-yellow-100 text-yellow-700' },
  LOW: { label: '低', cls: 'bg-gray-100 text-gray-600' },
};

// severity 排序权重：HIGH 在前，MEDIUM 次之，LOW 最后
const SEVERITY_ORDER: Record<AnomalyAlert['severity'], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

type FilterTab = 'all' | 'unread' | 'read';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'read', label: '已读' },
];

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount);

// 时间格式化为 YYYY-MM-DD HH:mm
const formatDateTime = (dateStr: string) => {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 排序：severity HIGH->MEDIUM->LOW，同 severity 按 createdAt 倒序
const sortBySeverity = (alerts: AnomalyAlert[]) =>
  [...alerts].sort((a, b) => {
    const sevDiff =
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

// V4.5：渠道图标与标签（投递状态展示用）
const DELIVERY_CHANNELS: Record<string, { icon: string; label: string }> = {
  IN_APP: { icon: '💬', label: '站内' },
  EMAIL: { icon: '📧', label: '邮件' },
  WEB_PUSH: { icon: '📣', label: '推送' },
};

// V4.5：按 alertId 聚合投递记录，用于告警卡片展示渠道投递状态
const buildDeliveryMap = (list: NotificationDelivery[]) => {
  const map = new Map<string, NotificationDelivery[]>();
  for (const item of list) {
    const key = item.alertId || item.alertSnapshot?.alertId;
    if (!key) continue;
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return map;
};

// V4.5：渠道投递状态小图标（✓ 送达 / ✗ 失败，SKIPPED 跳过的不展示）
const renderDeliveryBadges = (list?: NotificationDelivery[]) => {
  const items = (list ?? []).filter((d) => d.status !== 'SKIPPED');
  if (items.length === 0) return null;
  return (
    <span className="flex items-center gap-2">
      {items.map((d) => {
        const channel = DELIVERY_CHANNELS[d.channel];
        const failed = d.status === 'FAILED';
        const label = channel?.label ?? d.channel;
        return (
          <span
            key={d.id}
            title={failed ? `${label}投递失败` : `${label}已送达`}
            className={`text-xs ${failed ? 'text-red-500' : 'text-gray-400'}`}
          >
            {channel?.icon ?? '💬'}
            {failed ? '✗' : '✓'}
          </span>
        );
      })}
    </span>
  );
};

const AlertsPage = () => {
  const { currentFamily } = useFamilyStore();
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // V4.5：alertId -> 投递记录列表，用于卡片右下角投递状态展示
  const [deliveryMap, setDeliveryMap] = useState<Map<string, NotificationDelivery[]>>(new Map());
  const [filter, setFilter] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [detectMessage, setDetectMessage] = useState('');

  const loadData = async (tab: FilterTab) => {
    if (!currentFamily) return;
    setLoading(true);
    setError('');
    try {
      const isRead = tab === 'unread' ? false : tab === 'read' ? true : undefined;
      // V4.5：并行拉取通知投递记录（仅展示增强，失败不影响主流程）
      const [data, deliveryData] = await Promise.all([
        getAlerts(currentFamily.id, isRead),
        getNotifications(currentFamily.id, { limit: 50 }).catch(() => null),
      ]);
      setAlerts(sortBySeverity(data.alerts));
      setUnreadCount(data.unreadCount);
      setDeliveryMap(buildDeliveryMap(deliveryData?.notifications ?? []));
    } catch (err: any) {
      setError(err.response?.data?.error || '加载告警失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentFamily) loadData(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFamily, filter]);

  // 单条点击标记已读（仅未读时调用）
  const handleMarkRead = async (item: AnomalyAlert) => {
    if (!currentFamily || item.isRead || markingId) return;
    setMarkingId(item.id);
    try {
      await markRead(currentFamily.id, item.id);
      setAlerts((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, isRead: true } : it))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err: any) {
      window.alert(err.response?.data?.error || '标记已读失败');
    } finally {
      setMarkingId(null);
    }
  };

  // 一键全部已读
  const handleMarkAllRead = async () => {
    if (!currentFamily) return;
    setMarkingAll(true);
    try {
      await markAllRead(currentFamily.id);
      await loadData(filter);
    } catch (err: any) {
      alert(err.response?.data?.error || '操作失败');
    } finally {
      setMarkingAll(false);
    }
  };

  // 立即检测：触发后端规则检测并刷新列表
  const handleDetect = async () => {
    if (!currentFamily) return;
    setDetecting(true);
    setDetectMessage('');
    try {
      const result = await detectAnomalies(currentFamily.id);
      await loadData(filter);
      setDetectMessage(
        result.saved > 0
          ? `检测完成，新增 ${result.saved} 条告警`
          : '检测完成，未发现新的异常'
      );
    } catch (err: any) {
      alert(err.response?.data?.error || '检测失败');
    } finally {
      setDetecting(false);
    }
  };

  if (!currentFamily) {
    return <div className="text-center py-12 text-gray-500">请先选择或创建一个家庭</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">告警中心</h1>
          <p className="text-sm text-gray-500 mt-1">
            自动检测大额支出、频率异常、品类突变、重复扣款等异常情况。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {detecting ? '检测中...' : '立即检测'}
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {markingAll ? '处理中...' : '一键全部已读'}
            </button>
          )}
        </div>
      </div>

      {/* 筛选 tab */}
      <div className="flex gap-2 mb-4">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              filter === tab.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {tab.label}
            {tab.key === 'unread' && unreadCount > 0 && (
              <span className={`ml-1.5 text-xs ${filter === 'unread' ? 'text-white' : 'text-red-600'}`}>
                ({unreadCount})
              </span>
            )}
          </button>
        ))}
      </div>

      {detectMessage && (
        <div className="mb-4 text-sm text-green-700 bg-green-50 px-4 py-2.5 rounded-lg">
          {detectMessage}
        </div>
      )}
      {error && (
        <div className="mb-4 text-red-600 text-sm bg-red-50 p-3 rounded">{error}</div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-lg shadow text-center py-12 text-gray-500">
            加载中...
          </div>
        ) : alerts.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-12 text-gray-500">
            暂无告警，一切正常
          </div>
        ) : (
          alerts.map((item) => {
            const severity = SEVERITY_LABELS[item.severity] ?? SEVERITY_LABELS.LOW;
            const amountNum = item.amount == null ? null : Number(item.amount);
            return (
              <div
                key={item.id}
                onClick={() => handleMarkRead(item)}
                className={`bg-white rounded-lg shadow p-4 transition-colors ${
                  item.isRead ? '' : 'cursor-pointer hover:bg-gray-50'
                }`}
                title={item.isRead ? undefined : '点击标记为已读'}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${severity.cls}`}>
                      {severity.label}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">
                      {TYPE_LABELS[item.type] ?? item.type}
                    </span>
                    {item.category && (
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                        {item.category}
                      </span>
                    )}
                  </div>
                  {!item.isRead && (
                    <span
                      className="mt-1 w-2.5 h-2.5 rounded-full bg-red-500 shrink-0"
                      aria-label="未读"
                    />
                  )}
                </div>
                <p className="text-sm font-medium text-gray-900 mt-2">{item.title}</p>
                <p className="text-sm text-gray-500 mt-1">{item.description}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-400">{formatDateTime(item.createdAt)}</span>
                  <div className="flex items-center gap-3">
                    {renderDeliveryBadges(deliveryMap.get(item.id))}
                    {amountNum != null && !isNaN(amountNum) && (
                      <span className="text-red-600 font-medium text-sm">
                        {formatMoney(amountNum)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AlertsPage;
