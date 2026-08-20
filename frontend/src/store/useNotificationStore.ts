import { create } from 'zustand';

// 全局通知未读数：铃铛轮询更新，AlertsPage 等其他组件可共享读取
interface NotificationStore {
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  decrementUnread: () => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  unreadCount: 0,
  setUnreadCount: (n) => set({ unreadCount: n }),
  decrementUnread: () =>
    set((state) => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),
  clear: () => set({ unreadCount: 0 }),
}));
