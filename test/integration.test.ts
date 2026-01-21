import { afterAll, beforeAll, describe, expect, test } from "vitest";
import net from "node:net";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  let hitokotoCalls = 0;

  beforeAll(() => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://v1.hitokoto.cn/")) {
        hitokotoCalls += 1;
        return new Response(
          JSON.stringify({
            hitokoto: "欲买桂花同载酒，荒泷天下第一斗。",
            from: "原神",
            from_who: "钟离&荒泷一斗"
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/me")) {
        const auth = String(init?.headers && (init.headers as any).Authorization ? (init.headers as any).Authorization : (init?.headers as any)?.get?.("Authorization") ?? "");
        const token = auth.replace(/^Bearer\s+/i, "");
        if (token === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
          return new Response(JSON.stringify({ id: 100, name: "Alice", language: "zh-CN" }), { status: 200 });
        }
        if (token === "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
          return new Response(JSON.stringify({ id: 200, name: "Bob", language: "zh-CN" }), { status: 200 });
        }
        if (token === "cccccccccccccccccccccccccccccccc") {
          return new Response(JSON.stringify({ id: 300, name: "Carol", language: "zh-CN" }), { status: 200 });
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
      await alice.createRoom("room1");
      await waitFor(() => hitokotoCalls >= 1);

      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      const bobChat: string[] = [];
      await waitFor(() => {
        const batch = bob.takeMessages()
          .filter((m) => m.type === "Chat" && m.user === 0)
          .map((m) => (m as any).content as string);
        bobChat.push(...batch);
        return bobChat.some((s) => s.includes("当前可用的房间如下："));
      }, 2000);

      expect(bobChat.join("\n")).toContain("欲买桂花同载酒，荒泷天下第一斗。");
      expect(bobChat.join("\n")).toContain("当前可用的房间如下：");
      expect(bobChat.join("\n")).toContain("room1（1/8）");
      expect(hitokotoCalls).toBe(1);

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

  test("HTTP_SERVICE 默认关闭：不启动 HTTP 服务", async () => {
    const prevHttp = process.env.HTTP_SERVICE;
    const prevHttpPort = process.env.HTTP_PORT;
    delete process.env.HTTP_SERVICE;
    delete process.env.HTTP_PORT;

    const running = await startServer({ port: 0, config: { monitors: [200] } });
    try {
      expect(running.http).toBeUndefined();
    } finally {
      process.env.HTTP_SERVICE = prevHttp;
      process.env.HTTP_PORT = prevHttpPort;
      await running.close();
    }
  });

  test("HTTP_SERVICE 环境变量可开启 HTTP 服务", async () => {
    const prevHttp = process.env.HTTP_SERVICE;
    const prevHttpPort = process.env.HTTP_PORT;
    process.env.HTTP_SERVICE = "true";
    delete process.env.HTTP_PORT;

    const running = await startServer({ port: 0, config: { monitors: [200], http_port: 0 } });
    const httpPort = running.http!.address().port;
    try {
      const res = await originalFetch(`http://127.0.0.1:${httpPort}/room`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty("rooms");
    } finally {
      process.env.HTTP_SERVICE = prevHttp;
      process.env.HTTP_PORT = prevHttpPort;
      await running.close();
    }
  });

  test("MONITORS 环境变量生效：观战用户可加入", async () => {
    const prev = process.env.MONITORS;
    process.env.MONITORS = "200";

    const running = await startServer({ port: 0, config: {} });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await alice.createRoom("room1");
      await expect(bob.joinRoom("room1", true)).resolves.toBeTruthy();
    } finally {
      process.env.MONITORS = prev;
      await alice.close();
      await bob.close();
      await running.close();
    }
  });

  test("管理员 API：鉴权、封禁用户/房间", async () => {
    const prev = process.env.ADMIN_TOKEN;
    const prevPath = process.env.ADMIN_DATA_PATH;
    process.env.ADMIN_TOKEN = "test-token";
    const dataPath = join(tmpdir(), `phira-mp-admin-data-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    process.env.ADMIN_DATA_PATH = dataPath;

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      const noAuth = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`);
      expect(noAuth.status).toBe(401);

      const rooms = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        headers: { "x-admin-token": "test-token" }
      });
      expect(rooms.ok).toBe(true);

      const banUser = await originalFetch(`http://127.0.0.1:${httpPort}/admin/ban/user`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ userId: 100, banned: true })
      });
      expect(banUser.ok).toBe(true);

      const alice2 = await Client.connect("127.0.0.1", port);
      await expect(alice2.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).rejects.toThrow(/封禁|banned/i);
      await alice2.close();

      const banRoom = await originalFetch(`http://127.0.0.1:${httpPort}/admin/ban/room`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ userId: 200, roomId: "room1", banned: true })
      });
      expect(banRoom.ok).toBe(true);
    } finally {
      process.env.ADMIN_TOKEN = prev;
      process.env.ADMIN_DATA_PATH = prevPath;
      await unlink(dataPath).catch(() => {});
      await alice.close();
      await running.close();
    }
  });

  test("管理员 API CORS：允许所有来源并支持预检", async () => {
    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const httpPort = running.http!.address().port;

    try {
      const preflight = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "x-admin-token,content-type"
        }
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(preflight.headers.get("access-control-allow-methods")?.toLowerCase()).toContain("options");
      expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-admin-token");

      const res = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        headers: { Origin: "https://example.com", "x-admin-token": "test-token" }
      });
      expect(res.ok).toBe(true);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    } finally {
      process.env.ADMIN_TOKEN = prev;
      await running.close();
    }
  });

  test("管理员封禁持久化：重启后仍生效", async () => {
    const prevToken = process.env.ADMIN_TOKEN;
    const prevPath = process.env.ADMIN_DATA_PATH;
    process.env.ADMIN_TOKEN = "test-token";
    const dataPath = join(tmpdir(), `phira-mp-admin-data-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    process.env.ADMIN_DATA_PATH = dataPath;

    const running1 = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const port1 = running1.address().port;
    const httpPort1 = running1.http!.address().port;
    const alice1 = await Client.connect("127.0.0.1", port1);
    try {
      await alice1.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      const banUser = await originalFetch(`http://127.0.0.1:${httpPort1}/admin/ban/user`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ userId: 100, banned: true })
      });
      expect(banUser.ok).toBe(true);
    } finally {
      await alice1.close();
      await running1.close();
    }

    const running2 = await startServer({ port: 0, config: { monitors: [200] } });
    const port2 = running2.address().port;
    const alice2 = await Client.connect("127.0.0.1", port2);
    try {
      await expect(alice2.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).rejects.toThrow(/封禁|banned/i);
    } finally {
      process.env.ADMIN_TOKEN = prevToken;
      process.env.ADMIN_DATA_PATH = prevPath;
      await unlink(dataPath).catch(() => {});
      await alice2.close();
      await running2.close();
    }
  });

  test("比赛房间：白名单、手动开始、结算后解散", async () => {
    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [], http_service: true, http_port: 0 } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);
    const carol = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await carol.authenticate("cccccccccccccccccccccccccccccccc");

      await alice.createRoom("room1");
      await bob.joinRoom("room1", false);

      const cfg = await originalFetch(`http://127.0.0.1:${httpPort}/admin/contest/rooms/room1/config`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ enabled: true, whitelist: [100, 200] })
      });
      expect(cfg.ok).toBe(true);

      await expect(carol.joinRoom("room1", false)).rejects.toThrow(/白名单|whitelist/i);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "WaitingForReady");
      await sleep(200);
      expect(alice.roomState()?.type).toBe("WaitingForReady");

      const start = await originalFetch(`http://127.0.0.1:${httpPort}/admin/contest/rooms/room1/start`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({})
      });
      expect(start.ok).toBe(true);

      await waitFor(() => alice.roomState()?.type === "Playing");
      await waitFor(() => bob.roomState()?.type === "Playing");

      const frames: TouchFrame[] = [{ time: 1, points: [[0, { x: 0, y: 1 }]] }];
      await alice.sendTouches(frames);

      await alice.played(1);
      await bob.abort();

      await waitFor(() => alice.roomId() === null, 5000);
      await waitFor(() => bob.roomId() === null, 5000);
    } finally {
      process.env.ADMIN_TOKEN = prev;
      await alice.close();
      await bob.close();
      await carol.close();
      await running.close();
    }
  }, 20000);

  test("ROOM_MAX_USERS 环境变量生效（最多 1 人）", async () => {
    const prev = process.env.ROOM_MAX_USERS;
    process.env.ROOM_MAX_USERS = "1";

    const running = await startServer({ port: 0, config: { monitors: [200] } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");
      await expect(bob.joinRoom("room1", false)).rejects.toThrow("房间已满");
    } finally {
      process.env.ROOM_MAX_USERS = prev;
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

