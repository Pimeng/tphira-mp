import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Cache } from "../../src/server/utils/cache.js";

let tempDir: string;
let prevHome: string | undefined;
let fileCounter = 0;

function uniqueFileName(): string {
  return `cache-${Date.now()}-${fileCounter++}.json`;
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `phira-mp-cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(tempDir, { recursive: true });
  prevHome = process.env.PHIRA_MP_HOME;
  process.env.PHIRA_MP_HOME = tempDir;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PHIRA_MP_HOME;
  else process.env.PHIRA_MP_HOME = prevHome;
  await rm(tempDir, { recursive: true, force: true });
});

describe("Cache", () => {
  it("set / get", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("key1", "value1");
    const value = await cache.get("key1");
    expect(value).toBe("value1");
  });

  it("get 不存在的 key 返回 null", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    const value = await cache.get("nonexistent");
    expect(value).toBeNull();
  });

  it("has", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("key1", "value1");
    expect(await cache.has("key1")).toBe(true);
    expect(await cache.has("key2")).toBe(false);
  });

  it("delete", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("key1", "value1");
    await cache.delete("key1");
    expect(await cache.get("key1")).toBeNull();
  });

  it("clear", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");
    await cache.clear();
    expect(await cache.get("key1")).toBeNull();
    expect(await cache.get("key2")).toBeNull();
  });

  it("内存大小限制使用 LRU 策略", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 2 });
    await cache.set("key1", "value1");
    await new Promise((r) => setTimeout(r, 10));
    await cache.set("key2", "value2");
    await new Promise((r) => setTimeout(r, 10));
    // 访问 key1，使其成为最近使用的
    await cache.get("key1");
    await new Promise((r) => setTimeout(r, 10));
    await cache.set("key3", "value3");
    // LRU 淘汰：key2 最久未访问，应该被移除
    expect(await cache.get("key2")).toBeNull();
    expect(await cache.get("key1")).toBe("value1");
    expect(await cache.get("key3")).toBe("value3");
  });

  it("TTL 过期", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10, ttl: 50 });
    await cache.set("key1", "value1");
    expect(await cache.get("key1")).toBe("value1");
    await new Promise((r) => setTimeout(r, 100));
    expect(await cache.get("key1")).toBeNull();
  });

  it("持久化到磁盘", async () => {
    const fileName = uniqueFileName();
    const cache = new Cache<string, string>({ fileName, maxMemorySize: 10 });
    await cache.set("key1", "value1");

    // 等待防抖写入
    await new Promise((r) => setTimeout(r, 200));

    // 创建新实例读取
    const cache2 = new Cache<string, string>({ fileName, maxMemorySize: 10 });
    const value = await cache2.get("key1");
    expect(value).toBe("value1");
  });

  it("不持久化", async () => {
    const fileName = uniqueFileName();
    const cache = new Cache<string, string>({ fileName, maxMemorySize: 10, persistToDisk: false });
    await cache.set("key1", "value1");
    await new Promise((r) => setTimeout(r, 200));

    const cache2 = new Cache<string, string>({ fileName, maxMemorySize: 10 });
    expect(await cache2.get("key1")).toBeNull();
  });

  it("数字 key 持久化与加载", async () => {
    const fileName = uniqueFileName();
    const cache = new Cache<number, string>({ fileName, maxMemorySize: 10, keyType: "number" });
    await cache.set(1, "value1");
    await cache.set(42, "value42");
    await new Promise((r) => setTimeout(r, 200));

    const cache2 = new Cache<number, string>({ fileName, maxMemorySize: 10, keyType: "number" });
    expect(await cache2.get(1)).toBe("value1");
    expect(await cache2.get(42)).toBe("value42");
    expect(await cache2.get(2)).toBeNull();
  });

  it("复杂值类型", async () => {
    const cache = new Cache<string, { id: number; name: string }>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("user1", { id: 1, name: "Alice" });
    const value = await cache.get("user1");
    expect(value).toEqual({ id: 1, name: "Alice" });
  });

  it("getOrSet 使用缓存值", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("key1", "cached");
    const factory = vi.fn(() => "new");
    const value = await cache.getOrSet("key1", factory);
    expect(value).toBe("cached");
    expect(factory).not.toHaveBeenCalled();
  });

  it("getOrSet 调用 factory 并写入缓存", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    const value = await cache.getOrSet("key1", () => "factory-value");
    expect(value).toBe("factory-value");
    expect(await cache.get("key1")).toBe("factory-value");
  });

  it("getOrSet 支持异步 factory", async () => {
    const cache = new Cache<string, number>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    const value = await cache.getOrSet("key1", async () => 42);
    expect(value).toBe(42);
    expect(await cache.get("key1")).toBe(42);
  });

  it("keys 返回所有有效 key", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("a", "1");
    await cache.set("b", "2");
    await cache.set("c", "3");
    await cache.delete("b");
    const keys = await cache.keys();
    expect(keys.sort()).toEqual(["a", "c"]);
  });

  it("size 返回有效条目数", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("a", "1");
    await cache.set("b", "2");
    expect(await cache.size()).toBe(2);
    await cache.delete("a");
    expect(await cache.size()).toBe(1);
  });

  it("stats 统计命中率", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
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

  it("resetStats 重置统计", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("a", "1");
    await cache.get("a");
    expect(cache.stats().hits).toBe(1);
    cache.resetStats();
    expect(cache.stats().hits).toBe(0);
    expect(cache.stats().misses).toBe(0);
  });

  it("clear 同时重置统计", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("a", "1");
    await cache.get("a");
    await cache.clear();
    expect(cache.stats().hits).toBe(0);
    expect(cache.stats().misses).toBe(0);
  });
});
