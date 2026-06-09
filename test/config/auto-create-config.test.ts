import { afterEach, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../../src/server/core/server.js";
import { createTempDir, cleanupTempDir } from "../helpers.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await cleanupTempDir(d);
});

describe("首次启动自动生成配置", () => {
  test("autoCreateConfig 开启且配置缺失时，生成默认配置文件并正常启动", async () => {
    const dir = await createTempDir("auto-cfg");
    dirs.push(dir);
    const cfgPath = join(dir, "server_config.yml");
    expect(existsSync(cfgPath)).toBe(false);

    const running = await startServer({
      port: 0,
      configPath: cfgPath,
      autoCreateConfig: true,
      watchConfig: false,
      config: { monitors: [] }
    });
    try {
      expect(existsSync(cfgPath)).toBe(true);
    } finally {
      await running.close();
    }
  });

  test("未开启 autoCreateConfig 时不生成配置文件（测试默认行为）", async () => {
    const dir = await createTempDir("no-auto-cfg");
    dirs.push(dir);
    const cfgPath = join(dir, "server_config.yml");

    const running = await startServer({
      port: 0,
      configPath: cfgPath,
      watchConfig: false,
      config: { monitors: [] }
    });
    try {
      expect(existsSync(cfgPath)).toBe(false);
    } finally {
      await running.close();
    }
  });
});
