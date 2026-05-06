import { afterEach, beforeEach } from "vitest";
import { ServerState } from "../../../src/server/core/state.js";
import { Logger } from "../../../src/server/utils/logger.js";
import type { ServerConfig } from "../../../src/server/core/types.js";
import { cleanupTempDir, createTempDir } from "../../helpers.js";

export type CliTestRefs = {
  state: ServerState;
  logger: Logger;
  tempDir: string;
};

/**
 * 公共的 CLI 测试套件初始化：beforeEach 创建独立 state/logger，afterEach 清理。
 * 调用方在 describe 顶层调用获得引用持有者，并在 it 内通过 .current() 取最新引用。
 */
export function useCliTestSuite(): { current: () => CliTestRefs } {
  const refs: { value: CliTestRefs | null } = { value: null };

  beforeEach(async () => {
    const tempDir = await createTempDir("cli-test");
    const config: ServerConfig = {
      monitors: [2],
      test_account_ids: [],
      server_name: "测试服务器",
      host: "localhost",
      port: 12346,
      http_service: false,
      http_port: 12347,
      room_max_users: 8,
      replay_enabled: false,
      admin_token: "test_token",
      admin_data_path: `${tempDir}/test_admin_data.json`,
      room_list_tip: undefined,
      log_level: "ERROR",
      real_ip_header: undefined,
      haproxy_protocol: false
    };

    const logger = new Logger({ logsDir: tempDir, minLevel: "ERROR" });
    const state = new ServerState(config, logger, "测试服务器", `${tempDir}/test_admin_data.json`, `${tempDir}/test_server_config.yml`);
    refs.value = { state, logger, tempDir };
  });

  afterEach(async () => {
    if (!refs.value) return;
    refs.value.logger.close();
    await cleanupTempDir(refs.value.tempDir);
    refs.value = null;
  });

  return {
    current: () => {
      if (!refs.value) throw new Error("CLI test refs not initialized — call useCliTestSuite inside a describe");
      return refs.value;
    }
  };
}
