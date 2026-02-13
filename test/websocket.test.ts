import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { startServer, type RunningServer } from "../src/server/server.js";
import { Client } from "../src/client/client.js";
import type { ServerConfig } from "../src/server/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error("Timeout waiting for condition");
}

describe("WebSocket 测试", () => {
  let server: RunningServer;
  let httpPort: number;
  let gamePort: number;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    // 模拟身份验证的 fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      
      // 只拦截外部认证和谱面请求，让本地 HTTP 请求通过
      if (url.includes("127.0.0.1") || url.includes("localhost")) {
        return originalFetch(input, init);
      }
      
      if (url.endsWith("/me")) {
        const auth = String(init?.headers && (init.headers as any).Authorization ? (init.headers as any).Authorization : (init?.headers as any)?.get?.("Authorization") ?? "");
        const token = auth.replace(/^Bearer\s+/i, "");
        
        if (token === "user1token") {
          return new Response(JSON.stringify({ id: 1001, name: "User1", language: "zh-CN" }), { status: 200 });
        }
        if (token === "user2token") {
          return new Response(JSON.stringify({ id: 1002, name: "User2", language: "zh-CN" }), { status: 200 });
        }
        return new Response("unauthorized", { status: 401 });
      }

      if (/\/chart\/\d+$/.test(url)) {
        const id = Number(url.split("/").at(-1));
        return new Response(JSON.stringify({ id, name: `TestChart-${id}` }), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    // 启动服务器并启用 HTTP 服务
    const config: Partial<ServerConfig> = {
      monitors: [2],
      http_service: true,
      http_port: 0,
      admin_token: "test-admin-token",
      replay_enabled: false
    };

    server = await startServer({ host: "127.0.0.1", port: 0, config });
    gamePort = server.address().port;
    httpPort = server.http!.address().port;

    await sleep(200);
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await server.close();
  });

  afterEach(async () => {
    await sleep(5500); // 避免"连接过快"错误
  });

  describe("基础连接", () => {
    test("应该能够连接到 WebSocket", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
        setTimeout(() => reject(new Error("连接超时")), 3000);
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    test("应该响应 ping 消息", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      const pongReceived = new Promise<void>((resolve) => {
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "pong") {
            resolve();
          }
        });
      });

      ws.send(JSON.stringify({ type: "ping" }));
      
      await expect(pongReceived).resolves.toBeUndefined();
      ws.close();
    });
  });

  describe("房间订阅", () => {
    test("应该能够订阅房间并接收初始状态", async () => {
      const client = await Client.connect("127.0.0.1", gamePort);
      await client.authenticate("user1token");
      await client.createRoom("test-room-1");

      await sleep(200);

      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      const messages: any[] = [];
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      ws.send(JSON.stringify({
        type: "subscribe",
        roomId: "test-room-1",
        userId: 1001
      }));

      await waitFor(() => messages.some(m => m.type === "subscribed"));
      await waitFor(() => messages.some(m => m.type === "room_update"));

      const subscribed = messages.find(m => m.type === "subscribed");
      expect(subscribed).toBeDefined();
      expect(subscribed.roomId).toBe("test-room-1");

      const roomUpdate = messages.find(m => m.type === "room_update");
      expect(roomUpdate).toBeDefined();
      expect(roomUpdate.data.roomid).toBe("test-room-1");
      expect(roomUpdate.data.state).toBe("select_chart");

      ws.close();
      await client.close();
    });

    test("应该对不存在的房间返回错误", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      const errorReceived = new Promise<any>((resolve) => {
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "error") {
            resolve(msg);
          }
        });
      });

      ws.send(JSON.stringify({
        type: "subscribe",
        roomId: "non-existent-room"
      }));

      const error = await errorReceived;
      expect(error.message).toBe("room-not-found");

      ws.close();
    });
  });

  describe("管理员订阅", () => {
    test("应该能够使用有效令牌订阅", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      const messages: any[] = [];
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      ws.send(JSON.stringify({
        type: "admin_subscribe",
        token: "test-admin-token"
      }));

      await waitFor(() => messages.some(m => m.type === "admin_subscribed"));
      await waitFor(() => messages.some(m => m.type === "admin_update"));

      const subscribed = messages.find(m => m.type === "admin_subscribed");
      expect(subscribed).toBeDefined();

      const adminUpdate = messages.find(m => m.type === "admin_update");
      expect(adminUpdate).toBeDefined();
      expect(adminUpdate.data.timestamp).toBeDefined();
      expect(adminUpdate.data.changes).toBeDefined();
      expect(Array.isArray(adminUpdate.data.changes.rooms)).toBe(true);

      ws.close();
    });

    test("应该对无效令牌返回错误", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      const errorReceived = new Promise<any>((resolve) => {
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "error") {
            resolve(msg);
          }
        });
      });

      ws.send(JSON.stringify({
        type: "admin_subscribe",
        token: "invalid-token"
      }));

      const error = await errorReceived;
      expect(error.message).toBe("unauthorized");

      ws.close();
    });

    test("管理员更新应该包含详细信息", async () => {
      const client = await Client.connect("127.0.0.1", gamePort);
      await client.authenticate("user1token");
      await client.createRoom("admin-detail-test");

      await sleep(200);

      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      const updates: any[] = [];
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "admin_update") {
          updates.push(msg.data);
        }
      });

      ws.send(JSON.stringify({
        type: "admin_subscribe",
        token: "test-admin-token"
      }));

      await waitFor(() => updates.length > 0);
      
      const room = updates[0].changes.rooms.find((r: any) => r.roomid === "admin-detail-test");
      expect(room).toBeDefined();
      
      // 检查详细字段
      expect(room.max_users).toBe(8);
      expect(room.current_users).toBe(1);
      expect(room.host.id).toBe(1001);
      expect(room.host.name).toBe("User1");
      expect(room.state.type).toBe("select_chart");
      expect(room.users[0].id).toBe(1001);
      expect(room.users[0].is_host).toBe(true);

      ws.close();
      await client.close();
    });

    test("应该支持临时 token 订阅（需要 OTP）", async () => {
      // 此测试验证临时 token 在 WebSocket 中的支持
      // 由于测试服务器配置了 admin_token，OTP 功能被禁用
      // 我们通过直接在 state 中添加临时 token 来模拟
      
      const tempToken = "test-temp-token-12345";
      const clientIp = "127.0.0.1";
      const expiresAt = Date.now() + 4 * 60 * 60 * 1000; // 4小时后过期
      
      // 直接在 server state 中添加临时 token（模拟 OTP 验证后的结果）
      server.state.tempAdminTokens.set(tempToken, { ip: clientIp, expiresAt, banned: false });

      // 使用临时 token 订阅 WebSocket
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      const messages: any[] = [];
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      ws.send(JSON.stringify({
        type: "admin_subscribe",
        token: tempToken
      }));

      await waitFor(() => messages.some(m => m.type === "admin_subscribed"));
      await waitFor(() => messages.some(m => m.type === "admin_update"));

      const subscribed = messages.find(m => m.type === "admin_subscribed");
      expect(subscribed).toBeDefined();

      const adminUpdate = messages.find(m => m.type === "admin_update");
      expect(adminUpdate).toBeDefined();

      ws.close();
      
      // 清理
      server.state.tempAdminTokens.delete(tempToken);
    });
  });

  describe("错误处理", () => {
    test("应该对无效消息格式返回错误", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      
      await new Promise<void>((resolve) => {
        ws.on("open", () => resolve());
      });

      const errorReceived = new Promise<any>((resolve) => {
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "error") {
            resolve(msg);
          }
        });
      });

      ws.send("invalid json");

      const error = await errorReceived;
      expect(error.message).toBe("invalid-message");

      ws.close();
    });
  });
});
