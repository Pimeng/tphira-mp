/**
 * 服务端性能分析测试
 *
 * 通过注入 TimingCollector 到 Mutex、Session、Stream 等关键路径，
 * 收集各环节耗时数据，定位性能瓶颈。
 */

import { beforeAll, afterAll, describe, test } from "vitest";
import { Client } from "../../src/client/client.js";
import { type RunningServer, startServer } from "../../src/server/core/server.js";
import { setupMockFetch, createTempDir, cleanupTempDir, TOKENS, waitFor } from "../helpers.js";
import type { TouchFrame } from "../../src/common/commands.js";
import { timing } from "./timing.js";
import { Mutex } from "../../src/server/utils/mutex.js";
import { Session } from "../../src/server/network/session.js";
import { Stream } from "../../src/common/stream.js";

function installProfiler(): void {
  timing.enable();
  Mutex._profilerStart = () => performance.now();
  Mutex._profilerAcquired = (waitStart) => {
    timing.record("mutex.wait", performance.now() - waitStart);
  };
  Mutex._profilerDone = (execStart) => {
    timing.record("mutex.exec", performance.now() - execStart);
  };
  Session._profilerStart = () => performance.now();
  Session._profilerEnd = (start, label) => {
    timing.record(`cmd.${label}`, performance.now() - start);
  };
  Stream._profilerStart = () => performance.now();
  Stream._profilerWrite = (start) => {
    timing.record("stream.write", performance.now() - start);
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

function printPhase(title: string): void {
  console.log(`\n--- [${title}] ---`);
  console.log(timing.printReport());
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

  test("认证流程耗时", async () => {
    const tempDir = await createTempDir("perf-auth");
    let running: RunningServer | undefined;
    try {
      running = await startServer({ port: 0, config: { monitors: [200], replay_enabled: false, replay_base_dir: tempDir } });
      const port = running.address().port;

      timing.reset();
      const alice = await Client.connect("127.0.0.1", port);
      await alice.authenticate(TOKENS.alice);
      const bob = await Client.connect("127.0.0.1", port);
      await bob.authenticate(TOKENS.bob);

      printPhase("认证流程 (x2)");
      await alice.close();
      await bob.close();
    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
    }
  }, 15000);

  test("房间操作流程耗时", async () => {
    const tempDir = await createTempDir("perf-room");
    let running: RunningServer | undefined;
    try {
      running = await startServer({ port: 0, config: { monitors: [200], replay_enabled: false, replay_base_dir: tempDir } });
      const port = running.address().port;

      const alice = await Client.connect("127.0.0.1", port);
      await alice.authenticate(TOKENS.alice);
      const bob = await Client.connect("127.0.0.1", port);
      await bob.authenticate(TOKENS.bob);

      timing.reset();
      await alice.createRoom("perf-room");
      await bob.joinRoom("perf-room", false);

      printPhase("创建房间 + 加入");

      timing.reset();
      await alice.selectChart(1);
      await alice.requestStart();

      printPhase("选谱 + 请求开始");

      timing.reset();
      await bob.ready();
      await waitFor(() => alice.roomState()?.type === "Playing", 2000);

      printPhase("准备 + 开始游戏");

      // 观战者接收 Touches
      timing.reset();
      await bob.leaveRoom();
      await bob.joinRoom("perf-room", true);
      const frames: TouchFrame[] = [
        { time: 0.1, points: [[0, { x: 0, y: 1 }]] },
        { time: 0.2, points: [[0, { x: 0.1, y: 0.9 }]] }
      ];
      await alice.sendTouches(frames);
      await waitFor(() => bob.livePlayer(100).touch_frames.length >= 2, 1000);

      printPhase("触控转发 (2帧, 有观战者)");

      // 结算
      timing.reset();
      await alice.played(1);
      await waitFor(() => alice.roomState()?.type === "SelectChart", 3000);

      printPhase("结算 (played → SelectChart)");

      await alice.close();
      await bob.close();
    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
    }
  }, 30000);

  test("并发加入房间 (10 客户端)", async () => {
    const tempDir = await createTempDir("perf-concurrent");
    let running: RunningServer | undefined;
    try {
      running = await startServer({ port: 0, config: { monitors: [], replay_enabled: false, replay_base_dir: tempDir } });
      const port = running.address().port;

      const alice = await Client.connect("127.0.0.1", port);
      await alice.authenticate(TOKENS.alice);
      await alice.createRoom("perf-concurrent");

      // 为每个客户端生成唯一 token (通过 mock 映射到不同 ID)
      const tokens = [TOKENS.bob, TOKENS.carol, TOKENS.dave,
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "ffffffffffffffffffffffffffffffff",
        "gggggggggggggggggggggggggggggggg",
        "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh",
        "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
        "jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj",
        "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"
      ];
      // 扩展 mock 支持这些 token
      const idOffsets = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
      const names = ["Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Hank", "Ivy", "Jack", "Kate"];
      const originalFetch2 = globalThis.fetch;
      globalThis.fetch = (async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/me")) {
          const headers = init?.headers as Record<string, string> | undefined;
          const auth = String(headers?.Authorization ?? "");
          const token = auth.replace(/^Bearer\s+/i, "");
          const idx = tokens.indexOf(token);
          if (idx >= 0) {
            return new Response(JSON.stringify({ id: idOffsets[idx], name: names[idx], language: "zh-CN" }), { status: 200 });
          }
        }
        return mockFetch(input as string, init);
      }) as typeof fetch;

      const clients: Client[] = [];
      timing.reset();
      for (let i = 0; i < 10; i++) {
        const c = await Client.connect("127.0.0.1", port);
        await c.authenticate(tokens[i]!);
        clients.push(c);
      }
      printPhase("认证 (10 unique clients)");

      timing.reset();
      const joins = clients.map(c => c.joinRoom("perf-concurrent", false).catch(() => {}));
      await Promise.all(joins);

      printPhase("加入房间 (10 clients 并发)");

      for (const c of clients) await c.close().catch(() => {});
      await alice.close();
      globalThis.fetch = originalFetch2;
    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
    }
  }, 30000);

  test("高频 Touches 命令", async () => {
    const tempDir = await createTempDir("perf-touches");
    let running: RunningServer | undefined;
    try {
      running = await startServer({ port: 0, config: { monitors: [], replay_enabled: false, replay_base_dir: tempDir } });
      const port = running.address().port;

      const alice = await Client.connect("127.0.0.1", port);
      await alice.authenticate(TOKENS.alice);
      await alice.createRoom("perf-touch");
      await alice.selectChart(1);
      await alice.requestStart();
      await waitFor(() => alice.roomState()?.type === "Playing", 2000);

      const COUNT = 100;
      timing.reset();
      for (let i = 0; i < COUNT; i++) {
        const f: TouchFrame = { time: i * 0.1, points: [[0, { x: i * 0.01, y: 1 - i * 0.01 }]] };
        await alice.sendTouches([f]);
      }
      printPhase(`Touches x${COUNT}`);

      await alice.close();
    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
    }
  }, 30000);
});
