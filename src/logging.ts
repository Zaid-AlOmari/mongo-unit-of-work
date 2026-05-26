export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogRecord {
  timestamp: string;
  level: Exclude<LogLevel, 'silent'>;
  namespace: string;
  message: string;
  context?: Record<string, unknown>;
}

export type LogHandler = (record: LogRecord) => void;

export interface LoggingOptions {
  level: LogLevel;
  handler?: LogHandler;
  getTimestamp?: () => string;
}

export interface PackageLogger {
  trace(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const levels: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 60,
};

const defaultTimestamp = () => new Date().toISOString();

let currentLevel: LogLevel = 'silent';
let currentHandler: LogHandler | undefined;
let currentTimestamp = defaultTimestamp;

export function configureLogging(options: LoggingOptions): void {
  currentLevel = options.level;
  currentHandler = options.handler;
  currentTimestamp = options.getTimestamp || defaultTimestamp;
}

export function resetLogging(): void {
  currentLevel = 'silent';
  currentHandler = undefined;
  currentTimestamp = defaultTimestamp;
}

export function createJsonLogHandler(writeLine: (line: string) => void): LogHandler {
  return record => writeLine(JSON.stringify(record));
}

export function getPackageLogger(namespace: string): PackageLogger {
  return {
    trace: (message, context) => writeLog('trace', namespace, message, context),
    debug: (message, context) => writeLog('debug', namespace, message, context),
    info: (message, context) => writeLog('info', namespace, message, context),
    warn: (message, context) => writeLog('warn', namespace, message, context),
    error: (message, context) => writeLog('error', namespace, message, context),
  };
}

function writeLog(
  level: Exclude<LogLevel, 'silent'>,
  namespace: string,
  message: string,
  context?: Record<string, unknown>
): void {
  if (levels[level] < levels[currentLevel]) return;
  if (!currentHandler) return;
  currentHandler({
    timestamp: currentTimestamp(),
    level,
    namespace,
    message,
    context,
  });
}
