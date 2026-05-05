/**
 * Phira MP 服务器核心启动模块
 *
 * 负责服务器生命周期管理，包括：
 * - 配置加载与热重载
 * - TCP 监听与连接管理
 * - HTTP/WebSocket 服务启动
 * - 会话管理与协议握手
 * - 优雅关闭
 */
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

/** 启动服务器选项 */
export type StartServerOptions = { host?: string; port?: number; config?: Partial<ServerConfig>; configPath?: string; watchConfig?: boolean };

/** 运行中的服务器实例 */
export type RunningServer = {
  server: net.Server;
  http?: HttpService;
  state: ServerState;
  logger: Logger;
  close: () => Promise<void>;
  address: () => net.AddressInfo;
};

/**
 * 从 YAML 文本解析服务器配置
 * @param text - YAML 格式的配置文本
 * @returns 解析后的 ServerConfig 对象
 */
export function parseConfigText(text: string): ServerConfig {
  return buildConfigFromRecord(yaml.load(text));
}

/**
 * 从配置文件加载配置
 * @param configPath - 配置文件路径
 * @returns 解析后的 ServerConfig 对象
 */
export function loadConfigFile(configPath: string): ServerConfig {
  return parseConfigText(readFileSync(configPath, { encoding: "utf8" }));
}

/**
 * 加载配置（如果不存在则返回默认配置）
 * @param configPath - 配置文件路径
 * @returns ServerConfig 对象，默认 monitors 为 [2]
 */
function loadConfig(configPath: string): ServerConfig {
  if (!existsSync(configPath)) return { monitors: [2] };
  return loadConfigFile(configPath);
}

/** 配置文件监视器 */
type ConfigWatcher = { close: () => void };

/**
 * 启动配置文件热重载监视器
 *
 * 监视配置文件所在目录的变更，当配置文件发生变化时触发重载。
 * 使用防抖机制（200ms）避免频繁重载。
 *
 * @param opts - 监视器选项
 * @returns ConfigWatcher 实例，失败时返回 null
 */
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

/**
 * 协议编解码器配置
 *
 * 定义了服务器命令的编码/解码方式，以及高优先级消息的判断逻辑。
 * 高优先级消息会跳过批量发送延迟，立即发送，确保关键交互的实时性。
 */
const codec: StreamCodec<ServerCommand, ClientCommand> = {
  encodeSend: (payload) => encodePacket(payload, encodeServerCommand),
  decodeRecv: (payload) => decodePacket(payload, decodeClientCommand),
  isHighPriority: (cmd) => {
    // 高优先级消息类型：心跳响应、认证响应、状态变更、房主变更、用户加入
    const highTypes = new Set(["Pong", "Authenticate", "ChangeState", "ChangeHost", "OnJoinRoom"]);
    return highTypes.has(cmd.type);
  }
};

function formatListenHostPort(host: string, port: number): string {
  if (host.includes(":")) return `[${host}]:${port}`;
  return `${host}:${port}`;
}

function formatNodeVersion(v: string): string {
  return v.startsWith("v") ? v.slice(1) : v;
}

