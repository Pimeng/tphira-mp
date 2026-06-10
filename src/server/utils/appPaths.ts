import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type AppPaths = {
  rootDir: string;
  configPath: string;
  localesDir: string;
  logsDir: string;
  adminDataPath: string;
  dataDir: string;
};

let cached: AppPaths | null = null;

/**
 * 判断某根目录是否带有本地化资源目录，用作识别「源码 / 部署根目录」的哨兵。
 * 命中条件：locales/ 下存在 locales.json（部署的 nodejs bundle / 在线拉取后）
 * 或 en-US.ftl（源码检出 / 服主放置的 ftl 覆盖）。
 */
function hasLocales(rootDir: string): boolean {
  return existsSync(join(rootDir, "locales", "locales.json")) || existsSync(join(rootDir, "locales", "en-US.ftl"));
}

export function getAppPaths(): AppPaths {
  if (cached) return cached;

  const envHome = process.env.PHIRA_MP_HOME?.trim();
  const cwd = process.cwd();

  if (envHome && envHome.length > 0) {
    cached = {
      rootDir: envHome,
      configPath: join(envHome, "server_config.yml"),
      localesDir: join(envHome, "locales"),
      logsDir: join(envHome, "logs"),
      adminDataPath: join(envHome, "data", "admin_data.json"),
      dataDir: join(envHome, "data")
    };
    return cached;
  }

  if (hasLocales(cwd)) {
    cached = {
      rootDir: cwd,
      configPath: join(cwd, "server_config.yml"),
      localesDir: join(cwd, "locales"),
      logsDir: join(cwd, "logs"),
      adminDataPath: join(cwd, "data", "admin_data.json"),
      dataDir: join(cwd, "data")
    };
    return cached;
  }

  const argv1 = process.argv[1] ? resolve(process.argv[1]) : null;
  const entryDir = argv1 ? dirname(argv1) : null;
  if (entryDir) {
    const nearCandidates = [join(entryDir, "..", ".."), join(entryDir, "..", "..", "..")];
    for (const rootDir of nearCandidates) {
      if (!hasLocales(rootDir)) continue;
      cached = {
        rootDir,
        configPath: join(rootDir, "server_config.yml"),
        localesDir: join(rootDir, "locales"),
        logsDir: join(rootDir, "logs"),
        adminDataPath: join(rootDir, "data", "admin_data.json"),
        dataDir: join(rootDir, "data")
      };
      return cached;
    }
  }

  const rootDir = dirname(process.execPath);

  cached = {
    rootDir,
    configPath: join(rootDir, "server_config.yml"),
    localesDir: join(rootDir, "locales"),
    logsDir: join(rootDir, "logs"),
    adminDataPath: join(rootDir, "data", "admin_data.json"),
    dataDir: join(rootDir, "data")
  };

  return cached;
}
