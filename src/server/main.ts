import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import yaml from "js-yaml";
import { startServer } from "./core/server.js";
import {
  buildConfigFromRecord,
  parseBoolValue,
  parseIntegerListValue,
  parsePortValue,
  parseRoomMaxUsersValue
} from "./core/configValues.js";
import { Language, tl } from "./utils/l10n.js";
import { getAppPaths } from "./utils/appPaths.js";

/**
 * 启动期解析语言：用于 CLI 参数校验错误的本地化。
 * 优先级与运行时一致：CLI(--) 暂无 → ENV PHIRA_MP_LANG → ENV LANG → 配置文件 LANG → 空（默认 zh-CN）。
 */
function resolveStartupLang(): Language {
  const envLang = process.env.PHIRA_MP_LANG?.trim() || process.env.LANG?.trim();
  if (envLang) return new Language(envLang);
  try {
    const { configPath } = getAppPaths();
    if (existsSync(configPath)) {
      const cfg = buildConfigFromRecord(yaml.load(readFileSync(configPath, "utf8")));
      if (cfg.lang) return new Language(cfg.lang);
    }
  } catch {
    // 配置文件读取失败时静默回退（main 阶段不应因此中断）
  }
  return new Language("");
}

async function main(): Promise<void> {
  const lang = resolveStartupLang();
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      host: { type: "string" },
      port: { type: "string", short: "p" },
      httpService: { type: "string" },
      httpPort: { type: "string" },
      roomMaxUsers: { type: "string" },
      serverName: { type: "string" },
      monitors: { type: "string" }
    },
    allowPositionals: true
  });

  const requireParse = <T>(raw: string | undefined, parser: (v: unknown) => T | undefined, errorKey: string): T | undefined => {
    if (raw === undefined) return undefined;
    const out = parser(raw);
    if (out === undefined) throw new Error(tl(lang, errorKey));
    return out;
  };

  const host = values.host?.trim() || undefined;
  const port = requireParse(values.port, parsePortValue, "cli-invalid-port");
  const http_service = requireParse(values.httpService, parseBoolValue, "cli-invalid-http-service");
  const http_port = requireParse(values.httpPort, parsePortValue, "cli-invalid-http-port");
  const room_max_users = requireParse(values.roomMaxUsers, parseRoomMaxUsersValue, "cli-invalid-room-max-users");
  const server_name = values.serverName?.trim() || undefined;
  const monitors = requireParse(values.monitors, parseIntegerListValue, "cli-invalid-monitors");

  const running = await startServer({
    host,
    port,
    config: {
      ...(http_service !== undefined ? { http_service } : {}),
      ...(http_port !== undefined ? { http_port } : {}),
      ...(room_max_users !== undefined ? { room_max_users } : {}),
      ...(server_name !== undefined ? { server_name } : {}),
      ...(monitors !== undefined ? { monitors } : {})
    }
  });

  const stop = async () => {
    try {
      await running.close();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
