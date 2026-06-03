// 游戏进行中加入房间：核心功能测试
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { Client } from "../../../src/client/client.js";
import { waitFor, setupMockFetch } from "../../helpers.js";
import { createPlayingGame, cleanupGame } from "./helpers.js";

describe("late-join / basic", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("普通玩家游戏中加入不影响本局结束，下局可正常参与", async () => {
    const { running, port, alice, bob, tempDir } = await createPlayingGame("room1", {
      replay: true
    });

    const dave = await Client.connect("127.0.0.1", port);

    try {
      await dave.authenticate("dddddddddddddddddddddddddddddddd");

      // Dave 在游戏进行中加入
      const joinResp = await dave.joinRoom("room1", false);
      expect(joinResp.state.type).toBe("SelectChart");

      // Dave 收到状态同步后状态应为 Playing
      await waitFor(() => dave.roomState()?.type === "Playing");

      // Alice 完成，Bob 放弃，Dave 已自动标记为 aborted，本局结束
      await alice.played(1);
      await bob.abort();

      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);
      expect(bob.roomState()?.type).toBe("SelectChart");
      expect(dave.roomState()?.type).toBe("SelectChart");
    } finally {
      await cleanupGame({ running, alice, bob, dave, tempDir });
    }
  }, 15000);
});
