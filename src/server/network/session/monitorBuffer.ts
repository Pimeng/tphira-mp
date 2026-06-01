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

/** 动态 flush 阈值 */
const MAX_BUFFER_SIZE_SLOW = 50;
const MAX_BUFFER_SIZE_FAST = 200;
const FLUSH_INTERVAL_SLOW = 50;
const FLUSH_INTERVAL_FAST = 20;
const FLUSH_INTERVAL_URGENT = 10;

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
  /** 缓存归一化后的 monitor ID 数组, key 为 room 引用 (Room 对象引用稳定) */
  private cachedMonitorIds = new WeakMap<Room, { ids: number[]; version: number }>();
  private monitorIdVersion = 0;

  constructor(opts: MonitorBufferOptions) {
    this.opts = opts;
  }

  /** 推入一批 touches 帧 */
  bufferTouches(room: Room, _monitorIds: Iterable<number>, player: number, frames: TouchFrame[]): void {
    const ids = this.getCachedMonitorIds(room);
    if (ids.length === 0) return;
    this.touchBuffer.push({ targets: { room, ids }, player, frames });
    this.scheduleFlush();
  }

  /** 推入一批 judges 事件 */
  bufferJudges(room: Room, _monitorIds: Iterable<number>, player: number, judges: JudgeEvent[]): void {
    const ids = this.getCachedMonitorIds(room);
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
          // 优化：直接复用原始 frames 数组, 不再 .slice() 拷贝
          bucket.push({ ids, player: item.player, frames: item.frames });
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
          bucket.push({ ids, player: item.player, judges: item.judges });
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
      const bufferSize = this.touchBuffer.length + this.judgeBuffer.length;
      let interval: number;
      if (bufferSize > MAX_BUFFER_SIZE_FAST) {
        interval = FLUSH_INTERVAL_URGENT;
      } else if (bufferSize > MAX_BUFFER_SIZE_SLOW) {
        interval = FLUSH_INTERVAL_FAST;
      } else {
        interval = FLUSH_INTERVAL_SLOW;
      }
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, interval);
    }
  }

  /** 从 Room 获取缓存的 monitor ID 数组, 避免每次重建和排序 */
  private getCachedMonitorIds(room: Room): number[] {
    const cached = this.cachedMonitorIds.get(room);
    const currentIds = room.monitorIds();
    if (cached) {
      // 快速版本检查：monitor 数量变化意味着需要更新
      if (cached.ids.length === currentIds.length && cached.version === this.monitorIdVersion) {
        return cached.ids;
      }
    }
    // 缓存 miss 或版本过期, 重建
    const ids = currentIds.length === 0 ? currentIds : [...currentIds];
    this.monitorIdVersion++;
    this.cachedMonitorIds.set(room, { ids, version: this.monitorIdVersion });
    return ids;
  }

  private liveMonitorIds(targets: MonitorTargets): number[] {
    const { ids, room } = targets;
    // 快速路径：monitor 数量未变, 直接返回缓存数组
    if (ids.length === room.monitors.size) return ids;
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
