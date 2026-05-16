import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("ioredis", () => {
  const mockStore = new Map<string, { value: string; expiresAt?: number }>();

  class MockRedis {
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
    }
    async connect() {
      return this;
    }
    disconnect() {
      // no-op
    }
    async get(key: string): Promise<string | null> {
      const entry = mockStore.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        mockStore.delete(key);
        return null;
      }
      return entry.value;
    }
    async set(key: string, value: string): Promise<"OK"> {
      mockStore.set(key, { value });
      return "OK";
    }
    async del(...keys: string[]): Promise<number> {
      let count = 0;
      for (const key of keys) {
        if (mockStore.delete(key)) count++;
      }
      return count;
    }
    async exists(key: string): Promise<number> {
      const entry = mockStore.get(key);
      if (!entry) return 0;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        mockStore.delete(key);
        return 0;
      }
      return 1;
    }
    async pexpire(key: string, ms: number): Promise<number> {
      const entry = mockStore.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ms;
      return 1;
    }
    async scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]> {
      let pattern: string | undefined;
      let count = 100;
      for (let i = 0; i < args.length; i += 2) {
        if (args[i] === "MATCH") pattern = args[i + 1] as string;
        if (args[i] === "COUNT") count = args[i + 1] as number;
      }
      const prefix = pattern?.replace("*", "") ?? "";
      const keys = [...mockStore.keys()].filter((k) => k.startsWith(prefix));
      const start = Number(cursor);
      const page = keys.slice(start, start + count);
      const nextCursor = start + count >= keys.length ? "0" : String(start + count);
      return [nextCursor, page];
    }
    pipeline() {
      const commands: Array<() => Promise<unknown>> = [];
      const self = this;
      return {
        set(key: string, value: string) {
          commands.push(() => self.set(key, value));
          return this;
        },
        pexpire(key: string, ms: number) {
          commands.push(() => self.pexpire(key, ms));
          return this;
        },
        async exec(): Promise<null> {
          for (const cmd of commands) await cmd();
          return null;
        }
      };
    }
  }

  (globalThis as Record<string, unknown>).__redisMockStore = mockStore;
  return { default: MockRedis };
});

import { Cache, initRedisCache } from "../../src/server/utils/cache.js";

function getMockStore(): Map<string, { value: string; expiresAt?: number }> {
  return (globalThis as Record<string, unknown>).__redisMockStore as Map<string, { value: string; expiresAt?: number }>;
}

describe("Cache with Redis", () => {
  beforeEach(async () => {
    getMockStore().clear();
    await initRedisCache({ enabled: false });
  });

  afterEach(async () => {
    await initRedisCache({ enabled: false });
    getMockStore().clear();
  });

  it("set / get with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_1.json", maxMemorySize: 10 });
    await cache.set("key1", "value1");
    const value = await cache.get("key1");
    expect(value).toBe("value1");
  });

  it("get 不存在的 key 返回 null", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_2.json", maxMemorySize: 10 });
    const value = await cache.get("nonexistent");
    expect(value).toBeNull();
  });

  it("has with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_3.json", maxMemorySize: 10 });
    await cache.set("key1", "value1");
    expect(await cache.has("key1")).toBe(true);
    expect(await cache.has("key2")).toBe(false);
  });

  it("delete with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_4.json", maxMemorySize: 10 });
    await cache.set("key1", "value1");
    await cache.delete("key1");
    expect(await cache.get("key1")).toBeNull();
  });

  it("clear with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_5.json", maxMemorySize: 10 });
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");
    await cache.clear();
    expect(await cache.get("key1")).toBeNull();
    expect(await cache.get("key2")).toBeNull();
  });

  it("TTL 过期 with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_6.json", maxMemorySize: 10, ttl: 50 });
    await cache.set("key1", "value1");
    expect(await cache.get("key1")).toBe("value1");
    await new Promise((r) => setTimeout(r, 100));
    expect(await cache.get("key1")).toBeNull();
  });

  it("复杂值类型 with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, { id: number; name: string }>({ fileName: "redis_test_7.json", maxMemorySize: 10 });
    await cache.set("user1", { id: 1, name: "Alice" });
    const value = await cache.get("user1");
    expect(value).toEqual({ id: 1, name: "Alice" });
  });

  it("getOrSet 使用缓存值 with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_8.json", maxMemorySize: 10 });
    await cache.set("key1", "cached");
    const factory = vi.fn(() => "new");
    const value = await cache.getOrSet("key1", factory);
    expect(value).toBe("cached");
    expect(factory).not.toHaveBeenCalled();
  });

  it("getOrSet 调用 factory 并写入缓存 with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_9.json", maxMemorySize: 10 });
    const value = await cache.getOrSet("key1", () => "factory-value");
    expect(value).toBe("factory-value");
    expect(await cache.get("key1")).toBe("factory-value");
  });

  it("keys 返回所有有效 key with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_10.json", maxMemorySize: 10 });
    await cache.set("a", "1");
    await cache.set("b", "2");
    await cache.set("c", "3");
    await cache.delete("b");
    const keys = await cache.keys();
    expect(keys.sort()).toEqual(["a", "c"]);
  });

  it("size 返回有效条目数 with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_11.json", maxMemorySize: 10 });
    await cache.set("a", "1");
    await cache.set("b", "2");
    expect(await cache.size()).toBe(2);
    await cache.delete("a");
    expect(await cache.size()).toBe(1);
  });

  it("stats 统计命中率 with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_12.json", maxMemorySize: 10 });
    await cache.set("hit", "value");
    await cache.get("hit");
    await cache.get("hit");
    await cache.get("miss");

    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.total).toBe(3);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
    expect(stats.size).toBe(1);
  });

  it("resetStats 重置统计 with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_13.json", maxMemorySize: 10 });
    await cache.set("a", "1");
    await cache.get("a");
    expect(cache.stats().hits).toBe(1);
    cache.resetStats();
    expect(cache.stats().hits).toBe(0);
    expect(cache.stats().misses).toBe(0);
  });

  it("clear 同时重置统计 with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_14.json", maxMemorySize: 10 });
    await cache.set("a", "1");
    await cache.get("a");
    await cache.clear();
    expect(cache.stats().hits).toBe(0);
    expect(cache.stats().misses).toBe(0);
  });

  it("数字 key with Redis", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<number, string>({ fileName: "redis_test_15.json", maxMemorySize: 10, keyType: "number" });
    await cache.set(1, "value1");
    await cache.set(42, "value42");
    expect(await cache.get(1)).toBe("value1");
    expect(await cache.get(42)).toBe("value42");
    expect(await cache.get(2)).toBeNull();
  });

  it("禁用 Redis 后回退到本地缓存", async () => {
    await initRedisCache({ enabled: true, host: "127.0.0.1", port: 6379 });
    const cache = new Cache<string, string>({ fileName: "redis_test_16.json", maxMemorySize: 10 });
    await cache.set("key1", "redis-value");
    expect(await cache.get("key1")).toBe("redis-value");

    await initRedisCache({ enabled: false });
    expect(await cache.get("key1")).toBeNull();
    await cache.set("key1", "local-value");
    expect(await cache.get("key1")).toBe("local-value");
  });
});
