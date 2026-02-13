import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import { RateLimiter } from "./rateLimiter.js";

export type LogLevel = "DEBUG" | "INFO" | "MARK" | "WARN" | "ERROR";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  DEBUG: 5,
  INFO: 10,
  MARK: 20,
  WARN: 30,
  ERROR: 40
};



export type LoggerOptions = {
  logsDir?: string;
  minLevel?: LogLevel;
  consoleMinLevel?: LogLevel;
  /** 测试账号 ID：当 context.userId 在此列表中且 minLevel 非 DEBUG 时，不写入日志文件 */
  testAccountIds?: number[];
  /** 启用日志限流和IP黑名单 */
  enableRateLimiting?: boolean;
  /** INFO 日志回调函数，用于实时推送 */
  onInfoLog?: (message: string, timestamp: Date) => void;
};

export type LogContext = { userId?: number; ip?: string };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export function formatLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatLocalTimestamp(d: Date): string {
  return `${formatLocalDateKey(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

function parseLevel(input: string | undefined, fallback: LogLevel): LogLevel {
  if (!input) return fallback;
  const v = input.toUpperCase();
  if (v === "DEBUG" || v === "INFO" || v === "MARK" || v === "WARN" || v === "ERROR") return v;
  return fallback;
}

function shouldUseColor(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  return true;
}

function colorForLevel(level: LogLevel): string | null {
  if (level === "DEBUG") return "\x1b[34m";
  if (level === "INFO") return "\x1b[32m";
  if (level === "MARK") return "\x1b[90m";
  if (level === "WARN") return "\x1b[33m";
  if (level === "ERROR") return "\x1b[31m";
  return null;
}

export class Logger {
  private readonly logsDir: string;
  private readonly minLevel: LogLevel;
  private readonly consoleMinLevel: LogLevel;
  private readonly useColor: boolean;
  private readonly testAccountIds: ReadonlySet<number>;
  private readonly rateLimiter: RateLimiter | null;
  private readonly onInfoLog?: (message: string, timestamp: Date) => void;

  private currentDateKey: string | null = null;
  private stream: WriteStream | null = null;

  constructor(options: LoggerOptions = {}) {
    this.logsDir = options.logsDir ?? "logs";
    this.minLevel = options.minLevel ?? parseLevel(process.env.LOG_LEVEL, "INFO");
    this.consoleMinLevel = options.consoleMinLevel ?? parseLevel(process.env.CONSOLE_LOG_LEVEL, "INFO");
    this.useColor = shouldUseColor();
    this.testAccountIds = new Set(options.testAccountIds ?? []);
    this.rateLimiter = options.enableRateLimiting ? new RateLimiter() : null;
    this.onInfoLog = options.onInfoLog;

    mkdirSync(this.logsDir, { recursive: true });
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write("DEBUG", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write("INFO", message, meta);
  }

  mark(message: string, meta?: Record<string, unknown>): void {
    this.write("MARK", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("WARN", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write("ERROR", message, meta);
  }

  /** 带上下文的日志：当 context.userId 为测试账号且全局非 DEBUG 时不写入文件；当启用限流且IP被限流时，连接日志不输出 */
  log(level: LogLevel, message: string, meta?: Record<string, unknown>, context?: LogContext & { isConnectionLog?: boolean }): void {
    this.write(level, message, meta, context);
  }

  /** 获取当前黑名单中的IP列表 */
  getBlacklistedIps(): Array<{ ip: string; expiresIn: number }> {
    return this.rateLimiter?.getBlacklistedIps() ?? [];
  }

  /** 手动将IP从黑名单中移除 */
  removeFromBlacklist(ip: string): void {
    this.rateLimiter?.removeFromBlacklist(ip);
  }

  /** 清空所有黑名单 */
  clearBlacklist(): void {
    this.rateLimiter?.clearBlacklist();
  }

  /** 获取当前日志频率（条/秒） */
  getCurrentRate(): number {
    return this.rateLimiter?.getCurrentRate() ?? 0;
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
    this.currentDateKey = null;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>, context?: LogContext & { isConnectionLog?: boolean }): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;

    // 检查是否应该跳过连接日志（限流）
    const isConnectionLog = context?.isConnectionLog === true || 
                           message.includes("log-new-connection") || 
                           message.includes("log-handshake");
    if (isConnectionLog && this.rateLimiter && context?.ip) {
      if (!this.rateLimiter.shouldLogConnection(context.ip)) {
        return; // 跳过此日志，既不输出到控制台也不写入文件
      }
    }

    const now = new Date();
    const dateKey = formatLocalDateKey(now);
    if (this.currentDateKey !== dateKey) {
      this.rotate(dateKey);
    }

    const fileLine = this.formatLine(now, level, message, meta);
    const skipFile =
      this.testAccountIds.size > 0 &&
      context?.userId !== undefined &&
      this.testAccountIds.has(context.userId) &&
      this.minLevel !== "DEBUG";
    if (!skipFile) {
      this.stream?.write(fileLine);
    }

    if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.consoleMinLevel]) {
      const consoleLine = this.formatConsoleLine(fileLine, level);
      if (level === "WARN" || level === "ERROR") process.stderr.write(consoleLine);
      else process.stdout.write(consoleLine);
    }

    // 如果是 INFO 级别的日志且有回调函数，调用回调
    if (level === "INFO" && this.onInfoLog) {
      this.onInfoLog(message, now);
    }
  }

  private rotate(dateKey: string): void {
    this.stream?.end();
    this.currentDateKey = dateKey;

    const fileName = `${dateKey}.log`;
    const filePath = join(this.logsDir, fileName);
    this.stream = createWriteStream(filePath, { flags: "a" });
  }

  private formatLine(now: Date, level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const ts = formatLocalTimestamp(now);
    const base = `[${ts}] [${level}] ${message}`;
    void meta;
    return `${base}\n`;
  }

  private formatConsoleLine(line: string, level: LogLevel): string {
    if (!this.useColor) return line;
    const c = colorForLevel(level);
    if (!c) return line;
    if (line.endsWith("\n")) {
      return `${c}${line.slice(0, -1)}\x1b[0m\n`;
    }
    return `${c}${line}\x1b[0m`;
  }
}

