import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfigFile, parseConfigText, startServer } from "../../src/server/core/server.js";
import { waitFor } from "../helpers.js";

describe("配置文件解析", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `phira-mp-config-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, "server_config.yml");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("按全大写键名解析完整配置", () => {
    const config = parseConfigText(`
MONITORS: "2, 100; 200"
TEST_ACCOUNT_IDS:
  - 1739989
  - "200"
SERVER_NAME: "Phira MP"
HOST: "::"
PORT: "12346"
HTTP_SERVICE: "true"
HTTP_PORT: "12347"
LOG_LEVEL: INFO
REAL_IP_HEADER: X-Forwarded-For
HAPROXY_PROTOCOL: "false"
ROOM_MAX_USERS: 128
CHAT_ENABLED: "off"
REPLAY_ENABLED: "on"
REPLAY_BASE_DIR: "./record"
ADMIN_TOKEN: "replace_me"
ADMIN_DATA_PATH: "./admin_data.json"
ROOM_LIST_TIP: "欢迎加入"
PHIRA_API_ENDPOINT: "https://phira.5wyxi.com"
OUTBOUND_PROXY: false
SHARE_STATION:
  URL: "http://127.0.0.1:40004"
  TOKEN: "share_station_token"
`);

    expect(config).toMatchObject({
      monitors: [2, 100, 200],
      test_account_ids: [1739989, 200],
      server_name: "Phira MP",
      host: "::",
      port: 12346,
      http_service: true,
      http_port: 12347,
      log_level: "INFO",
      real_ip_header: "X-Forwarded-For",
      haproxy_protocol: false,
      room_max_users: 64,
      chat_enabled: false,
      replay_enabled: true,
      replay_base_dir: "./record",
      admin_token: "replace_me",
      admin_data_path: "./admin_data.json",
      room_list_tip: "欢迎加入",
      phira_api_endpoint: "https://phira.5wyxi.com",
      outbound_proxy: false,
      share_station: {
        url: "http://127.0.0.1:40004",
        token: "share_station_token"
      }
    });
  });

  it("旧的小写和驼峰配置键名不再生效", () => {
    const config = parseConfigText(`
monitors:
  - 100
test_account_ids:
  - 200
server_name: "Legacy Server"
replay_enabled: true
phiraApiEndpoint: "https://legacy.example.com"
share_station:
  url: "http://127.0.0.1:40004"
  token: "legacy_token"
`);

    expect(config.monitors).toEqual([2]);
    expect(config.test_account_ids).toBeUndefined();
    expect(config.server_name).toBeUndefined();
    expect(config.replay_enabled).toBeUndefined();
    expect(config.phira_api_endpoint).toBeUndefined();
    expect(config.share_station).toBeUndefined();
  });

  it("无效配置值回落到默认或未配置状态", () => {
    const config = parseConfigText(`
MONITORS: []
PORT: 70000
HTTP_SERVICE: "maybe"
HTTP_PORT: 0
ROOM_MAX_USERS: 0
CHAT_ENABLED: "maybe"
SHARE_STATION:
  URL: ""
  TOKEN: "token"
`);

    expect(config.monitors).toEqual([2]);
    expect(config.port).toBeUndefined();
    expect(config.http_service).toBeUndefined();
    expect(config.http_port).toBeUndefined();
    expect(config.room_max_users).toBeUndefined();
    expect(config.chat_enabled).toBeUndefined();
    expect(config.share_station).toBeUndefined();
  });

  it("YAML 语法错误不会被当作默认配置吞掉", () => {
    expect(() => parseConfigText("HOST: [")).toThrow();
  });

  it("使用 UTF-8 编码读取配置文件", () => {
    writeFileSync(
      configPath,
      `
SERVER_NAME: "测试服务器"
ROOM_LIST_TIP: "欢迎加入交流群"
MONITORS:
  - 2
`,
      "utf8"
    );

    const config = loadConfigFile(configPath);

    expect(config.server_name).toBe("测试服务器");
    expect(config.room_list_tip).toBe("欢迎加入交流群");
    expect(config.monitors).toEqual([2]);
  });

  it("watches config file changes and updates runtime config", async () => {
    const recordBefore = join(tempDir, "record-before");
    const recordAfter = join(tempDir, "record-after");
    writeFileSync(
      configPath,
      `
SERVER_NAME: "Before"
MONITORS:
  - 2
ROOM_MAX_USERS: 8
REPLAY_ENABLED: false
REPLAY_BASE_DIR: ${JSON.stringify(recordBefore)}
`,
      "utf8"
    );

    const running = await startServer({ port: 0, configPath });
    try {
      expect(running.state.serverName).toBe("Before");
      expect(running.state.config.monitors).toEqual([2]);
      expect(running.state.replayEnabled).toBe(false);
      expect(running.state.replayRecorder.baseDir).toBe(recordBefore);

      writeFileSync(
        configPath,
        `
SERVER_NAME: "After"
MONITORS:
  - 123
ROOM_MAX_USERS: 3
REPLAY_ENABLED: true
REPLAY_BASE_DIR: ${JSON.stringify(recordAfter)}
`,
        "utf8"
      );

      await waitFor(() => running.state.serverName === "After", 3000);
      expect(running.state.config.monitors).toEqual([123]);
      expect(running.state.config.room_max_users).toBe(3);
      expect(running.state.replayEnabled).toBe(true);
      expect(running.state.replayRecorder.baseDir).toBe(recordAfter);
    } finally {
      await running.close();
    }
  });
});
