// 比赛房间测试
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../src/client/client.js";
import { startServer } from "../src/server/core/server.js";
import { sleep, waitFor, setupMockFetch } from "./helpers.js";
import type { TouchFrame } from "../src/common/commands.js";

describe("比赛房间", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
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

      await waitFor(() => alice.roomState()?.type === "WaitingForReady", 2000);
      await sleep(150);
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

      await waitFor(() => alice.roomId() === null, 3000);
      await waitFor(() => bob.roomId() === null, 3000);
    } finally {
      process.env.ADMIN_TOKEN = prev;
      await alice.close();
      await bob.close();
      await carol.close();
      await running.close();
    }
  }, 15000);
});
