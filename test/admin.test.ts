// 管理员API测试
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink, rm } from "node:fs/promises";
import { Client } from "../src/client/client.js";
import { startServer } from "../src/server/server.js";
import { setupMockFetch } from "./helpers.js";

describe("管理员API", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
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
        body: JSON.stringify({ userId: 100, banned: true, disconnect: true })
      });
      expect(banUser.ok).toBe(true);

      const alice2 = await Client.connect("127.0.0.1", port);
      await alice2.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await expect(alice2.createRoom("test")).rejects.toThrow(/封禁|banned/i);
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

  test("管理员接口按 IP 错误次数封禁（5 次）", async () => {
    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const httpPort = running.http!.address().port;

    try {
      for (let i = 0; i < 4; i++) {
        const r = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
          headers: { "x-admin-token": "wrong-token" }
        });
        expect(r.status).toBe(401);
      }

      const banned = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        headers: { "x-admin-token": "wrong-token" }
      });
      expect(banned.status).toBe(401);
      expect(await banned.json()).toMatchObject({ ok: false, error: "unauthorized" });

      const stillBanned = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        headers: { "x-admin-token": "test-token" }
      });
      expect(stillBanned.status).toBe(401);
      expect(await stillBanned.json()).toMatchObject({ ok: false, error: "unauthorized" });
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
      await alice2.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await expect(alice2.createRoom("test")).rejects.toThrow(/封禁|banned/i);
    } finally {
      process.env.ADMIN_TOKEN = prevToken;
      process.env.ADMIN_DATA_PATH = prevPath;
      await unlink(dataPath).catch(() => {});
      await alice2.close();
      await running2.close();
    }
  });

  test("管理员接口：动态修改指定房间最大人数", async () => {
    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);
    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");

      const set1 = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms/room1/max_users`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ maxUsers: 1 })
      });
      expect(set1.ok).toBe(true);

      await expect(bob.joinRoom("room1", false)).rejects.toThrow("房间已满");

      const set2 = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms/room1/max_users`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ maxUsers: 2 })
      });
      expect(set2.ok).toBe(true);

      await expect(bob.joinRoom("room1", false)).resolves.toBeTruthy();
    } finally {
      process.env.ADMIN_TOKEN = prev;
      await alice.close();
      await bob.close();
      await running.close();
    }
  });

  test("管理员 API：禁用房间创建功能", async () => {
    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      await alice.createRoom("room1");
      await alice.leaveRoom();

      const getResp = await originalFetch(`http://127.0.0.1:${httpPort}/admin/room-creation/config`, {
        headers: { "X-Admin-Token": "test-token" }
      });
      expect(getResp.ok).toBe(true);
      const getJson = (await getResp.json()) as any;
      expect(getJson.ok).toBe(true);
      expect(getJson.enabled).toBe(true);

      const disableResp = await originalFetch(`http://127.0.0.1:${httpPort}/admin/room-creation/config`, {
        method: "POST",
        headers: { "X-Admin-Token": "test-token", "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false })
      });
      expect(disableResp.ok).toBe(true);
      const disableJson = (await disableResp.json()) as any;
      expect(disableJson.ok).toBe(true);
      expect(disableJson.enabled).toBe(false);

      await expect(alice.createRoom("room2")).rejects.toThrow();

      const enableResp = await originalFetch(`http://127.0.0.1:${httpPort}/admin/room-creation/config`, {
        method: "POST",
        headers: { "X-Admin-Token": "test-token", "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true })
      });
      expect(enableResp.ok).toBe(true);
      const enableJson = (await enableResp.json()) as any;
      expect(enableJson.ok).toBe(true);
      expect(enableJson.enabled).toBe(true);

      await alice.createRoom("room3");
    } finally {
      await alice.close();
      await running.close();
      if (prev === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = prev;
    }
  });

  test("管理员接口：解散房间", async () => {
    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");
      await bob.joinRoom("room1", true);

      const roomsBefore = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        headers: { "x-admin-token": "test-token" }
      });
      expect(roomsBefore.ok).toBe(true);
      const dataBeforeDisband = (await roomsBefore.json()) as any;
      expect(dataBeforeDisband.rooms.some((r: any) => r.roomid === "room1")).toBe(true);

      const disband = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms/room1/disband`, {
        method: "POST",
        headers: { "x-admin-token": "test-token" }
      });
      expect(disband.ok).toBe(true);
      const disbandData = (await disband.json()) as any;
      expect(disbandData.ok).toBe(true);
      expect(disbandData.roomid).toBe("room1");

      const roomsAfter = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        headers: { "x-admin-token": "test-token" }
      });
      expect(roomsAfter.ok).toBe(true);
      const dataAfterDisband = (await roomsAfter.json()) as any;
      expect(dataAfterDisband.rooms.some((r: any) => r.roomid === "room1")).toBe(false);
    } finally {
      process.env.ADMIN_TOKEN = prev;
      await alice.close();
      await bob.close();
      await running.close();
    }
  });

  test("管理员接口：解散不存在的房间返回 404", async () => {
    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const httpPort = running.http!.address().port;

    try {
      const disband = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms/nonexistent/disband`, {
        method: "POST",
        headers: { "x-admin-token": "test-token" }
      });
      expect(disband.status).toBe(404);
      const data = (await disband.json()) as any;
      expect(data.ok).toBe(false);
      expect(data.error).toBe("room-not-found");
    } finally {
      process.env.ADMIN_TOKEN = prev;
      await running.close();
    }
  });

  test("管理员接口：解散房间时无效房间ID返回 400", async () => {
    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const httpPort = running.http!.address().port;

    try {
      const disband = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms/invalid%20room/disband`, {
        method: "POST",
        headers: { "x-admin-token": "test-token" }
      });
      expect(disband.status).toBe(400);
      const data = (await disband.json()) as any;
      expect(data.ok).toBe(false);
      expect(data.error).toBe("bad-room-id");
    } finally {
      process.env.ADMIN_TOKEN = prev;
      await running.close();
    }
  });

  test("管理员接口：解散启用回放录制的房间", async () => {
    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    const prev = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0, replay_enabled: true } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room_replay");
      await bob.joinRoom("room_replay", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      const disband = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms/room_replay/disband`, {
        method: "POST",
        headers: { "x-admin-token": "test-token" }
      });
      expect(disband.ok).toBe(true);

      const roomsAfter = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        headers: { "x-admin-token": "test-token" }
      });
      expect(roomsAfter.ok).toBe(true);
      const dataAfterDisband = (await roomsAfter.json()) as any;
      expect(dataAfterDisband.rooms.some((r: any) => r.roomid === "room_replay")).toBe(false);
    } finally {
      process.env.ADMIN_TOKEN = prev;
      await alice.close();
      await bob.close();
      await running.close();
      // 等待文件系统操作完成
      await new Promise(resolve => setTimeout(resolve, 100));
      // 多次尝试删除,处理 Windows 文件锁定问题
      for (let i = 0; i < 3; i++) {
        try {
          await rm(join(process.cwd(), "record"), { recursive: true, force: true });
          break;
        } catch (e) {
          if (i === 2) throw e;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  }, 20000);
});
