/**
 * 内存泄漏回归测试
 *
 * 模拟极限场景：大量客户端反复连接、认证、创建房间、加入房间、发送消息、断开。
 * 每轮结束后强制 GC（需要 node --expose-gc），记录堆内存。
 * 如果修复后的代码存在监听器泄漏，内存会持续上升；正常代码应趋于平稳。
 *
 * 运行方式：
 *   pnpm test:memory
 * 或
 *   NODE_OPTIONS='--expose-gc' vitest run --config vitest.config.memory.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { startServer } from "../../src/server/core/server.js";
import { Client } from "../../src/client/client.js";
import { setupMockFetch, sleep, createTempDir, cleanupTempDir } from "../helpers.js";

// 声明全局 gc（由 --expose-gc 提供）
// Node.js 24 中 global.gc 的类型为 GCFunction，与 () => void 兼容，
// 但直接声明会冲突；这里通过 any 绕过，实际调用时做类型守卫。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalGc = (globalThis as any).gc as (() => void) | undefined;

function forceGc(): void {
  if (typeof globalGc === "function") {
    globalGc();
    globalGc(); // 两次以确保 Mark-Compact 充分执行
  }
}

function getHeapUsedMB(): number {
  return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

/** 等待所有 dangling timeout（10s）结束 */
async function waitForDangleTimeouts(): Promise<void> {
  await sleep(11_000);
}

describe("内存泄漏回归", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test(
    "大量连接/断开循环后内存应趋于平稳（无监听器泄漏）",
    async () => {
      if (typeof global.gc !== "function") {
        console.warn("[memory-leak] 未检测到 --expose-gc，跳过强制 GC。");
      }

      const tempDir = await createTempDir("memory-leak-test");
      const running = await startServer({
        port: 0,
        config: {
          monitors: [200, 300, 400],
          replay_enabled: false,
          replay_base_dir: tempDir,
        },
      });
      const port = running.address().port;

      // 预热：先执行一轮让 JIT 编译稳定，不计入统计
      await warmup(port);

      // 正式轮次
      const measurements: number[] = [];
      const ROUNDS = 8;
      const CLIENTS_PER_ROUND = 16;

      for (let round = 0; round < ROUNDS; round++) {
        await stressRound(port, CLIENTS_PER_ROUND);

        // 等待 dangling timeout 结束，确保所有 User 被清理
        await waitForDangleTimeouts();

        forceGc();
        await sleep(200);
        forceGc();

        const mem = getHeapUsedMB();
        measurements.push(mem);
        console.log(`[memory-leak] Round ${round + 1}/${ROUNDS}: heapUsed = ${mem} MB`);
      }

      await running.close();
      await cleanupTempDir(tempDir);

      // 分析：排除前两轮（JIT / 模块缓存影响），取后半段均值
      const warmupRounds = 2;
      const stableMeasurements = measurements.slice(warmupRounds);

      // 计算线性回归斜率：如果斜率显著为正，说明内存泄漏
      const slope = linearRegressionSlope(stableMeasurements);
      const avg = stableMeasurements.reduce((a, b) => a + b, 0) / stableMeasurements.length;
      const max = Math.max(...stableMeasurements);
      const min = Math.min(...stableMeasurements);

      console.log(`[memory-leak] 分析结果: avg=${avg.toFixed(1)}MB, max=${max}MB, min=${min}MB, slope=${slope.toFixed(2)}MB/round`);

      // 断言：
      // 1. 斜率不应显著为正（每轮增长 < 2MB 视为正常波动）
      expect(slope).toBeLessThan(2);

      // 2. 最大值不应超过平均值太多（波动 < 30%）
      expect(max).toBeLessThan(avg * 1.3 + 5);

      // 3. 最后一轮不应比平均值高出太多
      const last = stableMeasurements[stableMeasurements.length - 1];
      expect(last).toBeLessThan(avg * 1.25 + 5);
    },
    // 每轮大约需要：连接(16*50ms) + 操作(500ms) + dangle(11s) = ~12s
    // 8 轮 ≈ 96s + 预热 12s = 108s，留足余量
    180_000
  );
});

/** 预热一轮，让 JIT 和模块缓存稳定 */
async function warmup(port: number): Promise<void> {
  const clients: Client[] = [];
  const tokens = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "cccccccccccccccccccccccccccccccc",
    "dddddddddddddddddddddddddddddddd",
  ];
  for (let i = 0; i < 4; i++) {
    const c = await Client.connect("127.0.0.1", port, { timeoutMs: 5000 });
    clients.push(c);
    await c.authenticate(tokens[i % tokens.length]);
  }
  await clients[0].createRoom("warmup-room");
  for (let i = 1; i < clients.length; i++) {
    await clients[i].joinRoom("warmup-room", false);
  }
  for (const c of clients) {
    await c.close();
  }
  await waitForDangleTimeouts();
  forceGc();
  await sleep(200);
}

/** 一轮压力测试 */
async function stressRound(port: number, count: number): Promise<void> {
  const clients: Client[] = [];
  const tokens = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "cccccccccccccccccccccccccccccccc",
    "dddddddddddddddddddddddddddddddd",
  ];

  // 串行连接+认证：避免同一 token 的并发连接互相踢掉。
  // 内存泄漏测试的重点是"连接-断开-清理"循环，而非并发极限。
  for (let i = 0; i < count; i++) {
    const c = await Client.connect("127.0.0.1", port, { timeoutMs: 5000 });
    clients.push(c);
    await c.authenticate(tokens[i % tokens.length]);
  }

  // 创建多个房间，分散负载
  const roomNames = ["room-a", "room-b", "room-c", "room-d"];
  for (let i = 0; i < roomNames.length && i < clients.length; i++) {
    try {
      await clients[i].createRoom(roomNames[i]);
    } catch {
      // 可能已被其他同 token 连接踢掉，忽略
    }
  }

  // 其他客户端加入房间（部分观战）
  for (let i = roomNames.length; i < clients.length; i++) {
    const room = roomNames[i % roomNames.length];
    const monitor = i % 3 === 0; // 每第3个作为观战者
    try {
      await clients[i].joinRoom(room, monitor);
    } catch {
      // 忽略
    }
  }

  // 部分房间选择谱面并请求开始
  for (let i = 0; i < Math.min(roomNames.length, clients.length); i++) {
    const c = clients[i];
    try {
      await c.selectChart(1);
      await c.requestStart();
    } catch {
      // 忽略状态错误，只关心连接/断开循环
    }
  }

  // 部分客户端发送聊天消息
  for (let i = 0; i < clients.length; i += 4) {
    try {
      await clients[i].chat(`msg-${i}`);
    } catch {
      // 忽略
    }
  }

  // 断开所有连接（模拟各种断开方式）
  for (let i = 0; i < clients.length; i++) {
    const c = clients[i];
    try {
      if (i % 5 === 0) {
        // 20% 通过 destroy socket 暴力断开
        const socket = (c as any).stream?.socket;
        if (socket) socket.destroy();
      } else if (i % 3 === 0) {
        // 33% 通过 end() 半关闭
        const socket = (c as any).stream?.socket;
        if (socket) socket.end();
      } else {
        // 其余正常关闭
        await c.close();
      }
    } catch {
      // 忽略关闭错误
    }
  }
}

/** 简单线性回归，返回每轮增长的斜率（MB/round） */
function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}
