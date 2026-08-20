// V4.2 邮件通知渠道单元测试
// Mock nodemailer（createTransport/sendMail），真实运行 Handlebars 模板渲染
// MAIL_CONFIG / NOTIFICATION_CONFIG 在 import 时读取 env，
// 因此每个测试前 resetModules + 设置 env 后动态 require 获取新模块实例

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

import type { ChannelMessage, ChannelRecipient } from './emailChannel';

type EmailChannelModule = typeof import('./emailChannel');

const loadEmailChannel = (): EmailChannelModule => require('./emailChannel');

const recipient: ChannelRecipient = {
  userId: 'user-1',
  email: 'alice@example.com',
  name: 'Alice',
};

const buildMessage = (overrides: Partial<ChannelMessage> = {}): ChannelMessage => ({
  alertType: 'LARGE_EXPENSE',
  severity: 'HIGH',
  title: '发现大额支出',
  description: '检测到一笔大额支出，请确认是否为预期消费。',
  amount: 1234.5,
  category: '餐饮',
  familyId: 'family-1',
  familyName: '我的家',
  alertId: 'alert-1',
  createdAt: new Date(2026, 7, 19, 10, 30),
  ...overrides,
});

const SMTP_ENV_KEYS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'APP_URL',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of SMTP_ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
});

afterAll(() => {
  for (const key of SMTP_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

beforeEach(() => {
  jest.resetModules();
  jest.resetAllMocks();
  process.env.SMTP_HOST = 'smtp.test.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_USER = 'smtp-user';
  process.env.SMTP_PASS = 'smtp-pass';
  process.env.SMTP_FROM = 'HomeFinance <noreply@homefinance.local>';
  process.env.APP_URL = 'http://app.test.com';
});

describe('sendEmail - SMTP 未配置', () => {
  test('SMTP_HOST 为空时返回 SKIPPED，不调用 sendMail', async () => {
    delete process.env.SMTP_HOST;
    const { sendEmail } = loadEmailChannel();

    const result = await sendEmail(recipient, buildMessage());

    expect(result.status).toBe('SKIPPED');
    expect(result.errorMessage).toBe('SMTP 未配置');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('SMTP_USER 为空时返回 SKIPPED，不调用 sendMail', async () => {
    delete process.env.SMTP_USER;
    const { sendEmail } = loadEmailChannel();

    const result = await sendEmail(recipient, buildMessage());

    expect(result.status).toBe('SKIPPED');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('SMTP 未配置时不创建 transport', async () => {
    delete process.env.SMTP_HOST;
    const { sendEmail } = loadEmailChannel();

    await sendEmail(recipient, buildMessage());

    const { createTransport } = require('nodemailer');
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe('sendEmail - 发送成功', () => {
  test('返回 SENT 并透传 messageId', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });
    const { sendEmail } = loadEmailChannel();

    const result = await sendEmail(recipient, buildMessage());

    expect(result).toEqual({ status: 'SENT', messageId: 'test-message-id' });
  });

  test('sendMail 收到正确的收件人、发件人、主题与 HTML', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });
    const { sendEmail } = loadEmailChannel();

    await sendEmail(recipient, buildMessage());

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailOptions = mockSendMail.mock.calls[0][0];
    expect(mailOptions.to).toBe('alice@example.com');
    expect(mailOptions.from).toBe('HomeFinance <noreply@homefinance.local>');
    expect(mailOptions.subject).toBe('[高] 我的家 - 发现大额支出');
    expect(mailOptions.html).toContain('发现大额支出');
    expect(mailOptions.html).toContain('检测到一笔大额支出，请确认是否为预期消费。');
    expect(mailOptions.html).toContain('http://app.test.com/alerts');
  });

  test('transport 惰性创建：首次发送时创建一次并复用', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });
    const { sendEmail } = loadEmailChannel();

    await sendEmail(recipient, buildMessage());
    await sendEmail(recipient, buildMessage());

    const { createTransport } = require('nodemailer');
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.test.com',
        port: 587,
        auth: expect.objectContaining({ user: 'smtp-user', pass: 'smtp-pass' }),
      })
    );
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });
});

