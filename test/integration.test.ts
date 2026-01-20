import { afterAll, beforeAll, describe, expect, test } from "vitest";
import net from "node:net";
import { Client } from "../src/client/client.js";
import { startServer } from "../src/server/server.js";
import type { TouchFrame } from "../src/common/commands.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await sleep(20);
  }
  throw new Error("等待超时");
}

describe("端到端（mock 远端 HTTP）", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/me")) {
        const auth = String(init?.headers && (init.headers as any).Authorization ? (init.headers as any).Authorization : (init?.headers as any)?.get?.("Authorization") ?? "");
        const token = auth.replace(/^Bearer\s+/i, "");
        if (token === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
          return new Response(JSON.stringify({ id: 100, name: "Alice", language: "zh-CN" }), { status: 200 });
        }
        if (token === "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
          return new Response(JSON.stringify({ id: 200, name: "Bob", language: "zh-CN" }), { status: 200 });
        }
        return new Response("unauthorized", { status: 401 });
      }

      if (/\/chart\/\d+$/.test(url)) {
        const id = Number(url.split("/").at(-1));
        return new Response(JSON.stringify({ id, name: `Chart-${id}` }), { status: 200 });
      }

      if (/\/record\/\d+$/.test(url)) {
        const id = Number(url.split("/").at(-1));
        return new Response(
          JSON.stringify({
            id,
            player: 100,
            score: 999999,
            perfect: 1,
            good: 0,
            bad: 0,
            miss: 0,
            max_combo: 1,
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
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("创建房间→观战加入→准备→开始→触控转发→结算结束", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200] } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");
      await bob.joinRoom("room1", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing");
      await waitFor(() => bob.roomState()?.type === "Playing");

      const frames: TouchFrame[] = [{ time: 1, points: [[0, { x: 0, y: 1 }]] }];
      await alice.sendTouches(frames);

      await waitFor(() => bob.livePlayer(100).touch_frames.length > 0);
      expect(bob.livePlayer(100).touch_frames.at(-1)).toEqual(frames[0]);

      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart");
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
    }
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
    const alice = await Client.connect("127.0.0.1", port, { timeoutMs: 20000 });

    try {
      const auth = alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await sleep(200);
      await expect(alice.ping()).resolves.toBeGreaterThanOrEqual(0);
      await auth;
    } finally {
      globalThis.fetch = prevFetch;
      await alice.close();
      await running.close();
    }
  }, 10000);

  test("观战者不读数据导致广播背压时，结算仍能正常结束（不应卡死/心跳误断）", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200] } });
    const port = running.address().port;
    const alice = await Client.connect("127.0.0.1", port, { timeoutMs: 30000 });
    const bob = await Client.connect("127.0.0.1", port, { timeoutMs: 30000 });

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");
      await bob.joinRoom("room1", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing", 5000);

      const bobSocket = ((bob as any).stream as any).socket as net.Socket;
      bobSocket.pause();
      (bobSocket as any).setRecvBufferSize?.(1024);

      const frames: TouchFrame[] = Array.from({ length: 200 }, (_, i) => ({ time: i, points: [[0, { x: 0, y: 0 }]] }));
      for (let i = 0; i < 250; i++) {
        await alice.sendTouches(frames);
      }

      await sleep(200);
      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart", 20000);
      await expect(alice.ping()).resolves.toBeGreaterThanOrEqual(0);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
    }
  }, 30000);

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
      await waitFor(() => closed, 2000);
      expect(fetchCalled).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      socket.destroy();
      await running.close();
    }
  });

  test("HTTP /room 返回房间列表并过滤 _ 前缀", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");
      await bob.createRoom("_hidden");

      const resp = await originalFetch(`http://127.0.0.1:${httpPort}/room`);
      expect(resp.ok).toBe(true);
      const json = (await resp.json()) as {
        rooms: Array<{
          roomid: string;
          cycle: boolean;
          lock: boolean;
          host: { name: string; id: string };
          state: string;
          chart: { name: string; id: string } | null;
          players: Array<{ name: string; id: number }>;
        }>;
        total: number;
      };
      expect(json.total).toBe(1);
      expect(json.rooms.length).toBe(1);
      expect(json.rooms[0]!.roomid).toBe("room1");
      expect(json.rooms[0]!.host).toEqual({ name: "Alice", id: "100" });
      expect(json.rooms[0]!.chart).toBe(null);
      expect(json.rooms[0]!.players).toEqual([{ name: "Alice", id: 100 }]);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
    }
  });

  test("ROOM_MAX_USERS 生效（最多 1 人）", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200], room_max_users: 1 } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");
      await expect(bob.joinRoom("room1", false)).rejects.toThrow("房间已满");
    } finally {
      await alice.close();
      await bob.close();
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
      await expect(c2.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).rejects.toThrow("该账号已在线");
    } finally {
      await c1.close();
      await c2.close();
      await running.close();
    }
  });
});

