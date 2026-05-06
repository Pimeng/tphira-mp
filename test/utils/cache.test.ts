import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("内存大小限制", async () => {
    const cache = new Cache<string, string>({ fileName: uniqueFileName(), maxMemorySize: 2 });
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");
    await cache.set("key3", "value3");
    // 最旧的应该被移除
    expect(await cache.get("key1")).toBeNull();
    expect(await cache.get("key2")).not.toBeNull();
    expect(await cache.get("key3")).not.toBeNull();
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

    // 等待异步写入
    await new Promise((r) => setTimeout(r, 100));

    // 创建新实例读取
    const cache2 = new Cache<string, string>({ fileName, maxMemorySize: 10 });
    const value = await cache2.get("key1");
    expect(value).toBe("value1");
  });

  it("不持久化", async () => {
    const fileName = uniqueFileName();
    const cache = new Cache<string, string>({ fileName, maxMemorySize: 10, persistToDisk: false });
    await cache.set("key1", "value1");
    await new Promise((r) => setTimeout(r, 100));

    const cache2 = new Cache<string, string>({ fileName, maxMemorySize: 10 });
    expect(await cache2.get("key1")).toBeNull();
  });

  it("数字 key", async () => {
    const cache = new Cache<number, string>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set(1, "value1");
    expect(await cache.get(1)).toBe("value1");
  });

  it("复杂值类型", async () => {
    const cache = new Cache<string, { id: number; name: string }>({ fileName: uniqueFileName(), maxMemorySize: 10 });
    await cache.set("user1", { id: 1, name: "Alice" });
    const value = await cache.get("user1");
    expect(value).toEqual({ id: 1, name: "Alice" });
  });
});