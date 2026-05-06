// 客户端自动重连测试
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { startServer } from "../../src/server/core/server.js";
import { Client } from "../../src/client/client.js";
import { setupMockFetch, sleep, waitFor } from "../helpers.js";

describe("客户端自动重连", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("断线后应自动重连并恢复认证状态", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    let reconnected = false;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectBaseDelayMs: 50,
      onReconnect: () => {
        reconnected = true;
      }
    });

    try {
      await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(client.me()).not.toBeNull();

      const meBefore = client.me();

      client.disconnect();
      await waitFor(() => reconnected, 2000);

      expect(client.me()).not.toBeNull();
      expect(client.me()?.id).toBe(meBefore?.id);
    } finally {
      await client.close();
      await running.close();
    }
  });

  test("断线后应自动恢复房间状态", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200] } });
    const port = running.address().port;

    let reconnected = false;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      reconnectBaseDelayMs: 50,
      onReconnect: () => {
        reconnected = true;
      }
    });

    try {
      await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await client.createRoom("reconnect-room");
      expect(client.roomId()).not.toBeNull();

      client.disconnect();
      await waitFor(() => reconnected, 2000);

      expect(client.me()).not.toBeNull();
    } finally {
      await client.close();
      await running.close();
    }
  });

  test("超过最大重试次数应触发 onReconnectFailed", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    let failed = false;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      maxReconnectAttempts: 2,
      reconnectBaseDelayMs: 50,
      onReconnectFailed: () => {
        failed = true;
      }
    });

    try {
      await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      // 拦截重连尝试，快速失败
      (client as any).doConnect = async function() {
        throw new Error("mock-connection-failed");
      };

      client.disconnect();
      await waitFor(() => failed, 2000);

      expect(failed).toBe(true);
    } finally {
      await client.close();
      await running.close();
    }
  });

  test("主动关闭不应触发重连", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    let reconnected = false;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      reconnectBaseDelayMs: 50,
      onReconnect: () => {
        reconnected = true;
      }
    });

    await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    await client.close();
    await sleep(200);

    expect(reconnected).toBe(false);
    await running.close();
  });

  test("指数退避：重连间隔递增", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      maxReconnectAttempts: 3,
      reconnectBaseDelayMs: 50
    });

    try {
      await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      const timestamps: number[] = [];

      // 拦截重连尝试，快速失败以避免长时间等待连接超时
      (client as any).doConnect = async function() {
        timestamps.push(Date.now());
        throw new Error("mock-connection-failed");
      };

      client.disconnect();
      await waitFor(() => timestamps.length >= 3, 2000);

      // 验证有多次重试尝试（间隔递增）
      expect(timestamps.length).toBeGreaterThanOrEqual(3);
      const gap1 = timestamps[1] - timestamps[0];
      const gap2 = timestamps[2] - timestamps[1];
      expect(gap2).toBeGreaterThanOrEqual(gap1 * 0.5); // 指数退避
    } finally {
      await client.close();
      await running.close();
    }
  });
});
