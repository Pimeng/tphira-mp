import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";

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
};

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

/** 解析日志等级字符串，供配置/环境变量使用；无效值时返回 fallback */
export function parseLevel(input: string | undefined, fallback: LogLevel): LogLevel {
  const v = input?.trim();
  if (!v) return fallback;
  const u = v.toUpperCase();
  if (u === "DEBUG" || u === "INFO" || u === "MARK" || u === "WARN" || u === "ERROR") return u;
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

  private currentDateKey: string | null = null;
  private stream: WriteStream | null = null;

  constructor(options: LoggerOptions = {}) {
    this.logsDir = options.logsDir ?? "logs";
    this.minLevel = options.minLevel ?? parseLevel(process.env.LOG_LEVEL, "INFO");
    this.consoleMinLevel = options.consoleMinLevel ?? parseLevel(process.env.CONSOLE_LOG_LEVEL, "INFO");
    this.useColor = shouldUseColor();

    mkdirSync(this.logsDir, { recursive: true });
    process.stdout.write(`[Phira MP] 日志等级: 文件=${this.minLevel}, 控制台=${this.consoleMinLevel}\n`);
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

  close(): void {
    this.stream?.end();
    this.stream = null;
    this.currentDateKey = null;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;

    const now = new Date();
    const dateKey = formatLocalDateKey(now);
    if (this.currentDateKey !== dateKey) {
      this.rotate(dateKey);
    }

    const fileLine = this.formatLine(now, level, message, meta);
    this.stream?.write(fileLine);

    if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.consoleMinLevel]) {
      const consoleLine = this.formatConsoleLine(fileLine, level);
      if (level === "WARN" || level === "ERROR") process.stderr.write(consoleLine);
      else process.stdout.write(consoleLine);
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
    return `${c}${line}\x1b[0m`;
  }
}

