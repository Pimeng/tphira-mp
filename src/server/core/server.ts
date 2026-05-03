import net from "node:net";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import yaml from "js-yaml";
import { newUuid } from "../../common/uuid.js";
import { decodePacket, encodePacket } from "../../common/binary.js";
import { decodeClientCommand, encodeServerCommand } from "../../common/commands.js";
import { Stream } from "../../common/stream.js";
import type { StreamCodec } from "../../common/stream.js";
import type { ClientCommand, ServerCommand } from "../../common/commands.js";
import { ServerState } from "../core/state.js";
import type { ServerConfig } from "../core/types.js";
import { Session } from "../network/session.js";
import { Logger } from "../utils/logger.js";
import { getAppPaths } from "../utils/appPaths.js";
import { readAppVersion } from "../core/version.js";
import { startHttpService, type HttpService } from "../network/httpService.js";
import { tl } from "../utils/l10n.js";
import { startReplayCleanup } from "../replay/replayCleanup.js";
import { parseProxyProtocol } from "../network/proxyProtocol.js";
import { startCli } from "../cli/cli.js";
import { parseRoomId, type RoomId } from "../../common/roomId.js";

export type StartServerOptions = { host?: string; port?: number; config?: Partial<ServerConfig>; configPath?: string; watchConfig?: boolean };

export type RunningServer = {
  server: net.Server;
  http?: HttpService;
  state: ServerState;
  logger: Logger;
  close: () => Promise<void>;
  address: () => net.AddressInfo;
};

function parseBoolValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return undefined;
}

function parseStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseOutboundProxyValue(value: unknown): string | false | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === false) return false;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "false") return false;
  return trimmed;
}

function parsePortValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v <= 0 || v > 65535) return undefined;
  return v;
}

function parseRoomMaxUsersValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1) return undefined;
  return Math.min(v, 64);
}

function parseIntegerListText(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const ids = value
    .split(/[,\s;，]+/g)
    .map((it) => Number(it.trim()))
    .filter((it) => Number.isInteger(it));
  if (ids.length === 0) return undefined;
  return ids;
}

function parseIntegerListValue(value: unknown): number[] | undefined {
  if (Array.isArray(value)) return value.map((it) => Number(it)).filter((it) => Number.isInteger(it));
  if (typeof value === "string") return parseIntegerListText(value);
  if (typeof value === "number" && Number.isInteger(value)) return [value];
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseShareStationValue(value: unknown): ServerConfig["share_station"] {
  if (!isRecord(value)) return undefined;
  const url = parseStringValue(value.URL);
  const token = parseStringValue(value.TOKEN);
  return url && token ? { url, token } : undefined;
}

function loadEnvConfig(): Partial<ServerConfig> {
  const monitors = parseIntegerListText(process.env.MONITORS);
  const test_account_ids = parseIntegerListText(process.env.TEST_ACCOUNT_IDS);
  const server_name = parseStringValue(process.env.SERVER_NAME);
  const host = parseStringValue(process.env.HOST);
  const port = parsePortValue(process.env.PORT);
  const http_service = parseBoolValue(process.env.HTTP_SERVICE);
  const http_port = parsePortValue(process.env.HTTP_PORT);
  const room_max_users = parseRoomMaxUsersValue(process.env.ROOM_MAX_USERS);
  const chat_enabled = parseBoolValue(process.env.CHAT_ENABLED);
  const replay_enabled = parseBoolValue(process.env.REPLAY_ENABLED);
  const replay_base_dir = parseStringValue(process.env.REPLAY_BASE_DIR);
  const admin_token = parseStringValue(process.env.ADMIN_TOKEN);
  const admin_data_path = parseStringValue(process.env.ADMIN_DATA_PATH);
  const room_list_tip = parseStringValue(process.env.ROOM_LIST_TIP);
  const log_level = parseStringValue(process.env.LOG_LEVEL);
  const real_ip_header = parseStringValue(process.env.REAL_IP_HEADER);
  const haproxy_protocol = parseBoolValue(process.env.HAPROXY_PROTOCOL);
  const phira_api_endpoint = parseStringValue(process.env.PHIRA_API_ENDPOINT);
  const outbound_proxy = parseOutboundProxyValue(process.env.OUTBOUND_PROXY);
  const share_station = parseShareStationValue({
    URL: process.env.SHARE_STATION_URL,
    TOKEN: process.env.SHARE_STATION_TOKEN
  });

  const out: Partial<ServerConfig> = {};
  if (monitors) out.monitors = monitors;
  if (test_account_ids) out.test_account_ids = test_account_ids;
  if (server_name) out.server_name = server_name;
  if (host) out.host = host;
  if (port !== undefined) out.port = port;
  if (http_service !== undefined) out.http_service = http_service;
  if (http_port !== undefined) out.http_port = http_port;
  if (room_max_users !== undefined) out.room_max_users = room_max_users;
  if (chat_enabled !== undefined) out.chat_enabled = chat_enabled;
  if (replay_enabled !== undefined) out.replay_enabled = replay_enabled;
  if (replay_base_dir) out.replay_base_dir = replay_base_dir;
  if (admin_token) out.admin_token = admin_token;
  if (admin_data_path) out.admin_data_path = admin_data_path;
  if (room_list_tip) out.room_list_tip = room_list_tip;
  if (log_level) out.log_level = log_level;
  if (real_ip_header) out.real_ip_header = real_ip_header;
  if (haproxy_protocol !== undefined) out.haproxy_protocol = haproxy_protocol;
  if (phira_api_endpoint) out.phira_api_endpoint = phira_api_endpoint;
  if (outbound_proxy !== undefined) out.outbound_proxy = outbound_proxy;
  if (share_station) out.share_station = share_station;
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
    chat_enabled: override.chat_enabled ?? base.chat_enabled,
    replay_enabled: override.replay_enabled ?? base.replay_enabled,
    replay_base_dir: override.replay_base_dir ?? base.replay_base_dir,
    admin_token: override.admin_token ?? base.admin_token,
    admin_data_path: override.admin_data_path ?? base.admin_data_path,
    room_list_tip: override.room_list_tip ?? base.room_list_tip,
    log_level: override.log_level ?? base.log_level,
    real_ip_header: override.real_ip_header ?? base.real_ip_header,
    haproxy_protocol: override.haproxy_protocol ?? base.haproxy_protocol,
    phira_api_endpoint: override.phira_api_endpoint ?? base.phira_api_endpoint,
    outbound_proxy: override.outbound_proxy ?? base.outbound_proxy,
    share_station: override.share_station ?? base.share_station
  };
}

