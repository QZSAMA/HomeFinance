import api from './api';

// VAPID 公钥来自前端环境变量（与后端 VAPID_PUBLIC_KEY 配对）
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

// 当前浏览器是否支持 Web Push（Service Worker + PushManager）
export const isPushSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window;

// VAPID base64url 公钥转 Uint8Array（Web Push 协议要求）
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// 订阅浏览器推送：等待 SW 就绪 -> pushManager.subscribe -> 上报后端（幂等）
export const subscribeUser = async (vapidPublicKey?: string): Promise<boolean> => {
  if (!isPushSupported()) return false;
  const publicKey = vapidPublicKey || VAPID_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error('未配置 VITE_VAPID_PUBLIC_KEY，无法开启推送');
  }

  const registration = await navigator.serviceWorker.ready;
  // 已有订阅则直接复用，避免重复弹授权
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = subscription.toJSON();
  await api.post('/push-subscriptions', {
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    userAgent: navigator.userAgent,
  });
  return true;
};

// 取消推送订阅：本地退订 + 通知后端删除（后端幂等，不存在也返回成功）
export const unsubscribeUser = async (): Promise<boolean> => {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return true;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  await api.delete('/push-subscriptions', { data: { endpoint } });
  return true;
};

// 当前浏览器是否已存在推送订阅
export const getSubscriptionStatus = async (): Promise<boolean> => {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
};
