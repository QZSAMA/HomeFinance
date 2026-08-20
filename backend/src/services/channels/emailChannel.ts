// V4.2 邮件通知渠道适配器
// 告警产生后由 notificationDispatcher 按用户偏好调用 sendEmail 投递
// SMTP 未配置时优雅降级返回 SKIPPED，不影响其他渠道

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import Handlebars from 'handlebars';
import { MAIL_CONFIG } from '../../config/mail';
import { NOTIFICATION_CONFIG } from '../../config/notification';

// ===== 共享类型（V4.3 pushChannel 等渠道适配器复用）=====

export interface ChannelRecipient {
  userId: string;
  email: string;
  name: string;
}

export interface ChannelMessage {
  alertType: string;
  severity: string;
  title: string;
  description: string;
  amount?: number;
  category?: string;
  familyId: string;
  familyName: string;
  alertId: string;
  createdAt: Date;
}

export interface ChannelResult {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  errorMessage?: string;
  messageId?: string;
}

// ===== severity 映射 =====

const SEVERITY_LABELS: Record<string, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: '#dc2626',
  MEDIUM: '#d97706',
  LOW: '#6b7280',
};

const DEFAULT_SEVERITY_COLOR = '#6b7280';

// ===== 邮件模板（内嵌 Handlebars 模板，避免运行时 .hbs 路径问题）=====

const EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<body style="margin:0;padding:0;background-color:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
    <div style="height:6px;background-color:{{severityColor}};"></div>
    <div style="padding:24px 32px;">
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{familyName}}</p>
      <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">{{title}}</h2>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#374151;">{{description}}</p>
      <div style="background-color:#f9fafb;border-radius:6px;padding:16px 16px;margin-bottom:24px;">
        {{#if amountFormatted}}
        <p style="margin:0 0 8px;font-size:14px;color:#374151;">金额：<strong style="color:{{severityColor}};">{{amountFormatted}}</strong></p>
        {{/if}}
        {{#if category}}
        <p style="margin:0 0 8px;font-size:14px;color:#374151;">品类：{{category}}</p>
        {{/if}}
        <p style="margin:0;font-size:14px;color:#374151;">时间：{{timeFormatted}}</p>
      </div>
      <a href="{{alertUrl}}" style="display:inline-block;padding:10px 24px;background-color:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;">查看告警详情</a>
    </div>
    <div style="padding:16px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">此邮件由 HomeFinance 自动发送，可在通知偏好设置中关闭邮件提醒。</p>
    </div>
  </div>
</body>
</html>`;

const renderEmailTemplate = Handlebars.compile(EMAIL_TEMPLATE);

// ===== 惰性 transport 单例（首次发送时创建）=====

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: MAIL_CONFIG.host,
      port: MAIL_CONFIG.port,
      secure: MAIL_CONFIG.secure,
      auth: { user: MAIL_CONFIG.user, pass: MAIL_CONFIG.pass },
    });
  }
  return transporter;
}

// ===== 工具函数 =====

function formatAmount(amount: number): string {
  return `¥${amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
}

// ===== 邮件渠道入口 =====

export async function sendEmail(
  recipient: ChannelRecipient,
  message: ChannelMessage
): Promise<ChannelResult> {
  if (!MAIL_CONFIG.host || !MAIL_CONFIG.user) {
    return { status: 'SKIPPED', errorMessage: 'SMTP 未配置' };
  }

  const severityLabel = SEVERITY_LABELS[message.severity] ?? message.severity;
  const severityColor = SEVERITY_COLORS[message.severity] ?? DEFAULT_SEVERITY_COLOR;
  const alertUrl = `${NOTIFICATION_CONFIG.appUrl}/alerts`;

  const html = renderEmailTemplate({
    familyName: message.familyName,
    severityLabel,
    severityColor,
    title: message.title,
    description: message.description,
    amountFormatted: message.amount != null ? formatAmount(message.amount) : undefined,
    category: message.category,
    timeFormatted: formatTime(message.createdAt),
    alertUrl,
  });

  try {
    const info = await getTransporter().sendMail({
      from: MAIL_CONFIG.from,
      to: recipient.email,
      subject: `[${severityLabel}] ${message.familyName} - ${message.title}`,
      html,
    });
    return { status: 'SENT', messageId: info.messageId };
  } catch (err) {
    const error = err as { message?: unknown };
    return { status: 'FAILED', errorMessage: String(error?.message || err) };
  }
}
