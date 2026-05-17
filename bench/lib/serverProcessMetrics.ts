import fs from "node:fs";
import { execSync } from "node:child_process";

// New sample type (requested API)
export type ServerProcessMetricSample = {
  timestamp: number;
  pid: number;
  rssBytes: number;
  vmSizeBytes?: number;
  cpuPercent?: number;
  memoryPercent?: number;
  uptimeSeconds?: number;
};

// Backward-compatible alias used by existing bench scripts
export type ServerProcessMetricsSample = ServerProcessMetricSample;

export type ServerProcessMetricsCollector = {
  start: () => void;
  stop: () => ServerProcessMetricSample[];
};

export type ServerProcessMetricsCollectorOptions = {
  intervalMs?: number;
};

type ProcState = {
  utime: number;
  stime: number;
  timestamp: number;
};

function parseProcStat(pid: number): { utime: number; stime: number; starttime: number } | null {
  try {
    const data = fs.readFileSync(`/proc/${pid}/stat`, "utf-8").trim();
    // pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime priority nice num_threads itrealvalue starttime ...
    const match = data.match(/^\d+ \((.+)\) \S (.*)$/);
    if (!match) return null;
    const parts = match[2]!.split(" ");
    // 0=ppid,1=pgrp,2=session,3=tty_nr,4=tpgid,5=flags,6=minflt,7=cminflt,8=majflt,9=cmajflt,
    // 10=utime,11=stime,12=cutime,13=cstime,14=priority,15=nice,16=num_threads,17=itrealvalue,18=starttime
    const utime = Number(parts[10]);
    const stime = Number(parts[11]);
    const starttime = Number(parts[18]);
    if (Number.isNaN(utime) || Number.isNaN(stime) || Number.isNaN(starttime)) return null;
    return { utime, stime, starttime };
  } catch {
    return null;
  }
}

function parseProcStatus(pid: number): { vmRssKb: number; vmSizeKb: number } | null {
  try {
    const data = fs.readFileSync(`/proc/${pid}/status`, "utf-8");
    const rssMatch = data.match(/^VmRSS:\s+(\d+)\s+kB/im);
    const sizeMatch = data.match(/^VmSize:\s+(\d+)\s+kB/im);
    if (!rssMatch) return null;
    return {
      vmRssKb: Number(rssMatch[1]),
      vmSizeKb: sizeMatch ? Number(sizeMatch[1]) : 0,
    };
  } catch {
    return null;
  }
}

function parseSystemUptime(): number | null {
  try {
    const data = fs.readFileSync("/proc/uptime", "utf-8").trim();
    const seconds = Number(data.split(/\s+/)[0]);
    if (Number.isNaN(seconds)) return null;
    return seconds;
  } catch {
    return null;
  }
}

