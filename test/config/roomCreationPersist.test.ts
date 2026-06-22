import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../../src/server/core/server.js";
import { cleanupTempDir, createTempDir, setupMockFetch } from "../helpers.js";

describe("建房开关持久化 (ROOM_CREATION_ENABLED)", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("启动时从配置读取建房开关（false 则默认禁止建房）", async () => {
    const tempDir = await createTempDir("phira-roomcreate-load");
    const configPath = join(tempDir, "server_config.yml");
    await writeFile(configPath, "# 顶部注释\nROOM_CREATION_ENABLED: false\n", "utf8");

    const running = await startServer({
      port: 0,
      configPath,
      watchConfig: false,
      config: { replay_base_dir: tempDir }
    });
    try {
      expect(running.state.roomCreationEnabled).toBe(false);
    } finally {
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });

  test("CLI roomcreation off/on 写回配置文件且保留注释", async () => {
    const tempDir = await createTempDir("phira-roomcreate-persist");
    const configPath = join(tempDir, "server_config.yml");
    await writeFile(configPath, "# 顶部注释\nPORT: 12346\n", "utf8");

    const running = await startServer({
      port: 0,
      configPath,
      watchConfig: false,
      config: { replay_base_dir: tempDir }
    });
    try {
      // 默认放行建房
      expect(running.state.roomCreationEnabled).toBe(true);

      // 关闭 → 内存与文件均更新，注释/原有键保留
      await running.state.consoleExecutor?.("roomcreation off");
      expect(running.state.roomCreationEnabled).toBe(false);
      let text = await readFile(configPath, "utf8");
      expect(text).toContain("# 顶部注释");
      expect(text).toContain("PORT: 12346");
      expect(text).toMatch(/^ROOM_CREATION_ENABLED:\s*false\s*$/m);

      // 再次开启 → 原地替换为 true，不产生重复键
      await running.state.consoleExecutor?.("roomcreation on");
      expect(running.state.roomCreationEnabled).toBe(true);
      text = await readFile(configPath, "utf8");
      expect(text).toMatch(/^ROOM_CREATION_ENABLED:\s*true\s*$/m);
      expect((text.match(/ROOM_CREATION_ENABLED/g) ?? []).length).toBe(1);
    } finally {
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });
});
