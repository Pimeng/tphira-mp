import net from "node:net";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { newUuid } from "../common/uuid.js";
import { decodePacket, encodePacket } from "../common/binary.js";
import { decodeClientCommand, encodeServerCommand } from "../common/commands.js";
import { Stream } from "../common/stream.js";
import type { StreamCodec } from "../common/stream.js";
import type { ClientCommand, ServerCommand } from "../common/commands.js";
import { ServerState } from "./state.js";
import type { ServerConfig } from "./types.js";
import { Session } from "./session.js";
import { Logger, parseLevel } from "./logger.js";
import { getAppPaths } from "./appPaths.js";
import { readAppVersion } from "./version.js";
import { startHttpService, type HttpService } from "./httpService.js";
import { tl } from "./l10n.js";
import { startReplayCleanup } from "./replayCleanup.js";
import { RedisService } from "./redis.js";

export type StartServerOptions = { host?: string; port?: number; config?: Partial<ServerConfig> };

export type RunningServer = {
  server: net.Server;
  http?: HttpService;
  state: ServerState;
  logger: Logger;
  close: () => Promise<void>;
  address: () => net.AddressInfo;
};

function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return undefined;
}

function parsePortEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v <= 0 || v > 65535) return undefined;
  return v;
}

function parseRoomMaxUsersEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1) return undefined;
  return Math.min(v, 64);
}

function parseMonitorsEnv(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const ids = value
    .split(/[,\s;，]+/g)
    .map((it) => Number(it.trim()))
    .filter((it) => Number.isInteger(it));
  if (ids.length === 0) return undefined;
  return ids;
}

function loadEnvConfig(): Partial<ServerConfig> {
  const monitors = parseMonitorsEnv(process.env.MONITORS);
  const server_name = process.env.SERVER_NAME?.trim() || undefined;
  const host = process.env.HOST?.trim() || undefined;
  const port = parsePortEnv(process.env.PORT);
  const http_service = parseBoolEnv(process.env.HTTP_SERVICE);
  const http_port = parsePortEnv(process.env.HTTP_PORT);
  const room_max_users = parseRoomMaxUsersEnv(process.env.ROOM_MAX_USERS);
  const replay_enabled = parseBoolEnv(process.env.REPLAY_ENABLED);
  const admin_token = process.env.ADMIN_TOKEN?.trim() || undefined;
  const admin_data_path = process.env.ADMIN_DATA_PATH?.trim() || undefined;
  const room_list_tip = process.env.ROOM_LIST_TIP?.trim() || undefined;
  const redis_host = process.env.REDIS_HOST?.trim() || undefined;
  const redis_port = process.env.REDIS_PORT !== undefined ? parsePortEnv(process.env.REDIS_PORT) : undefined;
  const redis_db = process.env.REDIS_DB !== undefined ? (Number(process.env.REDIS_DB) | 0) : undefined;
  const redis_password = process.env.REDIS_PASSWORD?.trim() || undefined;
  const server_id = process.env.SERVER_ID?.trim() || undefined;
  const log_level = process.env.LOG_LEVEL?.trim() || undefined;
  const console_log_level = process.env.CONSOLE_LOG_LEVEL?.trim() || undefined;

  const out: Partial<ServerConfig> = {};
  if (monitors) out.monitors = monitors;
  if (server_name) out.server_name = server_name;
  if (host) out.host = host;
  if (port !== undefined) out.port = port;
  if (http_service !== undefined) out.http_service = http_service;
  if (http_port !== undefined) out.http_port = http_port;
  if (room_max_users !== undefined) out.room_max_users = room_max_users;
  if (replay_enabled !== undefined) out.replay_enabled = replay_enabled;
  if (admin_token) out.admin_token = admin_token;
  if (admin_data_path) out.admin_data_path = admin_data_path;
  if (room_list_tip) out.room_list_tip = room_list_tip;
  if (redis_host) out.redis_host = redis_host;
  if (redis_port !== undefined) out.redis_port = redis_port;
  if (redis_db !== undefined) out.redis_db = redis_db;
  if (redis_password !== undefined) out.redis_password = redis_password;
  if (server_id) out.server_id = server_id;
  if (log_level !== undefined) out.log_level = log_level;
  if (console_log_level !== undefined) out.console_log_level = console_log_level;
  return out;
}