export function parseConfigText(text: string): ServerConfig {
  const loaded = yaml.load(text);
  const raw = isRecord(loaded) ? loaded : {};

  const read = (key: string): unknown => {
    return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
  };

  const parsedMonitors = parseIntegerListValue(read("MONITORS"));
  const monitors = parsedMonitors && parsedMonitors.length > 0 ? parsedMonitors : [2];
  const test_account_ids = parseIntegerListValue(read("TEST_ACCOUNT_IDS"));
  const server_name = parseStringValue(read("SERVER_NAME"));
  const host = parseStringValue(read("HOST"));
  const port = parsePortValue(read("PORT"));
  const http_service = parseBoolValue(read("HTTP_SERVICE"));
  const http_port = parsePortValue(read("HTTP_PORT"));
  const room_max_users = parseRoomMaxUsersValue(read("ROOM_MAX_USERS"));
  const chat_enabled = parseBoolValue(read("CHAT_ENABLED"));
  const replay_enabled = parseBoolValue(read("REPLAY_ENABLED"));
  const replay_base_dir = parseStringValue(read("REPLAY_BASE_DIR"));
  const admin_token = parseStringValue(read("ADMIN_TOKEN"));
  const admin_data_path = parseStringValue(read("ADMIN_DATA_PATH"));
  const room_list_tip = parseStringValue(read("ROOM_LIST_TIP"));
  const log_level = parseStringValue(read("LOG_LEVEL"));
  const real_ip_header = parseStringValue(read("REAL_IP_HEADER"));
  const haproxy_protocol = parseBoolValue(read("HAPROXY_PROTOCOL"));
  const phira_api_endpoint = parseStringValue(read("PHIRA_API_ENDPOINT"));
  const outbound_proxy = parseOutboundProxyValue(read("OUTBOUND_PROXY"));
  const share_station = parseShareStationValue(read("SHARE_STATION"));

  return {
    monitors,
    test_account_ids,
    server_name,
    host,
    port,
    http_service,
    http_port,
    room_max_users,
    chat_enabled,
    replay_enabled,
    replay_base_dir,
    admin_token,
    admin_data_path,
    room_list_tip,
    log_level,
    real_ip_header,
    haproxy_protocol,
    phira_api_endpoint,
    outbound_proxy,
    share_station
  };
}

