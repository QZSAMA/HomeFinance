import { AsyncLocalStorage } from 'async_hooks';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  requestId?: string;
  meta?: unknown;
}

export interface ModuleLogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

const requestIdStorage = new AsyncLocalStorage<string | undefined>();

function writeLog(
  level: LogLevel,
  module: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
  };

  const requestId = requestIdStorage.getStore();
  if (requestId) {
    entry.requestId = requestId;
  }

  if (meta !== undefined) {
    entry.meta = meta;
  }

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createModuleLogger(moduleName: string): ModuleLogger {
  return {
    error: (message, meta) => writeLog('error', moduleName, message, meta),
    warn: (message, meta) => writeLog('warn', moduleName, message, meta),
    info: (message, meta) => writeLog('info', moduleName, message, meta),
    debug: (message, meta) => writeLog('debug', moduleName, message, meta),
  };
}

export const logger: ModuleLogger = createModuleLogger('app');

export function setRequestId(id: string): void {
  requestIdStorage.enterWith(id);
}

export function getRequestId(): string | undefined {
  return requestIdStorage.getStore() ?? undefined;
}

/** 内部使用：重置 requestId 上下文（主要用于测试隔离）。 */
export function _clearRequestId(): void {
  requestIdStorage.enterWith(undefined);
}
