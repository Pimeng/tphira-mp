/**
 * 会话级命令限流器（令牌桶）
 *
 * 连接层已有 ConnectionRateLimiter（按 IP 限制新建连接频率），但**已认证会话内的命令本身**
 * 此前不受任何频率约束：恶意客户端可借此刷屏聊天淹没整房，或用大量不同的 chart / record id
 * 触发服务端对 Phira API 的放大请求。本限流器按命令类别维护独立令牌桶，把异常高频操作挡下，
 * 同时给正常游玩留足余量——实时游戏数据（Touches / Judges）与心跳（Ping）完全不受限。
 *
 * 令牌桶：每个桶有容量 capacity 与每秒补充速率 refillPerSec。每条命令消费 1 个令牌，
 * 桶空即拒绝。容量决定允许的突发量，补充速率决定持续速率。默认值刻意宽松，正常玩家不会触发。
 */
import type { ClientCommand } from "../../../common/commands.js";

/** 单个令牌桶的可变状态 */
type Bucket = { tokens: number; last: number };

/** 桶参数：容量（突发上限）与每秒补充速率（持续上限） */
export type BucketSpec = { capacity: number; refillPerSec: number };

/** 限流类别 */
export type RateLimitCategory = "chat" | "api" | "room";

/**
 * 各类别默认参数：刻意宽松，正常游玩绝不会触发，只挡异常洪水。
 * - chat：聊天，突发 10 条、持续 3 条/秒
 * - api：触发上游 Phira API 的命令（SelectChart / Played），突发 12、持续 3/秒
 * - room：房间生命周期（建/退/锁/循环/准备/中止等），突发 20、持续 6/秒
 */
const DEFAULT_SPECS: Readonly<Record<RateLimitCategory, BucketSpec>> = Object.freeze({
  chat: { capacity: 10, refillPerSec: 3 },
  api: { capacity: 12, refillPerSec: 3 },
  room: { capacity: 20, refillPerSec: 6 }
});

/**
 * 把命令类型映射到限流类别；返回 null 表示**不限流**（实时游戏数据与心跳）。
 *
 * - Touches / Judges：实时高频游戏数据，限流会破坏观战与回放，放行。
 * - Ping：心跳，放行。
 * - Authenticate：仅认证前可达一次，由会话的 waitingForAuthenticate 把关，无需限流。
 */
export function categorize(type: ClientCommand["type"]): RateLimitCategory | null {
  switch (type) {
    case "Chat":
      return "chat";
    case "SelectChart":
    case "Played":
      return "api";
    case "CreateRoom":
    case "JoinRoom":
    case "LeaveRoom":
    case "LockRoom":
    case "CycleRoom":
    case "RequestStart":
    case "Ready":
    case "CancelReady":
    case "Abort":
      return "room";
    default:
      return null;
  }
}

/**
 * 每会话一个实例，持有三类令牌桶。线程模型为单线程事件循环，无需加锁。
 */
export class CommandRateLimiter {
  private readonly specs: Record<RateLimitCategory, BucketSpec>;
  private readonly buckets: Record<RateLimitCategory, Bucket>;

  constructor(specs: Partial<Record<RateLimitCategory, BucketSpec>> = {}, now: number = Date.now()) {
    this.specs = { ...DEFAULT_SPECS, ...specs };
    this.buckets = {
      chat: { tokens: this.specs.chat.capacity, last: now },
      api: { tokens: this.specs.api.capacity, last: now },
      room: { tokens: this.specs.room.capacity, last: now }
    };
  }

  /**
   * 消费一个令牌。返回 true 表示放行，false 表示超限应拒绝。
   * @param category 限流类别
   * @param now 当前时间戳（可注入，便于测试确定性）
   */
  allow(category: RateLimitCategory, now: number = Date.now()): boolean {
    const spec = this.specs[category];
    const bucket = this.buckets[category];
    // 按经过时间线性补充令牌（懒补充：无需定时器）
    const elapsedSec = (now - bucket.last) / 1000;
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(spec.capacity, bucket.tokens + elapsedSec * spec.refillPerSec);
      bucket.last = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }
}
