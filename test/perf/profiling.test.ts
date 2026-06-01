/**
 * 服务端性能分析测试
 *
 * 通过注入 TimingCollector 到 Mutex、Session、Stream 等关键路径，
 * 收集各环节耗时数据，定位性能瓶颈。
 *
 * 运行方式：npx vitest run test/perf/profiling.test.ts
 *
 * 若要单独跑某个场景，可以使用 .only：
 *   describe.only("auth-flow", ...)
 */

import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { Client } from "../../src/client/client.js";
import { type RunningServer, startServer } from "../../src/server/core/server.js";
import { setupMockFetch, createTempDir, cleanupTempDir, TOKENS, waitFor } from "../helpers.js";
import type { TouchFrame } from "../../src/common/commands.js";
import { timing } from "./timing.js";

// 延迟加载 profiler 目标模块（确保 hooks 在模块加载后设置）
import { Mutex } from "../../src/server/utils/mutex.js";
import { Session } from "../../src/server/network/session.js";
import { Stream } from "../../src/common/stream.js";

function installProfiler(): void {
  timing.enable();

  // Mutex 计时
  Mutex._profilerStart = () => performance.now();
  Mutex._profilerAcquired = (waitStart, queueLen) => {
    const waitMs = performance.now() - waitStart;
    timing.record("mutex.wait", waitMs);
    if (queueLen > 0) timing.record("mutex.wait.queue_depth", queueLen);
  };
  Mutex._profilerDone = (execStart) => {
    timing.record("mutex.exec", performance.now() - execStart);
  };

  // Session 命令处理计时
  Session._profilerStart = () => performance.now();
  Session._profilerEnd = (start, label) => {
    timing.record(`cmd.${label}`, performance.now() - start);
  };

  // Stream 写入计时
  Stream._profilerStart = () => performance.now();
  Stream._profilerWrite = (start, batchCount, totalBytes) => {
    const elapsed = performance.now() - start;
    timing.record("stream.write", elapsed);
    if (batchCount > 1) timing.record("stream.write.batched", batchCount);
  };
}

function uninstallProfiler(): void {
  Mutex._profilerStart = null;
  Mutex._profilerAcquired = null;
  Mutex._profilerDone = null;
  Session._profilerStart = null;
  Session._profilerEnd = null;
  Stream._profilerStart = null;
  Stream._profilerWrite = null;
  timing.disable();
}

