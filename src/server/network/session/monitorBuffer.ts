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

type MergedTouchEntry = { ids: number[]; player: number; frames: TouchFrame[] };
type MergedJudgeEntry = { ids: number[]; player: number; judges: JudgeEvent[] };

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
  private mergedTouches = new Map<number, MergedTouchEntry[]>();
  private mergedJudges = new Map<number, MergedJudgeEntry[]>();

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
        const bucket = this.getTouchBucket(item.player);
        const existing = this.findTouchEntry(bucket, ids);
        if (existing) {
          for (let i = 0; i < item.frames.length; i++) existing.frames.push(item.frames[i]!);
        } else {
          bucket.push({ ids, player: item.player, frames: item.frames.slice() });
        }
      }
      for (const entries of this.mergedTouches.values()) {
        for (const { ids, player, frames } of entries) {
          this.opts.broadcastFast(ids, { type: "Touches", player, frames });
        }
      }
      this.touchBuffer.length = 0;
    }

    if (this.judgeBuffer.length > 0) {
      this.mergedJudges.clear();
      for (const item of this.judgeBuffer) {
        const ids = this.liveMonitorIds(item.targets);
        if (ids.length === 0) continue;
        const bucket = this.getJudgeBucket(item.player);
        const existing = this.findJudgeEntry(bucket, ids);
        if (existing) {
          for (let i = 0; i < item.judges.length; i++) existing.judges.push(item.judges[i]!);
        } else {
          bucket.push({ ids, player: item.player, judges: item.judges.slice() });
        }
      }
      for (const entries of this.mergedJudges.values()) {
        for (const { ids, player, judges } of entries) {
          this.opts.broadcastFast(ids, { type: "Judges", player, judges });
        }
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
    if (ids instanceof Set) return [...ids];
    const arr = Array.isArray(ids) ? ids as number[] : [...ids];
    if (arr.length <= 1) return arr;
    return [...new Set(arr)].sort((a, b) => a - b);
  }

  private liveMonitorIds(targets: MonitorTargets): number[] {
    const { ids, room } = targets;
    let filtered: number[] | null = null;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      if (room.monitors.has(id)) {
        if (filtered) filtered.push(id);
        continue;
      }
      if (!filtered) filtered = ids.slice(0, i);
    }
    return filtered ?? ids;
  }

  private getTouchBucket(player: number): MergedTouchEntry[] {
    let bucket = this.mergedTouches.get(player);
    if (!bucket) {
      bucket = [];
      this.mergedTouches.set(player, bucket);
    }
    return bucket;
  }

  private getJudgeBucket(player: number): MergedJudgeEntry[] {
    let bucket = this.mergedJudges.get(player);
    if (!bucket) {
      bucket = [];
      this.mergedJudges.set(player, bucket);
    }
    return bucket;
  }

  private findTouchEntry(entries: MergedTouchEntry[], ids: number[]): MergedTouchEntry | undefined {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (this.sameIds(entry.ids, ids)) return entry;
    }
    return undefined;
  }

  private findJudgeEntry(entries: MergedJudgeEntry[], ids: number[]): MergedJudgeEntry | undefined {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (this.sameIds(entry.ids, ids)) return entry;
    }
    return undefined;
  }

  private sameIds(left: number[], right: number[]): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }
}
