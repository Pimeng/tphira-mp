import { Client } from "../src/client/client.js";
import { parseRoomArgs, printRoomHelp } from "./lib/args.js";
import { createMetricsCollector, summarizeMetrics } from "./lib/metrics.js";
import { createServerProcessMetricsCollector, summarizeServerProcessMetrics } from "./lib/serverProcessMetrics.js";
import { printProgress, clearProgress, saveReport, printBenchHeader, printBenchFooter } from "./lib/reporter.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const args = parseRoomArgs(process.argv.slice(2));

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printRoomHelp();
    process.exit(0);
  }

  const totalClients = args.rooms * (args.playersPerRoom + args.monitorsPerRoom);

  printBenchHeader("Room Benchmark", {
    host: args.host,
    port: args.port,
    rooms: args.rooms,
    playersPerRoom: args.playersPerRoom,
    monitorsPerRoom: args.monitorsPerRoom,
    totalClients,
    rate: `${args.rate}/s`,
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

  // 指标
  let clientsConnected = 0;
  let clientsConnectFailed = 0;
  let roomsCreated = 0;
  let roomCreateFailed = 0;
  let joinedPlayers = 0;
  let joinFailed = 0;
  let readySuccess = 0;
  let readyFailed = 0;
  let chatSuccess = 0;
  let chatFailed = 0;
  const skippedActions: string[] = [];
  const errorSummary = new Map<string, number>();

  const connectLatencies: number[] = [];
  const authLatencies: number[] = [];
  const createRoomLatencies: number[] = [];
  const joinRoomLatencies: number[] = [];

  // 限速创建连接
  const clients: Client[] = [];
  const intervalMs = 1000 / args.rate;

  for (let i = 0; i < totalClients; i++) {
    const expectedDelay = i * intervalMs;
    const elapsed = Date.now() - startTime;
    const wait = expectedDelay - elapsed;
    if (wait > 0) await sleep(wait);

    printProgress("Connecting", i + 1, totalClients);

    const connectStart = Date.now();
    let client: Client | null = null;
    try {
      client = await Client.connect(args.host, args.port, {
        timeoutMs: 7000,
        autoReconnect: false
      });
      connectLatencies.push(Date.now() - connectStart);
      clientsConnected++;

      const token = args.tokens[clients.length % args.tokens.length];
      if (token) {
        const authStart = Date.now();
        try {
          await client.authenticate(token);
          authLatencies.push(Date.now() - authStart);
        } catch (e) {
          authLatencies.push(Date.now() - authStart);
          const msg = e instanceof Error ? e.message : String(e);
          errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
        }
      }
    } catch (e) {
      connectLatencies.push(Date.now() - connectStart);
      clientsConnectFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
      if (client) {
        await client.close().catch(() => {});
      }
      continue;
    }
    clients.push(client);
  }

  clearProgress();
  console.log(`Connected ${clientsConnected}/${totalClients} clients. Creating rooms...`);

  // 分配房间角色
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

    const roomId = `bench${r}_${Date.now().toString(36)}`;
    rooms.push({ host, players, monitors, roomId });
  }

  // 创建房间
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r]!;
    printProgress("Creating rooms", r + 1, rooms.length);

    const createStart = Date.now();
    try {
      await room.host.createRoom(room.roomId);
      createRoomLatencies.push(Date.now() - createStart);
      roomsCreated++;
    } catch (e) {
      createRoomLatencies.push(Date.now() - createStart);
      roomCreateFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
    }
  }

  clearProgress();
  console.log(`Created ${roomsCreated}/${rooms.length} rooms. Joining players...`);

  // 加入房间
  let joinTotal = 0;
  let joinedMonitors = 0;
  const expectedJoins = roomsCreated * (args.playersPerRoom - 1 + args.monitorsPerRoom);
  for (const room of rooms) {
    const actualRoomId = room.host.roomId();
    if (!actualRoomId) continue; // 创建失败的房间跳过

    for (const player of room.players) {
      joinTotal++;
      printProgress("Joining players", joinTotal, expectedJoins);

      const joinStart = Date.now();
      try {
        await player.joinRoom(actualRoomId, false);
        joinRoomLatencies.push(Date.now() - joinStart);
        joinedPlayers++;
      } catch (e) {
        joinRoomLatencies.push(Date.now() - joinStart);
        joinFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
      }
    }

    for (const monitor of room.monitors) {
      joinTotal++;
      printProgress("Joining monitors", joinTotal, expectedJoins);

      const joinStart = Date.now();
      try {
        await monitor.joinRoom(actualRoomId, true);
        joinRoomLatencies.push(Date.now() - joinStart);
        joinedMonitors++;
      } catch (e) {
        joinRoomLatencies.push(Date.now() - joinStart);
        joinFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
      }
    }
  }

  clearProgress();
  console.log(`Joined ${joinedPlayers} players/monitors. Performing room actions...`);

  // 执行可选行为：ready + chat
  const actionTargets = rooms.filter((r) => r.host.roomId() !== null).flatMap((r) => [r.host, ...r.players]);

  for (let i = 0; i < actionTargets.length; i++) {
    const target = actionTargets[i]!;

    // ready
    try {
      await target.ready();
      readySuccess++;
    } catch (e) {
      readyFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
    }

    // chat
    try {
      await target.chat("bench test message");
      chatSuccess++;
    } catch (e) {
      chatFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      errorSummary.set(msg, (errorSummary.get(msg) ?? 0) + 1);
    }
  }

  console.log(
    `Actions done. Ready: ${readySuccess}/${readySuccess + readyFailed}, Chat: ${chatSuccess}/${chatSuccess + chatFailed}. Keeping for ${args.duration}s...`
  );

  // 保持连接
  const elapsedTotal = Date.now() - startTime;
  const remaining = args.duration * 1000 - elapsedTotal;
  if (remaining > 0) {
    const refreshInterval = 1000;
    const endAt = Date.now() + remaining;
    while (Date.now() < endAt) {
      const left = Math.ceil((endAt - Date.now()) / 1000);
      printProgress("Running", args.duration - left, args.duration, `| Active: ${clients.length}`);
      await sleep(Math.min(refreshInterval, endAt - Date.now()));
    }
    clearProgress();
  }

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

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const summary = {
    clientsCreated: totalClients,
    clientsConnected,
    clientsConnectFailed,
    roomsCreated,
    roomCreateFailed,
    joinedPlayers,
    joinFailed,
    readySuccess,
    readyFailed,
    chatSuccess,
    chatFailed,
    skippedActions,
    avgConnectLatency: `${avg(connectLatencies).toFixed(2)} ms`,
    avgAuthLatency: `${avg(authLatencies).toFixed(2)} ms`,
    avgCreateRoomLatency: `${avg(createRoomLatencies).toFixed(2)} ms`,
    avgJoinRoomLatency: `${avg(joinRoomLatencies).toFixed(2)} ms`,
    duration: `${args.duration} s`
  };

  const report = {
    benchType: "room-bench",
    params: {
      host: args.host,
      port: args.port,
      rooms: args.rooms,
      playersPerRoom: args.playersPerRoom,
      monitorsPerRoom: args.monitorsPerRoom,
      rate: args.rate,
      duration: args.duration
    },
    startedAt: new Date(startTime).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    duration: Math.round((endedAt - startTime) / 1000),
    summary,
    errors: [...errorSummary.entries()].map(([message, count]) => ({ message, count })),
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
