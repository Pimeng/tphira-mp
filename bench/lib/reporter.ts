import fs from "node:fs";
import path from "node:path";
import type { MetricsSample, MetricsSummary } from "./metrics.js";

export type BenchReport = {
  benchType: string;
  params: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
  duration: number;
  summary: Record<string, unknown>;
  errors: Array<{ message: string; count: number }>;
  metricsSamples: MetricsSample[];
  metricsSummary: MetricsSummary;
};

export function printProgress(label: string, current: number, total: number, extra?: string): void {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const line = `[${label}] ${current}/${total} (${pct}%)${extra ? " " + extra : ""}`;
  process.stdout.write("\r" + line.padEnd(80, " "));
}

export function clearProgress(): void {
  process.stdout.write("\r" + " ".repeat(80) + "\r");
}

export function saveReport(report: BenchReport): string {
  const dir = "bench-results";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${report.benchType}-${timestamp}.json`;
  const filepath = path.join(dir, filename);

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), "utf-8");
  return filepath;
}

export function printBenchHeader(benchType: string, params: Record<string, unknown>): void {
  console.log(`\n========== ${benchType} ==========`);
  for (const [k, v] of Object.entries(params)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log("");
}

export function printBenchFooter(report: BenchReport, metricsSummary: MetricsSummary): void {
  console.log(`\n========== Results ==========`);
  for (const [k, v] of Object.entries(report.summary)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`\n--- Client Process Metrics ---`);
  console.log(`  RSS avg/peak:        ${formatBytes(metricsSummary.rssAvg)} / ${formatBytes(metricsSummary.rssPeak)}`);
  console.log(`  HeapUsed avg/peak:   ${formatBytes(metricsSummary.heapUsedAvg)} / ${formatBytes(metricsSummary.heapUsedPeak)}`);
  console.log(`  EventLoopDelay mean: ${metricsSummary.eventLoopDelayMeanAvg} ms`);
  console.log(`  EventLoopDelay p95:  ${metricsSummary.eventLoopDelayP95Max} ms (max)`);
  console.log(`  EventLoopDelay p99:  ${metricsSummary.eventLoopDelayP99Max} ms (max)`);
  console.log(`  EventLoopDelay max:  ${metricsSummary.eventLoopDelayMaxPeak} ms (peak)`);
  console.log(`=============================\n`);
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
