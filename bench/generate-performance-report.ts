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

type ScenarioData = {
  name: string;
  connect: BenchReport | null;
  room: BenchReport | null;
  gameplay: BenchReport | null;
  serverMetrics: ServerMetricsReport | null;
};

function getScenarioDescription(name: string): string {
  switch (name) {
    case "normal":
      return "无网络限制 / No network restrictions";
    case "weak":
      return "轻微弱网：delay 80ms ±30ms，丢包 0.5% / Weak network: delay 80ms ±30ms, loss 0.5%";
    case "mobile":
      return "移动网络：delay 150ms ±80ms，丢包 1% / Mobile network: delay 150ms ±80ms, loss 1%";
    case "bad":
      return "较差网络：delay 300ms ±150ms，丢包 3% / Poor network: delay 300ms ±150ms, loss 3%";
    default:
      return "";
  }
}

function getScenarioNetemParam(name: string): string {
  switch (name) {
    case "normal":
      return "无限制";
    case "weak":
      return "delay 80ms ±30ms，loss 0.5%";
    case "mobile":
      return "delay 150ms ±80ms，loss 1%";
    case "bad":
      return "delay 300ms ±150ms，loss 3%";
    default:
      return "-";
  }
}

function discoverScenarios(resultsDir: string): ScenarioData[] {
  const scenarios: ScenarioData[] = [];

  // Check root directory for legacy single-scenario mode
  const rootConnect = findLatestReport(resultsDir, "connect-bench-");
  const rootRoom = findLatestReport(resultsDir, "room-bench-");
  const rootGameplay = findLatestReport(resultsDir, "gameplay-bench-");
  const rootServerMetrics = path.join(resultsDir, "server-process-metrics.json");
  const hasRootData = rootConnect || rootRoom || rootGameplay;

  // Scan subdirectories for multi-scenario mode
  let subdirs: string[] = [];
  if (fs.existsSync(resultsDir)) {
    subdirs = fs
      .readdirSync(resultsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  const hasSubdirData = subdirs.some((d) => {
    const dir = path.join(resultsDir, d);
    return (
      findLatestReport(dir, "connect-bench-") ||
      findLatestReport(dir, "room-bench-") ||
      findLatestReport(dir, "gameplay-bench-")
    );
  });

  if (hasSubdirData) {
    for (const name of subdirs.sort()) {
      const dir = path.join(resultsDir, name);
      const connect = findLatestReport(dir, "connect-bench-");
      const room = findLatestReport(dir, "room-bench-");
      const gameplay = findLatestReport(dir, "gameplay-bench-");
      const serverMetrics = path.join(dir, "server-process-metrics.json");

      const hasData = connect || room || gameplay;
      if (!hasData) continue;

      scenarios.push({
        name,
        connect: connect ? readJson<BenchReport>(connect) : null,
        room: room ? readJson<BenchReport>(room) : null,
        gameplay: gameplay ? readJson<BenchReport>(gameplay) : null,
        serverMetrics: fs.existsSync(serverMetrics)
          ? readJson<ServerMetricsReport>(serverMetrics)
          : null,
      });
    }
  } else if (hasRootData) {
    scenarios.push({
      name: "default",
      connect: rootConnect ? readJson<BenchReport>(rootConnect) : null,
      room: rootRoom ? readJson<BenchReport>(rootRoom) : null,
      gameplay: rootGameplay ? readJson<BenchReport>(rootGameplay) : null,
      serverMetrics: fs.existsSync(rootServerMetrics)
        ? readJson<ServerMetricsReport>(rootServerMetrics)
        : null,
    });
  }

  return scenarios;
}

function buildMetricsReferenceLines(): string[] {
  const lines: string[] = [];

  lines.push(`## 指标说明 / Metrics Reference`);
  lines.push(``);

  // Network scenarios
  lines.push(`### 网络场景 / Network Scenarios`);
  lines.push(``);
  lines.push(`| 场景 | 网络参数 | 典型用途 |`);
  lines.push(`|---|---|---|`);
  lines.push(`| normal | 无限制 | 获取基准上限，用于版本间对比 |`);
  lines.push(`| weak | delay 80ms ±30ms，丢包 0.5% | 模拟一般 WiFi 波动或轻度拥塞 |`);
  lines.push(`| mobile | delay 150ms ±80ms，丢包 1% | 模拟 4G/5G 典型移动网络 |`);
  lines.push(`| bad | delay 300ms ±150ms，丢包 3% | 模拟网络拥塞或信号极差环境 |`);
  lines.push(``);

  // Result metrics
  lines.push(`### 结果指标 / Result Metrics`);
  lines.push(``);
  lines.push(`| 指标 | 含义 | 关注要点 |`);
  lines.push(`|---|---|---|`);
  lines.push(`| 成功连接 / 失败 | TCP/WebSocket 握手成功与失败次数 | 失败率应接近 0%；weak 场景若显著上升，需检查握手超时 |`);
  lines.push(`| 平均连接延迟 | 从发起连接到握手完成的平均耗时 | 对 RTT 敏感；mobile 场景通常比 normal 高 1~2 倍 RTT |`);
  lines.push(`| 房间创建 / 失败 | 房间创建成功与失败次数 | 失败通常与连接断开或服务器内部错误有关 |`);
  lines.push(`| 加入成功 / 失败 | 玩家加入房间成功与失败次数 | 高失败率可能意味着房间状态同步异常或超时阈值过短 |`);
  lines.push(`| 消息发送 / 失败 | gameplay 阶段消息发送成功与失败次数 | 大量失败通常由连接断开导致；需区分丢包与断连 |`);
  lines.push(`| 消息每秒 | 服务端实际接收的消息速率 | 受 netem 丢包影响；显著下降时需评估缓冲/重传策略 |`);
  lines.push(``);

  // Process metrics
  lines.push(`### 进程指标 / Process Metrics`);
  lines.push(``);
  lines.push(`| 指标 | 含义 | 关注要点 |`);
  lines.push(`|---|---|---|`);
  lines.push(`| RSS | 进程常驻内存（含 C++ 层、V8 堆外内存、缓冲区） | 峰值反映整体内存占用；multi-scenario 连续运行时注意累积效应 |`);
  lines.push(`| HeapUsed | V8 堆内存使用量 | 若持续增长可能存在内存泄漏；benchmark 结束后应回落至基线 |`);
  lines.push(`| EL 延迟均值 | 事件循环（Event Loop）延迟平均值，反映主线程繁忙程度 | 持续 > 50 ms 表示主线程阻塞风险，可能影响消息及时处理 |`);
  lines.push(`| EL 延迟 P95 最大 | 所有采样中 P95 延迟的最大值 | 突发峰值指标；接近或超过 100 ms 需警惕瞬时拥塞 |`);
  lines.push(`| CPU 平均 / 峰值 | 进程占用的单核 CPU 百分比 | 峰值持续接近 100% 意味着单核计算瓶颈 |`);
  lines.push(`| 内存% | 进程 RSS 占系统总内存的比例 | 超过 80% 可能触发系统 OOM 或交换分区抖动 |`);
  lines.push(``);

  return lines;
}

function buildNotesLines(): string[] {
  const lines: string[] = [];

  lines.push(`## 备注 / Notes`);
  lines.push(``);
  lines.push(`- **客户端进程指标**采集自 benchmark 运行进程本身（内存占用、事件循环延迟等）。`);
  lines.push(`  **Client process metrics** are collected from the benchmark runner process itself.`);
  lines.push(`- **服务端进程指标**通过在 Linux 上读取 /proc/<pid>/stat 与 /proc/<pid>/status 采集。`);
  lines.push(`  **Server process metrics** are collected by reading /proc/<pid>/stat and /proc/<pid>/status on Linux.`);
  lines.push(`- CPU 占用率以单核为基准（100% = 一个完整核心）。`);
  lines.push(`  CPU percentage is relative to a single core (100% = one full core).`);
  lines.push(`- 内存百分比为进程 RSS 占系统总内存的比例。`);
  lines.push(`  Memory percentage is the process RSS as a percentage of total system memory.`);
  lines.push(`- GitHub Actions 运行器性能存在波动，这些数据仅供版本间对比参考。`);
  lines.push(`  GitHub Actions runner performance varies; use these numbers for version-to-version comparison only.`);
  lines.push(`- **弱网场景解读建议 / Interpretation Guide**`);
  lines.push(`  - 若 weak 场景下连接延迟增加超过 2 倍，说明握手阶段对 RTT 敏感，建议评估是否启用 TCP Fast Open 或缩短握手轮次。`);
  lines.push(`  - 若 mobile 场景下房间创建或加入失败率显著上升，需检查超时阈值是否过于激进（如 < 3s）。`);
  lines.push(`  - 若 bad 场景下消息吞吐下降超过 50%，建议评估消息合并（batching）、心跳补偿或前向纠错机制。`);
  lines.push(`  - 事件循环延迟在 weak/mobile 场景下若出现数量级增长，通常意味着丢包触发了大量重传或超时回调堆积。`);
  lines.push(``);

  return lines;
}

function buildSingleScenarioReport(scenario: ScenarioData): string[] {
  const { connect, room, gameplay, serverMetrics } = scenario;
  const lines: string[] = [];

  lines.push(`# 发布基准测试报告 / Release Benchmark Report`);
  lines.push(``);
  lines.push(
    `> 本次基准测试在 GitHub Actions 上运行，仅用于版本间对比，不代表绝对的生产环境容量保证。`
  );
  lines.push(`> This benchmark was run on GitHub Actions and is intended for version-to-version comparison, not as an absolute production capacity guarantee.`);
  lines.push(``);

  // --- Benchmark Parameters ---
  lines.push(`## 基准测试参数 / Benchmark Parameters`);
  lines.push(``);
  lines.push(`| 基准测试 | 参数 |`);
  lines.push(`|---|---|`);
  if (connect) {
    lines.push(
      `| connect-bench | clients=${connect.params.clients}, rate=${connect.params.rate}, duration=${connect.params.duration}s |`
    );
  }
  if (room) {
    lines.push(
      `| room-bench | rooms=${room.params.rooms}, playersPerRoom=${room.params.playersPerRoom}, duration=${room.params.duration}s |`
    );
  }
  if (gameplay) {
    lines.push(
      `| gameplay-bench | rooms=${gameplay.params.rooms}, playersPerRoom=${gameplay.params.playersPerRoom}, hz=${gameplay.params.hz}, duration=${gameplay.params.duration}s |`
    );
  }
  lines.push(``);

  // --- Summary ---
  lines.push(`## 结果摘要 / Results Summary`);
  lines.push(``);
  lines.push(`| 基准测试 | 关键指标 | 数值 |`);
  lines.push(`|---|---|---|`);
  if (connect) {
    const s = connect.summary;
    lines.push(`| connect-bench | 成功连接 / 失败 | ${s.connected} / ${s.connectFailed} |`);
    lines.push(`| connect-bench | 平均连接延迟 | ${s.avgConnectLatency} |`);
  }
  if (room) {
    const s = room.summary;
    lines.push(`| room-bench | 房间创建 / 失败 | ${s.roomsCreated} / ${s.roomCreateFailed} |`);
    lines.push(`| room-bench | 加入成功 / 失败 | ${s.joinedPlayers} / ${s.joinFailed} |`);
  }
  if (gameplay) {
    const s = gameplay.summary;
    lines.push(`| gameplay-bench | 消息发送 / 失败 | ${s.messagesSent} / ${s.messagesFailed} |`);
    lines.push(`| gameplay-bench | 消息每秒 | ${s.messagesPerSecond} |`);
  }
  lines.push(``);

  // --- Client Process Metrics ---
  lines.push(`## 客户端进程指标 / Client Process Metrics`);
  lines.push(``);
  lines.push(`指标来自 **benchmark 客户端进程**（而非被测服务端）。`);
  lines.push(`Metrics from the **benchmark client process** (not the server under test).`);
  lines.push(``);
  lines.push(`| 基准测试 | RSS 平均 | RSS 峰值 | HeapUsed 平均 | HeapUsed 峰值 | EL 延迟均值 | EL 延迟 P95 最大 |`);
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
  lines.push(`## 服务端进程指标 / Server Process Metrics`);
  lines.push(``);
  lines.push(`指标来自 **被测服务端进程**（通过外部读取 /proc 采样）。`);
  lines.push(`Metrics from the **server process under test** (sampled externally via /proc).`);
  lines.push(``);
  if (serverMetrics) {
    const s = serverMetrics.summary;
    lines.push(`| 指标 | 数值 |`);
    lines.push(`|---|---|`);
    lines.push(`| PID | ${serverMetrics.pid} |`);
    lines.push(`| 采样数 | ${s.samples} |`);
    lines.push(`| RSS 平均 | ${formatBytes(s.rssAvgBytes)} |`);
    lines.push(`| RSS 峰值 | ${formatBytes(s.rssMaxBytes)} |`);
    lines.push(`| RSS 最小 | ${formatBytes(s.rssMinBytes)} |`);
    if (s.cpuAvgPercent !== undefined) {
      lines.push(`| CPU 平均 | ${s.cpuAvgPercent}% |`);
    }
    if (s.cpuMaxPercent !== undefined) {
      lines.push(`| CPU 峰值 | ${s.cpuMaxPercent}% |`);
    }
    if (s.memoryPercentAvg !== undefined) {
      lines.push(`| 内存% 平均 | ${s.memoryPercentAvg.toFixed(2)}% |`);
    }
    if (s.memoryPercentPeak !== undefined) {
      lines.push(`| 内存% 峰值 | ${s.memoryPercentPeak.toFixed(2)}% |`);
    }
    lines.push(``);
  } else {
    lines.push(`> 服务端进程指标不可用。`);
    lines.push(`> Server process metrics not available.`);
    lines.push(``);
  }

  lines.push(...buildMetricsReferenceLines());
  lines.push(...buildNotesLines());

  return lines;
}

function buildMultiScenarioReport(scenarios: ScenarioData[]): string[] {
  const lines: string[] = [];

  lines.push(`# 发布基准测试报告 / Release Benchmark Report`);
  lines.push(``);
  lines.push(
    `> 本次基准测试在 GitHub Actions 上运行，仅用于版本间对比，不代表绝对的生产环境容量保证。`
  );
  lines.push(`> This benchmark was run on GitHub Actions and is intended for version-to-version comparison, not as an absolute production capacity guarantee.`);
  lines.push(``);

  // --- Scenarios ---
  lines.push(`## 测试场景 / Scenarios`);
  lines.push(``);
  lines.push(`| 场景 | 网络参数 | 说明 |`);
  lines.push(`|---|---|---|`);
  for (const s of scenarios) {
    lines.push(`| ${s.name} | ${getScenarioNetemParam(s.name)} | ${getScenarioDescription(s.name)} |`);
  }
  lines.push(``);

  // --- Benchmark Parameters ---
  const first = scenarios.find((s) => s.connect || s.room || s.gameplay);
  if (first) {
    lines.push(`## 基准测试参数 / Benchmark Parameters`);
    lines.push(``);
    lines.push(`| 基准测试 | 参数 |`);
    lines.push(`|---|---|`);
    if (first.connect) {
      lines.push(
        `| connect-bench | clients=${first.connect.params.clients}, rate=${first.connect.params.rate}, duration=${first.connect.params.duration}s |`
      );
    }
    if (first.room) {
      lines.push(
        `| room-bench | rooms=${first.room.params.rooms}, playersPerRoom=${first.room.params.playersPerRoom}, duration=${first.room.params.duration}s |`
      );
    }
    if (first.gameplay) {
      lines.push(
        `| gameplay-bench | rooms=${first.gameplay.params.rooms}, playersPerRoom=${first.gameplay.params.playersPerRoom}, hz=${first.gameplay.params.hz}, duration=${first.gameplay.params.duration}s |`
      );
    }
    lines.push(``);
  }

  // --- Summary ---
  lines.push(`## 结果摘要 / Results Summary`);
  lines.push(``);

  // connect-bench
  const hasConnect = scenarios.some((s) => s.connect);
  if (hasConnect) {
    lines.push(`### connect-bench`);
    lines.push(``);
    lines.push(`| 指标 | ${scenarios.map((s) => s.name).join(" | ")} |`);
    lines.push(`|---|${scenarios.map(() => "---").join("|")}|`);

    const connectedRow = ["成功连接 / 失败"];
    const latencyRow = ["平均连接延迟"];
    for (const s of scenarios) {
      if (s.connect) {
        connectedRow.push(`${s.connect.summary.connected} / ${s.connect.summary.connectFailed}`);
        latencyRow.push(`${s.connect.summary.avgConnectLatency}`);
      } else {
        connectedRow.push("-");
        latencyRow.push("-");
      }
    }
    lines.push(`| ${connectedRow.join(" | ")} |`);
    lines.push(`| ${latencyRow.join(" | ")} |`);
    lines.push(``);
  }

  // room-bench
  const hasRoom = scenarios.some((s) => s.room);
  if (hasRoom) {
    lines.push(`### room-bench`);
    lines.push(``);
    lines.push(`| 指标 | ${scenarios.map((s) => s.name).join(" | ")} |`);
    lines.push(`|---|${scenarios.map(() => "---").join("|")}|`);

    const createdRow = ["房间创建 / 失败"];
    const joinedRow = ["加入成功 / 失败"];
    for (const s of scenarios) {
      if (s.room) {
        createdRow.push(`${s.room.summary.roomsCreated} / ${s.room.summary.roomCreateFailed}`);
        joinedRow.push(`${s.room.summary.joinedPlayers} / ${s.room.summary.joinFailed}`);
      } else {
        createdRow.push("-");
        joinedRow.push("-");
      }
    }
    lines.push(`| ${createdRow.join(" | ")} |`);
    lines.push(`| ${joinedRow.join(" | ")} |`);
    lines.push(``);
  }

  // gameplay-bench
  const hasGameplay = scenarios.some((s) => s.gameplay);
  if (hasGameplay) {
    lines.push(`### gameplay-bench`);
    lines.push(``);
    lines.push(`| 指标 | ${scenarios.map((s) => s.name).join(" | ")} |`);
    lines.push(`|---|${scenarios.map(() => "---").join("|")}|`);

    const messagesRow = ["消息发送 / 失败"];
    const mpsRow = ["消息每秒"];
    for (const s of scenarios) {
      if (s.gameplay) {
        messagesRow.push(`${s.gameplay.summary.messagesSent} / ${s.gameplay.summary.messagesFailed}`);
        mpsRow.push(`${s.gameplay.summary.messagesPerSecond}`);
      } else {
        messagesRow.push("-");
        mpsRow.push("-");
      }
    }
    lines.push(`| ${messagesRow.join(" | ")} |`);
    lines.push(`| ${mpsRow.join(" | ")} |`);
    lines.push(``);
  }

  // --- Client Process Metrics ---
  lines.push(`## 客户端进程指标 / Client Process Metrics`);
  lines.push(``);
  lines.push(`指标来自 **benchmark 客户端进程**（而非被测服务端）。`);
  lines.push(`Metrics from the **benchmark client process** (not the server under test).`);
  lines.push(``);
  lines.push(
    `| 基准测试 | 场景 | RSS 平均 | RSS 峰值 | HeapUsed 平均 | HeapUsed 峰值 | EL 延迟均值 | EL 延迟 P95 最大 |`
  );
  lines.push(`|---|---|---|---|---|---|---|---|`);
  for (const s of scenarios) {
    for (const r of [s.connect, s.room, s.gameplay]) {
      if (!r) continue;
      const m = r.metricsSummary;
      lines.push(
        `| ${r.benchType} | ${s.name} | ${formatBytes(m.rssAvg)} | ${formatBytes(m.rssPeak)} | ${formatBytes(m.heapUsedAvg)} | ${formatBytes(m.heapUsedPeak)} | ${m.eventLoopDelayMeanAvg} ms | ${m.eventLoopDelayP95Max} ms |`
      );
    }
  }
  lines.push(``);

  // --- Server Process Metrics ---
  lines.push(`## 服务端进程指标 / Server Process Metrics`);
  lines.push(``);
  lines.push(`指标来自 **被测服务端进程**（通过外部读取 /proc 采样）。`);
  lines.push(`Metrics from the **server process under test** (sampled externally via /proc).`);
  lines.push(``);

  const hasServerMetrics = scenarios.some((s) => s.serverMetrics);
  if (hasServerMetrics) {
    lines.push(`| 场景 | RSS 平均 | RSS 峰值 | CPU 平均 | CPU 峰值 | 内存% 平均 | 内存% 峰值 |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const s of scenarios) {
      if (!s.serverMetrics) {
        lines.push(`| ${s.name} | - | - | - | - | - | - |`);
        continue;
      }
      const sm = s.serverMetrics;
      const sum = sm.summary;
      const cpuAvg = sum.cpuAvgPercent !== undefined ? `${sum.cpuAvgPercent}%` : "-";
      const cpuPeak = sum.cpuMaxPercent !== undefined ? `${sum.cpuMaxPercent}%` : "-";
      const memAvg = sum.memoryPercentAvg !== undefined ? `${sum.memoryPercentAvg.toFixed(2)}%` : "-";
      const memPeak =
        sum.memoryPercentPeak !== undefined ? `${sum.memoryPercentPeak.toFixed(2)}%` : "-";
      lines.push(
        `| ${s.name} | ${formatBytes(sum.rssAvgBytes)} | ${formatBytes(sum.rssMaxBytes)} | ${cpuAvg} | ${cpuPeak} | ${memAvg} | ${memPeak} |`
      );
    }
    lines.push(``);
  } else {
    lines.push(`> 服务端进程指标不可用。`);
    lines.push(`> Server process metrics not available.`);
    lines.push(``);
  }

  lines.push(...buildMetricsReferenceLines());
  lines.push(...buildNotesLines());

  return lines;
}

function main() {
  const resultsDir = "bench-results";
  const scenarios = discoverScenarios(resultsDir);

  if (scenarios.length === 0) {
    console.log("No benchmark results found.");
    return;
  }

  const lines =
    scenarios.length === 1 && scenarios[0]!.name === "default"
      ? buildSingleScenarioReport(scenarios[0]!)
      : buildMultiScenarioReport(scenarios);

  const output = lines.join("\n");
  const outputPath = path.join(resultsDir, "performance-report.md");
  fs.writeFileSync(outputPath, output, "utf-8");
  fs.writeFileSync("performance-report.md", output, "utf-8");
  console.log(`Performance report written to ${outputPath} and performance-report.md`);
}

main();
