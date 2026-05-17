import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { Logger } from "../utils/logger.js";

/** 配置文件监视器 */
export type ConfigWatcher = { close: () => void };

/**
 * 启动配置文件热重载监视器
 *
 * 监视配置文件所在目录的变更，当配置文件发生变化时触发重载。
 * 使用防抖机制（200ms）避免频繁重载。
 *
 * @param opts - 监视器选项
 * @returns ConfigWatcher 实例，失败时返回 null
 */
export function startConfigFileWatcher(opts: {
  configPath: string;
  logger: Logger;
  onReload: () => Promise<void>;
}): ConfigWatcher | null {
  const dir = dirname(opts.configPath);
  const fileName = basename(opts.configPath);
  let watcher: FSWatcher;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let reloading = false;
  let reloadAgain = false;

  const scheduleReload = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runReload();
    }, 200);
    timer.unref?.();
  };

  const runReload = async () => {
    if (closed) return;
    if (reloading) {
      reloadAgain = true;
      return;
    }
    reloading = true;
    try {
      await opts.onReload();
    } catch (e) {
      opts.logger.warn(`Config reload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      reloading = false;
      if (reloadAgain) {
        reloadAgain = false;
        scheduleReload();
      }
    }
  };

  try {
    watcher = watch(dir, (_eventType, filename) => {
      if (closed) return;
      if (filename && String(filename) !== fileName) return;
      scheduleReload();
    });
    watcher.on("error", (e) => {
      if (!closed) opts.logger.warn(`Config watcher error: ${e instanceof Error ? e.message : String(e)}`);
    });
    watcher.unref?.();
  } catch (e) {
    opts.logger.warn(`Failed to watch config file ${opts.configPath}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  opts.logger.debug(`Watching config file: ${opts.configPath}`);
  return {
    close: () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      watcher.close();
    }
  };
}
