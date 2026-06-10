/**
 * 服务器全局状态管理模块
 *
 * ServerState 是 Phira MP 服务器的核心状态容器，管理：
 * - 用户、会话、房间的内存存储
 * - 封禁列表（全局和房间级别）
 * - 回放录制器
 * - 管理员数据和临时 TOKEN
 * - WebSocket 服务引用
 *
 * 所有状态修改操作都需要通过 Mutex 进行同步，确保线程安全。
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Mutex } from "../utils/mutex.js";
import type { RoomId } from "../../common/roomId.js";
import { parseRoomId, roomIdToString } from "../../common/roomId.js";
import type { ServerConfig, ShareStationConfig } from "../core/types.js";
import type { Room } from "../game/room.js";
import type { Session } from "../network/session.js";
import type { User } from "../game/user.js";
import type { Logger } from "../utils/logger.js";
import { Language } from "../utils/l10n.js";
import { ReplayRecorder } from "../replay/replayRecorder.js";
import { defaultReplayBaseDir } from "../replay/replayStorage.js";
import type { WebSocketService } from "../network/websocketService.js";
import type { ConsoleOutputLine } from "../cli/cliHelpers.js";
import { ConsoleHub } from "../utils/consoleHub.js";
import { readAppVersion } from "./version.js";

/** 管理员数据文件结构 */
type AdminDataFile = { version: 1; bannedUsers: number[]; bannedRoomUsers: Record<string, number[]> };

/** 临时管理员 TOKEN 的有效期（4 小时 = 14,400,000 毫秒） */
export const TEMP_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
/** OTP / CLI 提权会话的有效期（1 分钟 = 60,000 毫秒） */
export const OTP_TTL_MS = 1 * 60 * 1000;

/** 用户自动上传配置（仅控制 UI 是否显示上传按钮，仅内存存储） */
type AutoUploadConfig = {
  show: boolean;
};

/** 已上传回放的元数据（用于去重和状态跟踪） */
type UploadedReplayMeta = {
  scoreId: number;
  chartId: number;
  timestamp: number;
};

/**
 * 服务器全局状态类
 *
 * 管理所有运行时状态数据，包括用户、房间、会话、封禁列表等。
 * 注意：此类本身不提供线程安全，并发修改需要通过 mutex 进行同步。
 */
export class ServerState {
  /** 全局互斥锁，用于保护并发状态修改 */
  readonly mutex = new Mutex();
  /** 当前服务器配置（运行时可通过热重载更新） */
  config: ServerConfig;
  /** 日志记录器实例 */
  readonly logger: Logger;
  /** 服务器显示名称 */
  serverName: string;
  /** 服务器本地化语言 */
  serverLang: Language;
  /** 管理员数据文件路径 */
  readonly adminDataPath: string;
  /** 服务器配置文件路径（用于持久化运行时配置变更） */
  readonly configPath: string;
  /** 是否启用回放录制 */
  replayEnabled: boolean;
  /** 是否允许创建新房间 */
  roomCreationEnabled: boolean;
  /** 服务器版本 */
  version: string;

  /** 分享站配置（用于回放自动上传到第三方平台） */
  get shareStation(): ShareStationConfig | undefined {
    return this.config.share_station;
  }

  /** 检查分享站是否已配置（需要同时设置 url 和 token） */
  get shareStationConfigured(): boolean {
    const cfg = this.config.share_station;
    return Boolean(cfg?.url && cfg?.token);
  }

  // ========== 核心数据存储 ==========

  /** 所有活跃的会话（sessionId -> Session） */
  readonly sessions = new Map<string, Session>();
  /** 所有在线用户（userId -> User） */
  readonly users = new Map<number, User>();
  /** 所有活跃房间（roomId -> Room） */
  readonly rooms = new Map<RoomId, Room>();

  // ========== 封禁管理 ==========

