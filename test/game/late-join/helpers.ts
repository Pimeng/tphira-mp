// 游戏进行中加入房间的共享测试辅助函数
import { Client } from "../../../src/client/client.js";
import { startServer } from "../../../src/server/core/server.js";
import { waitFor, createTempDir, cleanupTempDir } from "../../helpers.js";

/**
 * 创建一个正在游戏中的房间（Alice 是房主，Bob 是玩家，状态为 Playing）
 */
export async function createPlayingGame(
  roomName: string,
  opts: {
    replay?: boolean;
    extraMonitors?: number[];
    maxUsers?: number;
  } = {}
) {
  const tempDir = opts.replay ? await createTempDir("late-join-test") : null;

  const running = await startServer({
    port: 0,
    config: {
      monitors: opts.extraMonitors ?? [],
      replay_enabled: opts.replay ?? false,
      max_users: opts.maxUsers,
      ...(tempDir ? { replay_base_dir: tempDir } : {}),
    },
  });

  const port = running.address().port;

  const alice = await Client.connect("127.0.0.1", port);
  const bob = await Client.connect("127.0.0.1", port);

  await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

  await alice.createRoom(roomName);
  await bob.joinRoom(roomName, false);

  await alice.selectChart(1);
  await alice.requestStart();
  await bob.ready();

  await waitFor(() => alice.roomState()?.type === "Playing");
  await waitFor(() => bob.roomState()?.type === "Playing");

  return { running, port, alice, bob, tempDir };
}

/**
 * 创建一个处于 WaitForReady 状态的房间
 */
export async function createWaitingGame(roomName: string) {
  const running = await startServer({
    port: 0,
    config: { monitors: [] },
  });

  const port = running.address().port;

  const alice = await Client.connect("127.0.0.1", port);
  const bob = await Client.connect("127.0.0.1", port);

  await alice.authenticate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await bob.authenticate("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

  await alice.createRoom(roomName);
  await bob.joinRoom(roomName, false);

  await alice.selectChart(1);
  await alice.requestStart();

  await waitFor(() => alice.roomState()?.type === "WaitingForReady");

  return { running, port, alice, bob };
}

/**
 * 清理测试资源（客户端、服务器、临时目录）
 */
export async function cleanupGame(resources: {
  running?: Awaited<ReturnType<typeof startServer>>;
  alice?: Client;
  bob?: Client;
  dave?: Client;
  carol?: Client;
  tempDir?: string | null;
}): Promise<void> {
  const { running, alice, bob, dave, carol, tempDir } = resources;

  await alice?.close();
  await bob?.close();
  await dave?.close();
  await carol?.close();
  await running?.close();

  if (tempDir) {
    await cleanupTempDir(tempDir);
  }
}