describe("服务端性能分析", () => {
  const { originalFetch, mockFetch } = setupMockFetch();

  beforeAll(() => {
    globalThis.fetch = mockFetch;
    installProfiler();
  });

  afterAll(() => {
    uninstallProfiler();
    globalThis.fetch = originalFetch;
  });

  test("完整游戏流程耗时分析", async () => {
    const tempDir = await createTempDir("perf-test");
    let running: RunningServer | undefined;

    try {
      // 启动服务器
      running = await startServer({
        port: 0,
        config: {
          monitors: [200],
          replay_enabled: false,
          replay_base_dir: tempDir,
          hitokoto_api_url: "https://v1.hitokoto.cn/",
          room_list_tip: "perf test"
        }
      });
      const port = running.address().port;

      // --- 场景1: 认证 ---
      timing.reset();
      const alice = await Client.connect("127.0.0.1", port);
      await alice.authenticate(TOKENS.alice);
      const bob = await Client.connect("127.0.0.1", port);
      await bob.authenticate(TOKENS.bob);

      console.log("\n--- [阶段1] 认证流程 (authenticate x2) ---");
      console.log(timing.printReport());

      // --- 场景2: 创建房间 + 加入 ---
      timing.reset();
      await alice.createRoom("perf1");
      await bob.joinRoom("perf1", false);

      console.log("\n--- [阶段2] 创建房间 + 加入 ---");
      console.log(timing.printReport());

      // --- 场景3: 选谱 + 准备 + 开始 ---
      timing.reset();
      await alice.selectChart(1);
      await alice.requestStart();
      await bob.ready();

      await waitFor(() => alice.roomState()?.type === "Playing", 2000);
      await waitFor(() => bob.roomState()?.type === "Playing", 2000);

      console.log("\n--- [阶段3] 选谱 + 准备 + 开始游戏 ---");
      console.log(timing.printReport());

      // --- 场景4: 游戏中触控转发 ---
      timing.reset();
      const frames: TouchFrame[] = [
        { time: 0.1, points: [[0, { x: 0, y: 1 }]] },
        { time: 0.2, points: [[0, { x: 0.1, y: 0.9 }]] },
        { time: 0.3, points: [[0, { x: 0.2, y: 0.8 }]] }
      ];
      await alice.sendTouches(frames);

      console.log("\n--- [阶段4] 游戏中触控转发 (3帧) ---");
      console.log(timing.printReport());

      // --- 场景5: 结算 ---
      timing.reset();
      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);

      console.log("\n--- [阶段5] 结算 (played + gameEnd) ---");
      console.log(timing.printReport());

      // --- 汇总: 打印最耗时的操作 ---
      timing.reset();
      console.log("\n--- [检测] 全局 Mutex 队列深度 ---");
      const qSize = running.state.mutex.getQueueSize();
      console.log(`  当前队列深度: ${qSize}`);

    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
      // 在 finally 中打印，确保即使在失败时也能看到报告
      console.log("\n=== 最终汇总 ===");
      console.log(timing.printReport());
    }
  }, 30000);

  test("并发加入房间压力分析", async () => {
    const tempDir = await createTempDir("perf-concurrent");
    let running: RunningServer | undefined;

    try {
      running = await startServer({
        port: 0,
        config: {
          monitors: [],
          replay_enabled: false,
          replay_base_dir: tempDir,
          hitokoto_api_url: "https://v1.hitokoto.cn/",
          room_list_tip: ""
        }
      });
      const port = running.address().port;

      // 创建房主
      const alice = await Client.connect("127.0.0.1", port);
      await alice.authenticate(TOKENS.alice);
      await alice.createRoom("perf-concurrent");

      // 并发连接并加入房间 (10 个客户端)
      const CLIENT_COUNT = 10;
      timing.reset();

      const startConnects: Promise<Client>[] = [];
      for (let i = 0; i < CLIENT_COUNT; i++) {
        startConnects.push(Client.connect("127.0.0.1", port));
      }
      const clients = await Promise.all(startConnects);

      // 并发认证
      const authStarters: Promise<void>[] = [];
      for (let i = 0; i < CLIENT_COUNT; i++) {
        authStarters.push(clients[i]!.authenticate(TOKENS.bob)); // 都用 bob 的 token (会被认为是同一用户)
      }
      await Promise.allSettled(authStarters);

      console.log("\n--- [并发] 认证阶段 (10 clients) ---");
      console.log(timing.printReport());

      // 并发加入房间
      timing.reset();
      const joinStarters: Promise<unknown>[] = [];
      for (let i = 0; i < clients.length; i++) {
        const client = clients[i]!;
        joinStarters.push(client.joinRoom("perf-concurrent", false).catch(() => {}));
      }
      await Promise.allSettled(joinStarters);

      console.log("\n--- [并发] 加入房间 (10 clients) ---");
      console.log(timing.printReport());

      // 清理
      for (const client of clients) {
        await client.close().catch(() => {});
      }
      await alice.close();

    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
      console.log("\n=== 并发测试最终汇总 ===");
      console.log(timing.printReport());
    }
  }, 30000);

  test("高频命令处理 (Touches) 分析", async () => {
    const tempDir = await createTempDir("perf-touches");
    let running: RunningServer | undefined;

    try {
      running = await startServer({
        port: 0,
        config: {
          monitors: [],
          replay_enabled: false,
          replay_base_dir: tempDir,
          hitokoto_api_url: "https://v1.hitokoto.cn/"
        }
      });
      const port = running.address().port;

      const alice = await Client.connect("127.0.0.1", port);
      await alice.authenticate(TOKENS.alice);
      await alice.createRoom("perf-touch");
      await alice.selectChart(1);
      await alice.requestStart();

      // 进入 Playing 状态
      await waitFor(() => alice.roomState()?.type === "Playing", 2000);

      // 高频发送 Touches 命令
      timing.reset();
      const BATCH_COUNT = 50;
      for (let i = 0; i < BATCH_COUNT; i++) {
        const f: TouchFrame = {
          time: i * 0.1,
          points: [[0, { x: i * 0.01, y: 1 - i * 0.01 }]]
        };
        await alice.sendTouches([f]);
      }

      console.log(`\n--- [高频] 发送 Touches (${BATCH_COUNT}次) ---`);
      console.log(timing.printReport());

      await alice.close();

    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
    }
  }, 30000);
});