  /** 全局封禁用户列表（userId 集合） */
  readonly bannedUsers = new Set<number>();
  /** 房间级封禁用户列表（roomId -> userId 集合） */
  readonly bannedRoomUsers = new Map<RoomId, Set<number>>();
  /** 比赛房间白名单（roomId -> 允许加入的用户集合） */
  readonly contestRooms = new Map<RoomId, { whitelist: Set<number> }>();

  // ========== 回放录制 ==========

  /** 回放录制器实例，负责录制和存储游戏回放 */
  readonly replayRecorder: ReplayRecorder;

  // ========== WebSocket / HTTP 服务引用 ==========

  /** WebSocket 服务引用（仅在 HTTP 服务启用时存在） */
  wsService: WebSocketService | null = null;
  /** 控制台日志中心：缓存最近日志并向 GUI 订阅者实时推送（由 server.ts 的 Logger onLog 喂入） */
  readonly consoleHub = new ConsoleHub();
  /**
   * GUI 控制台命令执行器（由 server.ts 在 CLI 启动后注册）。
   * 输入一行命令文本，返回捕获到的输出行；null 表示尚未就绪。
   */
  consoleExecutor: ((line: string) => Promise<ConsoleOutputLine[]>) | null = null;
  /** 自动上传回调函数（由 HttpService 设置，用于游戏结束后触发回放上传） */
  autoUploadCallback: ((userId: number, chartId: number, timestamp: number, recordId: number) => void) | null = null;

  // ========== 管理员认证 ==========

  /** 临时管理员 TOKEN 表（TOKEN -> { ip, expiresAt, banned }） */
  readonly tempAdminTokens = new Map<string, { ip: string; expiresAt: number; banned: boolean }>();

  /**
   * 本机 GUI 窗口专用 token（GUI 窗口模式启动时生成，服务器运行期间有效）。
   * 仅当请求来自回环地址时被鉴权接受，用于 GUI 窗口免输入自动登录。
   */
  guiLocalToken: string | null = null;

  /** CLI 提权批准会话表（sessionKey -> 批准状态） */
  readonly cliApprovalSessions = new Map<
    string,
    {
      ip: string;
      expiresAt: number;
      status: "pending" | "approved" | "denied";
      token?: string;
      tokenExpiresAt?: number;
      requestedAt: number;
    }
  >();

  // ========== 自动上传配置 ==========

  /** 用户自动上传显示配置（userId -> { show }），仅内存存储 */
  readonly autoUploadConfigs = new Map<number, AutoUploadConfig>();
  /** 已上传回放元数据（userId -> chartId -> UploadedReplayMeta[]），用于去重 */
  readonly uploadedReplayMeta = new Map<number, Map<number, Array<UploadedReplayMeta>>>();
  /** 内存清理定时器句柄 */
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** 清理周期（毫秒） */
  private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
  /** 上传元数据保留天数 */
  private static readonly UPLOAD_META_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  // ========== Admin 数据保存防抖 ==========

  private adminSaveTimer: NodeJS.Timeout | null = null;
  private adminSavePending = false;
  private adminSavePromise: Promise<void> | null = null;
  private static readonly ADMIN_SAVE_DEBOUNCE_MS = 500;
  /**
   * 创建服务器状态实例
   * @param config - 初始配置
   * @param logger - 日志记录器
   * @param serverName - 服务器名称
   * @param adminDataPath - 管理员数据文件路径
   * @param configPath - 服务器配置文件路径（admin API 持久化运行时配置变更使用）
   */
  constructor(config: ServerConfig, logger: Logger, serverName: string, adminDataPath: string, configPath: string) {
    this.config = config;
    this.logger = logger;
    this.serverName = serverName;
    this.serverLang = new Language(config.lang ?? "");
    this.adminDataPath = adminDataPath;
    this.configPath = configPath;
    this.replayEnabled = Boolean(config.replay_enabled);
    this.roomCreationEnabled = true;
    this.version = readAppVersion();
    const replayBaseDir = config.replay_base_dir ?? defaultReplayBaseDir();
    this.replayRecorder = new ReplayRecorder(replayBaseDir, logger);
  }

