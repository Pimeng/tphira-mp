import { Client } from "../src/client/client.js";
import { Judgement } from "../src/common/commands.js";
import { parseRoomArgs, printRoomHelp } from "./lib/args.js";
import { createMetricsCollector, summarizeMetrics } from "./lib/metrics.js";
import { createServerProcessMetricsCollector, summarizeServerProcessMetrics } from "./lib/serverProcessMetrics.js";
import { printProgress, clearProgress, saveReport, printBenchHeader, printBenchFooter } from "./lib/reporter.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTouchFrame(time: number) {
  return {
    time,
    points: [[0, { x: Math.random(), y: Math.random() }]] as Array<[number, { x: number; y: number }]>
  };
}

function makeJudgeEvent(time: number) {
  return {
    time,
    line_id: Math.floor(Math.random() * 4),
    note_id: Math.floor(Math.random() * 100),
    judgement: Math.floor(Math.random() * 6) as Judgement
  };
}

async function run(): Promise<void> {
  const args = parseRoomArgs(process.argv.slice(2));

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printRoomHelp();
    process.exit(0);
  }

  const totalClients = args.rooms * (args.playersPerRoom + args.monitorsPerRoom);

  printBenchHeader("Gameplay Benchmark", {
    host: args.host,
    port: args.port,
    rooms: args.rooms,
    playersPerRoom: args.playersPerRoom,
    monitorsPerRoom: args.monitorsPerRoom,
    hz: args.hz ?? 20,
    totalClients,
    duration: `${args.duration}s`,
    tokens: args.tokens.length
  });

  const requiredTokens = totalClients;
  if (args.tokens.length < requiredTokens) {
    const autoCount = requiredTokens - args.tokens.length;
    for (let i = 0; i < autoCount; i++) {
      args.tokens.push(`bench-auto-${i + 1}`);
    }
    console.warn(`Warning: Auto-generated ${autoCount} token(s) to reach ${requiredTokens} required clients.`);
  }

  const metrics = createMetricsCollector(1000);
  metrics.start();

  const serverMetrics = args.serverPid ? createServerProcessMetricsCollector(args.serverPid, 1000) : null;
  serverMetrics?.start();

  const startTime = Date.now();

  // Setup 阶段统计
  let clientsConnected = 0;
  let clientsConnectFailed = 0;
  let authsSucceeded = 0;
  let authsFailed = 0;
  let roomsCreated = 0;
  let roomCreateFailed = 0;
  let joinsSucceeded = 0;
  let joinsFailed = 0;
  let monitorJoinsSucceeded = 0;
  let monitorJoinsFailed = 0;
  let selectChartsSucceeded = 0;
  let selectChartsFailed = 0;
  let requestStartsSucceeded = 0;
  let requestStartsFailed = 0;
  let readiesSucceeded = 0;
  let readiesFailed = 0;
  const setupErrors = new Map<string, number>();

  function recordSetupError(stage: string, msg: string) {
    const key = `${stage}: ${msg}`;
    setupErrors.set(key, (setupErrors.get(key) ?? 0) + 1);
  }

  // 连接与认证
  const clients: Client[] = [];
  const intervalMs = 1000 / args.rate;

  for (let i = 0; i < totalClients; i++) {
    const expectedDelay = i * intervalMs;
    const elapsed = Date.now() - startTime;
    const wait = expectedDelay - elapsed;
    if (wait > 0) await sleep(wait);

    printProgress("Connecting", i + 1, totalClients);

    try {
      const client = await Client.connect(args.host, args.port, {
        timeoutMs: 15000,
        autoReconnect: false
      });
      clientsConnected++;

      const token = args.tokens[clients.length % args.tokens.length];
      if (token) {
        try {
          await client.authenticate(token);
          authsSucceeded++;
        } catch (e) {
          authsFailed++;
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`Auth failed for client ${i + 1}: ${msg}`);
          recordSetupError("auth", msg);
        }
      }
      clients.push(client);
    } catch (e) {
      clientsConnectFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Connect failed for client ${i + 1}: ${msg}`);
      recordSetupError("connect", msg);
    }
  }

  clearProgress();
  console.log(`Connected ${clients.length}/${totalClients} clients (auth OK: ${authsSucceeded}).`);

  if (clients.length === 0) {
    console.error("No clients connected. Aborting.");
    process.exit(1);
  }

  // 分配房间
  type RoomAssignment = {
    host: Client;
    players: Client[];
    monitors: Client[];
    roomId: string;
  };

  const rooms: RoomAssignment[] = [];
  let clientIdx = 0;
  for (let r = 0; r < args.rooms; r++) {
    if (clientIdx >= clients.length) break;
    const host = clients[clientIdx++]!;
    const players: Client[] = [];
    const monitors: Client[] = [];

    for (let p = 1; p < args.playersPerRoom && clientIdx < clients.length; p++) {
      players.push(clients[clientIdx++]!);
    }
    for (let m = 0; m < args.monitorsPerRoom && clientIdx < clients.length; m++) {
      monitors.push(clients[clientIdx++]!);
    }

    const roomId = `benchgp${r}_${Date.now().toString(36)}`;
    rooms.push({ host, players, monitors, roomId });
  }

  // 创建房间
  for (const room of rooms) {
    try {
      await room.host.createRoom(room.roomId);
      roomsCreated++;
    } catch (e) {
      roomCreateFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Create room failed (${room.roomId}): ${msg}`);
      recordSetupError("createRoom", msg);
    }
  }
  console.log(`Created ${roomsCreated}/${rooms.length} rooms.`);

  // 加入房间
  for (const room of rooms) {
    const actualRoomId = room.host.roomId();
    if (!actualRoomId) continue;
    for (const p of room.players) {
      try {
        await p.joinRoom(actualRoomId, false);
        joinsSucceeded++;
      } catch (e) {
        joinsFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Join room failed (${String(actualRoomId)}): ${msg}`);
        recordSetupError("joinRoom", msg);
      }
    }
    for (const m of room.monitors) {
      try {
        await m.joinRoom(actualRoomId, true);
        monitorJoinsSucceeded++;
      } catch (e) {
        monitorJoinsFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Monitor join failed (${String(actualRoomId)}): ${msg}`);
        recordSetupError("monitorJoin", msg);
      }
    }
  }
  console.log(
    `Joined ${joinsSucceeded}/${joinsSucceeded + joinsFailed} players, ${monitorJoinsSucceeded}/${monitorJoinsSucceeded + monitorJoinsFailed} monitors.`
  );

  // 进入 gameplay：选谱 -> requestStart -> ready（并行执行各房间以加速 setup）
  const gameplaySetupPromises = rooms.map(async (room) => {
    if (!room.host.roomId()) return;

    try {
      await room.host.selectChart(1);
      selectChartsSucceeded++;
    } catch (e) {
      selectChartsFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Select chart failed (${room.roomId}): ${msg}`);
      recordSetupError("selectChart", msg);
      return;
    }

    try {
      await room.host.requestStart();
      requestStartsSucceeded++;
    } catch (e) {
      requestStartsFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Request start failed (${room.roomId}): ${msg}`);
      recordSetupError("requestStart", msg);
      return;
    }

    // requestStart 已将 host 标记为 ready，只需对 players 调用 ready
    for (const p of room.players) {
      try {
        await p.ready();
        readiesSucceeded++;
      } catch (e) {
        readiesFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Ready failed (${room.roomId}, player): ${msg}`);
        recordSetupError("ready", msg);
      }
    }
    // 观战者不需要 ready
  });

  await Promise.all(gameplaySetupPromises);
  console.log(
    `Gameplay setup: selectChart=${selectChartsSucceeded}/${selectChartsSucceeded + selectChartsFailed}, requestStart=${requestStartsSucceeded}/${requestStartsSucceeded + requestStartsFailed}, ready=${readiesSucceeded}/${readiesSucceeded + readiesFailed}`
  );

  // 等待一小段时间让状态变为 Playing
  await sleep(500);

  // 高频发送阶段
  const hz = (args as any).hz ?? 20;
  const interval = 1000 / hz;
  const sendLatencies: number[] = [];
  let messagesAttempted = 0;
  let messagesSent = 0;
  let messagesFailed = 0;
  const errorSummary = new Map<string, number>();

  // 发送窗口从「setup 完成后」开始计时，而非整个进程启动时（startTime）。
  // 否则在弱网/丢包场景（netem weak/mobile/bad）下，串行的连接/认证/建房/加入/
  // 选谱/ready 往返被网络延迟与重传放大，setup 耗时可能超过整个 duration，
  // 导致 endTime 在发送阶段开始前就已过期，每个 sender 立即 return → 0 消息发送。
  const sendPhaseStart = Date.now();
  const endTime = sendPhaseStart + args.duration * 1000;
  const senders: NodeJS.Timeout[] = [];

  const allSenders = rooms.filter((r) => r.host.roomId() !== null).flatMap((r) => [r.host, ...r.players]);

  if (allSenders.length === 0) {
    console.error("\n[CRITICAL] No senders available for gameplay load test.");
    console.error("Setup diagnostics:");
    console.error(`  clients connected: ${clientsConnected}/${totalClients} (auth OK: ${authsSucceeded})`);
    console.error(`  rooms created:     ${roomsCreated}/${rooms.length}`);
    console.error(`  joins:             ${joinsSucceeded}/${joinsSucceeded + joinsFailed}`);
    console.error(`  selectCharts:      ${selectChartsSucceeded}/${selectChartsSucceeded + selectChartsFailed}`);
    console.error(`  requestStarts:     ${requestStartsSucceeded}/${requestStartsSucceeded + requestStartsFailed}`);
    console.error(`  readies:           ${readiesSucceeded}/${readiesSucceeded + readiesFailed}`);
    if (setupErrors.size > 0) {
      console.error("  setup errors:");
      for (const [key, count] of setupErrors) {
        console.error(`    ${key}: ${count}`);
      }
    }
  }

  console.log(`Starting gameplay load: ${allSenders.length} clients × ${hz} msg/s for ${args.duration}s`);

  for (const sender of allSenders) {
    const timer = setInterval(async () => {
      if (Date.now() >= endTime) return;

      const t = Date.now() / 1000;
      messagesAttempted += 2; // touches + judges

      const sendStart = Date.now();
      try {
        await sender.sendTouches([makeTouchFrame(t)]);
        messagesSent++;
      } catch (e) {
        messagesFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
      }

      try {
        await sender.sendJudges([makeJudgeEvent(t)]);
        messagesSent++;
      } catch (e) {
        messagesFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
      }

      sendLatencies.push(Date.now() - sendStart);
    }, interval);
    senders.push(timer);
  }

  // 等待 duration
  const remaining = endTime - Date.now();
  if (remaining > 0) {
    const refreshInterval = 1000;
    while (Date.now() < endTime) {
      const left = Math.ceil((endTime - Date.now()) / 1000);
      const elapsed = args.duration - left;
      printProgress("Sending", elapsed, args.duration, `| Attempted: ${messagesAttempted}`);
      await sleep(Math.min(refreshInterval, endTime - Date.now()));
    }
    clearProgress();
  }

  // 清理定时器
  for (const t of senders) clearInterval(t);
  const sendPhaseEnd = Date.now();

  console.log("Leaving rooms and closing connections...");
  await Promise.all(
    clients.map((c) =>
      c
        .leaveRoom()
        .catch(() => {})
        .then(() => c.close().catch(() => {}))
    )
  );

  const endedAt = Date.now();
  const metricsSamples = metrics.stop();
  const metricsSummary = summarizeMetrics(metricsSamples);
  const serverMetricsSamples = serverMetrics?.stop() ?? [];
  const serverMetricsSummary =
    serverMetricsSamples.length > 0 ? summarizeServerProcessMetrics(serverMetricsSamples) : undefined;

  const actualDurationSec = (endedAt - startTime) / 1000;
  // 吞吐基于实际发送窗口（setup 完成后），不被慢速 setup 稀释
  const sendDurationSec = (sendPhaseEnd - sendPhaseStart) / 1000;
  const messagesPerSecond = sendDurationSec > 0 ? messagesSent / sendDurationSec : 0;

  const sortedLatencies = [...sendLatencies].sort((a, b) => a - b);
  const p95Index = Math.floor(sortedLatencies.length * 0.95);
  const p99Index = Math.floor(sortedLatencies.length * 0.99);
  const avgSendLatency =
    sortedLatencies.length > 0 ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length : 0;
  const p95SendLatency = sortedLatencies[p95Index] ?? 0;
  const p99SendLatency = sortedLatencies[p99Index] ?? 0;

  const mode = "real-gameplay"; // 使用真实的 Touches / Judges 命令

  // 合并 setup 错误和发送错误
  const allErrors = new Map<string, number>(setupErrors);
  for (const [msg, count] of errorSummary) {
    allErrors.set(msg, (allErrors.get(msg) ?? 0) + count);
  }

  const summary = {
    mode,
    clients: clients.length,
    clientsConnected,
    clientsConnectFailed,
    authsSucceeded,
    authsFailed,
    roomsCreated,
    roomCreateFailed,
    joinsSucceeded,
    joinsFailed,
    monitorJoinsSucceeded,
    monitorJoinsFailed,
    selectChartsSucceeded,
    selectChartsFailed,
    requestStartsSucceeded,
    requestStartsFailed,
    readiesSucceeded,
    readiesFailed,
    rooms: args.rooms,
    playersPerRoom: args.playersPerRoom,
    messagesAttempted,
    messagesSent,
    messagesFailed,
    messagesPerSecond: messagesPerSecond.toFixed(2),
    avgSendLatency: `${avgSendLatency.toFixed(2)} ms`,
    p95SendLatency: `${p95SendLatency.toFixed(2)} ms`,
    p99SendLatency: `${p99SendLatency.toFixed(2)} ms`,
    duration: `${args.duration} s`
  };

  const report = {
    benchType: "gameplay-bench",
    params: {
      host: args.host,
      port: args.port,
      rooms: args.rooms,
      playersPerRoom: args.playersPerRoom,
      monitorsPerRoom: args.monitorsPerRoom,
      hz,
      duration: args.duration
    },
    startedAt: new Date(startTime).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    duration: Math.round(actualDurationSec),
    summary,
    errors: [...allErrors.entries()].map(([message, count]) => ({ message, count })),
    metricsSamples,
    metricsSummary,
    serverMetricsSamples: serverMetricsSamples.length > 0 ? serverMetricsSamples : undefined,
    serverMetricsSummary
  };

  const filepath = saveReport(report);
  console.log(`Report saved to: ${filepath}`);

  printBenchFooter(report, metricsSummary, serverMetricsSummary);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
