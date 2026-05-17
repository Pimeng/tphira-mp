import { Client } from "../src/client/client.js";
import { parseConnectArgs, printConnectHelp } from "./lib/args.js";
import { createMetricsCollector, summarizeMetrics } from "./lib/metrics.js";
import {
  printProgress,
  clearProgress,
  saveReport,
  printBenchHeader,
  printBenchFooter,
} from "./lib/reporter.js";

type ClientResult = {
  connected: boolean;
  connectLatencyMs: number;
  authenticated: boolean;
  authLatencyMs: number;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const args = parseConnectArgs(process.argv.slice(2));

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printConnectHelp();
    process.exit(0);
  }

  printBenchHeader("Connect Benchmark", {
    host: args.host,
    port: args.port,
    clients: args.clients,
    rate: `${args.rate}/s`,
    duration: `${args.duration}s`,
    token: args.token ? "<provided>" : "<none>",
  });

  const metrics = createMetricsCollector(1000);
  metrics.start();

  const results: ClientResult[] = [];
  const clients: Client[] = [];
  const startTime = Date.now();

  const intervalMs = 1000 / args.rate;

  for (let i = 0; i < args.clients; i++) {
    const expectedDelay = i * intervalMs;
    const elapsed = Date.now() - startTime;
    const wait = expectedDelay - elapsed;
    if (wait > 0) {
      await sleep(wait);
    }

    printProgress("Connecting", i + 1, args.clients);

    const connectStart = Date.now();
    let client: Client | null = null;

    try {
      client = await Client.connect(args.host, args.port, {
        timeoutMs: 7000,
        autoReconnect: false,
      });
      const connectLatency = Date.now() - connectStart;

      let authLatency = 0;
      let authenticated = false;

      if (args.token) {
        const authStart = Date.now();
        try {
          await client.authenticate(args.token);
          authLatency = Date.now() - authStart;
          authenticated = true;
        } catch (e) {
          authLatency = Date.now() - authStart;
          authenticated = false;
        }
      }

      results.push({
        connected: true,
        connectLatencyMs: connectLatency,
        authenticated,
        authLatencyMs: authLatency,
      });
      clients.push(client);
    } catch (e) {
      const connectLatency = Date.now() - connectStart;
      results.push({
        connected: false,
        connectLatencyMs: connectLatency,
        authenticated: false,
        authLatencyMs: 0,
        error: e instanceof Error ? e.message : String(e),
      });
      if (client) {
        await client.close().catch(() => {});
      }
    }
  }

  clearProgress();
  const allConnected = results.filter((r) => r.connected).length;
  console.log(`Launched ${args.clients} connections. Connected: ${allConnected}. Keeping for ${args.duration}s...`);

  // 保持连接，同时打印实时进度
  const remaining = args.duration * 1000 - (Date.now() - startTime);
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

  const connected = results.filter((r) => r.connected).length;
  const connectFailed = results.filter((r) => !r.connected).length;
  const authenticated = results.filter((r) => r.authenticated).length;
  const authFailed = results.filter((r) => r.connected && !r.authenticated && args.token).length;

  const connectLatencies = results.filter((r) => r.connected).map((r) => r.connectLatencyMs);
  const authLatencies = results.filter((r) => r.authenticated).map((r) => r.authLatencyMs);

  const avgConnectLatency = connectLatencies.length > 0
    ? connectLatencies.reduce((a, b) => a + b, 0) / connectLatencies.length
    : 0;
  const avgAuthLatency = authLatencies.length > 0
    ? authLatencies.reduce((a, b) => a + b, 0) / authLatencies.length
    : 0;

  const errors = new Map<string, number>();
  for (const r of results) {
    if (r.error) {
      errors.set(r.error, (errors.get(r.error) ?? 0) + 1);
    }
  }

  const summary = {
    targetClients: args.clients,
    connected,
    connectFailed,
    authenticated,
    authFailed,
    avgConnectLatency: `${avgConnectLatency.toFixed(2)} ms`,
    avgAuthLatency: `${avgAuthLatency.toFixed(2)} ms`,
    duration: `${args.duration} s`,
  };

  const report = {
    benchType: "connect-bench",
    params: {
      host: args.host,
      port: args.port,
      clients: args.clients,
      rate: args.rate,
      duration: args.duration,
    },
    startedAt: new Date(startTime).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    duration: Math.round((endedAt - startTime) / 1000),
    summary,
    errors: [...errors.entries()].map(([message, count]) => ({ message, count })),
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
