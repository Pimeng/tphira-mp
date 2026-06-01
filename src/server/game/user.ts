import { Language } from "../utils/l10n.js";
import type { ServerState } from "../core/state.js";
import type { Room } from "../game/room.js";
import type { Session } from "../network/session.js";
import type { ServerCommand, UserInfo } from "../../common/commands.js";

/**
 * 用户数据模型
 *
 * User 类代表一个在线用户，管理：
 * - 用户基本信息（ID、名称、语言偏好）
 * - 会话关联（支持断线重连）
 * - 房间关联
 * - 观战权限检查
 * - 游戏时间跟踪（用于回放同步）
 * - 断线 dangling 状态（断线后 10 秒内可重连保留房间）
 */
export class User {
  /** Phira 用户 ID */
  readonly id: number;
  /** 用户显示名称 */
  readonly name: string;
  /** 用户语言偏好（用于本地化消息） */
  readonly lang: Language;
  /** 服务器全局状态引用 */
  readonly server: ServerState;

  // ========== 运行时状态 ==========

  /** 当前关联的会话（null 表示离线或断线） */
  session: Session | null = null;
  /** 当前所在的房间（null 表示不在任何房间） */
  room: Room | null = null;

  /** 是否为观战者 */
  monitor = false;

  private _infoCache: UserInfo | null = null;

  /** 当前游戏时间（用于回放同步，游戏中更新） */
  gameTime = Number.NEGATIVE_INFINITY;

  /** 断线 token（用于判断断线重连是否有效） */
  private dangleToken: object | null = null;

  /**
   * 创建新用户实例
   * @param opts - 用户创建选项
   */
  constructor(opts: { id: number; name: string; language: string; server: ServerState }) {
    this.id = opts.id;
    this.name = opts.name;
    this.lang = new Language(opts.language);
    this.server = opts.server;
  }

  /**
   * 转换为 UserInfo 对象（用于协议传输）
   * @returns 用户基本信息
   */
  toInfo(): UserInfo {
    if (!this._infoCache || this._infoCache.monitor !== this.monitor) {
      this._infoCache = { id: this.id, name: this.name, monitor: this.monitor };
    }
    return this._infoCache;
  }

  /**
   * 检查用户是否有观战权限
   * @returns 如果用户在 monitors 配置列表中返回 true
   */
  canMonitor(): boolean {
    return this.server.config.monitors.includes(this.id);
  }

  /**
   * 设置/清除关联的会话
   *
   * 设置新会话时会清除 dangling 状态。
   *
   * @param session - 新会话或 null
   */
  setSession(session: Session | null): void {
    this.session = session;
    this.dangleToken = null;
  }

  /**
   * 尝试向用户发送命令
   *
   * 如果用户当前没有活跃的会话，操作会被静默忽略。
   *
   * @param cmd - 要发送的服务器命令
   */
  async trySend(cmd: ServerCommand): Promise<void> {
    const session = this.session;
    if (!session) return;
    await session.trySend(cmd);
  }

  /**
   * 标记用户为 dangling 状态（断线等待重连）
   *
   * 生成一个唯一 token，用于在 10 秒内验证重连是否来自同一断线事件。
   *
   * @returns dangling token
   */
  markDangle(): object {
    const token = {};
    this.dangleToken = token;
    return token;
  }

  /**
   * 检查用户是否仍处于指定的 dangling 状态
   * @param token - 之前 markDangle 返回的 token
   * @returns 如果 token 匹配返回 true
   */
  isStillDangling(token: object): boolean {
    return this.dangleToken === token;
  }
}

