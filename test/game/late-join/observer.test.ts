// 游戏进行中加入房间：观战者与房间列表测试
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { Client } from "../../../src/client/client.js";
import { sleep, waitFor, setupMockFetch } from "../../helpers.js";
import type { TouchFrame } from "../../../src/common/commands.js";
import { createPlayingGame, cleanupGame } from "./helpers.js";

describe("late-join / observer", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("观战者可以在任何状态加入并接收实时数据", async () => {
    const { running, port, alice, bob } = await createPlayingGame("room4", {
      extraMonitors: [400]
    });

    const dave = await Client.connect("127.0.0.1", port);

    try {
      await dave.authenticate("dddddddddddddddddddddddddddddddd");

      // Dave 作为观战者在游戏进行中加入
      const joinResp = await dave.joinRoom("room4", true);
      expect(joinResp.state.type).toBe("SelectChart");

      // Alice 发送 touches，Dave 应该能收到
      const frames: TouchFrame[] = [{ time: 1, points: [[0, { x: 0, y: 1 }]] }];
      await alice.sendTouches(frames);

      await waitFor(() => dave.livePlayer(100).touch_frames.length > 0, 1000);
      expect(dave.livePlayer(100).touch_frames.at(-1)).toEqual(frames[0]);
    } finally {
      await cleanupGame({ running, alice, bob, dave });
    }
  }, 10000);
});

describe("late-join / roomlist", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("房间列表显示 Playing 状态的房间", async () => {
    const { running, port, alice, bob } = await createPlayingGame("room5");

    try {
      // Bob 断开连接，房间还剩 Alice
      await bob.close();
      await sleep(300);

      // 等待房间列表缓存过期（2s TTL），确保获取最新列表
      await sleep(2200);

      // 创建新客户端查看房间列表
      const carol = await Client.connect("127.0.0.1", port);
      await carol.authenticate("cccccccccccccccccccccccccccccccc");

      // 等待欢迎消息到达
      await sleep(500);

      const chats: string[] = [];
      await waitFor(() => {
        const batch = carol
          .takeMessages()
          .filter((m) => m.type === "Chat" && m.user === 0)
          .map((m) => (m as any).content as string);
        chats.push(...batch);
        return chats.some((s) => s.includes("当前可用的房间如下："));
      }, 2000);

      expect(chats.join("\n")).toContain("room5");
      await carol.close();
    } finally {
      await cleanupGame({ running, alice, bob });
    }
  }, 15000);
});
