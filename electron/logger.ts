import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export interface GlobalLoggerConfig {
  minLevel?: LogLevel;
  useColors?: boolean;
  writeToFile?: boolean;
  logFilePath?: string;
  maxFileSizeBytes?: number;
  maxBackupFiles?: number;
  consoleEnabled?: boolean;
  errorConsoleOnlyInProduction?: boolean;
}

export interface ILogger {
  readonly scope: string;
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, errorOrMeta?: unknown): void;
  withScope(subScope: string): ILogger;
}

const DEFAULT_CONFIG: Required<GlobalLoggerConfig> = {
  minLevel: 'info',
  useColors: true,
  writeToFile: false,
  logFilePath: '',
  maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
  maxBackupFiles: 3,
  consoleEnabled: true,
  errorConsoleOnlyInProduction: false,
};

let currentConfig: Required<GlobalLoggerConfig> = { ...DEFAULT_CONFIG };

export function resetLoggerState(): void {
  currentConfig = { ...DEFAULT_CONFIG };
}

export function configureGlobalLogger(
  config: Partial<GlobalLoggerConfig>,
): void {
  currentConfig = {
    ...currentConfig,
    ...config,
  };
}

export function getEffectiveLogLevel(): LogLevel {
  const envLevel = process.env.PLUTO_LOG_LEVEL?.toLowerCase();
  if (
    envLevel === 'debug' ||
    envLevel === 'info' ||
    envLevel === 'warn' ||
    envLevel === 'error' ||
    envLevel === 'silent'
  ) {
    return envLevel;
  }
  return currentConfig.minLevel;
}

function shouldLog(level: LogLevel): boolean {
  const effectiveMin = getEffectiveLogLevel();
  if (effectiveMin === 'silent') return false;
  return LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[effectiveMin];
}

function formatTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  redBold: '\x1b[1;31m',
};

function formatLevel(level: LogLevel, useColors: boolean): string {
  const upper = level.toUpperCase().padEnd(5, ' ');
  if (!useColors) return upper;

  switch (level) {
    case 'debug':
      return `${ANSI.magenta}${upper}${ANSI.reset}`;
    case 'info':
      return `${ANSI.green}${upper}${ANSI.reset}`;
    case 'warn':
      return `${ANSI.yellow}${upper}${ANSI.reset}`;
    case 'error':
      return `${ANSI.redBold}${upper}${ANSI.reset}`;
    default:
      return upper;
  }
}

function serializeMeta(meta: unknown, indent = false): string {
  if (meta === undefined) return '';

  if (meta instanceof Error) {
    if (meta.stack) {
      return indent
        ? `\n  ${meta.stack.replace(/\n/g, '\n  ')}`
        : `\n${meta.stack}`;
    }
    return ` Error: ${meta.message}`;
  }

  if (typeof meta === 'object' && meta !== null) {
    try {
      const inspectStr = util.inspect(meta, {
        depth: 4,
        colors: false,
        breakLength: 120,
        compact: true,
      });
      return ` ${inspectStr}`;
    } catch {
      return ' [Unserializable Object]';
    }
  }

  return ` ${String(meta)}`;
}

function rotateFileLogs(filePath: string, maxBackups: number): void {
  try {
    for (let i = maxBackups; i >= 1; i--) {
      const source = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const target = `${filePath}.${i}`;
      if (fs.existsSync(source)) {
        if (i === maxBackups && fs.existsSync(target)) {
          fs.unlinkSync(target);
        }
        fs.renameSync(source, target);
      }
    }
  } catch {
    // Fail silently on rotation error to guarantee zero crash
  }
}

function appendToFile(filePath: string, line: string): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size + line.length >= currentConfig.maxFileSizeBytes) {
        rotateFileLogs(filePath, currentConfig.maxBackupFiles);
      }
    }

    fs.appendFileSync(filePath, line, 'utf8');
  } catch {
    // Fail silently on disk error to guarantee zero crash
  }
}

function writeToStream(stream: NodeJS.WritableStream, text: string): void {
  try {
    stream.write(text);
  } catch {
    // Harmless broken pipe or detached stdout swallow
  }
}

function logMessage(
  level: LogLevel,
  scope: string,
  message: string,
  meta?: unknown,
): void {
  if (!shouldLog(level)) return;

  const now = new Date();

  // 1. Console Output
  if (currentConfig.consoleEnabled) {
    const isErrorOrWarn = level === 'error' || level === 'warn';
    const allowInProd =
      !currentConfig.errorConsoleOnlyInProduction || level === 'error';

    if (allowInProd) {
      const timeStr = currentConfig.useColors
        ? `${ANSI.dim}${formatTimestamp(now)}${ANSI.reset}`
        : formatTimestamp(now);
      const levelStr = formatLevel(level, currentConfig.useColors);
      const scopeStr = currentConfig.useColors
        ? `${ANSI.cyan}[${scope}]${ANSI.reset}`
        : `[${scope}]`;
      const metaStr = serializeMeta(meta, true);
      const terminalLine = `${timeStr} ${levelStr} ${scopeStr} ${message}${metaStr}\n`;

      const targetStream = isErrorOrWarn ? process.stderr : process.stdout;
      writeToStream(targetStream, terminalLine);
    }
  }

  // 2. File Output
  if (currentConfig.writeToFile && currentConfig.logFilePath) {
    const isoTime = now.toISOString();
    const upperLevel = level.toUpperCase().padEnd(5, ' ');
    const metaStr = serializeMeta(meta, false);
    const fileLine = `${isoTime} [${upperLevel}] [${scope}] ${message}${metaStr}\n`;
    appendToFile(currentConfig.logFilePath, fileLine);
  }
}

class LoggerInstance implements ILogger {
  readonly scope: string;

  constructor(scope: string) {
    this.scope = scope;
  }

  debug(message: string, meta?: unknown): void {
    logMessage('debug', this.scope, message, meta);
  }

  info(message: string, meta?: unknown): void {
    logMessage('info', this.scope, message, meta);
  }

  warn(message: string, meta?: unknown): void {
    logMessage('warn', this.scope, message, meta);
  }

  error(message: string, errorOrMeta?: unknown): void {
    logMessage('error', this.scope, message, errorOrMeta);
  }

  withScope(subScope: string): ILogger {
    return new LoggerInstance(`${this.scope}:${subScope}`);
  }
}

export function createLogger(scope: string): ILogger {
  return new LoggerInstance(scope);
}
