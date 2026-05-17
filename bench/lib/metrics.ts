import { monitorEventLoopDelay, type EventLoopDelayMonitor } from "node:perf_hooks";

export type MetricsSample = {
  timestamp: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  eventLoopDelayMean: number;
  eventLoopDelayP50: number;
  eventLoopDelayP95: number;
  eventLoopDelayP99: number;
  eventLoopDelayMax: number;
  uptime: number;
};

export type MetricsCollector = {
  start: () => void;
  stop: () => MetricsSample[];
};

function nsToMs(ns: number): number {
  return ns / 1_000_000;
}

export function createMetricsCollector(intervalMs = 1000): MetricsCollector {
  const samples: MetricsSample[] = [];
  let timer: NodeJS.Timeout | null = null;
  let monitor: EventLoopDelayMonitor | null = null;

  const sample = (): void => {
    const mem = process.memoryUsage();
    const uptime = process.uptime();

    let eventLoopDelayMean = 0;
    let eventLoopDelayP50 = 0;
    let eventLoopDelayP95 = 0;
    let eventLoopDelayP99 = 0;
    let eventLoopDelayMax = 0;

    if (monitor) {
      monitor.disable();
      const mean = monitor.mean;
      eventLoopDelayMean = (mean !== undefined && !Number.isNaN(mean)) ? nsToMs(mean) : 0;
      const p50 = monitor.percentile(50);
      const p95 = monitor.percentile(95);
      const p99 = monitor.percentile(99);
      eventLoopDelayP50 = !Number.isNaN(p50) ? nsToMs(p50) : 0;
      eventLoopDelayP95 = !Number.isNaN(p95) ? nsToMs(p95) : 0;
      eventLoopDelayP99 = !Number.isNaN(p99) ? nsToMs(p99) : 0;
      const max = monitor.max;
      eventLoopDelayMax = (max !== undefined && !Number.isNaN(max)) ? nsToMs(max) : 0;
      monitor.enable();
    }

    samples.push({
      timestamp: Date.now(),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers ?? 0,
      eventLoopDelayMean,
      eventLoopDelayP50,
      eventLoopDelayP95,
      eventLoopDelayP99,
      eventLoopDelayMax,
      uptime,
    });
  };

  return {
    start: () => {
      if (timer) return;
      monitor = monitorEventLoopDelay({ resolution: 10 });
      monitor.enable();
      sample(); // 立即采样一次
      timer = setInterval(sample, intervalMs);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (monitor) {
        monitor.disable();
        monitor = null;
      }
      return samples;
    },
  };
}

export function summarizeMetrics(samples: MetricsSample[]): MetricsSummary {
  if (samples.length === 0) {
    return {
      rssAvg: 0,
      rssPeak: 0,
      heapUsedAvg: 0,
      heapUsedPeak: 0,
      eventLoopDelayMeanAvg: 0,
      eventLoopDelayP95Max: 0,
      eventLoopDelayP99Max: 0,
      eventLoopDelayMaxPeak: 0,
    };
  }

  const rssAvg = samples.reduce((s, v) => s + v.rss, 0) / samples.length;
  const rssPeak = Math.max(...samples.map((v) => v.rss));
  const heapUsedAvg = samples.reduce((s, v) => s + v.heapUsed, 0) / samples.length;
  const heapUsedPeak = Math.max(...samples.map((v) => v.heapUsed));
  const eventLoopDelayMeanAvg = samples.reduce((s, v) => s + v.eventLoopDelayMean, 0) / samples.length;
  const eventLoopDelayP95Max = Math.max(...samples.map((v) => v.eventLoopDelayP95));
  const eventLoopDelayP99Max = Math.max(...samples.map((v) => v.eventLoopDelayP99));
  const eventLoopDelayMaxPeak = Math.max(...samples.map((v) => v.eventLoopDelayMax));

  return {
    rssAvg: Math.round(rssAvg),
    rssPeak,
    heapUsedAvg: Math.round(heapUsedAvg),
    heapUsedPeak,
    eventLoopDelayMeanAvg: Math.round(eventLoopDelayMeanAvg * 100) / 100,
    eventLoopDelayP95Max: Math.round(eventLoopDelayP95Max * 100) / 100,
    eventLoopDelayP99Max: Math.round(eventLoopDelayP99Max * 100) / 100,
    eventLoopDelayMaxPeak: Math.round(eventLoopDelayMaxPeak * 100) / 100,
  };
}

export type MetricsSummary = {
  rssAvg: number;
  rssPeak: number;
  heapUsedAvg: number;
  heapUsedPeak: number;
  eventLoopDelayMeanAvg: number;
  eventLoopDelayP95Max: number;
  eventLoopDelayP99Max: number;
  eventLoopDelayMaxPeak: number;
};
