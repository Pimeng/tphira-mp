/**
 * Redis 分布式状态层测试（需本地 Redis 127.0.0.1:6379，数据库 3）
 * 运行：pnpm test test/redis.test.ts
 * 若未启动 Redis，部分测试将跳过或失败。
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RedisService } from "../src/server/redis.js";
import { parseRoomId } from "../src/common/roomId.js";
import type { Logger } from "../src/server/logger.js";

const REDIS_HOST = "127.0.0.1";
const REDIS_PORT = 6379;
const REDIS_DB = 3;

const mockLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => console.log("[DEBUG]", msg, meta ?? ""),
  info: (msg: string, meta?: Record<string, unknown>) => console.log("[INFO]", msg, meta ?? ""),
  mark: (msg: string, meta?: Record<string, unknown>) => console.log("[MARK]", msg, meta ?? ""),
  warn: (msg: string, meta?: Record<string, unknown>) => console.log("[WARN]", msg, meta ?? ""),
  error: (msg: string, meta?: Record<string, unknown>) => console.log("[ERROR]", msg, meta ?? ""),
  close: () => {}
} as unknown as Logger;

let redis: RedisService;
const testRoomId = parseRoomId("redis-test-room");

beforeAll(async () => {
  redis = new RedisService({
    host: REDIS_HOST,
    port: REDIS_PORT,
    db: REDIS_DB,
    serverId: "test-server",
    logger: mockLogger
  });
  await new Promise<void>((r) => setTimeout(r, 800));
});

afterAll(async () => {
  await redis?.close();
});

describe("Redis 分布式状态层", () => {
  test("setPlayerSession / updatePlayerLastSeen / deletePlayerSession", async () => {
    const uid = 9001;
    await redis.setPlayerSession({
      uid,
      roomId: null,
      name: "TestUser",
      isMonitor: false
    });
    await redis.updatePlayerLastSeen(uid);
    await redis.deletePlayerSession(uid);
    // 无抛错即通过
  });

  test("initRoom / setRoomInfo / tryAddRoomPlayer / removeRoomPlayer / deleteRoom", async () => {
    await redis.initRoom(testRoomId, 100, 8);
    await redis.setRoomInfo({
      rid: testRoomId,
      hostId: 100,
      state: 0,
      chartId: 123,
      isLocked: false,
      isCycle: true
    });
    const added = await redis.tryAddRoomPlayer(testRoomId, 200, 8);
    expect(added).toBe(true);
    const addedAgain = await redis.tryAddRoomPlayer(testRoomId, 201, 8);
    expect(addedAgain).toBe(true);
    await redis.removeRoomPlayer(testRoomId, 200);
    await redis.removeRoomPlayer(testRoomId, 201);
    await redis.deleteRoom(testRoomId);
  });

  test("Lua 原子加入：房间满时 tryAddRoomPlayer 返回 false", async () => {
    const rid = parseRoomId("redis-full-room");
    await redis.initRoom(rid, 1, 2);
    expect(await redis.tryAddRoomPlayer(rid, 1, 2)).toBe(true);
    expect(await redis.tryAddRoomPlayer(rid, 2, 2)).toBe(true);
    expect(await redis.tryAddRoomPlayer(rid, 3, 2)).toBe(false);
    await redis.deleteRoom(rid);
  });

  test("publishEvent 与 subscribe 收包", async () => {
    const received: unknown[] = [];
    await redis.subscribe((payload) => {
      received.push(payload);
    });
    await redis.publishEvent({
      event: "STATE_CHANGE",
      room_id: "pubsub-test",
      data: { new_state: 1, chart_id: 456 }
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect((received[0] as { event: string }).event).toBe("STATE_CHANGE");
    expect((received[0] as { room_id: string }).room_id).toBe("pubsub-test");
  });
});
