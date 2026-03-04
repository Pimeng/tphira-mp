// 协议和连接测试
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import net from "node:net";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "../src/client/client.js";
import { startServer } from "../src/server/core/server.js";
import { sleep, waitFor, setupMockFetch } from "./helpers.js";
import type { TouchFrame } from "../src/common/commands.js";

describe("协议和连接", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("认证阻塞时仍能响应 Ping（避免心跳误判/客户端超时）", async () => {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/me")) {
        await sleep(3500);
        const auth = String(init?.headers && (init.headers as any).Authorization ? (init.headers as any).Authorization : (init?.headers as any)?.get?.("Authorization") ?? "");
        const token = auth.replace(/^Bearer\s+/i, "");
        if (token === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
          return new Response(JSON.stringify({ id: 100, name: "Alice", language: "zh-CN" }), { status: 200 });
        }
        return new Response("unauthorized", { status: 401 });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;
    const alice = await Client.connect("127.0.0.1", port, { timeoutMs: 15000 });

    try {
      const auth = alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await sleep(150);
      await expect(alice.ping()).resolves.toBeGreaterThanOrEqual(0);
      await auth;
    } finally {
      globalThis.fetch = prevFetch;
      await alice.close();
      await running.close();
    }
  }, 10000);

  test("观战者不读数据导致广播背压时，结算仍能正常结束（不应卡死/心跳误断）", async () => {
    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    const running = await startServer({ port: 0, config: { monitors: [200], replay_enabled: true } });
    const port = running.address().port;
    const alice = await Client.connect("127.0.0.1", port, { timeoutMs: 20000 });
    const bob = await Client.connect("127.0.0.1", port, { timeoutMs: 20000 });

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");
      await bob.joinRoom("room1", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing", 3000);

      const bobSocket = ((bob as any).stream as any).socket as net.Socket;
      bobSocket.pause();
      (bobSocket as any).setRecvBufferSize?.(1024);

      const frames: TouchFrame[] = Array.from({ length: 200 }, (_, i) => ({ time: i, points: [[0, { x: 0, y: 0 }]] }));
      for (let i = 0; i < 250; i++) {
        await alice.sendTouches(frames);
      }

      await sleep(150);
      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart", 8000);
      await expect(alice.ping()).resolves.toBeGreaterThanOrEqual(0);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  }, 20000);

  test("协议版本不为 1 时直接断开且不触发认证请求", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200] } });
    const port = running.address().port;

    const prevFetch = globalThis.fetch;
    let fetchCalled = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalled++;
      return prevFetch(input, init);
    }) as typeof fetch;

    const socket = net.createConnection({ host: "127.0.0.1", port });
    let closed = false;
    socket.on("close", () => {
      closed = true;
    });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });

      socket.write(Buffer.from([2]));
      await waitFor(() => closed, 1000);
      expect(fetchCalled).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      socket.destroy();
      await running.close();
    }
  });

  test("阻止同一玩家重复在线连接", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200] } });
    const port = running.address().port;

    const c1 = await Client.connect("127.0.0.1", port);
    const c2 = await Client.connect("127.0.0.1", port);

    try {
      await c1.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await expect(c2.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).rejects.toThrow(/连接过快|该账号已在线/);
    } finally {
      await c1.close();
      await c2.close();
      await running.close();
    }
  });

  test("断线（半关闭）后允许同账号立即重连", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200] } });
    const port = running.address().port;

    const c1 = await Client.connect("127.0.0.1", port);
    const c2 = await Client.connect("127.0.0.1", port);

    try {
      await c1.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      const c1Socket = ((c1 as any).stream as any).socket as net.Socket;
      c1Socket.end();
      await waitFor(() => c1Socket.writableEnded || c1Socket.destroyed, 1000);

      await expect(c2.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).resolves.toBeUndefined();
      await expect(c2.ping()).resolves.toBeGreaterThanOrEqual(0);
    } finally {
      await c1.close();
      await c2.close();
      await running.close();
    }
  });
});