function getClkTck(): number {
  try {
    const out = execSync("getconf CLK_TCK", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const n = Number(out);
    if (!Number.isNaN(n) && n > 0) return n;
  } catch {
    // fallthrough
  }
  return 100;
}

function getLinuxMetrics(
  pid: number,
  prev: ProcState | null,
  clkTck: number
): { sample: ServerProcessMetricSample; state: ProcState } | null {
  const stat = parseProcStat(pid);
  const status = parseProcStatus(pid);
  if (!stat || !status) return null;

  const now = Date.now();
  const rssBytes = status.vmRssKb * 1024;
  const vmSizeBytes = status.vmSizeKb > 0 ? status.vmSizeKb * 1024 : undefined;

  let cpuPercent: number | undefined;
  if (prev) {
    const ticksDiff = stat.utime + stat.stime - (prev.utime + prev.stime);
    const wallDiffMs = now - prev.timestamp;
    if (wallDiffMs > 0) {
      const wallDiffSec = wallDiffMs / 1000;
      const raw = (ticksDiff / clkTck) / wallDiffSec * 100;
      cpuPercent = raw < 0 ? 0 : Math.round(raw * 100) / 100;
    }
  }

  let memoryPercent: number | undefined;
  const memInfo = parseMemInfo();
  if (memInfo) {
    memoryPercent = Math.round((status.vmRssKb / memInfo.memTotalKb) * 100 * 100) / 100;
    if (memoryPercent < 0) memoryPercent = 0;
  }

  let uptimeSeconds: number | undefined;
  const systemUptime = parseSystemUptime();
  if (systemUptime !== null) {
    uptimeSeconds = Math.round((systemUptime - stat.starttime / clkTck) * 100) / 100;
    if (uptimeSeconds < 0) uptimeSeconds = 0;
  }

  return {
    sample: {
      timestamp: now,
      pid,
      rssBytes,
      vmSizeBytes,
      cpuPercent,
      memoryPercent,
      uptimeSeconds,
    },
    state: { utime: stat.utime, stime: stat.stime, timestamp: now },
  };
}

export function createServerProcessMetricsCollector(
  pid: number,
  options?: ServerProcessMetricsCollectorOptions | number
): ServerProcessMetricsCollector {
  const opts: ServerProcessMetricsCollectorOptions =
    typeof options === "number" ? { intervalMs: options } : options ?? {};
  const { intervalMs = 1000 } = opts;

  const samples: ServerProcessMetricSample[] = [];
  let timer: NodeJS.Timeout | null = null;
  let prev: ProcState | null = null;

  const isLinux = process.platform === "linux";
  const clkTck = isLinux ? getClkTck() : 0;

  const sample = (): void => {
    if (isLinux) {
      const result = getLinuxMetrics(pid, prev, clkTck);
      if (result) {
        samples.push(result.sample);
        prev = result.state;
      }
      // Silently skip intervals where the process is unreadable.
      return;
    }

    // Non-Linux: graceful degradation — no samples collected.
  };

  return {
    start: () => {
      if (timer) return;
      sample(); // immediate first sample (CPU will be undefined for this sample)
      timer = setInterval(sample, intervalMs);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      return samples;
    },
  };
}

// Summary with both new (requested) and old (backward-compatible) properties
export type ServerProcessMetricsSummary = {
  // New fields (requested API)
  samples: number;
  rssMinBytes: number;
  rssMaxBytes: number;
  rssAvgBytes: number;
  vmSizeMaxBytes?: number;
  cpuAvgPercent?: number;
  cpuMaxPercent?: number;
  memoryPercentAvg?: number;
  memoryPercentPeak?: number;

  // Old fields (backward compatibility for existing bench scripts / reporter)
  rssAvg: number;
  rssPeak: number;
  cpuAvg: number;
  cpuPeak: number;
};

export function summarizeServerProcessMetrics(
  samples: ServerProcessMetricSample[]
): ServerProcessMetricsSummary {
  if (samples.length === 0) {
    return {
      samples: 0,
      rssMinBytes: 0,
      rssMaxBytes: 0,
      rssAvgBytes: 0,
      rssAvg: 0,
      rssPeak: 0,
      cpuAvg: 0,
      cpuPeak: 0,
    };
  }

  const rssValues = samples.map((s) => s.rssBytes);
  const rssSum = rssValues.reduce((a, b) => a + b, 0);
  const rssMin = Math.min(...rssValues);
  const rssMax = Math.max(...rssValues);
  const rssAvg = rssSum / samples.length;

  const vmSizeValues = samples
    .map((s) => s.vmSizeBytes)
    .filter((v): v is number => v !== undefined);
  const vmSizeMax = vmSizeValues.length > 0 ? Math.max(...vmSizeValues) : undefined;

  const cpuValues = samples
    .map((s) => s.cpuPercent)
    .filter((v): v is number => v !== undefined);
  const cpuAvg = cpuValues.length > 0
    ? cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length
    : undefined;
  const cpuMax = cpuValues.length > 0 ? Math.max(...cpuValues) : undefined;

  const memoryValues = samples
    .map((s) => s.memoryPercent)
    .filter((v): v is number => v !== undefined);
  const memoryAvg = memoryValues.length > 0
    ? memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length
    : undefined;
  const memoryPeak = memoryValues.length > 0 ? Math.max(...memoryValues) : undefined;

  const out: ServerProcessMetricsSummary = {
    samples: samples.length,
    rssMinBytes: Math.round(rssMin),
    rssMaxBytes: Math.round(rssMax),
    rssAvgBytes: Math.round(rssAvg),
    rssAvg: Math.round(rssAvg),
    rssPeak: Math.round(rssMax),
    cpuAvg: cpuAvg !== undefined ? Math.round(cpuAvg * 100) / 100 : 0,
    cpuPeak: cpuMax !== undefined ? Math.round(cpuMax * 100) / 100 : 0,
  };

  if (vmSizeMax !== undefined) {
    out.vmSizeMaxBytes = Math.round(vmSizeMax);
  }
  if (cpuAvg !== undefined) {
    out.cpuAvgPercent = Math.round(cpuAvg * 100) / 100;
  }
  if (cpuMax !== undefined) {
    out.cpuMaxPercent = Math.round(cpuMax * 100) / 100;
  }
  if (memoryAvg !== undefined) {
    out.memoryPercentAvg = Math.round(memoryAvg * 100) / 100;
  }
  if (memoryPeak !== undefined) {
    out.memoryPercentPeak = Math.round(memoryPeak * 100) / 100;
  }

  return out;
}
