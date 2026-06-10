import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupMockFetch } from "./helpers.js";

// 测试环境隔离：把应用主目录（配置 / 日志 / 数据 / locales）指向一次性临时目录。
// 否则 getAppPaths() 会落到仓库根目录——只要服主在根目录真实运行过一次服务端，
// 自动生成的 server_config.yml（ROOM_MAX_USERS / CORS_ORIGINS 等）就会渗入测试，
// 测试日志也会写进仓库的 logs/ 与 data/。
// 必须在任何 getAppPaths() 调用之前设置（其结果按 worker 缓存）；
// 须在下方 originalEnv 快照之前设置，使 restoreTrackedEnv() 恢复到隔离值而非真实环境。
// 临时目录下没有 locales 时，l10n 回退到嵌入式翻译（与 ftl 内容一致，由 embeddedLocales.test 保证）。
process.env.PHIRA_MP_HOME = mkdtempSync(join(tmpdir(), "phira-mp-test-home-"));

// 保存原始环境变量，以便测试间恢复
const originalEnv: Record<string, string | undefined> = {};
const envVarsToTrack = [
  "ADMIN_TOKEN",
  "ADMIN_DATA_PATH",
  "ROOM_LIST_TIP",
  "PHIRA_MP_HOME",
  "PHIRA_API_ENDPOINT",
  "ROOM_MAX_USERS",
  "CHAT_ENABLED",
  "MONITORS",
  "HTTP_SERVICE"
];

for (const key of envVarsToTrack) {
  originalEnv[key] = process.env[key];
}

/** 恢复被跟踪的环境变量到初始值 */
export function restoreTrackedEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// 安装标准 mock fetch（不检查 hitokotoCalls 的测试可直接使用）
// 需要检查调用次数的测试应自行使用 setupMockFetch()
const { mockFetch, originalFetch: _globalOriginalFetch } = setupMockFetch();
const globalOriginalFetch = _globalOriginalFetch;

let mockFetchInstalled = false;

/** 安装全局 mock fetch，适用于不关心 hitokoto 调用次数的测试 */
export function installGlobalMockFetch(): void {
  if (!mockFetchInstalled) {
    globalThis.fetch = mockFetch;
    mockFetchInstalled = true;
  }
}

/** 恢复全局 fetch */
export function restoreGlobalMockFetch(): void {
  globalThis.fetch = globalOriginalFetch;
  mockFetchInstalled = false;
}

// 预加载关键模块以使 JIT 编译在首轮完成
import "../src/common/binary.js";
import "../src/common/framing.js";
import "../src/common/commands.js";
import "../src/common/roomId.js";
