/**
 * 进程 CPU / 内存采样器
 *
 * 为服务端 GUI 的统计图表提供数据：
 * - 每个采样周期记录进程 CPU 占用率（基于 process.cpuUsage 增量）与内存占用；
 * - 维护固定长度的历史环形缓冲，GUI 打开时可直接回填整条曲线。
 *
 * CPU 百分比为整机口径：(user + system 增量) / (墙钟时间 × 核心数)。
 */
import os from "node:os";

/** 单个采样点 */
export type StatsSample = {
  /** Unix 毫秒时间戳 */
  timestamp: number;
  /** 进程 CPU 占用率（整机口径，0-100） */
  cpuPercent: number;
  /** 常驻内存（字节） */
  rss: number;
  /** V8 堆已用（字节） */
  heapUsed: number;
  /** V8 堆总量（字节） */
  heapTotal: number;
};

export type ProcessStatsSampler = {
  /** 最新采样点（尚未采样时为 null） */
  current: () => StatsSample | null;
  /** 按时间顺序返回全部历史采样点 */
  history: () => StatsSample[];
  /** 系统总内存（字节） */
  systemTotalMem: () => number;
  /** CPU 核心数 */
  cpuCount: () => number;
  stop: () => void;
};

/** 采样周期（毫秒） */
const SAMPLE_INTERVAL_MS = 2000;
/** 历史采样点数量上限（2s × 300 = 10 分钟） */
const MAX_HISTORY_SAMPLES = 300;

export function startProcessStatsSampler(): ProcessStatsSampler {
  const cpuCount = Math.max(1, os.cpus().length);
  const samples: StatsSample[] = [];

  let lastCpuUsage = process.cpuUsage();
  let lastSampleAt = process.hrtime.bigint();

  const takeSample = (): void => {
    const nowHr = process.hrtime.bigint();
    const elapsedUs = Number(nowHr - lastSampleAt) / 1000;
    const cpu = process.cpuUsage();
    const usedUs = cpu.user - lastCpuUsage.user + (cpu.system - lastCpuUsage.system);
    lastCpuUsage = cpu;
    lastSampleAt = nowHr;

    const cpuPercent = elapsedUs > 0 ? Math.min(100, (usedUs / (elapsedUs * cpuCount)) * 100) : 0;
    const mem = process.memoryUsage();

    samples.push({
      timestamp: Date.now(),
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal
    });
    if (samples.length > MAX_HISTORY_SAMPLES) {
      samples.splice(0, samples.length - MAX_HISTORY_SAMPLES);
    }
  };

  takeSample();
  const timer = setInterval(takeSample, SAMPLE_INTERVAL_MS);
  timer.unref?.();

  return {
    current: () => samples[samples.length - 1] ?? null,
    history: () => [...samples],
    systemTotalMem: () => os.totalmem(),
    cpuCount: () => cpuCount,
    stop: () => clearInterval(timer)
  };
}
