import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { formatLocalDateKey, type Logger } from "./logger.js";

export type LogMaintenanceHandle = {
  stop: () => void;
  /** 立即执行一次维护（压缩 + 容量控制）。服务器启动时与单元测试中使用。 */
  runOnce: () => Promise<void>;
};

/** 仅识别 logger 产出的按日切分文件：2026-06-09.log / 2026-06-09.log.gz */
const PLAIN_LOG_RE = /^\d{4}-\d{2}-\d{2}\.log$/;
const ANY_LOG_RE = /^\d{4}-\d{2}-\d{2}\.log(?:\.gz)?$/;

function msUntilNextMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(24, 0, 0, 0);
  return Math.max(0, d.getTime() - nowMs);
}

/** 从文件名解析出当天 0 点的本地毫秒时间戳；无法解析返回 null */
function parseLogDateMs(fileName: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})\.log(?:\.gz)?$/.exec(fileName);
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 启动日志维护任务（每日凌晨执行，复用与回放清理一致的午夜定时模式）。
 *
 * 两条独立策略，均按 getter 读取以支持配置热重载：
 * 1. 压缩：历史日志超过 compressAfterDays 天后 gzip 化（日志重复率高，压缩可大幅降低占用）；
 *    compressAfterDays<=0 表示关闭压缩。最近的日志保持明文，方便服主直接查看。
 * 2. 容量控制：日志目录总占用超过 maxTotalBytes 时，从最旧的日志开始删除直到回落到上限以下；
 *    maxTotalBytes<=0 表示不限制。
 *
 * 当天正在写入的日志（active）永不压缩、永不删除。
 */
export function startLogMaintenance(opts: {
  logsDir: string;
  /** 历史日志超过多少天后压缩；<=0 关闭 */
  getCompressAfterDays: () => number;
  /** 日志目录总占用上限（字节）；<=0 不限制 */
  getMaxTotalBytes: () => number;
  logger?: Logger;
}): LogMaintenanceHandle {
  const { logsDir, getCompressAfterDays, getMaxTotalBytes, logger } = opts;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const compressOldLogs = async (entries: string[], activeName: string, nowMs: number): Promise<void> => {
    const compressAfterDays = Math.floor(getCompressAfterDays());
    if (!(compressAfterDays > 0)) return;
    for (const name of entries) {
      if (name === activeName) continue;
      if (!PLAIN_LOG_RE.test(name)) continue; // 仅压缩尚未压缩的 .log
      const dateMs = parseLogDateMs(name);
      if (dateMs === null) continue;
      const ageDays = (nowMs - dateMs) / 86_400_000;
      if (ageDays < compressAfterDays) continue;
      const src = join(logsDir, name);
      const dst = `${src}.gz`;
      try {
        await pipeline(createReadStream(src), createGzip(), createWriteStream(dst));
        await unlink(src);
        logger?.debug(`Log compressed: ${name} -> ${name}.gz`);
      } catch (e) {
        logger?.warn(`Log compress failed for ${name}: ${e instanceof Error ? e.message : String(e)}`);
        // 清理可能残留的半成品 .gz，避免下次重复
        await unlink(dst).catch(() => {});
      }
    }
  };

  const enforceSizeCap = async (activeName: string): Promise<void> => {
    const maxTotalBytes = Math.floor(getMaxTotalBytes());
    if (!(maxTotalBytes > 0)) return;

    let names: string[];
    try {
      names = await readdir(logsDir);
    } catch {
      return;
    }
    const files: { name: string; size: number; dateMs: number }[] = [];
    for (const name of names) {
      if (!ANY_LOG_RE.test(name)) continue;
      const dateMs = parseLogDateMs(name);
      if (dateMs === null) continue;
      try {
        const st = await stat(join(logsDir, name));
        files.push({ name, size: st.size, dateMs });
      } catch {
        /* 文件刚被移动/删除，跳过 */
      }
    }

    let total = files.reduce((s, f) => s + f.size, 0);
    if (total <= maxTotalBytes) return;

    files.sort((a, b) => a.dateMs - b.dateMs); // 旧 -> 新
    const capMb = (maxTotalBytes / 1_048_576).toFixed(0);
    for (const f of files) {
      if (total <= maxTotalBytes) break;
      if (f.name === activeName) continue; // 绝不删除当前正在写入的日志
      try {
        await unlink(join(logsDir, f.name));
        total -= f.size;
        logger?.mark(`Log removed to enforce ${capMb} MB cap: ${f.name}`);
      } catch (e) {
        logger?.warn(`Log remove failed for ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const runOnce = async (): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(logsDir);
    } catch {
      return; // 目录不存在等，静默
    }
    const activeName = `${formatLocalDateKey(new Date())}.log`;
    await compressOldLogs(entries, activeName, Date.now());
    await enforceSizeCap(activeName);
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      if (stopped) return;
      void runOnce()
        .catch((e) => logger?.warn(String(e)))
        .finally(schedule);
    }, msUntilNextMidnight(Date.now()));
    timer.unref?.();
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    runOnce
  };
}
