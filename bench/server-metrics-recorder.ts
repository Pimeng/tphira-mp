import fs from "node:fs";
import {
  createServerProcessMetricsCollector,
  summarizeServerProcessMetrics,
} from "./lib/serverProcessMetrics.js";

function parseArgs(argv: string[]) {
  let pid: number | undefined;
  let output = "bench-results/server-process-metrics.json";
  let intervalMs = 1000;
  let stopFile: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--pid":
        pid = Number(argv[++i]);
        break;
      case "--output":
        output = argv[++i] ?? output;
        break;
      case "--interval":
        intervalMs = Number(argv[++i]) || intervalMs;
        break;
      case "--stop-file":
        stopFile = argv[++i];
        break;
    }
  }

  return { pid, output, intervalMs, stopFile };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pid || Number.isNaN(args.pid)) {
    console.error(
      "Usage: tsx bench/server-metrics-recorder.ts --pid <pid> --output <path> [--interval <ms>] [--stop-file <path>]"
    );
    process.exit(1);
  }

  fs.mkdirSync("bench-results", { recursive: true });

  const collector = createServerProcessMetricsCollector(args.pid, {
    intervalMs: args.intervalMs,
  });
  collector.start();

  const startedAt = new Date().toISOString();
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const samples = collector.stop();
    const endedAt = new Date().toISOString();
    const summary = summarizeServerProcessMetrics(samples);

    const report = {
      pid: args.pid,
      startedAt,
      endedAt,
      samples,
      summary,
    };

    fs.writeFileSync(args.output, JSON.stringify(report, null, 2), "utf-8");
    console.log(
      `Server process metrics saved to ${args.output} (${samples.length} samples)`
    );
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  // Fallback: if a stop-file is provided, poll for its existence
  if (args.stopFile) {
    const stopTimer = setInterval(() => {
      if (fs.existsSync(args.stopFile!)) {
        clearInterval(stopTimer);
        shutdown();
      }
    }, 500);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
