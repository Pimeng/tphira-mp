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
import { existsSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import { detectLocaleOverrides, tl } from "../utils/l10n.js";
import { startReplayCleanup } from "../replay/replayCleanup.js";
import { startLogMaintenance } from "../utils/logMaintenance.js";
import { ensureLocalesAvailable, fetchRemoteConfigExample } from "../utils/remoteAssets.js";
import { parseProxyProtocol } from "../network/proxyProtocol.js";
import { dispatchCliCommand, makeCommandCtx, startCli } from "../cli/cli.js";
import { makeCapturePrinter } from "../cli/cliHelpers.js";
import { launchGuiWindow } from "../gui/guiWindow.js";
import { parseRoomId, type RoomId } from "../../common/roomId.js";
import { broadcastRoomAll as broadcastRoomAllImpl, pickRandomUserId } from "../network/httpHelpers.js";
import { initRedisCache, getRedisClient } from "../utils/cache.js";
import {
  buildConfigFromRecord,
  changedConfigKeys,
  keepStartupOnlyConfig,
  loadEnvConfig,
  mergeConfig
} from "./configValues.js";
import { startConfigFileWatcher, type ConfigWatcher } from "./configWatcher.js";
import { NOOP } from "../../common/utils.js";
import { isHighPriorityServerCommand } from "../network/serverCommandTransport.js";
import { ConnectionRateLimiter } from "../utils/connectionRateLimiter.js";

/** 启动服务器选项 */
export type StartServerOptions = {
  host?: string;
  port?: number;
  config?: Partial<ServerConfig>;
  configPath?: string;
  watchConfig?: boolean;
  /** CLI 的 stop/shutdown 命令请求关闭服务时的回调（由入口 main.ts 提供，负责 close + 退出进程）。 */
  onShutdownRequest?: () => void;
  /** 配置文件缺失时是否自动生成默认配置（仅真实入口 main.ts 开启，避免测试污染仓库根目录）。 */
  autoCreateConfig?: boolean;
};

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

/** 自动生成默认配置时使用的兜底内容（仅当示例文件缺失，如某些精简打包场景）。 */
const DEFAULT_CONFIG_YAML = `# Phira MP 服务端配置（首次启动自动生成）
# 完整配置项说明见 server_config.example.yml 或 docs/configuration.md
HOST: "::"
PORT: 12346
HTTP_SERVICE: false
HTTP_PORT: 12347
LOG_LEVEL: INFO
ROOM_MAX_USERS: 12
MONITORS:
  - 2
`;

/**
 * 首次运行未找到配置文件时，自动生成一份默认配置，避免服主在不知情下全程使用内存默认值。
 * 来源优先级：本地带注释示例（源码运行）> 在线拉取 GitHub 完整示例 > 内置无注释最小模板。
 * @returns 成功生成的路径；任何失败（如只读文件系统）返回 null，由调用方继续用内存默认值。
 */
async function ensureDefaultConfigFile(configPath: string, rootDir: string): Promise<string | null> {
  try {
    // 1. 本地完整示例（源码 / 开发运行时存在），离线且与当前工作副本一致
    const example = join(rootDir, "server_config.example.yml");
    if (existsSync(example)) {
      copyFileSync(example, configPath);
      return configPath;
    }
    // 2. 在线拉取完整带注释示例（CNB 镜像优先 / GitHub release 回退；精简打包不附带本地示例）
    const remote = await fetchRemoteConfigExample();
    if (remote) {
      writeFileSync(configPath, remote, "utf8");
      return configPath;
    }
    // 3. 兜底：内置无注释最小模板
    writeFileSync(configPath, DEFAULT_CONFIG_YAML, "utf8");
    return configPath;
  } catch {
    return null;
  }
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
  isHighPriority: isHighPriorityServerCommand
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

  // 资源自动准备（仅 autoCreateConfig 开启时，即真实入口启动；测试不触发以免污染/联网）。
  // 必须在 loadMergedConfig 及任何本地化输出之前完成，使其当次即生效。
  let autoCreatedConfigPath: string | null = null;
  let localesFetched = 0;
  if (options.autoCreateConfig === true) {
    // locales 与默认配置是两笔互相独立、各自可能在线拉取（CNB→GitHub，各 5s 超时）的准备工作：
    // 写不同文件、互不依赖、均不抛错。并行执行，避免冷启动（打包二进制首启 + 网络慢）时
    // 两次拉取串行叠加最坏约 20s 的等待。两者仍都在此处 await 完成，保证当次即生效。
    const needConfig = !existsSync(configPath);
    const [fetched, createdPath] = await Promise.all([
      // locales：缺失语言在线拉取写盘，失败由 l10n 嵌入兜底兜住
      ensureLocalesAvailable(paths.localesDir),
      // 配置：缺失时本地示例 / 在线拉取 / 内置最小模板
      needConfig ? ensureDefaultConfigFile(configPath, paths.rootDir) : Promise.resolve(null)
    ]);
    localesFetched = fetched;
    autoCreatedConfigPath = createdPath;
  }

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
  let httpServiceForcedByGui = false;
  const loadMergedConfig = (): ServerConfig => {
    const fileCfg = loadConfig(configPath);
    const envCfg = loadEnvConfig();
    const merged = mergeConfig(mergeConfig(fileCfg, envCfg), cliCfg);
    // GUI 窗口依赖 HTTP 服务：启用 GUI 时自动开启（在加载阶段统一隐含，热重载同样适用）
    if (merged.gui === true && merged.http_service !== true) {
      merged.http_service = true;
      httpServiceForcedByGui = true;
    }
    return merged;
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
      // 喂入控制台日志中心（GUI 控制台与终端共享同一套等级过滤）
      if (state && logger.isLevelEnabled(level)) {
        state.consoleHub.append(level, message, timestamp.getTime());
      }
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

  // 初始化 Redis 缓存（如果配置启用）
  if (mergedCfg.redis?.enabled) {
    try {
      await initRedisCache(mergedCfg.redis);
      logger.mark("Redis cache enabled");
    } catch (e) {
      logger.warn(`Failed to initialize Redis cache: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  state = new ServerState(mergedCfg, logger, serverName, adminDataPath, configPath);
  await state.loadAdminData();
  state.startCleanup();
  const replayCleanup = startReplayCleanup({ getTtlDays: () => currentConfig.replay_ttl_days ?? 4, logger });
  // 日志维护：历史日志压缩 + 目录容量上限（默认压缩 14 天前的日志、目录上限 500MB；0 表示关闭）
  const logMaintenance = startLogMaintenance({
    logsDir: paths.logsDir,
    getCompressAfterDays: () => currentConfig.log_compress_after_days ?? 14,
    getMaxTotalBytes: () => (currentConfig.log_max_total_mb ?? 500) * 1024 * 1024,
    logger
  });

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
  const activeSockets = new Set<net.Socket>();

  const connectionLimiter = new ConnectionRateLimiter({
    maxConnections: mergedCfg.connection_rate_limit ?? 30,
    windowMs: 10_000,
    banDurationMs: 30_000
  });

  const server = net.createServer(async (socket) => {
    // 全服连接数硬上限：超过即拒绝（保护小内存机器，防连接洪水导致 OOM）。
    // 读取 state.config 以支持热重载；未设置或 <1 表示不限制。
    const maxConnections = state.config.max_connections;
    if (typeof maxConnections === "number" && maxConnections >= 1 && activeSockets.size >= maxConnections) {
      logger.debug(`Connection rejected: max connections (${maxConnections}) reached`);
      socket.destroy();
      return;
    }

    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
    const id = newUuid();
    let remoteIp = socket.remoteAddress ?? "unknown";
    let remotePort = socket.remotePort ?? 0;

    if (remoteIp && !connectionLimiter.check(remoteIp)) {
      logger.debug(`Rate-limited connection from ${remoteIp}`);
      socket.destroy();
      activeSockets.delete(socket);
      return;
    }

    // 如果启用了 HAProxy PROXY Protocol，尝试解析真实客户端 IP
    // HAProxy PROXY Protocol 用于在反向代理后获取真实客户端地址
    if (state.config.haproxy_protocol) {
      try {
        const proxyInfo = await parseProxyProtocol(socket, 1000);
        if (proxyInfo) {
          remoteIp = proxyInfo.sourceAddress;
          remotePort = proxyInfo.sourcePort;
          logger.debug(`[${id}] HAProxy PROXY Protocol 解析成功: ${remoteIp}:${remotePort}`);
        }
      } catch (e) {
        logger.warn(`[${id}] HAProxy PROXY Protocol 解析失败: ${e instanceof Error ? e.message : String(e)}`);
        // PROXY Protocol 解析失败时直接断开，防止恶意连接
        socket.destroy();
        activeSockets.delete(socket);
        return;
      }
    }

    logger.debug(
      tl(state.serverLang, "log-new-connection", {
        id,
        remote: `${remoteIp}:${remotePort}`
      }),
      undefined,
      { ip: remoteIp, isConnectionLog: true }
    );

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
        },
        onError: (phase, err) => {
          logger.warn(`[${id}] Stream ${phase} error: ${err.message}`, undefined, {
            ip: remoteIp,
            userId: session.user?.id
          });
        }
      });

      session.bindStream(stream);
      state.sessions.set(id, session);
      logger.debug(tl(state.serverLang, "log-handshake-ok", { id, version: String(stream.version) }), undefined, {
        ip: remoteIp,
        isConnectionLog: true
      });
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
      logger.warn(tl(state.serverLang, "log-handshake-failed", { id, reason }), undefined, {
        ip: remoteIp,
        isConnectionLog: true
      });
      socket.destroy();
      activeSockets.delete(socket);
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

    // 单 IP 连接限速：热重载新阈值（限速器实例常驻，仅更新阈值，不重置已有窗口/封禁）
    connectionLimiter.setMaxConnections(effectiveConfig.connection_rate_limit ?? 30);

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
    httpService =
      mergedCfg.http_service === true
        ? await startHttpService({ state, host: listenHost, port: mergedCfg.http_port ?? 12347 })
        : null;

    // 设置 WebSocket 服务引用，建立服务器内部与 HTTP 服务的连接
    if (httpService) {
      state.wsService = httpService.ws;
      state.autoUploadCallback = httpService.handleGameEndAutoUpload;
      // 注册房间日志广播回调，将房间日志实时推送到 WebSocket 客户端
      broadcastRoomLog = (roomId, message, timestamp) => {
        void httpService?.ws.broadcastRoomLog(roomId, message, timestamp).catch(NOOP);
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
    logMaintenance.stop();
    if (httpService) await httpService.close().catch(NOOP);
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
  logger.mark(
    tl(state.serverLang, "log-runtime-env", {
      platform: `${process.platform}_${process.arch}`,
      node: formatNodeVersion(process.version)
    })
  );
  logger.mark(tl(state.serverLang, "log-server-listen", { addr: formatListenHostPort(addr.address, addr.port) }));
  if (httpService) {
    const httpAddr = httpService.address();
    logger.mark(
      tl(state.serverLang, "log-http-listen", { addr: formatListenHostPort(httpAddr.address, httpAddr.port) })
    );
  }
  logger.mark(tl(state.serverLang, "log-server-name", { name: serverName }));

  // 在线补齐了 locales 时给出提示
  if (localesFetched > 0) {
    logger.mark(tl(state.serverLang, "locales-fetched", { count: localesFetched }));
  }
  // 检测到 locales/<lang>.ftl 运行时覆盖时逐条提示（覆盖了多少个翻译键）
  for (const { lang, count } of detectLocaleOverrides()) {
    logger.mark(tl(state.serverLang, "locales-override-applied", { lang, count }));
  }
  // 首次启动自动生成了配置文件时提示服主按需修改
  if (autoCreatedConfigPath) {
    logger.mark(tl(state.serverLang, "config-auto-created", { path: autoCreatedConfigPath }));
  }
  // 开了 HTTP 但未配置 ADMIN_TOKEN 时，/admin/* 会全部拒绝；提示可用 CLI 临时授权或设置 token
  if (mergedCfg.http_service === true && !mergedCfg.admin_token?.trim()) {
    logger.warn(tl(state.serverLang, "http-admin-token-missing"));
  }
  // GUI 隐含开启了 HTTP 服务时给出提示
  if (httpServiceForcedByGui) {
    logger.mark(tl(state.serverLang, "log-gui-http-forced"));
  }

  // 启动时立即执行一次日志维护，清理历史堆积（异步，不阻塞启动）
  void logMaintenance.runOnce().catch(NOOP);

  // 启动 CLI 控制台（用于服务器管理命令）
  const broadcastRoomAll = (roomId: RoomId, cmd: ServerCommand): Promise<void> =>
    broadcastRoomAllImpl(state, roomId, cmd);
  const stopCli = startCli({
    state,
    logger,
    broadcastRoomAll,
    pickRandomUserId,
    requestShutdown: options.onShutdownRequest
  });

  // 注册 GUI 控制台命令执行器：与终端 CLI 共用同一套命令分发，输出捕获后回传调用方。
  // 每条命令记录一条审计日志（终端与 GUI 控制台都能看到）。
  state.consoleExecutor = async (line: string) => {
    const { printer, lines } = makeCapturePrinter();
    logger.info(tl(state.serverLang, "log-gui-console-command", { command: line }));
    await dispatchCliCommand(
      makeCommandCtx({ state, logger, broadcastRoomAll, pickRandomUserId }, printer),
      line,
      options.onShutdownRequest
    );
    return lines;
  };

  // GUI 窗口模式：生成本机回环专用 token 并弹出独立窗口（类似 Minecraft 服务端 GUI）。
  // token 仅接受来自回环地址的请求，通过 URL 片段（#）传入页面——片段不会出现在请求与日志中。
  if (currentConfig.gui === true && httpService) {
    state.guiLocalToken = newUuid();
    const guiBaseUrl = `http://127.0.0.1:${httpService.address().port}/gui`;
    const guiWindowUrl = `${guiBaseUrl}#token=${state.guiLocalToken}`;
    void launchGuiWindow(guiWindowUrl).then((opened) => {
      if (opened) {
        logger.mark(tl(state.serverLang, "log-gui-window-launched", { url: guiBaseUrl }));
      } else {
        // 打开失败时输出带 token 的完整地址，便于在本机手动打开（日志仅本机可读）
        logger.warn(tl(state.serverLang, "log-gui-window-failed", { url: guiWindowUrl }));
      }
    });
  }

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
        const redis = getRedisClient();
        if (redis) {
          redis.disconnect();
        }
        if (httpService) await httpService.close();
        // 关闭 TCP 服务器，设置 10 秒超时强制结束
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            server.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          }),
          new Promise<void>((_, reject) => {
            const timer = setTimeout(() => reject(new Error("server-close-timeout")), 10000);
            timer.unref?.();
          })
        ]).catch((err) => {
          logger.warn(`Server close timed out or failed: ${err instanceof Error ? err.message : String(err)}`);
          // 强制销毁所有活跃连接
          for (const socket of activeSockets) {
            try {
              socket.destroy();
            } catch {
              /* ignore */
            }
          }
        });
        logger.mark(tl(state.serverLang, "log-server-stopped"));
      } finally {
        await state.flushAdminDataNow().catch(NOOP);
        await state.replayRecorder.closeAll().catch((err) => {
          logger.warn(`Replay recorder closeAll failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        replayCleanup.stop();
        logMaintenance.stop();
        state.stopCleanup();
        logger.close();
      }
    }
  };
}