/**
 * 启动 Phira MP 服务器
 *
 * 完整的启动流程：
 * 1. 加载并合并配置（文件 + 环境变量 + CLI 参数）
 * 2. 初始化服务器状态（Logger、ServerState、AdminData）
 * 3. 启动回放清理任务
 * 4. 创建 TCP 服务器并监听连接
 * 5. 可选启动 HTTP/WebSocket 服务
 * 6. 启动配置文件热重载监视器
 * 7. 启动 CLI 控制台
 *
 * @param options - 启动选项
 * @returns 运行中的服务器实例
 * @throws 当端口被占用或配置错误时抛出异常
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const paths = getAppPaths();
  const configPath = options.configPath ?? paths.configPath;

  // CLI 参数配置（优先级最高）
  const cliCfg: Partial<ServerConfig> = {
    ...(options.config ?? {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {})
  };

  /**
   * 加载合并配置
   * 优先级：CLI 参数 > 环境变量 > 配置文件
   */
  const loadMergedConfig = (): ServerConfig => {
    const fileCfg = loadConfig(configPath);
    const envCfg = loadEnvConfig();
    return mergeConfig(mergeConfig(fileCfg, envCfg), cliCfg);
  };
  const mergedCfg = loadMergedConfig();
  let currentConfig = mergedCfg;
  let broadcastRoomLog: ((roomId: RoomId, message: string, timestamp: Date) => void) | null = null;
  let state: ServerState | undefined;

  // 初始化日志系统
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
      // 将日志同步到房间日志缓存和 WebSocket 广播
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

  /**
   * TCP 连接处理器
   *
   * 每个新连接的处理流程：
   * 1. 生成唯一会话 ID
   * 2. 解析真实客户端 IP（支持 HAProxy PROXY Protocol）
   * 3. 创建 Session 实例
   * 4. 进行协议握手（版本协商）
   * 5. 绑定 Stream 并注册到状态管理
   */
  const server = net.createServer(async (socket) => {
    const id = newUuid();
    let remoteIp = socket.remoteAddress ?? "unknown";
    let remotePort = socket.remotePort ?? 0;

    // 如果启用了 HAProxy PROXY Protocol，尝试解析真实客户端 IP
    // HAProxy PROXY Protocol 用于在反向代理后获取真实客户端地址
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

    // 创建新会话
    const session = new Session({ id, socket, state, remoteIp });

    try {
      // 协议握手：协商版本并创建 Stream
      const stream = await Stream.create<ServerCommand, ClientCommand>({
        socket,
        expectedVersion: 1,
        codec,
        // Ping 命令使用 fast path，避免进入队列延迟
        fastPath: (cmd) => cmd.type === "Ping",
        handler: async (cmd) => {
          await session.onCommand(cmd);
        }
      });

      session.bindStream(stream);
      state.sessions.set(id, session);
      logger.log("DEBUG", tl(state.serverLang, "log-handshake-ok", { id, version: String(stream.version) }), undefined, { ip: remoteIp, isConnectionLog: true });
    } catch (e) {
      // 握手失败：解析错误原因并记录日志，然后断开连接
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

  /**
   * 运行时配置热重载
   *
   * 重新加载配置并应用变更。某些配置（如 host、port）需要重启服务器才能生效。
   * 只会应用运行时可修改的配置项。
   */
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

  // 启动 TCP 服务器
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

    // 根据配置启动 HTTP/WebSocket 服务
    httpService = mergedCfg.http_service === true ? await startHttpService({ state, host: listenHost, port: mergedCfg.http_port ?? 12347 }) : null;

    // 设置 WebSocket 服务引用，建立服务器内部与 HTTP 服务的连接
    if (httpService) {
      state.wsService = httpService.ws;
      state.autoUploadCallback = httpService.handleGameEndAutoUpload;
      // 注册房间日志广播回调，将房间日志实时推送到 WebSocket 客户端
      broadcastRoomLog = (roomId, message, timestamp) => {
        void httpService?.ws.broadcastRoomLog(roomId, message, timestamp).catch(() => {});
      };
    }

    // 启动配置文件热重载（除非显式禁用）
    if (options.watchConfig !== false) {
      configWatcher = startConfigFileWatcher({ configPath, logger, onReload: reloadRuntimeConfig });
    }
  } catch (e) {
    // 启动失败：清理已分配的资源
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

  // 输出服务器启动信息
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

  // CLI 辅助函数：向房间所有成员广播命令
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

  // CLI 辅助函数：从用户列表中选择一个用户（目前选择第一个）
  const pickRandomUserId = (ids: number[]): number | null => ids[0] ?? null;

  // 启动 CLI 控制台（用于服务器管理命令）
  const stopCli = startCli({ state, logger, broadcastRoomAll, pickRandomUserId });

  // 返回运行中的服务器实例
  return {
    server,
    http: httpService ?? undefined,
    state,
    logger,
    address: () => server.address() as net.AddressInfo,
    /**
     * 优雅关闭服务器
     *
     * 关闭流程：
     * 1. 停止配置监视器
     * 2. 停止 CLI
     * 3. 关闭 HTTP 服务
     * 4. 关闭 TCP 服务器
     * 5. 停止回放清理任务
     * 6. 关闭日志系统
     */
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
