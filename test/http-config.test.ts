// HTTP和配置测试
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../src/client/client.js";
import { startServer } from "../src/server/core/server.js";
import { setupMockFetch } from "./helpers.js";

describe("HTTP和配置", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
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

  test("test_account_ids 配置生效：服务器正常启动", async () => {
    const running = await startServer({ port: 0, config: { monitors: [200], test_account_ids: [100, 200] } });
    const port = running.address().port;
    try {
      expect(port).toBeGreaterThan(0);
      const alice = await Client.connect("127.0.0.1", port);
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await alice.createRoom("room1");
      await alice.close();
    } finally {
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
});
