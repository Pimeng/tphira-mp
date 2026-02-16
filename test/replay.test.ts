// 回放录制测试
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "../src/client/client.js";
import { startServer } from "../src/server/server.js";
import { sleep, waitFor, setupMockFetch, parsePhiraRec } from "./helpers.js";
import type { JudgeEvent, TouchFrame } from "../src/common/commands.js";

describe("回放录制", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("启用回放录制时，无观战者也能产生触控/判定录制数据", async () => {
    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    const running = await startServer({ port: 0, config: { monitors: [], replay_enabled: true } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await alice.createRoom("room_replay");

      // 等待假观战者加入消息
      const roomMsgs: any[] = [];
      const fakeId = 2_000_000_000;
      await waitFor(() => {
        roomMsgs.push(...alice.takeMessages());
        return roomMsgs.some((m) => m.type === "JoinRoom" && m.user === fakeId);
      }, 5000);
      await sleep(300);
      roomMsgs.push(...alice.takeMessages());
      expect(roomMsgs.some((m) => m.type === "LeaveRoom" && m.user === fakeId)).toBe(false);

      await alice.selectChart(1);
      await alice.requestStart();
      await waitFor(() => alice.roomState()?.type === "Playing");

      const frames: TouchFrame[] = [{ time: 1, points: [[0, { x: 0, y: 1 }]] }];
      const judges: JudgeEvent[] = [{ time: 1, line_id: 1, note_id: 2, judgement: 0 }];
      await alice.sendTouches(frames);
      await alice.sendJudges(judges);
      await sleep(50);

      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart");

      const recordDir = join(process.cwd(), "record", "100", "1");
      await waitFor(() => existsSync(recordDir) && readdirSync(recordDir).some((f) => f.endsWith(".phirarec")), 2000);
      const file = readdirSync(recordDir).find((f) => f.endsWith(".phirarec"));
      expect(file).toBeTruthy();

      const buf = await readFile(join(recordDir, file!));
      const cmds = parsePhiraRec(buf);
      expect(cmds.some((c) => c.type === "Touches")).toBe(true);
      expect(cmds.some((c) => c.type === "Judges")).toBe(true);

      expect(cmds.find((c) => c.type === "Touches")).toEqual({ type: "Touches", frames });
      expect(cmds.find((c) => c.type === "Judges")).toEqual({ type: "Judges", judges });
    } finally {
      await alice.close();
      await running.close();
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  });

  test("回放录制：落盘、列表、下载", async () => {
    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    const prevAdmin = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, config: { monitors: [200], http_service: true, http_port: 0 } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      const cfg0 = await originalFetch(`http://127.0.0.1:${httpPort}/admin/replay/config`, {
        headers: { "x-admin-token": "test-token" }
      }).then((r) => r.json() as any);
      expect(cfg0).toMatchObject({ ok: true, enabled: false });

      const cfg1 = await originalFetch(`http://127.0.0.1:${httpPort}/admin/replay/config`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ enabled: true })
      }).then((r) => r.json() as any);
      expect(cfg1).toMatchObject({ ok: true, enabled: true });

      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room1");
      await bob.joinRoom("room1", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing", 3000);

      await alice.sendTouches([{ time: 1, points: [[0, { x: 0, y: 1 }]] }]);
      await alice.sendJudges([{ time: 1, line_id: 1, note_id: 1, judgement: 0 } as any]);

      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);

      const dir = join(process.cwd(), "record", "100", "1");
      await waitFor(() => {
        if (!existsSync(dir)) return false;
        try {
          return readdirSync(dir).some((f) => f.endsWith(".phirarec"));
        } catch {
          return false;
        }
      }, 3000);

      const files = (await readdir(dir)).filter((f) => f.endsWith(".phirarec"));
      expect(files.length).toBeGreaterThan(0);
      const ts = Number(files[0]!.replace(/\.phirarec$/i, ""));
      expect(Number.isInteger(ts)).toBe(true);

      const filePath = join(dir, files[0]!);
      const buf = await readFile(filePath);
      expect(buf.readUInt16LE(0)).toBe(0x504d);
      expect(buf.readUInt32LE(2)).toBe(1);
      expect(buf.readUInt32LE(6)).toBe(100);
      expect(buf.readUInt32LE(10)).toBe(1);

      const authRes = await originalFetch(`http://127.0.0.1:${httpPort}/replay/auth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
      }).then((r) => r.json() as any);
      expect(authRes.ok).toBe(true);
      expect(authRes.userId).toBe(100);
      expect(Array.isArray(authRes.charts)).toBe(true);
      const chart1 = authRes.charts.find((c: any) => c.chartId === 1);
      expect(chart1).toBeTruthy();
      const replay = (chart1.replays as any[]).find((r) => r.timestamp === ts && r.recordId === 1);
      expect(replay).toBeTruthy();

      const dl = await originalFetch(`http://127.0.0.1:${httpPort}/replay/download?sessionToken=${encodeURIComponent(authRes.sessionToken)}&chartId=1&timestamp=${ts}`);
      expect(dl.status).toBe(200);
      const dlBuf = Buffer.from(await dl.arrayBuffer());
      expect(dlBuf.readUInt16LE(0)).toBe(0x504d);
      expect(dlBuf.readUInt32LE(2)).toBe(1);
      expect(dlBuf.readUInt32LE(6)).toBe(100);
      expect(dlBuf.readUInt32LE(10)).toBe(1);

      const delRes = await originalFetch(`http://127.0.0.1:${httpPort}/replay/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionToken: authRes.sessionToken, chartId: 1, timestamp: ts })
      }).then((r) => r.json() as any);
      expect(delRes.ok).toBe(true);

      await waitFor(() => !existsSync(filePath), 3000);

      const dl2 = await originalFetch(`http://127.0.0.1:${httpPort}/replay/download?sessionToken=${encodeURIComponent(authRes.sessionToken)}&chartId=1&timestamp=${ts}`);
      expect(dl2.status).toBe(404);
    } finally {
      process.env.ADMIN_TOKEN = prevAdmin;
      await alice.close();
      await bob.close();
      await running.close();
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  }, 20000);

  test("回放录制开关：开启后不影响已存在房间", async () => {
    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

    const prevAdmin = process.env.ADMIN_TOKEN;
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

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();
      await waitFor(() => alice.roomState()?.type === "Playing", 3000);

      const cfg1 = await originalFetch(`http://127.0.0.1:${httpPort}/admin/replay/config`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ enabled: true })
      }).then((r) => r.json() as any);
      expect(cfg1).toMatchObject({ ok: true, enabled: true });

      await alice.sendTouches([{ time: 1, points: [[0, { x: 0, y: 1 }]] }]);
      await alice.sendJudges([{ time: 1, line_id: 1, note_id: 1, judgement: 0 } as any]);

      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);

      // 等待一下确保如果有录制也会完成
      await sleep(500);

      const userDir = join(process.cwd(), "record", "100");
      expect(existsSync(userDir)).toBe(false);
    } finally {
      process.env.ADMIN_TOKEN = prevAdmin;
      await alice.close();
      await bob.close();
      await running.close();
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  }, 20000);

  test("回放录制默认关闭：不落盘", async () => {
    await rm(join(process.cwd(), "record"), { recursive: true, force: true });

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

      await waitFor(() => alice.roomState()?.type === "Playing", 3000);

      await alice.sendTouches([{ time: 1, points: [[0, { x: 0, y: 1 }]] }]);
      await alice.sendJudges([{ time: 1, line_id: 1, note_id: 1, judgement: 0 } as any]);

      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);

      const recordDir = join(process.cwd(), "record");
      expect(existsSync(recordDir)).toBe(false);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
      await rm(join(process.cwd(), "record"), { recursive: true, force: true });
    }
  }, 20000);
});