function mergeConfig(base: ServerConfig, override: Partial<ServerConfig>): ServerConfig {
  return {
    monitors: override.monitors ?? base.monitors,
    server_name: override.server_name ?? base.server_name,
    host: override.host ?? base.host,
    port: override.port ?? base.port,
    http_service: override.http_service ?? base.http_service,
    http_port: override.http_port ?? base.http_port,
    room_max_users: override.room_max_users ?? base.room_max_users,
    replay_enabled: override.replay_enabled ?? base.replay_enabled,
    admin_token: override.admin_token ?? base.admin_token,
    admin_data_path: override.admin_data_path ?? base.admin_data_path,
    room_list_tip: override.room_list_tip ?? base.room_list_tip,
    redis_host: override.redis_host ?? base.redis_host,
    redis_port: override.redis_port ?? base.redis_port,
    redis_db: override.redis_db ?? base.redis_db,
    redis_password: override.redis_password ?? base.redis_password,
    server_id: override.server_id ?? base.server_id,
    log_level: override.log_level ?? base.log_level,
    console_log_level: override.console_log_level ?? base.console_log_level
  };
}

function loadConfig(): ServerConfig {
  try {
    const { configPath } = getAppPaths();
    const text = readFileSync(configPath, "utf8");
    const raw = (yaml.load(text) ?? {}) as Record<string, unknown>;

    const read = <T>(keys: readonly string[]): T | undefined => {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) return raw[k] as T;
      }
      return undefined;
    };

    const monitorsRaw = read<unknown>(["monitors", "MONITORS"]);
    const monitorsFromArray = Array.isArray(monitorsRaw) ? monitorsRaw.map((it) => Number(it)).filter((it) => Number.isInteger(it)) : null;
    const monitorsFromString = typeof monitorsRaw === "string" ? (parseMonitorsEnv(monitorsRaw) ?? null) : null;
    const monitorsFromNumber = typeof monitorsRaw === "number" && Number.isInteger(monitorsRaw) ? [monitorsRaw] : null;
    const monitors =
      monitorsFromArray && monitorsFromArray.length > 0
        ? monitorsFromArray
        : monitorsFromString && monitorsFromString.length > 0
          ? monitorsFromString
          : monitorsFromNumber && monitorsFromNumber.length > 0
            ? monitorsFromNumber
            : [2];

    const serverNameRaw = read<unknown>(["server_name", "SERVER_NAME"]);
    const server_name = typeof serverNameRaw === "string" && serverNameRaw.trim().length > 0 ? serverNameRaw.trim() : undefined;

    const hostRaw = read<unknown>(["host", "HOST"]);
    const host = typeof hostRaw === "string" && hostRaw.trim().length > 0 ? hostRaw.trim() : undefined;

    const portRaw = read<unknown>(["port", "PORT"]);
    const port = typeof portRaw === "number" ? portRaw : Number(portRaw);
    const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;

    const httpServiceRaw = read<unknown>(["http_service", "HTTP_SERVICE"]);
    const http_service = typeof httpServiceRaw === "boolean" ? httpServiceRaw : undefined;

    const httpPortRaw = read<unknown>(["http_port", "HTTP_PORT"]);
    const http_port = typeof httpPortRaw === "number" ? httpPortRaw : Number(httpPortRaw);
    const safeHttpPort = Number.isInteger(http_port) && http_port > 0 && http_port <= 65535 ? http_port : undefined;

    const roomMaxUsersRaw = read<unknown>(["room_max_users", "ROOM_MAX_USERS"]);
    const roomMaxUsers = typeof roomMaxUsersRaw === "number" ? roomMaxUsersRaw : Number(roomMaxUsersRaw);
    const room_max_users = Number.isInteger(roomMaxUsers) && roomMaxUsers >= 1 ? Math.min(roomMaxUsers, 64) : undefined;

    const replayEnabledRaw = read<unknown>(["replay_enabled", "REPLAY_ENABLED", "replayEnabled"]);
    const replay_enabled = typeof replayEnabledRaw === "boolean" ? replayEnabledRaw : undefined;

    const adminTokenRaw = read<unknown>(["admin_token", "ADMIN_TOKEN", "adminToken"]);
    const admin_token = typeof adminTokenRaw === "string" && adminTokenRaw.trim().length > 0 ? adminTokenRaw.trim() : undefined;

    const adminDataPathRaw = read<unknown>(["admin_data_path", "ADMIN_DATA_PATH", "adminDataPath"]);
    const admin_data_path = typeof adminDataPathRaw === "string" && adminDataPathRaw.trim().length > 0 ? adminDataPathRaw.trim() : undefined;

    const roomListTipRaw = read<unknown>(["room_list_tip", "ROOM_LIST_TIP", "roomListTip"]);
    const room_list_tip = typeof roomListTipRaw === "string" && roomListTipRaw.trim().length > 0 ? roomListTipRaw.trim() : undefined;

    const redisHostRaw = read<unknown>(["redis_host", "REDIS_HOST"]);
    const redis_host = typeof redisHostRaw === "string" && redisHostRaw.trim().length > 0 ? redisHostRaw.trim() : undefined;
    const redisPortRaw = read<unknown>(["redis_port", "REDIS_PORT"]);
    const redis_port = typeof redisPortRaw === "number" ? redisPortRaw : Number(redisPortRaw);
    const safeRedisPort = Number.isInteger(redis_port) && redis_port > 0 && redis_port <= 65535 ? redis_port : undefined;
    const redisDbRaw = read<unknown>(["redis_db", "REDIS_DB"]);
    const redis_db = typeof redisDbRaw === "number" ? redisDbRaw : Number(redisDbRaw);
    const safeRedisDb = Number.isInteger(redis_db) && redis_db >= 0 ? redis_db : undefined;
    const serverIdRaw = read<unknown>(["server_id", "SERVER_ID"]);
    const server_id = typeof serverIdRaw === "string" && serverIdRaw.trim().length > 0 ? serverIdRaw.trim() : undefined;
    const redisPasswordRaw = read<unknown>(["redis_password", "REDIS_PASSWORD"]);
    const redis_password = typeof redisPasswordRaw === "string" && redisPasswordRaw.length > 0 ? redisPasswordRaw : undefined;

    const logLevelRaw = read<unknown>(["log_level", "LOG_LEVEL"]);
    const log_level = typeof logLevelRaw === "string" && logLevelRaw.trim().length > 0 ? logLevelRaw.trim() : undefined;
    const consoleLogLevelRaw = read<unknown>(["console_log_level", "CONSOLE_LOG_LEVEL"]);
    const console_log_level = typeof consoleLogLevelRaw === "string" && consoleLogLevelRaw.trim().length > 0 ? consoleLogLevelRaw.trim() : undefined;

    return {
      monitors,
      server_name,
      host,
      port: safePort,
      http_service,
      http_port: safeHttpPort,
      room_max_users,
      replay_enabled,
      admin_token,
      admin_data_path,
      room_list_tip,
      redis_host,
      redis_port: safeRedisPort,
      redis_db: safeRedisDb,
      redis_password,
      server_id,
      log_level,
      console_log_level
    };
  } catch {
    return { monitors: [2] };
  }
}

