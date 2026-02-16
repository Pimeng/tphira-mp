import type { Logger } from "../utils/logger.js";
import { cleanupExpiredReplays, defaultReplayBaseDir } from "../replay/replayStorage.js";

export type ReplayCleanupHandle = {
  stop: () => void;
};

function msUntilNextMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(24, 0, 0, 0);
  const next = d.getTime();
  return Math.max(0, next - nowMs);
}

export function startReplayCleanup(opts: { baseDir?: string; ttlDays: number; logger?: Logger }): ReplayCleanupHandle {
  const baseDir = opts.baseDir ?? defaultReplayBaseDir();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const delay = msUntilNextMidnight(Date.now());
    timer = setTimeout(() => {
      if (stopped) return;
      void (async () => {
        try {
          await cleanupExpiredReplays(baseDir, Date.now(), opts.ttlDays);
        } catch (e) {
          opts.logger?.warn(String(e));
        } finally {
          schedule();
        }
      })();
    }, delay);
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

