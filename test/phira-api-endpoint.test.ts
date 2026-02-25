// Phira API 端点配置测试
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "../src/client/client.js";
import { startServer } from "../src/server/server.js";
import { sleep, waitFor } from "./helpers.js";

describe("Phira API 端点配置", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  const createMockFetch = (customEndpoint: string) => {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url, init });

      // 验证请求使用了正确的端点
      if (url.includes("/me") || url.includes("/chart/") || url.includes("/record/")) {
        // 记录请求以便后续验证
      }

      if (url.endsWith("/me")) {
        const auth = String(init?.headers && (init.headers as any).Authorization ? (init.headers as any).Authorization : (init?.headers as any)?.get?.("Authorization") ?? "");
        const token = auth.replace(/^Bearer\s+/i, "");
        if (token === "test_token_for_custom_endpoint") {
          return new Response(JSON.stringify({ id: 999, name: "CustomUser", language: "zh-CN" }), { status: 200 });
        }
        return new Response("unauthorized", { status: 401 });
      }

      if (/\/chart\/\d+$/.test(url)) {
        const id = Number(url.split("/").at(-1));
        return new Response(JSON.stringify({ id, name: `CustomChart-${id}` }), { status: 200 });
      }

      if (/\/record\/\d+$/.test(url)) {
        const id = Number(url.split("/").at(-1));
        return new Response(
          JSON.stringify({
            id,
            player: 999,
            score: 1000000,
            perfect: 100,
            good: 0,
            bad: 0,
            miss: 0,
            max_combo: 100,
            accuracy: 1.0,
            full_combo: true,
            std: 0,
            std_score: 0
          }),
          { status: 200 }
        );
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  };

  beforeEach(() => {
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("使用默认 Phira API 端点", async () => {
    const mockFetch = createMockFetch("https://phira.5wyxi.com");
    globalThis.fetch = mockFetch;

    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    // 不配置 phira_api_endpoint，使用默认值
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    const client = await Client.connect("127.0.0.1", port);

    try {
      await client.authenticate("test_token_for_custom_endpoint");
      
      // 验证请求发送到默认端点
      const meCalls = fetchCalls.filter(c => c.url.endsWith("/me"));
      expect(meCalls.length).toBeGreaterThan(0);
      expect(meCalls[0].url).toContain("phira.5wyxi.com");
    } finally {
      await client.close();
      await running.close();
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  });

  test("使用自定义 Phira API 端点", async () => {
    const customEndpoint = "https://custom-phira-api.example.com";
    const mockFetch = createMockFetch(customEndpoint);
    globalThis.fetch = mockFetch;

    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    // 配置自定义 Phira API 端点
    const running = await startServer({ 
      port: 0, 
      config: { 
        monitors: [],
        phira_api_endpoint: customEndpoint
      } 
    });
    const port = running.address().port;

    const client = await Client.connect("127.0.0.1", port);

    try {
      await client.authenticate("test_token_for_custom_endpoint");
      
      // 验证请求发送到自定义端点
      const meCalls = fetchCalls.filter(c => c.url.endsWith("/me"));
      expect(meCalls.length).toBeGreaterThan(0);
      expect(meCalls[0].url).toContain("custom-phira-api.example.com");
    } finally {
      await client.close();
      await running.close();
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  });

  test("自定义端点的谱面获取", async () => {
    const customEndpoint = "https://phira-mirror.example.org";
    const mockFetch = createMockFetch(customEndpoint);
    globalThis.fetch = mockFetch;

    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    const running = await startServer({ 
      port: 0, 
      config: { 
        monitors: [],
        phira_api_endpoint: customEndpoint
      } 
    });
    const port = running.address().port;

    const client = await Client.connect("127.0.0.1", port);

    try {
      await client.authenticate("test_token_for_custom_endpoint");
      await client.createRoom("test-room");
      
      // 选择谱面会触发 /chart/ 请求
      await client.selectChart(12345);
      
      // 验证谱面请求发送到自定义端点
      const chartCalls = fetchCalls.filter(c => /\/chart\//.test(c.url));
      expect(chartCalls.length).toBeGreaterThan(0);
      expect(chartCalls[0].url).toContain("phira-mirror.example.org");
      expect(chartCalls[0].url).toContain("/chart/12345");
    } finally {
      await client.close();
      await running.close();
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  });

  test("环境变量配置 Phira API 端点", async () => {
    const customEndpoint = "https://env-configured.example.com";
    const mockFetch = createMockFetch(customEndpoint);
    globalThis.fetch = mockFetch;

    // 设置环境变量
    const prevEndpoint = process.env.PHIRA_API_ENDPOINT;
    process.env.PHIRA_API_ENDPOINT = customEndpoint;

    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    try {
      // 不通过 config 传入，让服务器从环境变量读取
      const running = await startServer({ port: 0, config: { monitors: [] } });
      const port = running.address().port;

      const client = await Client.connect("127.0.0.1", port);

      try {
        await client.authenticate("test_token_for_custom_endpoint");
        
        // 验证请求发送到环境变量配置的端点
        const meCalls = fetchCalls.filter(c => c.url.endsWith("/me"));
        expect(meCalls.length).toBeGreaterThan(0);
        expect(meCalls[0].url).toContain("env-configured.example.com");
      } finally {
        await client.close();
        await running.close();
      }
    } finally {
      // 恢复环境变量
      process.env.PHIRA_API_ENDPOINT = prevEndpoint;
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  });
});
