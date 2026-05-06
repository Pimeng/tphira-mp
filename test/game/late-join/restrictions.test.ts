// 游戏进行中加入房间：操作限制测试
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { Client } from "../../../src/client/client.js";
import { sleep, waitFor, setupMockFetch } from "../../helpers.js";
import type { TouchFrame } from "../../../src/common/commands.js";
import { createPlayingGame, createWaitingGame, cleanupGame } from "./helpers.js";

describe("late-join / restrictions", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("游戏中加入的玩家自动标记为已完成，不能操作", async () => {
    const { running, port, alice, bob } = await createPlayingGame("room2");
    const dave = await Client.connect("127.0.0.1", port);

    try {
      await dave.authenticate("dddddddddddddddddddddddddddddddd");

      await dave.joinRoom("room2", false);
      await waitFor(() => dave.roomState()?.type === "Playing");

      // Dave 发送 touches 应被静默忽略
      const frames: TouchFrame[] = [{ time: 1, points: [[0, { x: 0, y: 1 }]] }];
      await dave.sendTouches(frames);
      await sleep(200);

      // Dave 不能放弃或上传成绩（已被标记为 aborted）
      await expect(dave.abort()).rejects.toThrow(/aborted|放弃|中止/i);

      // 正常结束本局
      await alice.played(1);
      await bob.abort();

      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);
    } finally {
      await cleanupGame({ running, alice, bob, dave });
    }
  }, 15000);

  test("WaitForReady 状态下普通玩家不能加入", async () => {
    const { running, port, alice, bob } = await createWaitingGame("room3");
    const carol = await Client.connect("127.0.0.1", port);

    try {
      await carol.authenticate("cccccccccccccccccccccccccccccccc");

      await expect(carol.joinRoom("room3", false)).rejects.toThrow(/ongoing|进行中/i);
    } finally {
      await cleanupGame({ running, alice, bob, carol });
    }
  }, 10000);
});