import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type AppPaths = {
  rootDir: string;
  configPath: string;
  localesDir: string;
  logsDir: string;
  adminDataPath: string;
  dataDir: string;
  pluginsDir: string;
};

let cached: AppPaths | null = null;

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
      adminDataPath: join(envHome, "admin_data.json"),
      dataDir: join(envHome, "data"),
      pluginsDir: join(envHome, "plugins")
    };
    return cached;
  }

  if (existsSync(join(cwd, "locales"))) {
    cached = {
      rootDir: cwd,
      configPath: join(cwd, "server_config.yml"),
      localesDir: join(cwd, "locales"),
      logsDir: join(cwd, "logs"),
      adminDataPath: join(cwd, "admin_data.json"),
      dataDir: join(cwd, "data"),
      pluginsDir: join(cwd, "plugins")
    };
    return cached;
  }

  const argv1 = process.argv[1] ? resolve(process.argv[1]) : null;
  const entryDir = argv1 ? dirname(argv1) : null;
  if (entryDir) {
    const nearCandidates = [join(entryDir, "..", ".."), join(entryDir, "..", "..", "..")];
    for (const rootDir of nearCandidates) {
      if (!existsSync(join(rootDir, "locales"))) continue;
      cached = {
        rootDir,
        configPath: join(rootDir, "server_config.yml"),
        localesDir: join(rootDir, "locales"),
        logsDir: join(rootDir, "logs"),
        adminDataPath: join(rootDir, "admin_data.json"),
        dataDir: join(rootDir, "data"),
        pluginsDir: join(rootDir, "plugins")
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
    adminDataPath: join(rootDir, "admin_data.json"),
    dataDir: join(rootDir, "data"),
    pluginsDir: join(rootDir, "plugins")
  };

  return cached;
}

