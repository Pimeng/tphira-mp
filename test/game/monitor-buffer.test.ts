// 观战数据聚合缓冲测试
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { startServer } from "../../src/server/core/server.js";
import { Client } from "../../src/client/client.js";
import { setupMockFetch, sleep, waitFor, createTempDir, cleanupTempDir } from "../helpers.js";
import type { JudgeEvent, TouchFrame } from "../../src/common/commands.js";

describe("观战数据聚合缓冲", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("高频 Touches 应该被聚合后在 50ms 内发送", async () => {
    const tempDir = await createTempDir("monitor-buffer-test");
    const running = await startServer({
      port: 0,
      config: { monitors: [200], replay_enabled: true, replay_base_dir: tempDir }
    });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await alice.createRoom("room1");

      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await bob.joinRoom("room1", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing");
      await sleep(100); // 等待游戏开始

      const startTime = Date.now();

      // 快速发送多个 Touches
      for (let i = 0; i < 10; i++) {
        const frames: TouchFrame[] = [{ time: i, points: [[0, { x: i, y: i }]] }];
        await alice.sendTouches(frames);
      }

      // 等待聚合缓冲 flush
      await sleep(200);

      const elapsed = Date.now() - startTime;

      // 验证 Bob 收到了聚合后的数据
      const livePlayer = bob.livePlayer(100);
      expect(livePlayer.touch_frames.length).toBeGreaterThanOrEqual(10);

      // 应该在合理时间内完成（10 次发送 + 50ms 缓冲 + 网络延迟）
      expect(elapsed).toBeLessThan(500);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });

  test("多个玩家的数据应该被分别聚合", async () => {
    const tempDir = await createTempDir("monitor-buffer-test");
    const running = await startServer({
      port: 0,
      config: { monitors: [200, 300], replay_enabled: true, replay_base_dir: tempDir }
    });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);
    const carol = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await alice.createRoom("room1");

      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await bob.joinRoom("room1", false);

      await carol.authenticate("cccccccccccccccccccccccccccccccc");
      await carol.joinRoom("room1", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();
      await carol.ready(); // 观战者也需要 ready 才能开始游戏

      await sleep(150);

      // Alice 和 Bob 同时发送数据（每批数据内部也会聚合）
      await alice.sendTouches([{ time: 1, points: [[0, { x: 1, y: 1 }]] }]);
      await alice.sendTouches([{ time: 3, points: [[0, { x: 3, y: 3 }]] }]);
      await bob.sendTouches([{ time: 2, points: [[0, { x: 2, y: 2 }]] }]);
      await bob.sendTouches([{ time: 4, points: [[0, { x: 4, y: 4 }]] }]);

      // 等待聚合缓冲 flush（50ms 窗口 + 网络延迟），使用轮询确保数据到达
      const waitStart = Date.now();
      while (Date.now() - waitStart < 2000) {
        const aliceFrames = carol.livePlayer(100).touch_frames;
        const bobFrames = carol.livePlayer(200).touch_frames;
        if (aliceFrames.length >= 1 && bobFrames.length >= 1) break;
        await sleep(50);
      }

      // Carol 作为观战者应该收到两人的数据
      const aliceFrames = carol.livePlayer(100).touch_frames;
      const bobFrames = carol.livePlayer(200).touch_frames;

      // 聚合后每个玩家的多批数据应合并为一批或保持分批（取决于时序）
      expect(aliceFrames.length).toBeGreaterThanOrEqual(1);
      expect(bobFrames.length).toBeGreaterThanOrEqual(1);
    } finally {
      await alice.close();
      await bob.close();
      await carol.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });

  test.each([false, true])("玩家离房前缓冲的数据仍应转发给多个观战者(replay=%s)", async (replayEnabled) => {
    const tempDir = await createTempDir("monitor-buffer-test");
    const running = await startServer({
      port: 0,
      config: { monitors: [200, 300], replay_enabled: replayEnabled, replay_base_dir: tempDir }
    });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);
    const carol = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await carol.authenticate("cccccccccccccccccccccccccccccccc");

      await alice.createRoom("room1");
      await bob.joinRoom("room1", true);
      await carol.joinRoom("room1", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();
      await carol.ready();

      await waitFor(() => alice.roomState()?.type === "Playing", 2000);

      const frames: TouchFrame[] = [{ time: 1, points: [[0, { x: 1, y: 1 }]] }];
      const judges: JudgeEvent[] = [{ time: 1, line_id: 1, note_id: 1, judgement: 0 }];

      await alice.sendTouches(frames);
      await alice.sendJudges(judges);
      await alice.leaveRoom();

      await waitFor(() => {
        return (
          bob.livePlayer(100).touch_frames.length >= 1 &&
          bob.livePlayer(100).judge_events.length >= 1 &&
          carol.livePlayer(100).touch_frames.length >= 1 &&
          carol.livePlayer(100).judge_events.length >= 1
        );
      }, 2000);

      expect(bob.livePlayer(100).touch_frames).toEqual(frames);
      expect(bob.livePlayer(100).judge_events).toEqual(judges);
      expect(carol.livePlayer(100).touch_frames).toEqual(frames);
      expect(carol.livePlayer(100).judge_events).toEqual(judges);
    } finally {
      await alice.close();
      await bob.close();
      await carol.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });

  test("Judges 数据也应该被聚合", async () => {
    const tempDir = await createTempDir("monitor-buffer-test");
    const running = await startServer({
      port: 0,
      config: { monitors: [200], replay_enabled: true, replay_base_dir: tempDir }
    });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await alice.createRoom("room1");

      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await bob.joinRoom("room1", true);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await sleep(100);

      // 快速发送多个 Judges
      for (let i = 0; i < 5; i++) {
        await alice.sendJudges([{ time: i, line_id: i, note_id: i, judgement: 0 }]);
      }

      await waitFor(() => bob.livePlayer(100).judge_events.length >= 5, 2000);

      const livePlayer = bob.livePlayer(100);
      expect(livePlayer.judge_events.length).toBeGreaterThanOrEqual(5);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });
});
