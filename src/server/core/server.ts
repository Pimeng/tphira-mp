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
import {
  buildConfigFromRecord,
  changedConfigKeys,
  keepStartupOnlyConfig,
  loadEnvConfig,
  mergeConfig
} from "./configValues.js";

export type StartServerOptions = { host?: string; port?: number; config?: Partial<ServerConfig>; configPath?: string; watchConfig?: boolean };

export type RunningServer = {
  server: net.Server;
  http?: HttpService;
  state: ServerState;
  logger: Logger;
  close: () => Promise<void>;
  address: () => net.AddressInfo;
};

export function parseConfigText(text: string): ServerConfig {
  return buildConfigFromRecord(yaml.load(text));
}

export function loadConfigFile(configPath: string): ServerConfig {
  return parseConfigText(readFileSync(configPath, { encoding: "utf8" }));
}

function loadConfig(configPath: string): ServerConfig {
  if (!existsSync(configPath)) return { monitors: [2] };
  return loadConfigFile(configPath);
}

type ConfigWatcher = { close: () => void };

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
  let state: ServerState | undefined;
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
      const room = state?.rooms.get(roomId);
      if (room) room.addLog(message, timestamp.getTime());
      broadcastRoomLog?.(roomId, message, timestamp);
    }
  });
  const serverName = mergedCfg.server_name || "Phira MP";
  const adminDataPath = mergedCfg.admin_data_path ?? paths.adminDataPath;
  state = new ServerState(mergedCfg, logger, serverName, adminDataPath);
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
