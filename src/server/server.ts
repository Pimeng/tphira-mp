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
import { Logger } from "./logger.js";
import { getAppPaths } from "./appPaths.js";
import { readAppVersion } from "./version.js";
import { startHttpService, type HttpService } from "./httpService.js";
import { tl } from "./l10n.js";
import { startReplayCleanup } from "./replayCleanup.js";

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
  return out;
}

function mergeConfig(base: ServerConfig, override: Partial<ServerConfig>): ServerConfig {
  return {
    monitors: override.monitors ?? base.monitors,
    test_account_ids: override.test_account_ids ?? base.test_account_ids ?? [1739989],
    server_name: override.server_name ?? base.server_name,
    host: override.host ?? base.host,
    port: override.port ?? base.port,
    http_service: override.http_service ?? base.http_service,
    http_port: override.http_port ?? base.http_port,
    room_max_users: override.room_max_users ?? base.room_max_users,
    replay_enabled: override.replay_enabled ?? base.replay_enabled,
    admin_token: override.admin_token ?? base.admin_token,
    admin_data_path: override.admin_data_path ?? base.admin_data_path,
    room_list_tip: override.room_list_tip ?? base.room_list_tip
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

    const testAccountIdsRaw = read<unknown>(["test_account_ids", "testAccountIds"]);
    const test_account_ids = Array.isArray(testAccountIdsRaw)
      ? testAccountIdsRaw.map((it) => Number(it)).filter((it) => Number.isInteger(it))
      : undefined;

    return { monitors, test_account_ids, server_name, host, port: safePort, http_service, http_port: safeHttpPort, room_max_users, replay_enabled, admin_token, admin_data_path, room_list_tip };
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
  const logger = new Logger({
    logsDir: paths.logsDir,
    testAccountIds: mergedCfg.test_account_ids ?? [1739989],
    enableRateLimiting: true
  });
  const serverName = mergedCfg.server_name || "Phira MP";
  const adminDataPath = mergedCfg.admin_data_path ?? paths.adminDataPath;
  const state = new ServerState(mergedCfg, logger, serverName, adminDataPath);
  await state.loadAdminData();
  const replayCleanup = startReplayCleanup({ ttlDays: 4, logger });

  const version = readAppVersion();
  const listenHost = mergedCfg.host ?? "::";
  const listenPort = mergedCfg.port ?? 12346;

  const server = net.createServer(async (socket) => {
    const id = newUuid();
    const remoteIp = socket.remoteAddress ?? "unknown";
    logger.log("DEBUG", tl(state.serverLang, "log-new-connection", {
      id,
      remote: `${remoteIp}:${socket.remotePort ?? "unknown"}`
    }), undefined, { ip: remoteIp });
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
      logger.log("DEBUG", tl(state.serverLang, "log-handshake-ok", { id, version: String(stream.version) }), undefined, { ip: remoteIp });
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
      logger.log("WARN", tl(state.serverLang, "log-handshake-failed", { id, reason }), undefined, { ip: remoteIp });
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: listenPort, host: listenHost }, () => resolve());
  });

  const httpService = mergedCfg.http_service === true ? await startHttpService({ state, host: listenHost, port: mergedCfg.http_port ?? 12347 }) : null;

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
