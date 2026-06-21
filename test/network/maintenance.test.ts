import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../../src/client/client.js";
import { startServer } from "../../src/server/core/server.js";
import { cleanupTempDir, createTempDir, setupMockFetch } from "../helpers.js";

describe("维护模式 (maintenance mode)", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("CLI maintenance on/off 切换状态；维护期间拒绝新连接，关闭后恢复", async () => {
    const tempDir = await createTempDir("phira-maint-auth");
    const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
    const port = running.address().port;

    try {
      // 经由真实 CLI 分发进入维护模式（GUI 控制台与终端共用此入口）
      await running.state.consoleExecutor?.("maintenance on");
      expect(running.state.maintenance).toBe(true);

      // 维护期间新连接认证应被拒绝
      const blocked = await Client.connect("127.0.0.1", port);
      try {
        await expect(blocked.authenticate("a".repeat(32))).rejects.toThrow();
      } finally {
        await blocked.close();
      }

      // 退出维护模式
      await running.state.consoleExecutor?.("maintenance off");
      expect(running.state.maintenance).toBe(false);

      // 恢复后可正常认证
      const ok = await Client.connect("127.0.0.1", port);
      try {
        await ok.authenticate("a".repeat(32));
        expect(ok.me()?.id).toBe(100);
      } finally {
        await ok.close();
      }
    } finally {
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });

  test("维护期间已在线用户不被踢，但不能新建房间；关闭后恢复建房", async () => {
    const tempDir = await createTempDir("phira-maint-room");
    const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
    const port = running.address().port;

    const host = await Client.connect("127.0.0.1", port);
    try {
      // 维护关闭时认证成功
      await host.authenticate("a".repeat(32));
      expect(host.me()?.id).toBe(100);

      // 进入维护：已在线用户保持连接，但新建房间被拒
      running.state.maintenance = true;
      await expect(host.createRoom("room_maint")).rejects.toThrow();
      expect(host.me()?.id).toBe(100); // 未被踢下线

      // 退出维护后可正常建房
      running.state.maintenance = false;
      await host.createRoom("room_maint");
      expect(host.roomState()?.type).toBe("SelectChart");
    } finally {
      await host.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });
});
