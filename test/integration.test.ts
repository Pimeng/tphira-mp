import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
});

