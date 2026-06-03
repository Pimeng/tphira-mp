import { setupMockFetch } from "./helpers.js";

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