const codec: StreamCodec<ServerCommand, ClientCommand> = {
  encodeSend: (payload) => encodePacket(payload, encodeServerCommand),
  decodeRecv: (payload) => decodePacket(payload, decodeClientCommand)
};

function formatListenHostPort(host: string, port: number): string {
  if (host.includes(":")) return `[${host}]:${port}`;
  return `${host}:${port}`;
}

function formatNodeVersion(v: string): string {
  return v.startsWith("v") ? v.slice(1) : v;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const paths = getAppPaths();
  const fileCfg = loadConfig();
  const envCfg = loadEnvConfig();
  const cliCfg: Partial<ServerConfig> = {
    ...(options.config ?? {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {})
  };
  const mergedCfg = mergeConfig(mergeConfig(fileCfg, envCfg), cliCfg);
  const fileLevel = parseLevel(mergedCfg.log_level, "INFO");
  const consoleLevel = parseLevel(mergedCfg.console_log_level, "INFO");
  const onlyFileSet = mergedCfg.log_level !== undefined && mergedCfg.console_log_level === undefined;
  const onlyConsoleSet = mergedCfg.console_log_level !== undefined && mergedCfg.log_level === undefined;
  const logger = new Logger({
    logsDir: paths.logsDir,
    minLevel: onlyConsoleSet ? consoleLevel : fileLevel,
    consoleMinLevel: onlyFileSet ? fileLevel : consoleLevel
  });
  const serverName = mergedCfg.server_name || "Phira MP";
  const adminDataPath = mergedCfg.admin_data_path ?? paths.adminDataPath;

  let redis: RedisService | null = null;
  if (mergedCfg.redis_host && mergedCfg.server_id) {
    redis = new RedisService({
      host: mergedCfg.redis_host,
      port: mergedCfg.redis_port ?? 6379,
      db: mergedCfg.redis_db ?? 0,
      password: mergedCfg.redis_password,
      serverId: mergedCfg.server_id,
      logger
    });
    logger.debug("[Server] Redis 分布式状态层已连接", {
      host: mergedCfg.redis_host,
      port: mergedCfg.redis_port ?? 6379,
      db: mergedCfg.redis_db ?? 0,
      server_id: mergedCfg.server_id,
      auth: mergedCfg.redis_password ? "yes" : "no"
    });
  }
  const state = new ServerState(mergedCfg, logger, serverName, adminDataPath, redis);
  await state.loadAdminData();

  if (redis) {
    await redis.subscribe((payload) => state.handleRedisEvent(payload));
    logger.debug("[Server] 调用 Redis 订阅");
  }
  const replayCleanup = startReplayCleanup({ ttlDays: 4, logger });

  const version = readAppVersion();
  const listenHost = mergedCfg.host ?? "::";
  const listenPort = mergedCfg.port ?? 12346;

  const server = net.createServer(async (socket) => {
    const id = newUuid();
    logger.debug(tl(state.serverLang, "log-new-connection", {
      id,
      remote: `${socket.remoteAddress ?? "unknown"}:${socket.remotePort ?? "unknown"}`
    }));
    const session = new Session({ id, socket, state });

    try {
      const stream = await Stream.create<ServerCommand, ClientCommand>({
        socket,
        expectedVersion: 1,
        codec,
        fastPath: (cmd) => cmd.type === "Ping",
        handler: async (cmd) => {
          await session.onCommand(cmd);
        }
      });

      session.bindStream(stream);
      state.sessions.set(id, session);
      logger.debug(tl(state.serverLang, "log-handshake-ok", { id, version: String(stream.version) }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const reason = (() => {
        const m = /^net-unsupported-protocol-version:(\d+)$/.exec(msg);
        if (m) return tl(state.serverLang, "net-unsupported-protocol-version", { version: m[1]! });
        try {
          return state.serverLang.format(msg);
        } catch {
          return msg;
        }
      })();
      logger.warn(tl(state.serverLang, "log-handshake-failed", { id, reason }));
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: listenPort, host: listenHost }, () => resolve());
  });

  // 互通服（Redis）模式下禁止启用管理员 HTTP 接口
  const httpService =
    mergedCfg.http_service === true && !redis
      ? await startHttpService({ state, host: listenHost, port: mergedCfg.http_port ?? 12347 })
      : null;
  if (redis && mergedCfg.http_service === true) {
    logger.warn("[互通服] 已禁用管理员 HTTP 接口（Redis 分布式模式下不允许使用）");
  }

  const addr = server.address() as net.AddressInfo;
  logger.mark(tl(state.serverLang, "log-server-version", { version }));
  logger.mark(tl(state.serverLang, "log-runtime-env", {
    platform: `${process.platform}_${process.arch}`,
    node: formatNodeVersion(process.version)
  }));
  logger.mark(tl(state.serverLang, "log-server-listen", { addr: formatListenHostPort(addr.address, addr.port) }));
  if (httpService) {
    const httpAddr = httpService.address();
    logger.mark(tl(state.serverLang, "log-http-listen", { addr: formatListenHostPort(httpAddr.address, httpAddr.port) }));
  }
  logger.mark(tl(state.serverLang, "log-server-name", { name: serverName }));

  return {
    server,
    http: httpService ?? undefined,
    state,
    logger,
    address: () => server.address() as net.AddressInfo,
    close: async () => {
      try {
        if (redis) {
          await state.cleanupRedisOnShutdown();
          await redis.close();
        }
        if (httpService) await httpService.close();
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        logger.mark(tl(state.serverLang, "log-server-stopped"));
      } finally {
        replayCleanup.stop();
        logger.close();
      }
    }
  };
}
