/**
 * 观战数据聚合缓冲模块
 *
 * 为避免高频实时数据(Touches/Judges)直接冲击网络,将多个事件帧聚合后批量发送。
 * 默认聚合窗口为 50ms,期间收集的同一玩家的数据会合并后统一转发给观战者。
 */
import type { JudgeEvent, ServerCommand, TouchFrame } from "../../../common/commands.js";

/** 观战数据缓冲选项 */
export type MonitorBufferOptions = {
  /** 聚合间隔(毫秒) */
  flushIntervalMs: number;
  /** 获取当前监视者 ID 列表的回调,返回 null 表示丢弃缓冲 */
  getMonitorIds: () => number[] | null;
  /** 广播命令到指定 ID 列表的回调(fire-and-forget) */
  broadcastFast: (ids: number[], cmd: ServerCommand) => void;
};

/**
 * 观战数据缓冲器
 *
 * 维护两个独立缓冲(touches 和 judges),共享同一个延迟 flush 定时器。
 * flush 时会按玩家合并多次推入的数据,然后一次性广播给所有观战者。
 */
export class MonitorBuffer {
  private touchBuffer: Array<{ player: number; frames: TouchFrame[] }> = [];
  private judgeBuffer: Array<{ player: number; judges: JudgeEvent[] }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly opts: MonitorBufferOptions;

  constructor(opts: MonitorBufferOptions) {
    this.opts = opts;
  }

  /** 推入一批 touches 帧 */
  bufferTouches(player: number, frames: TouchFrame[]): void {
    this.touchBuffer.push({ player, frames });
    this.scheduleFlush();
  }

  /** 推入一批 judges 事件 */
  bufferJudges(player: number, judges: JudgeEvent[]): void {
    this.judgeBuffer.push({ player, judges });
    this.scheduleFlush();
  }

  /** 立即 flush 缓冲区,合并并广播 */
  flush(): void {
    const monitorIds = this.opts.getMonitorIds();
    if (!monitorIds) {
      this.touchBuffer = [];
      this.judgeBuffer = [];
      return;
    }

    if (this.touchBuffer.length > 0) {
      const merged = new Map<number, TouchFrame[]>();
      for (const item of this.touchBuffer) {
        const existing = merged.get(item.player);
        if (existing) existing.push(...item.frames);
        else merged.set(item.player, [...item.frames]);
      }
      for (const [player, frames] of merged) {
        this.opts.broadcastFast(monitorIds, { type: "Touches", player, frames });
      }
      this.touchBuffer = [];
    }

    if (this.judgeBuffer.length > 0) {
      const merged = new Map<number, JudgeEvent[]>();
      for (const item of this.judgeBuffer) {
        const existing = merged.get(item.player);
        if (existing) existing.push(...item.judges);
        else merged.set(item.player, [...item.judges]);
      }
      for (const [player, judges] of merged) {
        this.opts.broadcastFast(monitorIds, { type: "Judges", player, judges });
      }
      this.judgeBuffer = [];
    }
  }

  /** 销毁缓冲器: 取消定时器并最后一次 flush */
  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private scheduleFlush(): void {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.opts.flushIntervalMs);
    }
  }
}