describe('sendEmail - 发送失败', () => {
  test('sendMail 抛错时返回 FAILED 并记录 errorMessage', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP connection refused'));
    const { sendEmail } = loadEmailChannel();

    const result = await sendEmail(recipient, buildMessage());

    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toBe('SMTP connection refused');
  });

  test('sendMail reject 非 Error 值时 errorMessage 为字符串化结果', async () => {
    mockSendMail.mockRejectedValue('raw failure');
    const { sendEmail } = loadEmailChannel();

    const result = await sendEmail(recipient, buildMessage());

    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toBe('raw failure');
  });
});

describe('邮件主题格式', () => {
  test.each([
    ['HIGH', '[高]'],
    ['MEDIUM', '[中]'],
    ['LOW', '[低]'],
  ])('severity=%s 时主题前缀为 %s', async (severity, prefix) => {
    mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });
    const { sendEmail } = loadEmailChannel();

    await sendEmail(recipient, buildMessage({ severity }));

    const mailOptions = mockSendMail.mock.calls[0][0];
    expect(mailOptions.subject).toBe(`${prefix} 我的家 - 发现大额支出`);
  });
});

describe('HTML 模板渲染', () => {
  const sendAndGetHtml = async (message: ChannelMessage): Promise<string> => {
    mockSendMail.mockResolvedValue({ messageId: 'test-message-id' });
    const { sendEmail } = loadEmailChannel();
    await sendEmail(recipient, message);
    return mockSendMail.mock.calls[0][0].html as string;
  };

  test('渲染家庭名、标题与描述', async () => {
    const html = await sendAndGetHtml(buildMessage());
    expect(html).toContain('我的家');
    expect(html).toContain('发现大额支出');
    expect(html).toContain('检测到一笔大额支出，请确认是否为预期消费。');
  });

  test('渲染金额（¥ 千分位 + 两位小数）', async () => {
    const html = await sendAndGetHtml(buildMessage({ amount: 1234.5 }));
    expect(html).toContain('¥1,234.50');
  });

  test('无金额时不渲染金额行', async () => {
    const html = await sendAndGetHtml(buildMessage({ amount: undefined }));
    expect(html).not.toContain('¥');
    expect(html).not.toContain('金额');
  });

  test('有品类时渲染品类', async () => {
    const html = await sendAndGetHtml(buildMessage({ category: '餐饮' }));
    expect(html).toContain('餐饮');
  });

  test('无品类时不渲染品类行', async () => {
    const html = await sendAndGetHtml(buildMessage({ category: undefined }));
    expect(html).not.toContain('品类');
  });

  test('渲染格式化时间 YYYY-MM-DD HH:mm', async () => {
    const html = await sendAndGetHtml(
      buildMessage({ createdAt: new Date(2026, 7, 19, 10, 30) })
    );
    expect(html).toContain('2026-08-19 10:30');
  });

  test('包含"查看告警详情"按钮并链接到 appUrl/alerts', async () => {
    const html = await sendAndGetHtml(buildMessage());
    expect(html).toContain('查看告警详情');
    expect(html).toContain('href="http://app.test.com/alerts"');
  });

  test('HIGH 严重度使用红色色标', async () => {
    const html = await sendAndGetHtml(buildMessage({ severity: 'HIGH' }));
    expect(html).toContain('#dc2626');
  });

  test('MEDIUM 严重度使用黄色色标', async () => {
    const html = await sendAndGetHtml(buildMessage({ severity: 'MEDIUM' }));
    expect(html).toContain('#d97706');
  });

  test('LOW 严重度使用灰色色标', async () => {
    const html = await sendAndGetHtml(buildMessage({ severity: 'LOW' }));
    expect(html).toContain('#6b7280');
  });

  test('页脚包含 HomeFinance 自动发送提示', async () => {
    const html = await sendAndGetHtml(buildMessage());
    expect(html).toContain('自动发送');
  });
});
