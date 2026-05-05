// fetchWithRetry 指数退避和重试策略测试
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { fetchWithRetry } from "../src/common/http.js";

describe("fetchWithRetry 重试策略", () => {
  const originalFetch = globalThis.fetch;

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("4xx 错误不应重试，直接返回", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response("bad request", { status: 400 });
    }) as typeof fetch;

    const res = await fetchWithRetry("http://example.com/test", {}, 5000);
    expect(res.status).toBe(400);
    expect(callCount).toBe(1); // 只调用一次，不重试
  });

  test("5xx 错误应该重试", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount < 3) {
        return new Response("server error", { status: 500 });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const res = await fetchWithRetry("http://example.com/test", {}, 5000, 3);
    expect(res.status).toBe(200);
    expect(callCount).toBe(3);
  });

  test("429 错误应该重试", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount < 2) {
        return new Response("too many requests", { status: 429 });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const res = await fetchWithRetry("http://example.com/test", {}, 5000, 2);
    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("网络超时错误应该重试", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error("ECONNRESET");
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const res = await fetchWithRetry("http://example.com/test", {}, 5000, 2);
    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("不可重试的网络错误应直接抛出", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      throw new Error("ENOTFOUND");
    }) as typeof fetch;

    await expect(fetchWithRetry("http://example.com/test", {}, 5000, 0)).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  test("指数退避：重试间隔递增", async () => {
    const timestamps: number[] = [];
    globalThis.fetch = (async () => {
      timestamps.push(Date.now());
      return new Response("error", { status: 500 });
    }) as typeof fetch;

    try {
      await fetchWithRetry("http://example.com/test", {}, 5000, 3);
    } catch {
      // expected
    }

    expect(timestamps.length).toBe(4); // 初始 + 3 次重试

    // 验证间隔递增（允许抖动）
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    const gap3 = timestamps[3] - timestamps[2];

    expect(gap2).toBeGreaterThanOrEqual(gap1 * 0.8); // 指数退避
    expect(gap3).toBeGreaterThanOrEqual(gap2 * 0.8);
  });

  test("达到最大重试次数后抛出错误", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response("server error", { status: 500 });
    }) as typeof fetch;

    await expect(fetchWithRetry("http://example.com/test", {}, 5000, 1)).rejects.toThrow();
    expect(callCount).toBe(2); // 初始 + 1 次重试
  });
});
