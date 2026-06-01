/**
 * 观战数据聚合缓冲模块
 *
 * 为避免高频实时数据(Touches/Judges)直接冲击网络,将多个事件帧聚合后批量发送。
 * 默认聚合窗口为 50ms,期间收集的同一玩家的数据会合并后统一转发给观战者。
 */
import type { JudgeEvent, ServerCommand, TouchFrame } from "../../../common/commands.js";
import type { Room } from "../../game/room.js";

/** 观战数据缓冲选项 */
type MonitorBufferOptions = {
  /** 聚合间隔(毫秒) */
  flushIntervalMs: number;
  /** 广播命令到指定 ID 列表的回调(fire-and-forget) */
  broadcastFast: (ids: number[], cmd: ServerCommand) => void;
};

type MonitorTargets = {
  room: Room;
  ids: number[];
};

/**
 * 观战数据缓冲器
 *
 * 维护两个独立缓冲(touches 和 judges),共享同一个延迟 flush 定时器。
 * flush 时会按玩家合并多次推入的数据,然后一次性广播给所有观战者。
 */
export class MonitorBuffer {
  private touchBuffer: Array<{ targets: MonitorTargets; player: number; frames: TouchFrame[] }> = [];
  private judgeBuffer: Array<{ targets: MonitorTargets; player: number; judges: JudgeEvent[] }> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly opts: MonitorBufferOptions;
  private mergedTouches = new Map<string, { ids: number[]; player: number; frames: TouchFrame[] }>();
  private mergedJudges = new Map<string, { ids: number[]; player: number; judges: JudgeEvent[] }>();

  constructor(opts: MonitorBufferOptions) {
    this.opts = opts;
  }

  /** 推入一批 touches 帧 */
  bufferTouches(room: Room, monitorIds: Iterable<number>, player: number, frames: TouchFrame[]): void {
    const ids = this.normalizeMonitorIds(monitorIds);
    if (ids.length === 0) return;
    this.touchBuffer.push({ targets: { room, ids }, player, frames });
    this.scheduleFlush();
  }

  /** 推入一批 judges 事件 */
  bufferJudges(room: Room, monitorIds: Iterable<number>, player: number, judges: JudgeEvent[]): void {
    const ids = this.normalizeMonitorIds(monitorIds);
    if (ids.length === 0) return;
    this.judgeBuffer.push({ targets: { room, ids }, player, judges });
    this.scheduleFlush();
  }

  /** 立即 flush 缓冲区,合并并广播 */
  flush(): void {
    if (this.touchBuffer.length > 0) {
      this.mergedTouches.clear();
      for (const item of this.touchBuffer) {
        const ids = this.liveMonitorIds(item.targets);
        if (ids.length === 0) continue;
        const key = this.mergeKey(ids, item.player);
        const existing = this.mergedTouches.get(key);
        if (existing) {
          for (let i = 0; i < item.frames.length; i++) existing.frames.push(item.frames[i]!);
        } else {
          this.mergedTouches.set(key, { ids, player: item.player, frames: item.frames.slice() });
        }
      }
      for (const { ids, player, frames } of this.mergedTouches.values()) {
        this.opts.broadcastFast(ids, { type: "Touches", player, frames });
      }
      this.touchBuffer.length = 0;
    }

    if (this.judgeBuffer.length > 0) {
      this.mergedJudges.clear();
      for (const item of this.judgeBuffer) {
        const ids = this.liveMonitorIds(item.targets);
        if (ids.length === 0) continue;
        const key = this.mergeKey(ids, item.player);
        const existing = this.mergedJudges.get(key);
        if (existing) {
          for (let i = 0; i < item.judges.length; i++) existing.judges.push(item.judges[i]!);
        } else {
          this.mergedJudges.set(key, { ids, player: item.player, judges: item.judges.slice() });
        }
      }
      for (const { ids, player, judges } of this.mergedJudges.values()) {
        this.opts.broadcastFast(ids, { type: "Judges", player, judges });
      }
      this.judgeBuffer.length = 0;
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

  private normalizeMonitorIds(ids: Iterable<number>): number[] {
    const arr = Array.isArray(ids) ? ids as number[] : [...ids];
    if (arr.length <= 1) return arr;
    return [...new Set(arr)].sort((a, b) => a - b);
  }

  private liveMonitorIds(targets: MonitorTargets): number[] {
    return targets.ids.filter((id) => targets.room.monitors.has(id));
  }

  private mergeKey(ids: number[], player: number): string {
    return `${ids.join(",")}:${player}`;
  }
}
