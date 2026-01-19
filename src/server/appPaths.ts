import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type AppPaths = {
  rootDir: string;
  configPath: string;
  localesDir: string;
  logsDir: string;
};

let cached: AppPaths | null = null;

export function getAppPaths(): AppPaths {
  if (cached) return cached;

  const envHome = process.env.PHIRA_MP_HOME?.trim();
  const rootDir = envHome && envHome.length > 0 ? envHome : existsSync(join(process.cwd(), "locales")) ? process.cwd() : dirname(process.execPath);

  cached = {
    rootDir,
    configPath: join(rootDir, "server_config.yml"),
    localesDir: join(rootDir, "locales"),
    logsDir: join(rootDir, "logs")
  };

  return cached;
}

