/**
 * 大规模压力测试
 *
 * 场景：N 个房间 × M 玩家，测量服务端在高负载下的表现
 * 使用现有 Client 类确保协议正确性。
 *
 * 运行：npx vitest run test/perf/stress.test.ts --no-coverage
 */

import { describe, test, beforeAll, afterAll } from "vitest";
import { Client } from "../../src/client/client.js";
import { startServer, type RunningServer } from "../../src/server/core/server.js";
import { setupMockFetch, createTempDir, cleanupTempDir, sleep } from "../helpers.js";
import { timing } from "./timing.js";
import { Mutex } from "../../src/server/utils/mutex.js";
import { Session } from "../../src/server/network/session.js";
import { Stream } from "../../src/common/stream.js";

const ROOMS = 10;
const PLAYERS_PER_ROOM = 30;
const MONITORS_PER_ROOM = 5;
const TOTAL_PER_ROOM = PLAYERS_PER_ROOM + MONITORS_PER_ROOM;
const TOTAL_CLIENTS = ROOMS * TOTAL_PER_ROOM;
const CONNECT_RATE = 100;

function makeToken(index: number): string {
  const id = String(index).padStart(8, "0");
  // ≤ 32 bytes total for protocol writeVarchar(32)
  return `s${id}${"x".repeat(31 - id.length)}`;
}

