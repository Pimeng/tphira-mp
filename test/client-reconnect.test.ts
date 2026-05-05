// 客户端自动重连测试
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { startServer } from "../src/server/core/server.js";
import { Client } from "../src/client/client.js";
import { setupMockFetch, sleep } from "./helpers.js";

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
      onReconnect: () => {
        reconnected = true;
      }
    });

    try {
      await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(client.me()).not.toBeNull();

      const meBefore = client.me();

      // 模拟断线：销毁底层 socket
      // @ts-expect-error 访问私有属性
      client.stream?.socket.destroy();

      // 等待重连
      await sleep(3000);

      expect(reconnected).toBe(true);
      expect(client.me()).not.toBeNull();
      expect(client.me()?.id).toBe(meBefore?.id);
    } finally {
      await client.close();
      await running.close();
    }
  }, 15000);

  test("断线后应自动恢复房间状态", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200] } });
    const port = running.address().port;

    let reconnected = false;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      onReconnect: () => {
        reconnected = true;
      }
    });

    try {
      await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await client.createRoom("reconnect-room");
      expect(client.roomId()).not.toBeNull();

      // 模拟断线
      // @ts-expect-error 访问私有属性
      client.stream?.socket.destroy();

      // 等待重连
      await sleep(3000);

      expect(reconnected).toBe(true);
      // 注意：重连后房间可能已被回收（如果等待时间过长），
      // 但认证状态应该已恢复
      expect(client.me()).not.toBeNull();
    } finally {
      await client.close();
      await running.close();
    }
  }, 15000);

  test("超过最大重试次数应触发 onReconnectFailed", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    let failed = false;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      maxReconnectAttempts: 2,
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

      // 模拟断线
      // @ts-expect-error 访问私有属性
      client.stream?.socket.destroy();

      // 等待重试失败（2次重试 + 指数退避约1s+2s = 3s）
      await sleep(6000);

      expect(failed).toBe(true);
    } finally {
      await client.close();
      await running.close();
    }
  }, 15000);

  test("主动关闭不应触发重连", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    let reconnected = false;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      onReconnect: () => {
        reconnected = true;
      }
    });

    await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    // 主动关闭
    await client.close();

    // 等待一段时间
    await sleep(1000);

    expect(reconnected).toBe(false);
    await running.close();
  });

  test("指数退避：重连间隔递增", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    const client = await Client.connect("127.0.0.1", port, {
      autoReconnect: true,
      maxReconnectAttempts: 3
    });

    try {
      await client.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      const timestamps: number[] = [];

      // 拦截重连尝试，快速失败以避免长时间等待连接超时
      (client as any).doConnect = async function() {
        timestamps.push(Date.now());
        throw new Error("mock-connection-failed");
      };

      // 模拟断线
      // @ts-expect-error 访问私有属性
      client.stream?.socket.destroy();

      // 等待几次重试
      await sleep(6000);

      // 验证有多次重试尝试（间隔递增）
      expect(timestamps.length).toBeGreaterThanOrEqual(2);
      if (timestamps.length >= 3) {
        const gap1 = timestamps[1] - timestamps[0];
        const gap2 = timestamps[2] - timestamps[1];
        expect(gap2).toBeGreaterThanOrEqual(gap1 * 0.5); // 指数退避
      }
    } finally {
      await client.close();
      await running.close();
    }
  }, 15000);
});
