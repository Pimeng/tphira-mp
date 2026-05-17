import { Client } from "../src/client/client.js";
import { parseRoomArgs, printRoomHelp } from "./lib/args.js";
import { createMetricsCollector, summarizeMetrics } from "./lib/metrics.js";
import {
  printProgress,
  clearProgress,
  saveReport,
  printBenchHeader,
  printBenchFooter,
} from "./lib/reporter.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const args = parseRoomArgs(process.argv.slice(2));

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printRoomHelp();
    process.exit(0);
  }

  // 根据可用 token 数量调整并发规模（同一 token 不能多 session 同时在线）
  const maxConcurrentUsers = args.tokens.length;
  let effectivePlayersPerRoom = Math.min(args.playersPerRoom, Math.max(1, maxConcurrentUsers));
  let effectiveRooms = Math.min(args.rooms, Math.max(1, Math.floor(maxConcurrentUsers / effectivePlayersPerRoom)));
  if (maxConcurrentUsers === 0) {
    effectiveRooms = 0;
    effectivePlayersPerRoom = 0;
  }

  const totalClients = effectiveRooms * (effectivePlayersPerRoom + args.monitorsPerRoom);

  printBenchHeader("Room Benchmark", {
    host: args.host,
    port: args.port,
    rooms: effectiveRooms,
    playersPerRoom: effectivePlayersPerRoom,
    monitorsPerRoom: args.monitorsPerRoom,
    effectiveRooms,
    effectivePlayersPerRoom,
    totalClients,
    rate: `${args.rate}/s`,
    duration: `${args.duration}s`,
    tokens: args.tokens.length,
  });

  if (args.tokens.length === 0) {
    console.warn("Warning: No auth token provided. Clients will connect but not authenticate.");
  } else if (maxConcurrentUsers < args.rooms * args.playersPerRoom) {
    console.warn(
      `Warning: Only ${maxConcurrentUsers} token(s) available. ` +
      `Adjusted to ${effectiveRooms} room(s) with ${effectivePlayersPerRoom} player(s) each.`
    );
  }

  const metrics = createMetricsCollector(1000);
  metrics.start();

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
        autoReconnect: false,
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
  for (let r = 0; r < effectiveRooms; r++) {
    if (clientIdx >= clients.length) break;
    const host = clients[clientIdx++]!;
    const players: Client[] = [];
    const monitors: Client[] = [];

    for (let p = 1; p < effectivePlayersPerRoom && clientIdx < clients.length; p++) {
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
  for (const room of rooms) {
    if (!room.host.roomId()) continue; // 创建失败的房间跳过

    for (const player of room.players) {
      joinTotal++;
      printProgress("Joining players", joinTotal, roomsCreated * (effectivePlayersPerRoom - 1 + args.monitorsPerRoom));

      const joinStart = Date.now();
      try {
        await player.joinRoom(room.roomId, false);
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
      printProgress("Joining monitors", joinTotal, roomsCreated * (effectivePlayersPerRoom - 1 + args.monitorsPerRoom));

      const joinStart = Date.now();
      try {
        await monitor.joinRoom(room.roomId, true);
        joinRoomLatencies.push(Date.now() - joinStart);
        joinedPlayers++;
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
  const actionTargets = rooms
    .filter((r) => r.host.roomId() !== null)
    .flatMap((r) => [r.host, ...r.players]);

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

  console.log(`Actions done. Ready: ${readySuccess}/${readySuccess + readyFailed}, Chat: ${chatSuccess}/${chatSuccess + chatFailed}. Keeping for ${args.duration}s...`);

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

  console.log("Closing connections...");
  await Promise.all(clients.map((c) => c.close().catch(() => {})));

  const endedAt = Date.now();
  const metricsSamples = metrics.stop();
  const metricsSummary = summarizeMetrics(metricsSamples);

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
    duration: `${args.duration} s`,
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
      duration: args.duration,
    },
    startedAt: new Date(startTime).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    duration: Math.round((endedAt - startTime) / 1000),
    summary,
    errors: [...errorSummary.entries()].map(([message, count]) => ({ message, count })),
    metricsSamples,
    metricsSummary,
  };

  const filepath = saveReport(report);
  console.log(`Report saved to: ${filepath}`);

  printBenchFooter(report, metricsSummary);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
