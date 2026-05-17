import fs from "node:fs";
import path from "node:path";

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function findLatestReport(dir: string, prefix: string): string | null {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  if (files.length === 0) return null;
  files.sort().reverse();
  return path.join(dir, files[0]!);
}

function readJson<T>(filepath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8")) as T;
  } catch {
    return null;
  }
}

type BenchReport = {
  benchType: string;
  params: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
  duration: number;
  summary: Record<string, unknown>;
  metricsSummary: {
    rssAvg: number;
    rssPeak: number;
    heapUsedAvg: number;
    heapUsedPeak: number;
    eventLoopDelayMeanAvg: number;
    eventLoopDelayP95Max: number;
    eventLoopDelayP99Max: number;
    eventLoopDelayMaxPeak: number;
  };
};

type ServerMetricsReport = {
  pid: number;
  startedAt: string;
  endedAt: string;
  summary: {
    samples: number;
    rssAvgBytes: number;
    rssMaxBytes: number;
    rssMinBytes: number;
    cpuAvgPercent?: number;
    cpuMaxPercent?: number;
    memoryPercentAvg?: number;
    memoryPercentPeak?: number;
  };
};

function main() {
  const resultsDir = "bench-results";

  const connectPath = findLatestReport(resultsDir, "connect-bench-");
  const roomPath = findLatestReport(resultsDir, "room-bench-");
  const gameplayPath = findLatestReport(resultsDir, "gameplay-bench-");
  const serverMetricsPath = path.join(resultsDir, "server-process-metrics.json");

  const connect = connectPath ? readJson<BenchReport>(connectPath) : null;
  const room = roomPath ? readJson<BenchReport>(roomPath) : null;
  const gameplay = gameplayPath ? readJson<BenchReport>(gameplayPath) : null;
  const serverMetrics = fs.existsSync(serverMetricsPath)
    ? readJson<ServerMetricsReport>(serverMetricsPath)
    : null;

  const lines: string[] = [];

  lines.push(`# Release Benchmark Report`);
  lines.push(``);
  lines.push(`> This benchmark was run on GitHub Actions and is intended for version-to-version comparison, not as an absolute production capacity guarantee.`);
  lines.push(``);

  // --- Benchmark Parameters ---
  lines.push(`## Benchmark Parameters`);
  lines.push(``);
  lines.push(`| Benchmark | Parameters |`);
  lines.push(`|---|---|`);
  if (connect) {
    lines.push(`| connect-bench | clients=${connect.params.clients}, rate=${connect.params.rate}, duration=${connect.params.duration}s |`);
  }
  if (room) {
    lines.push(`| room-bench | rooms=${room.params.rooms}, playersPerRoom=${room.params.playersPerRoom}, duration=${room.params.duration}s |`);
  }
  if (gameplay) {
    lines.push(`| gameplay-bench | rooms=${gameplay.params.rooms}, playersPerRoom=${gameplay.params.playersPerRoom}, hz=${gameplay.params.hz}, duration=${gameplay.params.duration}s |`);
  }
  lines.push(``);

  // --- Summary ---
  lines.push(`## Results Summary`);
  lines.push(``);
  lines.push(`| Benchmark | Key Metric | Value |`);
  lines.push(`|---|---|---|`);
  if (connect) {
    const s = connect.summary;
    lines.push(`| connect-bench | Connected / Failed | ${s.connected} / ${s.connectFailed} |`);
    lines.push(`| connect-bench | Avg Connect Latency | ${s.avgConnectLatency} |`);
  }
  if (room) {
    const s = room.summary;
    lines.push(`| room-bench | Rooms Created / Failed | ${s.roomsCreated} / ${s.roomCreateFailed} |`);
    lines.push(`| room-bench | Joined / Join Failed | ${s.joinedPlayers} / ${s.joinFailed} |`);
  }
  if (gameplay) {
    const s = gameplay.summary;
    lines.push(`| gameplay-bench | Messages Sent / Failed | ${s.messagesSent} / ${s.messagesFailed} |`);
    lines.push(`| gameplay-bench | Messages/sec | ${s.messagesPerSecond} |`);
  }
  lines.push(``);

  // --- Client Process Metrics ---
  lines.push(`## Client Process Metrics`);
  lines.push(``);
  lines.push(`Metrics from the **benchmark client process** (not the server under test).`);
  lines.push(``);
  lines.push(`| Benchmark | RSS Avg | RSS Peak | HeapUsed Avg | HeapUsed Peak | EL Delay Mean | EL Delay P95 Max |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of [connect, room, gameplay]) {
    if (!r) continue;
    const m = r.metricsSummary;
    lines.push(
      `| ${r.benchType} | ${formatBytes(m.rssAvg)} | ${formatBytes(m.rssPeak)} | ${formatBytes(m.heapUsedAvg)} | ${formatBytes(m.heapUsedPeak)} | ${m.eventLoopDelayMeanAvg} ms | ${m.eventLoopDelayP95Max} ms |`
    );
  }
  lines.push(``);

  // --- Server Process Metrics ---
  lines.push(`## Server Process Metrics`);
  lines.push(``);
  lines.push(`Metrics from the **server process under test** (sampled externally via /proc).`);
  lines.push(``);
  if (serverMetrics) {
    const s = serverMetrics.summary;
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| PID | ${serverMetrics.pid} |`);
    lines.push(`| Samples | ${s.samples} |`);
    lines.push(`| RSS Avg | ${formatBytes(s.rssAvgBytes)} |`);
    lines.push(`| RSS Peak | ${formatBytes(s.rssMaxBytes)} |`);
    lines.push(`| RSS Min | ${formatBytes(s.rssMinBytes)} |`);
    if (s.cpuAvgPercent !== undefined) {
      lines.push(`| CPU Avg | ${s.cpuAvgPercent}% |`);
    }
    if (s.cpuMaxPercent !== undefined) {
      lines.push(`| CPU Peak | ${s.cpuMaxPercent}% |`);
    }
    if (s.memoryPercentAvg !== undefined) {
      lines.push(`| Memory% Avg | ${s.memoryPercentAvg.toFixed(2)}% |`);
    }
    if (s.memoryPercentPeak !== undefined) {
      lines.push(`| Memory% Peak | ${s.memoryPercentPeak.toFixed(2)}% |`);
    }
    lines.push(``);
  } else {
    lines.push(`> Server process metrics not available.`);
    lines.push(``);
  }

  // --- Notes ---
  lines.push(`## Notes`);
  lines.push(``);
  lines.push(`- **Client process metrics** are collected from the benchmark runner process itself (memory usage, event loop delay, etc.).`);
  lines.push(`- **Server process metrics** are collected by reading /proc/<pid>/stat and /proc/<pid>/status on Linux.`);
  lines.push(`- CPU percentage is relative to a single core (100% = one full core).`);
  lines.push(`- Memory percentage is the process RSS as a percentage of total system memory.`);
  lines.push(`- GitHub Actions runner performance varies; use these numbers for version-to-version comparison only.`);
  lines.push(``);

  const output = lines.join("\n");
  const outputPath = path.join(resultsDir, "performance-report.md");
  fs.writeFileSync(outputPath, output, "utf-8");
  console.log(`Performance report written to ${outputPath}`);
}

main();
