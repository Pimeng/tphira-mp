// 回放录制测试
import { afterAll, beforeAll, afterEach, describe, expect, test } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "../../src/client/client.js";
import { parseRoomId } from "../../src/common/roomId.js";
import { ReplayRecorder } from "../../src/server/replay/replayRecorder.js";
import { startServer } from "../../src/server/core/server.js";
import { Logger } from "../../src/server/utils/logger.js";
import { sleep, waitFor, setupMockFetch, parsePhiraRec, parsePhiraRecordV2, createTempDir, cleanupTempDir } from "../helpers.js";
import type { JudgeEvent, TouchFrame } from "../../src/common/commands.js";

describe("回放录制", () => {
  const { originalFetch, mockFetch } = setupMockFetch();
  let tempDir: string;

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(async () => {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  });

  test("启用回放录制时，无观战者也能产生触控/判定录制数据", async () => {
    tempDir = await createTempDir("replay-test-1");

    const running = await startServer({ port: 0, config: { monitors: [], replay_enabled: true, replay_base_dir: tempDir } });
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

      const recordDir = join(tempDir, "100", "1");
      await waitFor(() => existsSync(recordDir) && readdirSync(recordDir).some((f) => f.endsWith(".phirarec")), 2000);
      const file = readdirSync(recordDir).find((f) => f.endsWith(".phirarec"));
      expect(file).toBeTruthy();

      const buf = await readFile(join(recordDir, file!));
      const record = parsePhiraRecordV2(buf);
      expect(buf.subarray(0, 8).toString("ascii")).toBe("PHIRAREC");
      expect(record.version).toBe(1);
      expect(record.compression).toBe(0x01);
      expect(record.recordId).toBe(1);
      expect(record.timestamp).toBe(Number(file!.replace(/\.phirarec$/i, "")));
      expect(record.chartId).toBe(1);
      expect(record.chartName).toBe("Chart-1");
      expect(record.userId).toBe(100);
      expect(record.userName).toBe("Alice");
      expect(record.touchFrames).toEqual(frames);
      expect(record.judgeEvents).toEqual(judges);

      const cmds = parsePhiraRec(buf);
      expect(cmds.some((c) => c.type === "Touches")).toBe(true);
      expect(cmds.some((c) => c.type === "Judges")).toBe(true);

      expect(cmds.find((c) => c.type === "Touches")).toEqual({ type: "Touches", frames });
      expect(cmds.find((c) => c.type === "Judges")).toEqual({ type: "Judges", judges });
    } finally {
      await alice.close();
      await running.close();
    }
  });

  test("回放开关不应覆盖真实观战者的 live 转发", async () => {
    tempDir = await createTempDir("replay-test-live-monitor");

    const prevAdmin = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    const running = await startServer({ port: 0, configPath: join(tempDir, "server_config.yml"), config: { monitors: [200], http_service: true, http_port: 0, replay_enabled: true, replay_base_dir: tempDir } });
    const port = running.address().port;
    const httpPort = running.http!.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    const getRoom = async () => {
      const data = await originalFetch(`http://127.0.0.1:${httpPort}/admin/rooms`, {
        headers: { "x-admin-token": "test-token" }
      }).then((r) => r.json() as any);
      expect(data.ok).toBe(true);
      const room = data.rooms.find((r: any) => r.roomid === "room_live_monitor");
      expect(room).toBeTruthy();
      return room;
    };

    const setReplay = async (enabled: boolean) => {
      const res = await originalFetch(`http://127.0.0.1:${httpPort}/admin/replay/config`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": "test-token" },
        body: JSON.stringify({ enabled })
      }).then((r) => r.json() as any);
      expect(res).toMatchObject({ ok: true, enabled });
    };

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room_live_monitor");
      const join = await bob.joinRoom("room_live_monitor", true);
      expect(join.live).toBe(true);
      expect((await getRoom()).live).toBe(true);

      await setReplay(false);
      expect((await getRoom()).live).toBe(true);

      await setReplay(true);
      expect((await getRoom()).live).toBe(true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing", 3000);
      await waitFor(() => bob.roomState()?.type === "Playing", 3000);

      const frames: TouchFrame[] = [{ time: 1, points: [[0, { x: 0, y: 1 }]] }];
      const judges: JudgeEvent[] = [{ time: 1, line_id: 1, note_id: 1, judgement: 0 } as any];
      await alice.sendTouches(frames);
      await alice.sendJudges(judges);

      await waitFor(() => bob.livePlayer(100).touch_frames.length > 0, 1000);
      await waitFor(() => bob.livePlayer(100).judge_events.length > 0, 1000);
      expect(bob.livePlayer(100).touch_frames.at(-1)).toEqual(frames[0]);
      expect(bob.livePlayer(100).judge_events.at(-1)).toEqual(judges[0]);

      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);
    } finally {
      process.env.ADMIN_TOKEN = prevAdmin;
      await alice.close();
      await bob.close();
      await running.close();
    }
  }, 20000);

  test("回放结束时会输出每个录制的触控/判定统计", async () => {
    tempDir = await createTempDir("replay-test-log-summary");

    const debugLogs: string[] = [];
    const logger = new Logger({
      logsDir: tempDir,
      minLevel: "DEBUG",
      consoleMinLevel: "ERROR",
      onLog: (level, message) => {
        if (level === "DEBUG") debugLogs.push(message);
      }
    });
    const recorder = new ReplayRecorder(tempDir, logger);
    const roomId = parseRoomId("room_log_summary");

    await recorder.startRoom(roomId, 1, [{ id: 100, name: "Alice" }]);
    recorder.setRecordId(roomId, 100, 1);
    recorder.appendTouches(roomId, 100, [{ time: 1, points: [[0, { x: 0, y: 1 }]] }]);
    recorder.appendJudges(roomId, 100, [{ time: 1, line_id: 1, note_id: 2, judgement: 0 }]);
    await recorder.endRoom(roomId);
    logger.close();

    expect(debugLogs).toContain("[Replay] endRoom stats: roomKey=room_log_summary, userId=100, recordId=1, touchFrames=1, judgeEvents=1");
  });

  test("回放结束时即便没有触控/判定也会输出 0 统计", async () => {
    tempDir = await createTempDir("replay-test-zero-summary");

    const debugLogs: string[] = [];
    const logger = new Logger({
      logsDir: tempDir,
      minLevel: "DEBUG",
      consoleMinLevel: "ERROR",
      onLog: (level, message) => {
        if (level === "DEBUG") debugLogs.push(message);
      }
    });
    const recorder = new ReplayRecorder(tempDir, logger);
    const roomId = parseRoomId("room_zero_summary");

    await recorder.startRoom(roomId, 1, [{ id: 100, name: "Alice" }]);
    recorder.setRecordId(roomId, 100, 1);
    await recorder.endRoom(roomId);
    logger.close();

    expect(debugLogs).toContain("[Replay] endRoom stats: roomKey=room_zero_summary, userId=100, recordId=1, touchFrames=0, judgeEvents=0");
  });

  test("回放录制：落盘、列表、下载", async () => {
    tempDir = await createTempDir("replay-test-2");
    const testConfigPath = join(tempDir, "server_config.yml");

    const prevAdmin = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    // 先关闭录制，确保测试初始状态正确
    const running0 = await startServer({ port: 0, configPath: testConfigPath, config: { monitors: [200], http_service: true, http_port: 0, replay_base_dir: tempDir } });
    const httpPort0 = running0.http!.address().port;
    await originalFetch(`http://127.0.0.1:${httpPort0}/admin/replay/config`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "test-token" },
      body: JSON.stringify({ enabled: false })
    });
    await running0.close();

    const running = await startServer({ port: 0, configPath: testConfigPath, config: { monitors: [200], http_service: true, http_port: 0, replay_base_dir: tempDir } });
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

      const dir = join(tempDir, "100", "1");
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
      const record = parsePhiraRecordV2(buf);
      expect(buf.subarray(0, 8).toString("ascii")).toBe("PHIRAREC");
      expect(record.version).toBe(1);
      expect(record.compression).toBe(0x01);
      expect(record.recordId).toBe(1);
      expect(record.timestamp).toBe(ts);
      expect(record.chartId).toBe(1);
      expect(record.chartName).toBe("Chart-1");
      expect(record.userId).toBe(100);
      expect(record.userName).toBe("Alice");

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
      const dlRecord = parsePhiraRecordV2(dlBuf);
      expect(dlRecord.recordId).toBe(1);
      expect(dlRecord.timestamp).toBe(ts);
      expect(dlRecord.chartId).toBe(1);
      expect(dlRecord.userId).toBe(100);

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
    }
  }, 20000);

  test("回放录制开关：开启后不影响已存在房间", async () => {
    tempDir = await createTempDir("replay-test-3");
    const testConfigPath = join(tempDir, "server_config.yml");

    const prevAdmin = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";

    // 先关闭录制，确保测试初始状态正确
    const running0 = await startServer({ port: 0, configPath: testConfigPath, config: { monitors: [200], http_service: true, http_port: 0, replay_base_dir: tempDir } });
    const httpPort0 = running0.http!.address().port;
    await originalFetch(`http://127.0.0.1:${httpPort0}/admin/replay/config`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "test-token" },
      body: JSON.stringify({ enabled: false })
    });
    await running0.close();

    const running = await startServer({ port: 0, configPath: testConfigPath, config: { monitors: [200], http_service: true, http_port: 0, replay_base_dir: tempDir } });
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

      const userDir = join(tempDir, "100");
      expect(existsSync(userDir)).toBe(false);
    } finally {
      process.env.ADMIN_TOKEN = prevAdmin;
      await alice.close();
      await bob.close();
      await running.close();
    }
  }, 20000);

  test("回放录制默认关闭：不落盘", async () => {
    tempDir = await createTempDir("replay-test-4");
    const testConfigPath = join(tempDir, "server_config.yml");

    // 先关闭录制，确保测试初始状态正确
    const prevAdmin = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-token";
    const running0 = await startServer({ port: 0, configPath: testConfigPath, config: { monitors: [200], http_service: true, http_port: 0, replay_base_dir: tempDir } });
    const httpPort0 = running0.http!.address().port;
    await originalFetch(`http://127.0.0.1:${httpPort0}/admin/replay/config`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "test-token" },
      body: JSON.stringify({ enabled: false })
    });
    await running0.close();
    process.env.ADMIN_TOKEN = prevAdmin;

    const running = await startServer({ port: 0, configPath: testConfigPath, config: { monitors: [200], replay_base_dir: tempDir } });
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

      // 验证回放录制默认关闭时没有产生录制数据
      // 检查用户录制目录不存在（tempDir 本身存在，但下面不应该有 100/1/ 这样的录制目录）
      const userRecordDir = join(tempDir, "100");
      expect(existsSync(userRecordDir)).toBe(false);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
    }
  }, 20000);
});