import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { startServer, type RunningServer } from "../../src/server/core/server.js";
import { Client } from "../../src/client/client.js";
import type { ServerConfig } from "../../src/server/core/types.js";
import { sleep } from "../helpers.js";

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await sleep(20);
  }
  throw new Error("Timeout waiting for condition");
}

// 辅助函数：创建并等待WebSocket连接
async function createWebSocket(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("连接超时")), 2000);
  });
  return ws;
}

// 辅助函数：关闭WebSocket并等待完成
async function closeWebSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  
  ws.close();
  await new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on("close", () => resolve());
    setTimeout(() => resolve(), 200);
  });
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

        const usersByToken: Record<string, { id: number; name: string; language: string }> = {
          user1token: { id: 1001, name: "User1", language: "zh-CN" },
          user2token: { id: 1002, name: "User2", language: "zh-CN" },
          roomloghost: { id: 3001, name: "RoomLogHost", language: "zh-CN" },
          roomlogguest: { id: 3002, name: "RoomLogGuest", language: "zh-CN" }
        };
        const user = usersByToken[token];
        if (user) {
          return new Response(JSON.stringify(user), { status: 200 });
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
      replay_enabled: false,
      log_level: "ERROR"
    };

    server = await startServer({ host: "127.0.0.1", port: 0, config });
    gamePort = server.address().port;
    httpPort = server.http!.address().port;

    await sleep(100);
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    // 增加超时时间并添加错误处理
    try {
      await Promise.race([
        server.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Server close timeout")), 15000))
      ]);
    } catch (e) {
      console.error("Error closing server:", e);
    }
  }, 20000); // 设置afterAll超时为20秒

  // 移除 afterEach 中的长延迟，改为在需要时单独等待
  afterEach(async () => {
    await sleep(100); // 减少到100ms
  });

  describe("基础连接", () => {
    test("应该能够连接到 WebSocket", async () => {
      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      await closeWebSocket(ws);
    });

    test("应该响应 ping 消息", async () => {
      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

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
      await closeWebSocket(ws);
    });
  });

  describe("房间订阅", () => {
    test("应该能够订阅房间并接收初始状态", async () => {
      const client = await Client.connect("127.0.0.1", gamePort);
      await client.authenticate("user1token");
      await client.createRoom("test-room-1");

      await sleep(100);

      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

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

      await closeWebSocket(ws);
      await client.close();
    });

    test("应该对不存在的房间返回错误", async () => {
      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

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

      await closeWebSocket(ws);
    });

    test("应该推送订阅房间的实时日志事件", async () => {
      const roomId = "room-log-test";
      const host = await Client.connect("127.0.0.1", gamePort);
      const guest = await Client.connect("127.0.0.1", gamePort);
      let ws: WebSocket | null = null;

      try {
        await host.authenticate("roomloghost");
        await host.createRoom(roomId);

        ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);
        const messages: any[] = [];
        ws.on("message", (data) => {
          messages.push(JSON.parse(data.toString()));
        });

        ws.send(JSON.stringify({
          type: "subscribe",
          roomId,
          userId: 3001
        }));

        await waitFor(() => messages.some(m => m.type === "subscribed"));
        const countRoomLogsFor = (name: string) => messages.filter((m) => {
          const text = String(m.data?.message ?? "");
          return m.type === "room_log" && text.includes(name) && text.includes(roomId);
        }).length;

        server.state.logger.log("INFO", "opaque structured room log", undefined, { roomId });
        await waitFor(() => messages.some(m => m.type === "room_log" && m.data.message === "opaque structured room log"));
        server.state.logger.log("MARK", "opaque structured room mark", undefined, { roomId });
        await waitFor(() => messages.some(m => m.type === "room_log" && m.data.message === "opaque structured room mark"));

        await guest.authenticate("roomlogguest");
        await guest.joinRoom(roomId, false);
        await waitFor(() => countRoomLogsFor("RoomLogGuest") >= 1);

        const guestLogsBeforeChat = countRoomLogsFor("RoomLogGuest");
        await guest.chat("hello");
        await waitFor(() => countRoomLogsFor("RoomLogGuest") > guestLogsBeforeChat);

        const hostLogsBeforeSelect = countRoomLogsFor("RoomLogHost");
        await host.selectChart(1);
        await waitFor(() => countRoomLogsFor("RoomLogHost") > hostLogsBeforeSelect);
        await host.requestStart();
        const guestLogsBeforeReady = countRoomLogsFor("RoomLogGuest");
        await guest.ready();
        await waitFor(() => countRoomLogsFor("RoomLogGuest") > guestLogsBeforeReady);

        await waitFor(() => messages.some(m => m.type === "room_log" && String(m.data.message).includes(roomId)));
        const guestLogsBeforeLeave = countRoomLogsFor("RoomLogGuest");
        await guest.leaveRoom();
        await waitFor(() => countRoomLogsFor("RoomLogGuest") > guestLogsBeforeLeave);
      } finally {
        if (ws) await closeWebSocket(ws);
        await guest.close();
        await host.close();
      }
    });
  });

  describe("管理员订阅", () => {
    test("应该能够使用有效令牌订阅", async () => {
      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

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

      await closeWebSocket(ws);
    });

    test("应该对无效令牌返回错误", async () => {
      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

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

      await closeWebSocket(ws);
    });

    test("管理员更新应该包含详细信息", async () => {
      const client = await Client.connect("127.0.0.1", gamePort);
      await client.authenticate("user2token"); // 使用不同的用户避免冲突
      await client.createRoom("admin-detail-test");

      await sleep(100);

      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

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
      expect(room.host.id).toBe(1002); // User2
      expect(room.host.name).toBe("User2");
      expect(room.state.type).toBe("select_chart");
      expect(room.users[0].id).toBe(1002);
      expect(room.users[0].is_host).toBe(true);

      await closeWebSocket(ws);
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
      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

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

      await closeWebSocket(ws);
      
      // 清理
      server.state.tempAdminTokens.delete(tempToken);
    });
  });

  describe("房间索引广播", () => {
    test("多个房间订阅应只收到自己房间的消息", async () => {
      const client1 = await Client.connect("127.0.0.1", gamePort);
      const client2 = await Client.connect("127.0.0.1", gamePort);

      try {
        await client1.authenticate("user1token");
        // 如果用户已在房间中，先离开
        if (client1.roomId()) await client1.leaveRoom();
        await client1.createRoom("room-index-1");

        await client2.authenticate("user2token");
        if (client2.roomId()) await client2.leaveRoom();
        await client2.createRoom("room-index-2");

        await sleep(100);

        const ws1 = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);
        const ws2 = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

        const messages1: any[] = [];
        const messages2: any[] = [];

        ws1.on("message", (data) => {
          messages1.push(JSON.parse(data.toString()));
        });
        ws2.on("message", (data) => {
          messages2.push(JSON.parse(data.toString()));
        });

        // 分别订阅不同房间
        ws1.send(JSON.stringify({ type: "subscribe", roomId: "room-index-1", userId: 1001 }));
        ws2.send(JSON.stringify({ type: "subscribe", roomId: "room-index-2", userId: 1002 }));

        await waitFor(() => messages1.some(m => m.type === "subscribed"));
        await waitFor(() => messages2.some(m => m.type === "subscribed"));

        // 清空初始消息
        messages1.length = 0;
        messages2.length = 0;

        // client1 操作房间1
        await client1.selectChart(1);

        await sleep(200);

        // ws1 应该收到 room-index-1 的更新
        const ws1Updates = messages1.filter(m => m.type === "room_update");
        expect(ws1Updates.length).toBeGreaterThanOrEqual(1);

        // ws2 不应该收到 room-index-1 的更新
        const ws2UpdatesForRoom1 = messages2.filter(
          m => m.type === "room_update" && m.data?.roomid === "room-index-1"
        );
        expect(ws2UpdatesForRoom1.length).toBe(0);

        await closeWebSocket(ws1);
        await closeWebSocket(ws2);
      } finally {
        await client1.close();
        await client2.close();
      }
    });

    test("取消订阅后不应再收到房间消息", async () => {
      const client = await Client.connect("127.0.0.1", gamePort);

      try {
        await client.authenticate("user1token");
        if (client.roomId()) await client.leaveRoom();
        await client.createRoom("unsub-test");

        await sleep(100);

        const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);
        const messages: any[] = [];

        ws.on("message", (data) => {
          messages.push(JSON.parse(data.toString()));
        });

        ws.send(JSON.stringify({ type: "subscribe", roomId: "unsub-test", userId: 1001 }));
        await waitFor(() => messages.some(m => m.type === "subscribed"));

        // 取消订阅
        ws.send(JSON.stringify({ type: "unsubscribe" }));
        await waitFor(() => messages.some(m => m.type === "unsubscribed"));

        // 清空消息
        const beforeCount = messages.length;

        // 操作房间
        await client.selectChart(1);
        await sleep(300);

        // 不应该收到新的 room_update
        const newMessages = messages.slice(beforeCount);
        const roomUpdates = newMessages.filter(m => m.type === "room_update");
        expect(roomUpdates.length).toBe(0);

        await closeWebSocket(ws);
      } finally {
        await client.close();
      }
    });

    test("WebSocket 断开后应从房间索引移除", async () => {
      const client = await Client.connect("127.0.0.1", gamePort);

      try {
        await client.authenticate("user1token");
        if (client.roomId()) await client.leaveRoom();
        await client.createRoom("disconnect-test");

        await sleep(100);

        const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);
        const messages: any[] = [];

        ws.on("message", (data) => {
          messages.push(JSON.parse(data.toString()));
        });

        ws.send(JSON.stringify({ type: "subscribe", roomId: "disconnect-test", userId: 1001 }));
        await waitFor(() => messages.some(m => m.type === "subscribed"));

        // 断开 WebSocket
        await closeWebSocket(ws);
        await sleep(100);

        // 检查服务端房间索引
        const wsService = server.state.wsService;
        if (wsService) {
          // @ts-expect-error 访问私有属性
          const subscribers = wsService.roomSubscribers?.get("disconnect-test");
          if (subscribers) {
            expect(subscribers.size).toBe(0);
          }
        }
      } finally {
        await client.close();
      }
    });
  });

  describe("错误处理", () => {
    test("应该对无效消息格式返回错误", async () => {
      const ws = await createWebSocket(`ws://127.0.0.1:${httpPort}/ws`);

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

      await closeWebSocket(ws);
    });
  });
});