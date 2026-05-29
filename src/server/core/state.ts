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
  /** 自动上传回调函数（由 HttpService 设置，用于游戏结束后触发回放上传） */
  autoUploadCallback: ((userId: number, chartId: number, timestamp: number, recordId: number) => void) | null = null;

  // ========== 管理员认证 ==========

  /** 临时管理员 TOKEN 表（TOKEN -> { ip, expiresAt, banned }） */
  readonly tempAdminTokens = new Map<string, { ip: string; expiresAt: number; banned: boolean }>();

  /** CLI 提权批准会话表（sessionKey -> 批准状态） */
  readonly cliApprovalSessions = new Map<string, {
    ip: string;
    expiresAt: number;
    status: "pending" | "approved" | "denied";
    token?: string;
    tokenExpiresAt?: number;
    requestedAt: number;
  }>();

  // ========== 自动上传配置 ==========

  /** 用户自动上传显示配置（userId -> { show }），仅内存存储 */
  readonly autoUploadConfigs = new Map<number, AutoUploadConfig>();
  /** 已上传回放元数据（userId -> chartId -> UploadedReplayMeta[]），用于去重 */
  readonly uploadedReplayMeta = new Map<number, Map<number, Array<UploadedReplayMeta>>>();

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
   * 保存管理员数据到文件
   *
   * 使用写时复制（write-to-temp-then-rename）策略确保原子性写入，
   * 避免在写入过程中断电或崩溃导致数据损坏。
   * 如果重命名失败（例如 Windows 上的文件锁定），尝试删除后重试。
   */
  async saveAdminData(): Promise<void> {
    const data = await this.mutex.runExclusive(async () => this.snapshotAdminData());
    const dir = dirname(this.adminDataPath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.adminDataPath}.tmp`;
    const text = JSON.stringify(data, null, 2);
    await writeFile(tmp, text, "utf8");
    try {
      await rename(tmp, this.adminDataPath);
    } catch {
      // 在某些平台（如 Windows）上，如果目标文件被锁定，重命名会失败
      // 此时尝试删除后重试
      try {
        await unlink(this.adminDataPath);
      } catch {
        // 文件可能不存在
      }
      await rename(tmp, this.adminDataPath);
    }
  }
}
