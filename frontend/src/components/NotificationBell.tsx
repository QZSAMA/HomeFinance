import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useFamilyStore } from '../store/useFamilyStore';
import { useNotificationStore } from '../store/useNotificationStore';
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  type NotificationDelivery,
} from '../services/notificationService';
import { markAllRead } from '../services/alertService';

// 渠道小图标：站内 / 邮件 / 推送
const CHANNEL_ICONS: Record<string, string> = {
  IN_APP: '💬',
  EMAIL: '📧',
  WEB_PUSH: '📣',
};

// severity 标签样式（与 AlertsPage 一致）
const SEVERITY_LABELS: Record<string, { label: string; cls: string }> = {
  HIGH: { label: '高', cls: 'bg-red-100 text-red-700' },
  MEDIUM: { label: '中', cls: 'bg-yellow-100 text-yellow-700' },
  LOW: { label: '低', cls: 'bg-gray-100 text-gray-600' },
};

// 未读数轮询间隔：60 秒
const POLL_INTERVAL = 60_000;

// 顶栏通知铃铛：未读徽章 + 最近通知 Popover + 60s 未读数轮询
const NotificationBell = () => {
  const { currentFamily } = useFamilyStore();
  const { unreadCount, setUnreadCount, decrementUnread } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationDelivery[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // 拉取最近 10 条通知（同时校正未读数）
  const loadList = useCallback(async () => {
    if (!currentFamily) return;
    setLoadingList(true);
    try {
      const data = await getNotifications(currentFamily.id, { limit: 10 });
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // 静默失败，不打扰用户
    } finally {
      setLoadingList(false);
    }
  }, [currentFamily, setUnreadCount]);

  // 60s 轮询未读数：页面不可见时跳过本轮，无家庭时不轮询
  useEffect(() => {
    if (!currentFamily) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const n = await getUnreadCount(currentFamily.id);
        if (!cancelled) setUnreadCount(n);
      } catch {
        // 轮询失败静默忽略，下一轮重试
      }
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [currentFamily, setUnreadCount]);

  // 点击组件外部关闭 Popover
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  // 打开面板时加载最近通知
  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  // 一键全部已读：复用告警 read-all 接口（家庭级）
  const handleMarkAllRead = async () => {
    if (!currentFamily || markingAll) return;
    setMarkingAll(true);
    try {
      await markAllRead(currentFamily.id);
      setUnreadCount(0);
      await loadList();
    } catch {
      // 失败保持现状，下次再试
    } finally {
      setMarkingAll(false);
    }
  };

  // 点击未读项：标记该通知对应告警已读并刷新列表
  const handleItemClick = async (item: NotificationDelivery) => {
    if (!currentFamily || markingId) return;
    if (item.alert?.isRead !== false) return;
    setMarkingId(item.id);
    try {
      await markNotificationRead(currentFamily.id, item.id);
      decrementUnread();
      await loadList();
    } catch {
      // 失败忽略，保持未读状态
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 text-gray-600 hover:text-gray-900 transition-colors"
        aria-label="通知"
      >
        <span className="text-xl leading-none">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[11px] font-medium leading-none rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden">
          {/* 头部：标题 + 全部已读 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-medium text-gray-900">通知</span>
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll || unreadCount === 0}
              className="text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {markingAll ? '处理中...' : '全部已读'}
            </button>
          </div>

          {/* 通知列表 */}
          <div className="max-h-80 overflow-y-auto">
            {loadingList ? (
              <div className="py-10 text-center text-sm text-gray-500">加载中...</div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-500">暂无通知</div>
            ) : (
              notifications.map((item) => {
                const severity =
                  SEVERITY_LABELS[item.alertSnapshot?.severity] ?? SEVERITY_LABELS.LOW;
                const unread = item.alert?.isRead === false;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`px-4 py-3 border-b border-gray-50 last:border-b-0 ${
                      unread ? 'bg-blue-50 cursor-pointer hover:bg-blue-100' : ''
                    }`}
                    title={unread ? '点击标记为已读' : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm leading-none" title={item.channel}>
                        {CHANNEL_ICONS[item.channel] ?? '💬'}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${severity.cls}`}>
                        {severity.label}
                      </span>
                      <span className="ml-auto text-xs text-gray-400">
                        {dayjs(item.sentAt || item.createdAt).format('MM-DD HH:mm')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900 mt-1.5 truncate">
                      {item.alertSnapshot?.title ?? '通知'}
                    </p>
                    {item.alertSnapshot?.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                        {item.alertSnapshot.description}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 底部：查看全部 */}
          <button
            onClick={() => {
              setOpen(false);
              navigate('/alerts');
            }}
            className="w-full py-2.5 text-center text-sm text-indigo-600 hover:text-indigo-700 hover:bg-gray-50 border-t border-gray-100 transition-colors"
          >
            查看全部
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