export function loadConfigFile(configPath: string): ServerConfig {
  const text = readFileSync(configPath, { encoding: "utf8" });
  return parseConfigText(text);
}

function loadConfig(configPath: string): ServerConfig {
  if (!existsSync(configPath)) {
    return { monitors: [2] };
  }
  return loadConfigFile(configPath);
}

const CONFIG_KEYS = [
  ["monitors", "MONITORS"],
  ["test_account_ids", "TEST_ACCOUNT_IDS"],
  ["server_name", "SERVER_NAME"],
  ["host", "HOST"],
  ["port", "PORT"],
  ["http_service", "HTTP_SERVICE"],
  ["http_port", "HTTP_PORT"],
  ["room_max_users", "ROOM_MAX_USERS"],
  ["chat_enabled", "CHAT_ENABLED"],
  ["replay_enabled", "REPLAY_ENABLED"],
  ["replay_base_dir", "REPLAY_BASE_DIR"],
  ["admin_token", "ADMIN_TOKEN"],
  ["admin_data_path", "ADMIN_DATA_PATH"],
  ["room_list_tip", "ROOM_LIST_TIP"],
  ["log_level", "LOG_LEVEL"],
  ["real_ip_header", "REAL_IP_HEADER"],
  ["haproxy_protocol", "HAPROXY_PROTOCOL"],
  ["phira_api_endpoint", "PHIRA_API_ENDPOINT"],
  ["outbound_proxy", "OUTBOUND_PROXY"],
  ["share_station", "SHARE_STATION"]
] as const satisfies ReadonlyArray<readonly [keyof ServerConfig, string]>;

const STARTUP_ONLY_CONFIG_KEYS = [
  ["host", "HOST"],
  ["port", "PORT"],
  ["http_service", "HTTP_SERVICE"],
  ["http_port", "HTTP_PORT"],
  ["admin_data_path", "ADMIN_DATA_PATH"]
] as const satisfies ReadonlyArray<readonly [keyof ServerConfig, string]>;

type ConfigWatcher = { close: () => void };

function sameConfigValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedConfigKeys(prev: ServerConfig, next: ServerConfig): string[] {
  const out: string[] = [];
  for (const [key, name] of CONFIG_KEYS) {
    if (!sameConfigValue(prev[key], next[key])) out.push(name);
  }
  return out;
}

function keepStartupOnlyConfig(prev: ServerConfig, next: ServerConfig): { config: ServerConfig; restartRequiredKeys: string[] } {
  const config: ServerConfig = { ...next };
  const restartRequiredKeys: string[] = [];
  for (const [key, name] of STARTUP_ONLY_CONFIG_KEYS) {
    if (!sameConfigValue(prev[key], next[key])) {
      (config as Record<keyof ServerConfig, ServerConfig[keyof ServerConfig]>)[key] = prev[key];
      restartRequiredKeys.push(name);
    }
  }
  return { config, restartRequiredKeys };
}