  /**
   * 应用新配置到服务器状态
   *
   * 更新运行时配置、服务器名称、语言和回放目录。
   * 此方法在配置热重载时被调用。
   *
   * @param config - 新的服务器配置
   */
  applyConfig(config: ServerConfig): void {
    this.config = config;
    this.serverName = config.server_name || "Phira MP";
    this.serverLang = new Language(config.lang ?? "");
    this.replayEnabled = Boolean(config.replay_enabled);
    this.replayRecorder.setBaseDir(config.replay_base_dir ?? defaultReplayBaseDir());
  }

  /**
   * 生成管理员数据的快照
   *
   * 将内存中的封禁列表转换为可序列化的数据结构。
   * 自动过滤非整数 ID 并进行排序，确保输出稳定。
   *
   * @returns 管理员数据文件对象
   */
  private snapshotAdminData(): AdminDataFile {
    const bannedUsers = [...this.bannedUsers].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
    const bannedRoomUsers: Record<string, number[]> = {};
    const entries = [...this.bannedRoomUsers.entries()].map(([rid, set]) => [roomIdToString(rid), [...set]] as const);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [rid, users] of entries) {
      const ids = users.filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
      if (ids.length > 0) bannedRoomUsers[rid] = ids;
    }
    return { version: 1, bannedUsers, bannedRoomUsers };
  }

  /**
   * 从数据文件对象加载管理员数据到内存
   *
   * @param data - 管理员数据文件对象
   */
  private applyAdminDataFile(data: AdminDataFile): void {
    this.bannedUsers.clear();
    for (const id of data.bannedUsers) {
      if (Number.isInteger(id)) this.bannedUsers.add(id);
    }
    this.bannedRoomUsers.clear();
    for (const [ridText, ids] of Object.entries(data.bannedRoomUsers ?? {})) {
      try {
        const rid = parseRoomId(ridText);
        const set = new Set<number>();
        for (const id of ids ?? []) if (Number.isInteger(id)) set.add(id);
        if (set.size > 0) this.bannedRoomUsers.set(rid, set);
      } catch {
        // 忽略格式错误的房间 ID
      }
    }
  }

  /**
   * 从文件加载管理员数据
   *
   * 使用互斥锁保护，确保并发安全。
   * 文件不存在或格式错误时静默忽略。
   */
  async loadAdminData(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      try {
        const text = await readFile(this.adminDataPath, "utf8");
        const raw = JSON.parse(text);
        // 运行时验证：确保是对象且版本正确
        if (!raw || typeof raw !== "object" || raw.version !== 1) return;
        const bannedUsers = Array.isArray(raw.bannedUsers)
          ? raw.bannedUsers.filter((n: unknown) => Number.isInteger(n))
          : [];
        const bannedRoomUsers: Record<string, number[]> = {};
        if (raw.bannedRoomUsers && typeof raw.bannedRoomUsers === "object" && !Array.isArray(raw.bannedRoomUsers)) {
          for (const [key, val] of Object.entries(raw.bannedRoomUsers)) {
            if (Array.isArray(val)) {
              bannedRoomUsers[key] = val.filter((n: unknown) => Number.isInteger(n));
            }
          }
        }
        this.applyAdminDataFile({ version: 1, bannedUsers, bannedRoomUsers });
      } catch {
        // 文件不存在或格式错误时静默忽略
      }
    });
  }

  /**
   * 清理指定用户的自动上传配置和元数据
   * 在用户完全退出（不再 dangling）时调用，防止内存泄漏
   */
  cleanupUserData(userId: number): void {
    this.autoUploadConfigs.delete(userId);
    this.uploadedReplayMeta.delete(userId);
  }

  /**
   * 启动周期性内存清理任务
   * 每小时清理过期数据：上传元数据、离线用户配置、过期 CLI 审批会话
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.runCleanup(), ServerState.CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * 停止周期性内存清理任务
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.adminSaveTimer) {
      clearTimeout(this.adminSaveTimer);
      this.adminSaveTimer = null;
      if (this.adminSavePending) {
        this.adminSavePending = false;
        this.adminSavePromise = null;
      }
    }
  }

  private runCleanup(): void {
    const now = Date.now();

    // 清理 7 天前的上传回放元数据
    const cutoffUpload = now - ServerState.UPLOAD_META_RETENTION_MS;
    for (const [userId, chartMap] of this.uploadedReplayMeta) {
      for (const [chartId, metas] of chartMap) {
        const filtered = metas.filter((m) => m.timestamp >= cutoffUpload);
        if (filtered.length === 0) {
          chartMap.delete(chartId);
        } else if (filtered.length !== metas.length) {
          chartMap.set(chartId, filtered);
        }
      }
      if (chartMap.size === 0) {
        this.uploadedReplayMeta.delete(userId);
      }
    }

    // 清理已离线用户的自动上传配置（配置本身无时间戳，离线即回收；
    // dangling 仅 10s，远短于本清理任务的小时级周期，不会误删在线/重连中的用户）
    for (const [userId] of this.autoUploadConfigs) {
      if (!this.users.has(userId)) {
        this.autoUploadConfigs.delete(userId);
      }
    }

    // 清理已过期的 CLI 审批会话
    for (const [key, session] of this.cliApprovalSessions) {
      if (now > session.expiresAt || session.status === "denied") {
        this.cliApprovalSessions.delete(key);
      }
    }

    // 清理过期的临时管理员 token
    for (const [token, data] of this.tempAdminTokens) {
      if (data.banned || now > data.expiresAt) {
        this.tempAdminTokens.delete(token);
      }
    }
  }

  /**
   * 保存管理员数据到文件（带防抖批处理）
   *
   * 使用写时复制（write-to-temp-then-rename）策略确保原子性写入，
   * 避免在写入过程中断电或崩溃导致数据损坏。
   * 如果重命名失败（例如 Windows 上的文件锁定），尝试删除后重试。
   *
   * 防抖：500ms 内的多次调用只触发一次文件写入，减少磁盘 I/O。
   */
  async saveAdminData(): Promise<void> {
    this.adminSavePending = true;

    if (this.adminSaveTimer) {
      clearTimeout(this.adminSaveTimer);
    }

    if (!this.adminSavePromise) {
      this.adminSavePromise = new Promise<void>((resolve) => {
        this.adminSaveTimer = setTimeout(() => {
          this.adminSaveTimer = null;
          this.adminSavePending = false;
          const promise = this.adminSavePromise;
          this.adminSavePromise = null;
          void this.flushAdminData().then(resolve, resolve);
        }, ServerState.ADMIN_SAVE_DEBOUNCE_MS);
      });
    }

    return this.adminSavePromise;
  }

  /**
   * 强制立即写入管理员数据（忽略防抖，用于服务器关闭）
   */
  async flushAdminDataNow(): Promise<void> {
    if (this.adminSaveTimer) {
      clearTimeout(this.adminSaveTimer);
      this.adminSaveTimer = null;
      this.adminSavePending = false;
      const promise = this.adminSavePromise;
      this.adminSavePromise = null;
      if (promise) {
        // 已有等待者在监听，直接用实际写入覆盖
      }
    }
    await this.flushAdminData();
  }

  private async flushAdminData(): Promise<void> {
    const data = await this.mutex.runExclusive(async () => this.snapshotAdminData());
    const dir = dirname(this.adminDataPath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.adminDataPath}.tmp`;
    const text = JSON.stringify(data, null, 2);
    await writeFile(tmp, text, "utf8");
    try {
      await rename(tmp, this.adminDataPath);
    } catch {
      try {
        await unlink(this.adminDataPath);
      } catch {
        // 文件可能不存在
      }
      await rename(tmp, this.adminDataPath);
    }
  }
}