function installProfiler(): void {
  timing.enable();
  Mutex._profilerStart = () => performance.now();
  Mutex._profilerAcquired = (waitStart, queueLen) => {
    timing.record("mutex.wait", performance.now() - waitStart);
    if (queueLen > 1) timing.record("mutex.qdepth", queueLen);
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

function makeExtendedMock(original: typeof fetch): typeof fetch {
  return (async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = init?.headers as Record<string, string> | undefined;
    const auth = String(headers?.Authorization ?? "");
    const token = auth.replace(/^Bearer\s+/i, "");

    if (url.endsWith("/me")) {
      const match = /^s(\d+)/.exec(token);
      if (match) {
        const id = parseInt(match[1]!, 10);
        return new Response(JSON.stringify({ id, name: `P${id}`, language: "zh-CN" }), { status: 200 });
      }
    }

    if (/\/chart\/\d+$/.test(url)) {
      const id = Number(url.split("/").at(-1));
      return new Response(JSON.stringify({ id, name: `Chart-${id}` }), { status: 200 });
    }

    if (/\/record\/\d+$/.test(url)) {
      const id = Number(url.split("/").at(-1));
      const match = /^s(\d+)/.exec(token);
      const player = match ? parseInt(match[1]!, 10) : 100;
      return new Response(JSON.stringify({
        id, player, score: 999999, perfect: 1, good: 0, bad: 0, miss: 0,
        max_combo: 1, accuracy: 1.0, full_combo: true, std: 0, std_score: 0
      }), { status: 200 });
    }

    // 回退到原始 mock（处理 hitokoto 等）
    return original(input as string, init);
  }) as typeof fetch;
}

describe("大规模压力测试", () => {
  const { originalFetch, mockFetch } = setupMockFetch();
  const extendedMock = makeExtendedMock(mockFetch);

  beforeAll(() => {
    globalThis.fetch = extendedMock;
    installProfiler();
  });

  afterAll(() => {
    uninstallProfiler();
    globalThis.fetch = originalFetch;
  });

  test("并发连接+认证 (350 clients)", async () => {
    const tempDir = await createTempDir("stress-conn");
    let running: RunningServer | undefined;

    console.log(`\n========================================`);
    console.log(`  并发连接+认证压力测试`);
    console.log(`  总客户端: ${TOTAL_CLIENTS}  |  速率: ${CONNECT_RATE}/s`);
    console.log(`========================================\n`);

    try {
      running = await startServer({
        port: 0,
        config: {
          monitors: Array.from({ length: 1000 }, (_, i) => i + 100),
          replay_enabled: false,
          replay_base_dir: tempDir,
          room_max_users: TOTAL_PER_ROOM + 1,
          hitokoto_api_url: "https://v1.hitokoto.cn/"
        }
      });
      const port = running.address().port;

      timing.reset();
      const clients: Client[] = [];
      let connected = 0, connectFailed = 0;
      let authOk = 0, authFail = 0;
      const t0 = performance.now();
      const intervalMs = 1000 / CONNECT_RATE;

      for (let i = 0; i < TOTAL_CLIENTS; i++) {
        const wait = i * intervalMs - (performance.now() - t0);
        if (wait > 0) await sleep(wait);

        let client: Client | null = null;
        try {
          client = await Client.connect("127.0.0.1", port, { timeoutMs: 5000, autoReconnect: false });
          connected++;
        } catch {
          connectFailed++;
          continue;
        }

        try {
          await client.authenticate(makeToken(i));
          authOk++;
        } catch {
          authFail++;
        }
        clients.push(client);

        if ((i + 1) % 50 === 0 || i === TOTAL_CLIENTS - 1) {
          const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
          process.stdout.write(`\r  ${i + 1}/${TOTAL_CLIENTS}  |  ${elapsed}s  |  OK:${connected} ERR:${connectFailed}  Auth:${authOk}/${authFail}`);
        }
      }

      const totalMs = performance.now() - t0;
      console.log(`\n\n  结果: 连接 ${connected}/${TOTAL_CLIENTS}, 认证 ${authOk}/${authFail}`);
      console.log(`  总耗时: ${(totalMs / 1000).toFixed(1)}s (${(TOTAL_CLIENTS / (totalMs / 1000)).toFixed(0)} conn/s)`);
      console.log(`  峰值 Mutex 队列: ${running.state.mutex.getQueueSize()}\n`);
      console.log(timing.printReport());

      // 清理
      for (const c of clients) {
        c.close().catch(() => {});
      }

    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
    }
  }, 180000);

  test("10房间创建+30玩家加入 (并发)", async () => {
    const tempDir = await createTempDir("stress-room");
    let running: RunningServer | undefined;

    console.log(`\n========================================`);
    console.log(`  房间创建+加入压力测试`);
    console.log(`  房间: ${ROOMS}  |  每房: ${TOTAL_PER_ROOM}人`);
    console.log(`========================================\n`);

    try {
      running = await startServer({
        port: 0,
        config: {
          monitors: Array.from({ length: 1000 }, (_, i) => i + 100),
          replay_enabled: false,
          replay_base_dir: tempDir,
          room_max_users: TOTAL_PER_ROOM + 1,
          hitokoto_api_url: "https://v1.hitokoto.cn/"
        }
      });
      const port = running.address().port;

      // 先连接所有客户端
      console.log("连接客户端...");
      const allClients: Client[] = [];
      for (let i = 0; i < TOTAL_CLIENTS; i++) {
        const c = await Client.connect("127.0.0.1", port, { timeoutMs: 5000, autoReconnect: false });
        await c.authenticate(makeToken(i));
        allClients.push(c);
        if ((i + 1) % 50 === 0) process.stdout.write(`\r  ${i + 1}/${TOTAL_CLIENTS}`);
      }
      console.log(`\r  已连接 ${allClients.length} 客户端`);

      // 分配房间：每 ROOMS 个客户端一组
      const roomGroups: { host: Client; players: Client[]; monitors: Client[] }[] = [];
      let idx = 0;
      for (let r = 0; r < ROOMS; r++) {
        const host = allClients[idx++]!;
        const players: Client[] = [];
        const monitors: Client[] = [];
        for (let p = 0; p < PLAYERS_PER_ROOM - 1; p++) players.push(allClients[idx++]!);
        for (let m = 0; m < MONITORS_PER_ROOM; m++) monitors.push(allClients[idx++]!);
        roomGroups.push({ host, players, monitors });
      }

      // 创建房间 (串行，因为需要不同 roomId)
      timing.reset();
      console.log("\n创建房间...");
      let created = 0, createFailed = 0;
      const createT0 = performance.now();
      for (let r = 0; r < ROOMS; r++) {
        try {
          await roomGroups[r]!.host.createRoom(`room${r}`);
          created++;
        } catch {
          createFailed++;
        }
      }
      const createMs = performance.now() - createT0;
      console.log(`  房间创建: ${created}/${ROOMS}  (${createMs.toFixed(0)}ms)`);
      console.log(timing.printReport());

      // 并发加入房间 (每个房间内部串行，房间间并行)
      timing.reset();
      console.log("\n并发加入房间...");
      let joined = 0, joinFailed = 0;
      const joinT0 = performance.now();

      const joinRoom = async (roomIdx: number) => {
        const group = roomGroups[roomIdx]!;
        const roomId = `room${roomIdx}`;
        // 玩家加入
        for (const p of group.players) {
          try {
            await p.joinRoom(roomId, false);
            joined++;
          } catch { joinFailed++; }
        }
        // 观战者加入
        for (const m of group.monitors) {
          try {
            await m.joinRoom(roomId, true);
            joined++;
          } catch { joinFailed++; }
        }
      };

      // 房间间并行
      await Promise.all(Array.from({ length: ROOMS }, (_, i) => joinRoom(i)));

      const joinMs = performance.now() - joinT0;
      const expected = ROOMS * (PLAYERS_PER_ROOM - 1 + MONITORS_PER_ROOM);
      console.log(`  加入: ${joined}/${expected}  (${joinMs.toFixed(0)}ms, ${(expected / (joinMs / 1000)).toFixed(0)} joins/s)`);
      console.log(timing.printReport());

      // 清理
      for (const c of allClients) {
        c.close().catch(() => {});
      }

    } finally {
      if (running) await running.close();
      await cleanupTempDir(tempDir);
    }
  }, 180000);
});