function startConfigFileWatcher(opts: { configPath: string; logger: Logger; onReload: () => Promise<void> }): ConfigWatcher | null {
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
  const configPath = options.configPath ?? paths.configPath;
  const cliCfg: Partial<ServerConfig> = {
    ...(options.config ?? {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {})
  };
  const loadMergedConfig = (): ServerConfig => {
    const fileCfg = loadConfig(configPath);
    const envCfg = loadEnvConfig();
    return mergeConfig(mergeConfig(fileCfg, envCfg), cliCfg);
  };
  const mergedCfg = loadMergedConfig();
  let currentConfig = mergedCfg;
  let broadcastRoomLog: ((roomId: RoomId, message: string, timestamp: Date) => void) | null = null;
  const logger = new Logger({
    logsDir: paths.logsDir,
    minLevel: mergedCfg.log_level as any,
    testAccountIds: mergedCfg.test_account_ids ?? [1739989],
    enableRateLimiting: true,
    onLog: (level, message, timestamp, context) => {
      if (level === "DEBUG") return;
      if (!context?.roomId) return;
      let roomId: RoomId;
      try {
        roomId = parseRoomId(context.roomId);
      } catch {
        return;
      }
      broadcastRoomLog?.(roomId, message, timestamp);
    }
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
    let remoteIp = socket.remoteAddress ?? "unknown";
    let remotePort = socket.remotePort ?? 0;

    // 如果启用了 HAProxy PROXY Protocol，尝试解析
    if (state.config.haproxy_protocol) {
      try {
        const proxyInfo = await parseProxyProtocol(socket, 5000);
        if (proxyInfo) {
          remoteIp = proxyInfo.sourceAddress;
          remotePort = proxyInfo.sourcePort;
          logger.log("DEBUG", `[${id}] HAProxy PROXY Protocol 解析成功: ${remoteIp}:${remotePort}`);
        }
      } catch (e) {
        logger.log("WARN", `[${id}] HAProxy PROXY Protocol 解析失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    logger.log("DEBUG", tl(state.serverLang, "log-new-connection", {
      id,
      remote: `${remoteIp}:${remotePort}`
    }), undefined, { ip: remoteIp, isConnectionLog: true });
    const session = new Session({ id, socket, state, remoteIp });

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
      logger.log("DEBUG", tl(state.serverLang, "log-handshake-ok", { id, version: String(stream.version) }), undefined, { ip: remoteIp, isConnectionLog: true });
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
      logger.log("WARN", tl(state.serverLang, "log-handshake-failed", { id, reason }), undefined, { ip: remoteIp, isConnectionLog: true });
      socket.destroy();
    }
  });

  let httpService: HttpService | null = null;
  let configWatcher: ConfigWatcher | null = null;
  const reloadRuntimeConfig = async (): Promise<void> => {
    let nextConfig: ServerConfig;
    try {
      nextConfig = loadMergedConfig();
    } catch (e) {
      logger.warn(`Config reload skipped: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const { config: effectiveConfig, restartRequiredKeys } = keepStartupOnlyConfig(currentConfig, nextConfig);
    const changedKeys = changedConfigKeys(currentConfig, effectiveConfig);
    if (changedKeys.length === 0 && restartRequiredKeys.length === 0) return;

    state.applyConfig(effectiveConfig);
    logger.updateOptions({
      minLevel: effectiveConfig.log_level as any,
      testAccountIds: effectiveConfig.test_account_ids ?? [1739989]
    });
    currentConfig = effectiveConfig;

    if (changedKeys.length > 0) {
      logger.mark(`Config reloaded: ${changedKeys.join(", ")}`);
    }
    if (restartRequiredKeys.length > 0) {
      logger.warn(`Config changes require restart to take effect: ${restartRequiredKeys.join(", ")}`);
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ port: listenPort, host: listenHost });
    });

    httpService = mergedCfg.http_service === true ? await startHttpService({ state, host: listenHost, port: mergedCfg.http_port ?? 12347 }) : null;

    // 设置 WebSocket 服务引用
    if (httpService) {
      state.wsService = httpService.ws;
      state.autoUploadCallback = httpService.handleGameEndAutoUpload;
      broadcastRoomLog = (roomId, message, timestamp) => {
        void httpService?.ws.broadcastRoomLog(roomId, message, timestamp).catch(() => {});
      };
    }
    if (options.watchConfig !== false) {
      configWatcher = startConfigFileWatcher({ configPath, logger, onReload: reloadRuntimeConfig });
    }
  } catch (e) {
    configWatcher?.close();
    replayCleanup.stop();
    if (httpService) await httpService.close().catch(() => {});
    if (server.listening) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    logger.close();
    throw e;
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

  // Helper functions for CLI
  const broadcastRoomAll = async (roomId: RoomId, cmd: ServerCommand): Promise<void> => {
    const room = state.rooms.get(roomId);
    if (!room) return;
    const ids = [...room.userIds(), ...room.monitorIds()];
    const tasks: Promise<void>[] = [];
    for (const id of ids) {
      const u = state.users.get(id);
      if (u) tasks.push(u.trySend(cmd));
    }
    await Promise.allSettled(tasks);
  };
  const pickRandomUserId = (ids: number[]): number | null => ids[0] ?? null;

  // Start CLI
  const stopCli = startCli({ state, logger, broadcastRoomAll, pickRandomUserId });

  return {
    server,
    http: httpService ?? undefined,
    state,
    logger,
    address: () => server.address() as net.AddressInfo,
    close: async () => {
      try {
        configWatcher?.close();
        stopCli();
        broadcastRoomLog = null;
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
