// 游戏进行中加入房间测试
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../src/client/client.js";
import { startServer } from "../src/server/core/server.js";
import { sleep, waitFor, setupMockFetch, createTempDir, cleanupTempDir } from "./helpers.js";
import type { TouchFrame } from "../src/common/commands.js";

describe("游戏进行中加入房间", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("游戏进行中普通玩家可以加入且不影响本局结束", async () => {
    const tempDir = await createTempDir("late-join-test");
    const running = await startServer({ port: 0, config: { monitors: [], replay_enabled: true, replay_base_dir: tempDir } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);
    const dave = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await dave.authenticate("dddddddddddddddddddddddddddddddd");

      await alice.createRoom("room1");
      await bob.joinRoom("room1", false);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing");
      await waitFor(() => bob.roomState()?.type === "Playing");

      // Dave 在游戏进行中加入
      const joinResp = await dave.joinRoom("room1", false);
      expect(joinResp.state.type).toBe("Playing");

      // Dave 应该收到状态同步：最终状态为 Playing
      await waitFor(() => dave.roomState()?.type === "Playing");

      // Alice 完成游戏，Bob 放弃，Dave 已自动标记为 aborted
      await alice.played(1);
      await bob.abort();

      // 本局应该结束
      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);
      expect(bob.roomState()?.type).toBe("SelectChart");
      expect(dave.roomState()?.type).toBe("SelectChart");
    } finally {
      await alice.close();
      await bob.close();
      await dave.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  }, 15000);

  test("游戏中加入的玩家自动标记为已完成且不能上传成绩", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);
    const dave = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await dave.authenticate("dddddddddddddddddddddddddddddddd");

      await alice.createRoom("room2");
      await bob.joinRoom("room2", false);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing");

      await dave.joinRoom("room2", false);
      await waitFor(() => dave.roomState()?.type === "Playing");

      // Dave 尝试发送 touches，应该被静默忽略
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
      await alice.close();
      await bob.close();
      await dave.close();
      await running.close();
    }
  }, 15000);

  test("WaitForReady 状态下普通玩家不能加入", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);
    const carol = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await carol.authenticate("cccccccccccccccccccccccccccccccc");

      await alice.createRoom("room3");
      await bob.joinRoom("room3", false);

      await alice.selectChart(1);
      await alice.requestStart();

      await waitFor(() => alice.roomState()?.type === "WaitingForReady");

      // Carol 在 WaitForReady 状态下尝试作为普通玩家加入
      await expect(carol.joinRoom("room3", false)).rejects.toThrow(/ongoing|进行中/i);
    } finally {
      await alice.close();
      await bob.close();
      await carol.close();
      await running.close();
    }
  }, 10000);

  test("观战者可以在任何状态加入", async () => {
    const running = await startServer({ port: 0, config: { monitors: [400] } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);
    const dave = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      await dave.authenticate("dddddddddddddddddddddddddddddddd");

      await alice.createRoom("room4");
      await bob.joinRoom("room4", false);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing");

      // Dave 作为观战者在游戏进行中加入
      const joinResp = await dave.joinRoom("room4", true);
      expect(joinResp.state.type).toBe("Playing");

      // Alice 发送 touches，Dave 应该能收到
      const frames: TouchFrame[] = [{ time: 1, points: [[0, { x: 0, y: 1 }]] }];
      await alice.sendTouches(frames);

      await waitFor(() => dave.livePlayer(100).touch_frames.length > 0, 1000);
      expect(dave.livePlayer(100).touch_frames.at(-1)).toEqual(frames[0]);
    } finally {
      await alice.close();
      await bob.close();
      await dave.close();
      await running.close();
    }
  }, 10000);

  test("房间列表显示 Playing 状态的房间", async () => {
    const running = await startServer({ port: 0, config: { monitors: [] } });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

      await alice.createRoom("room5");
      await bob.joinRoom("room5", false);

      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing");

      // Bob 断开连接，房间还剩 Alice
      await bob.close();
      await sleep(300);

      // 创建新客户端查看房间列表
      const carol = await Client.connect("127.0.0.1", port);
      await carol.authenticate("cccccccccccccccccccccccccccccccc");

      const chats: string[] = [];
      await waitFor(() => {
        const batch = carol.takeMessages()
          .filter((m) => m.type === "Chat" && m.user === 0)
          .map((m) => (m as any).content as string);
        chats.push(...batch);
        return chats.some((s) => s.includes("当前可用的房间如下："));
      }, 1500);

      expect(chats.join("\n")).toContain("room5");
      await carol.close();
    } finally {
      await alice.close();
      await running.close();
    }
  }, 10000);
});
