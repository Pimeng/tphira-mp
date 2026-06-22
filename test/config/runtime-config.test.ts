import { afterEach, describe, expect, test } from "vitest";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { startServer } from "../../src/server/core/server.js";
import { cleanupTempDir, createTempDir } from "../helpers.js";

describe("管理员运行时配置接口", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => cleanupTempDir(dir)));
  });

  test("支持读取、批量更新并一键回滚", async () => {
    const tempDir = await createTempDir("phira-runtime-config");
    tempDirs.push(tempDir);
    const configPath = join(tempDir, "server_config.yml");
    await writeFile(
      configPath,
      ['# 运行时配置测试', 'ROOM_LIST_TIP: "旧提示"', 'MAX_ROOMS: 0', 'LOG_LEVEL: INFO', ""].join("\n"),
      "utf8"
    );

    const running = await startServer({
      port: 0,
      configPath,
      config: { monitors: [200], http_service: true, http_port: 0, admin_token: "runtime-config-secret-1234" }
    });
    const httpPort = running.http!.address().port;

    try {
      const getResp = await fetch(`http://127.0.0.1:${httpPort}/admin/runtime-config`, {
        headers: { "x-admin-token": "runtime-config-secret-1234" }
      });
      expect(getResp.ok).toBe(true);
      const getJson = (await getResp.json()) as any;
      expect(getJson.ok).toBe(true);
      expect(getJson.rollbackAvailable).toBe(false);
      expect(getJson.config.MAX_ROOMS).toBe(0);
      expect(getJson.config.ROOM_LIST_TIP).toBe("旧提示");

      const updateResp = await fetch(`http://127.0.0.1:${httpPort}/admin/runtime-config`, {
        method: "POST",
        headers: { "x-admin-token": "runtime-config-secret-1234", "content-type": "application/json" },
        body: JSON.stringify({
          MAX_ROOMS: 5,
          ROOM_LIST_TIP: "欢迎加入测试服",
          LOG_LEVEL: "warn",
          HTTP_RATE_LIMIT_MAX_REQUESTS: 123,
          ROOM_CREATION_ENABLED: false
        })
      });
      expect(updateResp.ok).toBe(true);
      const updateJson = (await updateResp.json()) as any;
      expect(updateJson.ok).toBe(true);
      expect(updateJson.updatedKeys).toEqual([
        "MAX_ROOMS",
        "ROOM_LIST_TIP",
        "LOG_LEVEL",
        "HTTP_RATE_LIMIT_MAX_REQUESTS",
        "ROOM_CREATION_ENABLED"
      ]);
      expect(updateJson.rollbackAvailable).toBe(true);
      expect(updateJson.config.MAX_ROOMS).toBe(5);
      expect(updateJson.config.ROOM_LIST_TIP).toBe("欢迎加入测试服");
      expect(updateJson.config.LOG_LEVEL).toBe("WARN");
      expect(updateJson.config.HTTP_RATE_LIMIT_MAX_REQUESTS).toBe(123);
      expect(updateJson.config.ROOM_CREATION_ENABLED).toBe(false);
      expect(running.state.roomCreationEnabled).toBe(false);
      expect(running.state.config.max_rooms).toBe(5);
      expect(running.state.config.log_level).toBe("WARN");

      const updatedText = await readFile(configPath, "utf8");
      expect(updatedText).toContain('ROOM_LIST_TIP: "欢迎加入测试服"');
      expect(updatedText).toContain("MAX_ROOMS: 5");
      expect(updatedText).toContain("LOG_LEVEL: \"WARN\"");
      expect(updatedText).toContain("HTTP_RATE_LIMIT_MAX_REQUESTS: 123");
      expect(updatedText).toContain("ROOM_CREATION_ENABLED: false");

      const rollbackResp = await fetch(`http://127.0.0.1:${httpPort}/admin/runtime-config/rollback`, {
        method: "POST",
        headers: { "x-admin-token": "runtime-config-secret-1234" }
      });
      expect(rollbackResp.ok).toBe(true);
      const rollbackJson = (await rollbackResp.json()) as any;
      expect(rollbackJson.ok).toBe(true);
      expect(rollbackJson.config.MAX_ROOMS).toBe(0);
      expect(rollbackJson.config.ROOM_LIST_TIP).toBe("旧提示");
      expect(rollbackJson.config.LOG_LEVEL).toBe("INFO");
      expect(rollbackJson.config.ROOM_CREATION_ENABLED).toBe(true);
      expect(running.state.roomCreationEnabled).toBe(true);
      expect(running.state.config.max_rooms).toBeUndefined();

      const rolledBackText = await readFile(configPath, "utf8");
      expect(rolledBackText).toContain('ROOM_LIST_TIP: "旧提示"');
      expect(rolledBackText).toContain("MAX_ROOMS: 0");
      expect(rolledBackText).toContain("LOG_LEVEL: \"INFO\"");
      expect(rolledBackText).toContain("ROOM_CREATION_ENABLED: true");
    } finally {
      await running.close();
    }
  });

  test("拒绝启动期配置和非法值", async () => {
    const tempDir = await createTempDir("phira-runtime-config-invalid");
    tempDirs.push(tempDir);
    const configPath = join(tempDir, "server_config.yml");
    await writeFile(configPath, "# invalid\n", "utf8");

    const running = await startServer({
      port: 0,
      configPath,
      config: { monitors: [200], http_service: true, http_port: 0, admin_token: "runtime-config-secret-1234" }
    });
    const httpPort = running.http!.address().port;

    try {
      const resp = await fetch(`http://127.0.0.1:${httpPort}/admin/runtime-config`, {
        method: "POST",
        headers: { "x-admin-token": "runtime-config-secret-1234", "content-type": "application/json" },
        body: JSON.stringify({ HTTP_PORT: 12347, LOG_LEVEL: "trace", UNKNOWN_KEY: 1 })
      });
      expect(resp.status).toBe(400);
      const json = (await resp.json()) as any;
      expect(json.ok).toBe(false);
      expect(json.error).toBe("bad-runtime-config");
      expect(json.invalidKeys).toEqual(["LOG_LEVEL"]);
      expect(json.startupOnlyKeys).toEqual(["HTTP_PORT"]);
      expect(json.unsupportedKeys).toEqual(["UNKNOWN_KEY"]);
    } finally {
      await running.close();
    }
  });
});
