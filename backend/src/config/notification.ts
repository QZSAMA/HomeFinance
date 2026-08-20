// 通知渠道通用配置（邮件 / Web Push / 站内）
// 未配置 SMTP 或 VAPID 时对应渠道自动降级（SKIPPED），不影响应用启动
export const NOTIFICATION_CONFIG = {
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  emailFrom: process.env.SMTP_FROM || 'noreply@homefinance.local',
  // 投递失败重试配置
  maxRetries: 3,
  retryDelayMs: 60_000,
  // 前端未读数轮询节流
  pollThrottleMs: 60_000,
};

export const isEmailConfigured = (): boolean => {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
};

export const isPushConfigured = (): boolean => {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
};
