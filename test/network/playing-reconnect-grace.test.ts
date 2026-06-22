// 对局（Playing）进行中断线的重连宽限测试
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../../src/client/client.js";
import { startServer } from "../../src/server/core/server.js";
import { cleanupTempDir, createTempDir, setupMockFetch, sleep, waitFor } from "../helpers.js";

const ALICE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** 让 alice（房主）与 bob（普通玩家）进入同一房间并开局到 Playing */
async function driveToPlaying(alice: Client, bob: Client, roomName: string): Promise<void> {
  await alice.authenticate(ALICE);
  await alice.createRoom(roomName);
  await bob.authenticate(BOB);
  await bob.joinRoom(roomName, false);

  await alice.selectChart(1);
  await alice.requestStart();
  await bob.ready();

  await waitFor(() => alice.roomState()?.type === "Playing", 2000);
  await waitFor(() => bob.roomState()?.type === "Playing", 2000);
}

describe("对局断线重连宽限 (PLAYING_RECONNECT_GRACE)", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("默认开启宽限：Playing 中断线不立即移除，可重连回原局", async () => {
    const tempDir = await createTempDir("phira-playgrace-on");
    const running = await startServer({
      port: 0,
      config: { monitors: [], replay_base_dir: tempDir } // 默认 PLAYING_RECONNECT_GRACE=15
    });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    let bob = await Client.connect("127.0.0.1", port);

    try {
      await driveToPlaying(alice, bob, "grace-on");
      expect(running.state.users.has(200)).toBe(true);

      // 硬断线（不自动重连）→ 服务端进入 dangle 宽限，而非立即移除
      bob.disconnect();
      await sleep(400);
      expect(running.state.users.has(200)).toBe(true); // 仍占位
      const room = [...running.state.rooms.values()][0]!;
      expect(room.state.type).toBe("Playing"); // 本局未被提前结算

      // 宽限期内重连：恢复到原 Playing 房间
      bob = await Client.connect("127.0.0.1", port);
      await bob.authenticate(BOB);
      expect(bob.me()?.id).toBe(200);
      expect(bob.roomState()?.type).toBe("Playing");
      expect(running.state.users.has(200)).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });

  test("宽限设为 0：保持旧行为，Playing 中断线立即移出本局", async () => {
    const tempDir = await createTempDir("phira-playgrace-off");
    const running = await startServer({
      port: 0,
      config: { monitors: [], playing_reconnect_grace: 0, replay_base_dir: tempDir }
    });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await driveToPlaying(alice, bob, "grace-off");
      expect(running.state.users.has(200)).toBe(true);

      bob.disconnect();
      // 立即判定离开：很快从在线用户中移除
      await waitFor(() => !running.state.users.has(200), 2000);
      expect(running.state.users.has(200)).toBe(false);
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });

  test("其他玩家都已完成、仅剩断线玩家时，向房间广播等待重连提示", async () => {
    const tempDir = await createTempDir("phira-playgrace-notify");
    const running = await startServer({
      port: 0,
      config: { monitors: [], replay_base_dir: tempDir } // 默认宽限 5s
    });
    const port = running.address().port;

    const alice = await Client.connect("127.0.0.1", port);
    const bob = await Client.connect("127.0.0.1", port);

    try {
      await driveToPlaying(alice, bob, "grace-notify");

      // alice 先完成本局；bob 仍在进行，故本局尚未结算
      await alice.played(1);

      // bob 异常断开 → 此刻其他玩家(alice)都已完成 → 应广播等待重连提示
      bob.disconnect();

      const chats: string[] = [];
      await waitFor(() => {
        chats.push(
          ...alice
            .takeMessages()
            .filter((m) => m.type === "Chat" && (m as { user: number }).user === 0)
            .map((m) => (m as { content: string }).content)
        );
        return chats.some((s) => s.includes("等待重连"));
      }, 3000);

      expect(chats.some((s) => s.includes("等待重连"))).toBe(true);
      expect(chats.some((s) => s.includes("Bob"))).toBe(true);
      // 本局仍未结算（在等 bob）
      const room = [...running.state.rooms.values()][0]!;
      expect(room.state.type).toBe("Playing");
    } finally {
      await alice.close();
      await bob.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });
});
