/**
 * 控制台日志中心
 *
 * 为服务端 GUI 提供与终端控制台一致的日志流：
 * - 维护最近 N 条日志的环形缓冲，供 GUI 打开时回填历史；
 * - 提供订阅机制，供 WebSocket 服务实时推送新日志行。
 *
 * 日志来源是 Logger 的 onLog 侧信道（见 core/server.ts 的接线），
 * 因此与文件/终端输出共享同一套等级过滤语义。
 */
import type { LogLevel } from "./logger.js";

/** 单条控制台日志行 */
export type ConsoleLine = {
  level: LogLevel;
  message: string;
  /** Unix 毫秒时间戳 */
  timestamp: number;
};

type ConsoleSubscriber = (line: ConsoleLine) => void;

/** 环形缓冲保留的最大日志行数 */
const MAX_BUFFER_LINES = 500;

export class ConsoleHub {
  private readonly buffer: ConsoleLine[] = [];
  /** 环形缓冲写入位置（buffer 装满后开始循环覆盖） */
  private writeIndex = 0;
  private readonly subscribers = new Set<ConsoleSubscriber>();

  /** 追加一条日志行并通知所有订阅者 */
  append(level: LogLevel, message: string, timestamp: number): void {
    const line: ConsoleLine = { level, message, timestamp };
    if (this.buffer.length < MAX_BUFFER_LINES) {
      this.buffer.push(line);
    } else {
      this.buffer[this.writeIndex] = line;
      this.writeIndex = (this.writeIndex + 1) % MAX_BUFFER_LINES;
    }
    for (const cb of this.subscribers) {
      try {
        cb(line);
      } catch {
        // 订阅者异常不能影响日志主流程
      }
    }
  }

  /** 按时间顺序返回最近的日志行（最多 limit 条，默认全部缓冲） */
  getRecent(limit = MAX_BUFFER_LINES): ConsoleLine[] {
    const ordered =
      this.buffer.length < MAX_BUFFER_LINES
        ? this.buffer
        : [...this.buffer.slice(this.writeIndex), ...this.buffer.slice(0, this.writeIndex)];
    return limit >= ordered.length ? [...ordered] : ordered.slice(ordered.length - limit);
  }

  /** 订阅新日志行；返回取消订阅函数 */
  subscribe(cb: ConsoleSubscriber): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }
}
