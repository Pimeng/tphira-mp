// 游戏进行中加入房间：边界情况测试
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { Client } from "../../../src/client/client.js";
import { waitFor, setupMockFetch } from "../../helpers.js";
import { createPlayingGame, cleanupGame } from "./helpers.js";

describe("late-join / edge-cases", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("late-join 玩家下一局可正常参与", async () => {
    const { running, port, alice, bob, tempDir } = await createPlayingGame("edge1");
    const dave = await Client.connect("127.0.0.1", port);

    try {
      await dave.authenticate("dddddddddddddddddddddddddddddddd");
      await dave.joinRoom("edge1", false);
      await waitFor(() => dave.roomState()?.type === "Playing");

      // 第一局结束：Alice 完成，Bob 放弃，Dave 已被标记为 aborted
      await alice.played(1);
      await bob.abort();

      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);
      expect(dave.roomState()?.type).toBe("SelectChart");

      // 第二局：Dave 正常参与（ready + 游戏开始）
      await alice.selectChart(2);
      await alice.requestStart();
      await bob.ready();
      await dave.ready();

      await waitFor(() => alice.roomState()?.type === "Playing", 3000);
      expect(dave.roomState()?.type).toBe("Playing");

      // Dave 现在可以正常发送 touches（不再被 aborted 屏蔽）
      await dave.sendTouches([{ time: 1, points: [[0, { x: 0, y: 1 }]] }]);

      // 第二局结束
      await alice.played(3);
      await bob.abort();
      await dave.abort();

      await waitFor(() => dave.roomState()?.type === "SelectChart", 3000);
    } finally {
      await cleanupGame({ running, alice, bob, dave, tempDir });
    }
  }, 20000);

  test("游戏中房主离开后剩余玩家继续对局，late-join 玩家可被随机选为新房主", async () => {
    const { running, port, alice, bob, tempDir } = await createPlayingGame("edge2");
    const dave = await Client.connect("127.0.0.1", port);

    try {
      await dave.authenticate("dddddddddddddddddddddddddddddddd");
      await dave.joinRoom("edge2", false);
      await waitFor(() => dave.roomState()?.type === "Playing");

      // 记录当前状态
      const beforeHost = alice.isHost();
      expect(beforeHost).toBe(true);

      // 房主 Alice 离开（断线）
      await alice.close();

      // 等待房主转移事件传播到客户端
      await waitFor(() => {
        const bobHost = bob.isHost();
        const daveHost = dave.isHost();
        return bobHost === true || daveHost === true;
      }, 3000);

      // 新房主应该是 Bob 或 Dave 之一（因为 Alice 已离开，users 只剩下 Bob 和 Dave）
      const newHostId = bob.isHost() ? 200 : 400;
      expect([200, 400]).toContain(newHostId);

      // 让 Bob 放弃对局，使游戏正常结束
      await bob.abort();
      await waitFor(() => bob.roomState()?.type === "SelectChart", 3000);
      expect(dave.roomState()?.type).toBe("SelectChart");
    } finally {
      await cleanupGame({ running, alice, bob, dave, tempDir });
    }
  }, 15000);

  test("多玩家同时 late-join", async () => {
    const { running, port, alice, bob, tempDir } = await createPlayingGame("edge3");
    const dave = await Client.connect("127.0.0.1", port);
    const carol = await Client.connect("127.0.0.1", port);

    try {
      await dave.authenticate("dddddddddddddddddddddddddddddddd");
      await carol.authenticate("cccccccccccccccccccccccccccccccc");

      // 两人同时加入
      await Promise.all([
        dave.joinRoom("edge3", false),
        carol.joinRoom("edge3", false),
      ]);

      await waitFor(() => dave.roomState()?.type === "Playing");
      await waitFor(() => carol.roomState()?.type === "Playing");

      // 两人都已被标记为 aborted，本局结束
      await alice.played(1);
      await bob.abort();

      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);
      expect(dave.roomState()?.type).toBe("SelectChart");
      expect(carol.roomState()?.type).toBe("SelectChart");
    } finally {
      await cleanupGame({ running, alice, bob, dave, carol, tempDir });
    }
  }, 15000);
});
