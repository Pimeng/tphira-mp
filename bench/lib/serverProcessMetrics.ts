import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";

export type ServerProcessMetricsSample = {
  timestamp: number;
  rss: number; // bytes
  cpuPercent: number; // percentage relative to a single core (0-100+)
  memoryPercent: number; // 0-100
  eventLoopDelay?: number; // ms, if the server exposes it
};

export type ServerProcessMetricsCollector = {
  start: () => void;
  stop: () => ServerProcessMetricsSample[];
};

type ProcState = {
  utime: number;
  stime: number;
  timestamp: number;
};

function parseProcStat(pid: number): { utime: number; stime: number } | null {
  try {
    const data = fs.readFileSync(`/proc/${pid}/stat`, "utf-8").trim();
    // pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt cmajflt utime stime ...
    const match = data.match(/^\d+ \((.+)\) \S (.*)$/);
    if (!match) return null;
    const parts = match[2]!.split(" ");
    // parts indices after state:
    // 0=ppid,1=pgrp,2=session,3=tty_nr,4=tpgid,5=flags,6=minflt,7=cminflt,8=majflt,9=cmajflt,10=utime,11=stime
    const utime = Number(parts[10]);
    const stime = Number(parts[11]);
    if (Number.isNaN(utime) || Number.isNaN(stime)) return null;
    return { utime, stime };
  } catch {
    return null;
  }
}

function parseProcStatus(pid: number): { vmRssKb: number } | null {
  try {
    const data = fs.readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = data.match(/^VmRSS:\s+(\d+)\s+kB/im);
    if (!match) return null;
    return { vmRssKb: Number(match[1]) };
  } catch {
    return null;
  }
}

function parseMemInfo(): { memTotalKb: number } | null {
  try {
    const data = fs.readFileSync("/proc/meminfo", "utf-8");
    const match = data.match(/^MemTotal:\s+(\d+)\s+kB/im);
    if (!match) return null;
    return { memTotalKb: Number(match[1]) };
  } catch {
    return null;
  }
}

function getClkTck(): number {
  try {
    const out = execSync("getconf CLK_TCK", { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    const n = Number(out);
    if (!Number.isNaN(n) && n > 0) return n;
  } catch {
    // fallthrough
  }
  return 100; // default on virtually all Linux systems
}

function getLinuxMetrics(
  pid: number,
  prev: ProcState | null,
  clkTck: number
): { sample: ServerProcessMetricsSample; state: ProcState } | null {
  const stat = parseProcStat(pid);
  const status = parseProcStatus(pid);
  if (!stat || !status) return null;

  const now = Date.now();
  const rss = status.vmRssKb * 1024;

  let cpuPercent = 0;
  if (prev) {
    const ticksDiff = stat.utime + stat.stime - (prev.utime + prev.stime);
    const wallDiffMs = now - prev.timestamp;
    if (wallDiffMs > 0) {
      const wallDiffSec = wallDiffMs / 1000;
      cpuPercent = (ticksDiff / clkTck) / wallDiffSec * 100;
      if (cpuPercent < 0) cpuPercent = 0;
    }
  }

  const memInfo = parseMemInfo();
  const memoryPercent = memInfo ? (status.vmRssKb / memInfo.memTotalKb) * 100 : 0;

  return {
    sample: {
      timestamp: now,
      rss,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      memoryPercent: Math.round(memoryPercent * 100) / 100,
    },
    state: { utime: stat.utime, stime: stat.stime, timestamp: now },
  };
}

function getWindowsMetrics(
  pid: number,
  prev: ProcState | null
): { sample: ServerProcessMetricsSample; state: ProcState } | null {
  try {
    const psCmd = `powershell -NoProfile -Command "Get-Process -Id ${pid} | Select-Object WorkingSet,TotalProcessorTime | ConvertTo-Json"`;
    const output = execSync(psCmd, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    const info = JSON.parse(output);

    const rss = info.WorkingSet ?? 0;
    const totalProcTimeMs = info.TotalProcessorTime
      ? (info.TotalProcessorTime.TotalMilliseconds ?? 0)
      : 0;

    const now = Date.now();
    let cpuPercent = 0;
    if (prev) {
      const procDiffMs = totalProcTimeMs - prev.utime;
      const wallDiffMs = now - prev.timestamp;
      if (wallDiffMs > 0) {
        cpuPercent = (procDiffMs / wallDiffMs / os.cpus().length) * 100;
        if (cpuPercent < 0) cpuPercent = 0;
      }
    }

    let memoryPercent = 0;
    try {
      const memCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory | ConvertTo-Json"`;
      const memOutput = execSync(memCmd, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
      const memInfo = JSON.parse(memOutput);
      const totalMem = memInfo.TotalPhysicalMemory ?? 0;
      if (totalMem > 0) {
        memoryPercent = (rss / totalMem) * 100;
      }
    } catch {
      // ignore
    }

    return {
      sample: {
        timestamp: now,
        rss,
        cpuPercent: Math.round(cpuPercent * 100) / 100,
        memoryPercent: Math.round(memoryPercent * 100) / 100,
      },
      state: {
        utime: totalProcTimeMs,
        stime: 0,
        timestamp: now,
      },
    };
  } catch {
    return null;
  }
}

export function createServerProcessMetricsCollector(
  pid: number,
  intervalMs = 1000
): ServerProcessMetricsCollector {
  const samples: ServerProcessMetricsSample[] = [];
  let timer: NodeJS.Timeout | null = null;
  let prev: ProcState | null = null;

  const isLinux = process.platform === "linux";
  const clkTck = isLinux ? getClkTck() : 0;

  const sample = (): void => {
    let result: { sample: ServerProcessMetricsSample; state: ProcState } | null = null;

    if (isLinux) {
      result = getLinuxMetrics(pid, prev, clkTck);
    } else if (process.platform === "win32") {
      result = getWindowsMetrics(pid, prev);
    }

    if (result) {
      samples.push(result.sample);
      prev = result.state;
    }
  };

  return {
    start: () => {
      if (timer) return;
      sample(); // immediate first sample (CPU will be 0 for this sample)
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

export function summarizeServerProcessMetrics(
  samples: ServerProcessMetricsSample[]
): ServerProcessMetricsSummary {
  if (samples.length === 0) {
    return {
      rssAvg: 0,
      rssPeak: 0,
      cpuAvg: 0,
      cpuPeak: 0,
      memoryAvg: 0,
      memoryPeak: 0,
    };
  }

  const rssAvg = samples.reduce((s, v) => s + v.rss, 0) / samples.length;
  const rssPeak = Math.max(...samples.map((v) => v.rss));
  const cpuAvg = samples.reduce((s, v) => s + v.cpuPercent, 0) / samples.length;
  const cpuPeak = Math.max(...samples.map((v) => v.cpuPercent));
  const memoryAvg = samples.reduce((s, v) => s + v.memoryPercent, 0) / samples.length;
  const memoryPeak = Math.max(...samples.map((v) => v.memoryPercent));

  return {
    rssAvg: Math.round(rssAvg),
    rssPeak,
    cpuAvg: Math.round(cpuAvg * 100) / 100,
    cpuPeak: Math.round(cpuPeak * 100) / 100,
    memoryAvg: Math.round(memoryAvg * 100) / 100,
    memoryPeak: Math.round(memoryPeak * 100) / 100,
  };
}

export type ServerProcessMetricsSummary = {
  rssAvg: number;
  rssPeak: number;
  cpuAvg: number;
  cpuPeak: number;
  memoryAvg: number;
  memoryPeak: number;
};
