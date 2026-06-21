import { describe, expect, test } from "vitest";
import { CommandRateLimiter, categorize } from "../../src/server/network/session/commandRateLimiter.js";

describe("CommandRateLimiter", () => {
  test("categorize 正确分类命令；实时游戏数据与心跳不限流", () => {
    expect(categorize("Chat")).toBe("chat");
    expect(categorize("SelectChart")).toBe("api");
    expect(categorize("Played")).toBe("api");
    expect(categorize("CreateRoom")).toBe("room");
    expect(categorize("JoinRoom")).toBe("room");
    expect(categorize("Ready")).toBe("room");
    expect(categorize("Abort")).toBe("room");
    // 实时高频数据与心跳：返回 null 表示放行不限流
    expect(categorize("Touches")).toBeNull();
    expect(categorize("Judges")).toBeNull();
    expect(categorize("Ping")).toBeNull();
  });

  test("超过突发容量后在同一时刻拒绝", () => {
    const t0 = 1_000_000;
    const limiter = new CommandRateLimiter({ chat: { capacity: 3, refillPerSec: 1 } }, t0);
    expect(limiter.allow("chat", t0)).toBe(true);
    expect(limiter.allow("chat", t0)).toBe(true);
    expect(limiter.allow("chat", t0)).toBe(true);
    // 第 4 次：桶已空，拒绝
    expect(limiter.allow("chat", t0)).toBe(false);
  });

  test("随时间按速率补充令牌", () => {
    const t0 = 2_000_000;
    const limiter = new CommandRateLimiter({ chat: { capacity: 2, refillPerSec: 2 } }, t0);
    expect(limiter.allow("chat", t0)).toBe(true);
    expect(limiter.allow("chat", t0)).toBe(true);
    expect(limiter.allow("chat", t0)).toBe(false);
    // 0.5 秒后按 2/秒补充约 1 个令牌
    expect(limiter.allow("chat", t0 + 500)).toBe(true);
    expect(limiter.allow("chat", t0 + 500)).toBe(false);
  });

  test("补充不超过容量上限", () => {
    const t0 = 5_000_000;
    const limiter = new CommandRateLimiter({ chat: { capacity: 2, refillPerSec: 5 } }, t0);
    // 长时间空闲后令牌封顶在 capacity，而非无限累积
    expect(limiter.allow("chat", t0 + 100_000)).toBe(true);
    expect(limiter.allow("chat", t0 + 100_000)).toBe(true);
    expect(limiter.allow("chat", t0 + 100_000)).toBe(false);
  });

  test("各类别令牌桶相互独立", () => {
    const t0 = 3_000_000;
    const limiter = new CommandRateLimiter(
      { chat: { capacity: 1, refillPerSec: 1 }, room: { capacity: 1, refillPerSec: 1 } },
      t0
    );
    expect(limiter.allow("chat", t0)).toBe(true);
    expect(limiter.allow("chat", t0)).toBe(false);
    // room 桶不受 chat 桶耗尽影响
    expect(limiter.allow("room", t0)).toBe(true);
  });

  test("默认阈值对正常游玩足够宽松", () => {
    const limiter = new CommandRateLimiter();
    const now = 4_000_000;
    // 正常一局选谱 + 上报成绩量级远低于 api 桶默认容量(12)
    let allOk = true;
    for (let i = 0; i < 12; i++) allOk &&= limiter.allow("api", now);
    expect(allOk).toBe(true);
  });
});
