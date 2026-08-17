import {
  logger,
  createModuleLogger,
  setRequestId,
  getRequestId,
  _clearRequestId,
} from './logger';

describe('logger', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    _clearRequestId();
  });

  afterEach(() => {
    _clearRequestId();
    jest.restoreAllMocks();
  });

  describe('logger.info', () => {
    test('输出 JSON 格式，包含 timestamp/level/module/message', () => {
      logger.info('用户登录成功');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output).toHaveProperty('timestamp');
      expect(typeof output.timestamp).toBe('string');
      expect(output.level).toBe('info');
      expect(output.module).toBe('app');
      expect(output.message).toBe('用户登录成功');
    });

    test('timestamp 为 ISO 格式', () => {
      logger.info('test');
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(() => new Date(output.timestamp).toISOString()).not.toThrow();
    });
  });

  describe('logger.error', () => {
    test('输出 level: "error" 并写入 stderr（console.error）', () => {
      logger.error('发生错误');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).not.toHaveBeenCalled();
      const output = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(output.level).toBe('error');
      expect(output.message).toBe('发生错误');
    });
  });

  describe('logger.warn / logger.debug', () => {
    test('warn 输出 level: "warn" 并写入 stdout', () => {
      logger.warn('警告信息');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.level).toBe('warn');
      expect(output.message).toBe('警告信息');
    });

    test('debug 输出 level: "debug" 并写入 stdout', () => {
      logger.debug('调试信息');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.level).toBe('debug');
      expect(output.message).toBe('调试信息');
    });
  });

  describe('createModuleLogger', () => {
    test('返回的 logger 预设 module', () => {
      const authLogger = createModuleLogger('auth');
      authLogger.info('用户登录');

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.module).toBe('auth');
    });

    test('不同模块 logger 的 module 互不影响', () => {
      const authLogger = createModuleLogger('auth');
      const dbLogger = createModuleLogger('database');

      authLogger.info('auth 事件');
      dbLogger.info('db 事件');

      const out1 = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const out2 = JSON.parse(consoleLogSpy.mock.calls[1][0]);
      expect(out1.module).toBe('auth');
      expect(out2.module).toBe('database');
    });

    test('模块 logger 同样支持 error 等级', () => {
      const authLogger = createModuleLogger('auth');
      authLogger.error('认证失败');

      const output = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(output.level).toBe('error');
      expect(output.module).toBe('auth');
    });
  });

  describe('meta 字段', () => {
    test('meta 字段正确输出', () => {
      logger.info('操作', { userId: 123, action: 'login' });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.meta).toEqual({ userId: 123, action: 'login' });
    });

    test('不传 meta 时不输出 meta 字段', () => {
      logger.info('简单消息');

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output).not.toHaveProperty('meta');
    });
  });

  describe('requestId 追踪', () => {
    test('setRequestId/getRequestId 正确存取', () => {
      setRequestId('test-uuid-123');
      expect(getRequestId()).toBe('test-uuid-123');
    });

    test('日志中包含 requestId 当已设置', () => {
      setRequestId('test-uuid-123');
      logger.info('操作');

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.requestId).toBe('test-uuid-123');
    });

    test('未设置 requestId 时日志中不包含 requestId 字段', () => {
      logger.info('操作');

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output).not.toHaveProperty('requestId');
    });

    test('替换 requestId 后日志反映新值', () => {
      setRequestId('first-id');
      logger.info('第一次操作');
      setRequestId('second-id');
      logger.info('第二次操作');

      const out1 = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      const out2 = JSON.parse(consoleLogSpy.mock.calls[1][0]);
      expect(out1.requestId).toBe('first-id');
      expect(out2.requestId).toBe('second-id');
    });
  });
});
