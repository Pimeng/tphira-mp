/**
 * 客户端会话管理模块
 *
 * Session 类代表一个客户端连接会话，负责：
 * - 协议握手与认证（通过 Phira API 验证用户身份）
 * - 心跳检测与超时断开
 * - 命令处理与路由（游戏命令、房间管理、聊天等）
 * - 观战数据聚合与转发（Touches/Judges 缓冲）
 * - 断线重连处理（dangle 机制）
 */
import type net from "node:net";
import { err, ok, type StringResult } from "../../common/binary.js";
import type { ClientCommand, ClientRoomState, JoinRoomResponse, ServerCommand, TouchFrame, JudgeEvent } from "../../common/commands.js";
import { HEARTBEAT_DISCONNECT_TIMEOUT_MS } from "../../common/commands.js";
import type { Stream } from "../../common/stream.js";
import { fetchWithRetry } from "../../common/http.js";
import type { Room } from "../game/room.js";
import { Room as RoomClass } from "../game/room.js";
import { parseRoomId } from "../../common/roomId.js";
import { refreshRoomLive as refreshRoomLiveState } from "../game/roomUtils.js";
import type { ServerState } from "../core/state.js";
import type { Chart, RecordData } from "../core/types.js";
import { User } from "../game/user.js";
import { tl, type Language } from "../utils/l10n.js";
import { chartCache } from "../utils/cache.js";
import { getHitokotoCached } from "../utils/hitokotoCache.js";
import { logRoomInfo, logRoomMark, logRoomWarn } from "../utils/logUtils.js";

/** Phira API 默认端点 */
const DEFAULT_PHIRA_API_ENDPOINT = "https://phira.5wyxi.com";
/** API 请求超时时间（毫秒） */
const FETCH_TIMEOUT_MS = 8000;

/** 房间列表缓存数据结构 */
type RoomListCache = {
  /** 按语言缓存的房间列表文本 */
  text: Map<string, string>;
  /** 缓存生成时间戳 */
  timestamp: number;
};

/** 房间列表缓存实例（全局单例） */
let roomListCache: RoomListCache = {
  text: new Map(),
  timestamp: 0
};

/** 房间列表缓存有效期（2秒） */
const ROOM_LIST_CACHE_TTL_MS = 2000;
/** 最大缓存语言数，防止内存泄漏 */
const ROOM_LIST_MAX_CACHED_LANGS = 10;

/**
 * 从数组中随机选择一个元素
 * @param arr - 输入数组
 * @returns 随机选中的元素，数组为空时返回 null
 */
function pickRandom<T>(arr: readonly T[]): T | null {
  if (arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx] ?? null;
}

/**
 * 客户端会话类
 *
 * 管理单个 TCP 连接的生命周期，包括：
 * - 连接建立与协议握手
 * - 用户认证（通过 Phira API Bearer Token）
 * - 心跳检测与超时断开
 * - 命令路由与处理
 * - 观战数据聚合缓冲
 * - 断线重连支持（dangle 机制）
 */
export class Session {
  /** 会话唯一标识符（UUID） */
  readonly id: string;
  /** TCP Socket 连接 */
  readonly socket: net.Socket;
  /** 服务器全局状态引用 */
  readonly state: ServerState;
  /** 客户端真实 IP 地址（支持 HAProxy PROXY Protocol） */
  readonly remoteIp: string;

  // ========== 协议状态 ==========

  /** 绑定的流实例（协议握手成功后设置） */
  private stream: Stream<ServerCommand, ClientCommand> | null = null;
  /** 协商后的协议版本 */
  private protocolVersion: number | null = null;
  /** 是否等待认证（初始为 true，认证成功后设为 false） */
  private waitingForAuthenticate = true;
  /** 是否处于 panic 状态（认证失败等致命错误） */
  private panicked = false;
  /** 连接是否已断开 */
  private lost = false;
  /** 断线时是否保留房间（用于踢出旧连接时保留房间） */
  private preserveRoomOnLost = false;

  // ========== 心跳检测 ==========

  /** 最后接收数据的时间戳 */
  private lastRecv = Date.now();
  /** 心跳检测定时器（每 500ms 检查一次） */
  private heartbeatTimer: NodeJS.Timeout;

  // ========== 观战数据缓冲 ==========

  /**
   * 观战触摸数据缓冲
   *
   * 为避免高频实时数据直接冲击网络，将多个触摸帧聚合后批量发送。
   * 聚合窗口为 50ms，期间收集的数据会合并后统一转发给观战者。
   */
  private monitorTouchBuffer: Array<{ player: number; frames: TouchFrame[] }> = [];
  /** 观战判定数据缓冲（同触摸数据缓冲机制） */
  private monitorJudgeBuffer: Array<{ player: number; judges: JudgeEvent[] }> = [];
  /** 观战数据 flush 定时器 */
  private monitorFlushTimer: NodeJS.Timeout | null = null;
  /** 观战数据聚合间隔（毫秒） */
  private static readonly MONITOR_FLUSH_INTERVAL_MS = 50;

  /** 关联的用户实例（认证成功后设置） */
  user: User | null = null;

/**
   * 创建新会话实例
   * @param opts - 会话选项
   */
  constructor(opts: { id: string; socket: net.Socket; state: ServerState; remoteIp?: string }) {
    this.id = opts.id;
    this.socket = opts.socket;
    this.state = opts.state;
    this.remoteIp = opts.remoteIp ?? opts.socket.remoteAddress ?? "unknown";

    // 监听 socket 事件
    this.socket.on("close", () => void this.markLost());
    this.socket.on("error", () => void this.markLost());
    this.socket.on("data", () => {
      // 每次收到数据时更新最后接收时间，用于心跳检测
      this.lastRecv = Date.now();
    });

    // 启动心跳检测定时器
    this.heartbeatTimer = setInterval(() => {
      if (this.lost) return;
      // 如果超过心跳超时时间未收到数据，判定为连接丢失
      if (Date.now() - this.lastRecv > HEARTBEAT_DISCONNECT_TIMEOUT_MS) {
        this.state.logger.log("WARN", tl(this.state.serverLang, "log-heartbeat-timeout-disconnect", { id: this.id }), { session: this.id }, { userId: this.user?.id });
        void this.markLost();
      }
    }, 500);
  }

  private localizeMessage(lang: Language, msg: string): string {
    try {
      return lang.format(msg);
    } catch {
      return msg;
    }
  }

  private localizeError(lang: Language, e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return this.localizeMessage(lang, msg);
  }

  /**
   * 立即 flush 观战数据缓冲区
   */
  private flushMonitorBuffers(): void {
    const room = this.user?.room;
    if (!room) {
      this.monitorTouchBuffer = [];
      this.monitorJudgeBuffer = [];
      return;
    }

    if (this.monitorTouchBuffer.length > 0) {
      // 合并同一玩家的多批 frames
      const merged = new Map<number, TouchFrame[]>();
      for (const item of this.monitorTouchBuffer) {
        const existing = merged.get(item.player);
        if (existing) existing.push(...item.frames);
        else merged.set(item.player, [...item.frames]);
      }
      for (const [player, frames] of merged) {
        this.broadcastToIdsFast(room.monitorIds(), { type: "Touches", player, frames });
      }
      this.monitorTouchBuffer = [];
    }

    if (this.monitorJudgeBuffer.length > 0) {
      const merged = new Map<number, JudgeEvent[]>();
      for (const item of this.monitorJudgeBuffer) {
        const existing = merged.get(item.player);
        if (existing) existing.push(...item.judges);
        else merged.set(item.player, [...item.judges]);
      }
      for (const [player, judges] of merged) {
        this.broadcastToIdsFast(room.monitorIds(), { type: "Judges", player, judges });
      }
      this.monitorJudgeBuffer = [];
    }
  }

  /**
   * 将观战数据推入缓冲区，并设置延迟 flush
   */
  private bufferMonitorData(type: "touches" | "judges", player: number, data: TouchFrame[] | JudgeEvent[]): void {
    if (type === "touches") {
      this.monitorTouchBuffer.push({ player, frames: data as TouchFrame[] });
    } else {
      this.monitorJudgeBuffer.push({ player, judges: data as JudgeEvent[] });
    }

    if (!this.monitorFlushTimer) {
      this.monitorFlushTimer = setTimeout(() => {
        this.monitorFlushTimer = null;
        this.flushMonitorBuffers();
      }, Session.MONITOR_FLUSH_INTERVAL_MS);
    }
  }

  bindStream(stream: Stream<ServerCommand, ClientCommand>): void {
    this.stream = stream;
    this.protocolVersion = stream.version;
  }

  async trySend(cmd: ServerCommand): Promise<void> {
    const stream = this.stream;
    if (!stream) return;
    try {
      await stream.send(cmd);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.state.logger.log("DEBUG", `[${this.id}] Send failed: ${msg}`, undefined, { userId: this.user?.id });
      await this.markLost();
    }
  }

  async onCommand(cmd: ClientCommand): Promise<void> {
    this.lastRecv = Date.now();
    if (this.panicked || this.lost) return;

    if (cmd.type === "Ping") {
      await this.trySend({ type: "Pong" });
      return;
    }

    if (this.waitingForAuthenticate) {
      if (cmd.type !== "Authenticate") return;
      await this.handleAuthenticate(cmd.token);
      return;
    }

    const resp = await this.process(cmd);
    if (resp) await this.trySend(resp);
  }

  private getPhiraApiEndpoint(): string {
    return this.state.config.phira_api_endpoint || DEFAULT_PHIRA_API_ENDPOINT;
  }

  private async handleAuthenticate(token: string): Promise<void> {
    try {
      const me = await fetchWithRetry(`${this.getPhiraApiEndpoint()}/me`, {
        headers: { Authorization: `Bearer ${token}` },
        proxy: this.state.config.outbound_proxy
      }, FETCH_TIMEOUT_MS).then(async (r) => {
        if (!r.ok) throw new Error("auth-fetch-me-failed");
        const data: unknown = await r.json();
        // 运行时验证 API 响应结构
        if (!data || typeof data !== "object" || data === null) throw new Error("auth-invalid-response");
        const obj = data as Record<string, unknown>;
        if (!Number.isInteger(obj.id)) throw new Error("auth-invalid-user-id");
        if (typeof obj.name !== "string" || !obj.name.trim()) throw new Error("auth-invalid-user-name");
        return {
          id: obj.id as number,
          name: obj.name.trim(),
          language: typeof obj.language === "string" ? obj.language : ""
        };
      });

      // Don't reject banned users at auth time - allow them to connect
      // They will be blocked from operations later

      const { user, staleSession } = await this.state.mutex.runExclusive(async () => {
        const existing = this.state.users.get(me.id);
        if (existing) {
          let staleSession: Session | null = null;
          if (existing.session) {
            const sock = existing.session.socket;
            if (sock.destroyed || sock.readyState !== "open") {
              staleSession = existing.session;
              existing.setSession(null);
            } else {
              throw new Error("auth-account-already-online");
            }
          }
          existing.setSession(this);
          return { user: existing, staleSession };
        }
        const created = new User({ id: me.id, name: me.name, language: me.language, server: this.state });
        created.setSession(this);
        this.state.users.set(me.id, created);
        return { user: created, staleSession: null };
      });

      this.user = user;
      if (staleSession) void staleSession.adminDisconnect({ preserveRoom: true });
      
      // Check if user is banned - 优化：不需要mutex，直接读取Set
      const isBanned = this.state.bannedUsers.has(user.id);
      if (isBanned && user.room) {
        await this.handleUserLeaveRoom(user, user.room);
      }
      
      const roomState: ClientRoomState | null = user.room ? user.room.clientState(user, (id) => this.state.users.get(id)) : null;
      await this.trySend({ type: "Authenticate", result: ok([user.toInfo(), roomState]) });
      
      // 立即刷新发送批量，确保认证响应快速发送
      await this.stream?.flushSendBatch();
      
      this.waitingForAuthenticate = false;

      const monitorSuffix = user.monitor ? tl(this.state.serverLang, "label-monitor-suffix") : "";
      this.state.logger.log("DEBUG", tl(this.state.serverLang, "log-auth-ok", {
        id: this.id,
        user: user.name,
        monitorSuffix,
        version: String(this.protocolVersion ?? "?")
      }), undefined, { userId: user.id, isConnectionLog: true });

      this.state.logger.log("INFO", tl(this.state.serverLang, "log-player-join", {
        user: user.name,
        id: String(user.id),
        monitorSuffix
      }), undefined, { userId: user.id, isConnectionLog: true });

      void this.sendWelcomeExtras(user).catch(() => {});
    } catch (e) {
      const localized = this.localizeError(this.state.serverLang, e instanceof Error ? e : new Error("auth-failed"));
      this.state.logger.log("WARN", tl(this.state.serverLang, "log-auth-failed", { id: this.id, reason: localized }), undefined, { ip: this.remoteIp, isConnectionLog: true });
      await this.trySend({ type: "Authenticate", result: err(localized) });
      
      // 立即刷新发送批量
      await this.stream?.flushSendBatch();
      
      this.panicked = true;
      await this.markLost();
    }
  }

  private async sendSystemChat(content: string): Promise<void> {
    await this.trySend({ type: "Message", message: { type: "Chat", user: 0, content } });
  }

  private async checkAndHandleBan(user: User): Promise<boolean> {
    // 优化：直接读取Set，不需要mutex
    const isBanned = this.state.bannedUsers.has(user.id);
    if (isBanned) {
      await this.sendSystemChat(user.lang.format("user-banned-by-server"));
      return true;
    }
    return false;
  }

  private async getAvailableRoomsText(lang: Language): Promise<string> {
    const now = Date.now();
    
    // 检查缓存（仅在缓存有效时使用）
    if (now - roomListCache.timestamp < ROOM_LIST_CACHE_TTL_MS) {
      const cached = roomListCache.text.get(lang.lang);
      if (cached !== undefined) return cached;
    }
    
    // 优化：不使用mutex，直接读取
    const rooms: Array<{ id: string; count: number; max: number }> = [];
    for (const [id, room] of this.state.rooms) {
      if (String(id).startsWith("_")) continue;
      if (room.locked) continue;
      if (room.state.type !== "SelectChart" && room.state.type !== "Playing") continue;
      const count = room.userIds().length;
      if (count >= room.maxUsers) continue;
      rooms.push({ id: String(id), count, max: room.maxUsers });
    }
    rooms.sort((a, b) => a.id.localeCompare(b.id));

    if (rooms.length === 0) {
      const text = lang.format("chat-roomlist-empty");
      // 不缓存空列表，因为房间可能很快被创建
      return text;
    }

    const joiner = lang.lang === "zh-CN" ? "；" : "; ";
    const items = rooms.map((r) => lang.format("chat-roomlist-item", { id: r.id, count: r.count, max: r.max }));
    const text = items.join(joiner);
    
    // 更新缓存
    if (roomListCache.text.size >= ROOM_LIST_MAX_CACHED_LANGS) {
      // 清理最旧的缓存条目
      const firstKey = roomListCache.text.keys().next().value;
      if (firstKey !== undefined) {
        roomListCache.text.delete(firstKey);
      }
    }
    roomListCache.text.set(lang.lang, text);
    roomListCache.timestamp = now;
    
    return text;
  }

  private async sendWelcomeExtras(user: User): Promise<void> {
    try {
      const lang = user.lang;
      const tip = this.state.config.room_list_tip;
      const hitokoto = await getHitokotoCached(this.state.config.outbound_proxy);

      // 感谢出走大大提供的清屏思路
      let message = "\n".repeat(30)

      message += lang.format("chat-welcome", { userName: user.name, serverName: this.state.serverName }) + "\n"
      message += "=".repeat(73) + "\n"
      message += lang.format("chat-roomlist-title") + "\n"
      message += await this.getAvailableRoomsText(lang) + "\n"
      message += "=".repeat(73) + "\n"
      if (tip) message += tip + "\n"
      if (hitokoto) {
        const fromText = hitokoto.from ? hitokoto.from : lang.format("chat-hitokoto-from-unknown");
        message += `${hitokoto.quote} —— ${fromText}`
      } else {
        message += lang.format("chat-hitokoto-unavailable")
      }
      await this.sendSystemChat(message)
    } catch(e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.state.logger.log("ERROR", errorMsg)
    }
  }

  /**
   * 处理游戏结束，触发回放录制结束和自动上传
   */
  private async handleGameEnd(room: Room): Promise<void> {
    // 结束回放录制
    await this.state.replayRecorder.endRoom(room.id);
    
    // 触发自动上传（如果启用）
    if (this.state.autoUploadCallback && room.chart && room.state.type === "Playing") {
      const chartId = room.chart.id;
      const results = room.state.results;
      
      // 获取房间的文件信息
      const roomFiles = this.state.replayRecorder.listRoomFiles(room.id);
      
      for (const [userId, recordData] of results.entries()) {
        // 查找该用户的回放文件
        const userFile = roomFiles.find(f => f.userId === userId);
        if (userFile) {
          // 触发自动上传（延迟30秒由回调内部处理）
          this.state.autoUploadCallback(userId, chartId, userFile.timestamp, recordData.id);
        }
      }
    }
  }

  private async startReplayRecording(room: Room): Promise<void> {
    if (!this.state.replayEnabled || !room.replayEligible || !room.chart) return;
    const users = room.userIds().map((id) => ({ id, name: this.state.users.get(id)?.name ?? String(id) }));
    await this.state.replayRecorder.startRoom(room.id, room.chart, users);
  }

  private async markLost(): Promise<void> {
    if (this.lost) return;
    this.lost = true;
    clearInterval(this.heartbeatTimer);
    if (this.monitorFlushTimer) {
      clearTimeout(this.monitorFlushTimer);
      this.monitorFlushTimer = null;
    }
    this.flushMonitorBuffers();

    const stream = this.stream;
    if (stream) stream.close();

    const user = this.user;
    let detachedUserSession = false;
    await this.state.mutex.runExclusive(async () => {
      this.state.sessions.delete(this.id);
      if (!user) return;
      if (user.session === this) {
        user.setSession(null);
        detachedUserSession = true;
      }
    });

    const who = user ? tl(this.state.serverLang, "log-disconnect-user", { user: user.name }) : "";
    this.state.logger.log("DEBUG", tl(this.state.serverLang, "log-disconnect", { id: this.id, who }), undefined, { userId: user?.id, isConnectionLog: true });

    if (user && detachedUserSession && !this.preserveRoomOnLost && user.session === null) await this.dangleUser(user);
  }

  async adminDisconnect(opts: { preserveRoom: boolean }): Promise<void> {
    if (opts.preserveRoom) this.preserveRoomOnLost = true;
    await this.markLost();
  }

  private async dangleUser(user: User): Promise<void> {
    const room = user.room;
    if (room && room.state.type === "Playing") {
      logRoomWarn(this.state.logger, this.state.serverLang, room.id, "log-user-disconnect-playing", { user: user.name }, { userId: user.id });
      await this.state.mutex.runExclusive(async () => {
        this.state.users.delete(user.id);
      });
      await this.handleUserLeaveRoom(user, room);
      return;
    }

    // 如果用户被封禁，直接删除而不是等待重连
    // 优化：直接读取Set，不需要mutex
    const isBanned = this.state.bannedUsers.has(user.id);
    if (isBanned) {
      this.state.logger.log("INFO", tl(this.state.serverLang, "log-user-dangle", { user: user.name }), undefined, { userId: user.id });
      const room2 = user.room;
      if (room2) {
        await this.state.mutex.runExclusive(async () => {
          this.state.users.delete(user.id);
        });
        await this.handleUserLeaveRoom(user, room2);
      }
      return;
    }

    this.state.logger.log("INFO", tl(this.state.serverLang, "log-user-dangle", { user: user.name }), undefined, { userId: user.id });
    const token = user.markDangle();
    setTimeout(() => {
      if (!user.isStillDangling(token)) return;
      void (async () => {
        const room2 = user.room;
        if (!room2) return;
        logRoomWarn(this.state.logger, this.state.serverLang, room2.id, "log-user-dangle-timeout-remove", { user: user.name }, { userId: user.id });
        await this.state.mutex.runExclusive(async () => {
          this.state.users.delete(user.id);
        });
        await this.handleUserLeaveRoom(user, room2);
      })();
    }, 10_000);
  }

  private async handleUserLeaveRoom(user: User, room: Room): Promise<void> {
    const shouldDrop = await room.onUserLeave({ user, ...this.makeRoomCallbacks(room) });
    if (shouldDrop) {
      logRoomInfo(this.state.logger, this.state.serverLang, room.id, "log-room-recycled", undefined, { userId: user.id });
      await this.state.mutex.runExclusive(async () => {
        this.state.rooms.delete(room.id);
      });
    } else {
      refreshRoomLiveState(room, this.state.replayEnabled);
    }
  }

  private errToStr<T>(fn: () => Promise<T>): Promise<StringResult<T>> {
    const user = this.user;
    const lang = user?.lang ?? this.state.serverLang;
    return fn().then(ok).catch((e) => err(this.localizeError(lang, e)));
  }

  private async processCreateRoom(user: User, id: string): Promise<Record<never, never>> {
    if (await this.checkAndHandleBan(user)) throw new Error(user.lang.format("user-banned-by-server"));
    if (!this.state.roomCreationEnabled) throw new Error(user.lang.format("room-creation-disabled"));
    if (user.room) throw new Error(user.lang.format("room-already-in-room"));
    const roomId = parseRoomId(id);
    await this.state.mutex.runExclusive(async () => {
      if (this.state.rooms.has(roomId)) throw new Error(user.lang.format("create-id-occupied"));
      const maxUsersRaw = this.state.config.room_max_users;
      const maxUsers =
        typeof maxUsersRaw === "number" && Number.isInteger(maxUsersRaw) ? Math.min(Math.max(maxUsersRaw, 1), 64) : 8;
      const room = new RoomClass({ id: roomId, hostId: user.id, maxUsers, replayEligible: this.state.replayEnabled });
      this.state.rooms.set(roomId, room);
      user.room = room;
    });
    const room = user.room!;
    refreshRoomLiveState(room, this.state.replayEnabled);
    logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-created", { user: user.name }, { userId: user.id });
    await this.broadcastRoomMessage(room, { type: "CreateRoom", user: user.id });
    if (this.state.replayEnabled && room.replayEligible) {
      const fake = this.state.replayRecorder.fakeMonitorInfo();
      // 使用 setImmediate 确保在当前事件循环后执行
      setImmediate(() => {
        void (async () => {
          const me = this.user;
          if (!me) return;
          if (!me.room || me.room.id !== room.id) return;
          await me.trySend({ type: "OnJoinRoom", info: fake });
          await me.trySend({ type: "Message", message: { type: "JoinRoom", user: fake.id, name: fake.name } });
        })();
      });
    }
    return {};
  }

  private async processJoinRoom(user: User, roomIdStr: string, monitor: boolean): Promise<JoinRoomResponse> {
    if (await this.checkAndHandleBan(user)) throw new Error(user.lang.format("user-banned-by-server"));
    if (user.room) throw new Error(user.lang.format("room-already-in-room"));

    const roomId = parseRoomId(roomIdStr);

    // 优化：先检查房间封禁，不需要mutex
    const bannedInRoom = (() => {
      const set = this.state.bannedRoomUsers.get(roomId);
      return set ? set.has(user.id) : false;
    })();
    if (bannedInRoom) throw new Error(user.lang.format("room-banned", { id: String(roomId) }));

    // 优化：获取房间也不需要mutex（读操作）
    const room = this.state.rooms.get(roomId) ?? null;
    if (!room) throw new Error(user.lang.format("room-not-found"));

    room.validateJoin(user, monitor);
    const okJoin = room.addUser(user, monitor);
    if (!okJoin) throw new Error(user.lang.format("join-room-full"));

    user.monitor = monitor;
    user.room = room; // 直接设置，不需要mutex
    room.handleJoin(user);
    refreshRoomLiveState(room, this.state.replayEnabled);

    const suffix = monitor ? tl(this.state.serverLang, "label-monitor-suffix") : "";
    logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-joined", { user: user.name, suffix }, { userId: user.id });
    await this.broadcastRoom(room, { type: "OnJoinRoom", info: user.toInfo() });
    await this.broadcastRoomMessage(room, { type: "JoinRoom", user: user.id, name: user.name });

    const users = [...room.userIds(), ...room.monitorIds()]
      .map((id) => this.state.users.get(id))
      .filter((it): it is User => Boolean(it))
      .map((it) => it.toInfo());

    const resp: JoinRoomResponse = {
      state: room.clientRoomState(),
      users,
      live: room.isLive()
    };

    // 状态同步：如果正在游戏中，先发送 SelectChart 状态让客户端知道当前谱面，再发送 Playing 状态
    if (room.state.type === "Playing" && room.chart) {
      await user.trySend({ type: "ChangeState", state: { type: "SelectChart", id: room.chart.id } });
      await user.trySend({ type: "ChangeState", state: { type: "Playing" } });
    }

    if (this.state.replayEnabled && room.replayEligible) {
      const fake = this.state.replayRecorder.fakeMonitorInfo();
      // 使用 setImmediate 确保在当前事件循环后执行
      setImmediate(() => {
        void (async () => {
          if (!user.room || user.room.id !== room.id) return;
          await user.trySend({ type: "OnJoinRoom", info: fake });
          await user.trySend({ type: "Message", message: { type: "JoinRoom", user: fake.id, name: fake.name } });
        })();
      });
    }

    return resp;
  }

  private async process(cmd: ClientCommand): Promise<ServerCommand | null> {
    const user = this.user;
    if (!user) return null;

    switch (cmd.type) {
      case "Authenticate":
        return { type: "Authenticate", result: err(user.lang.format("auth-repeated-authenticate")) };
      case "Chat":
        return { type: "Chat", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          logRoomInfo(this.state.logger, this.state.serverLang, room.id, "log-user-chat", { user: user.name }, { userId: user.id });
          const content = this.state.config.chat_enabled === false ? tl(this.state.serverLang, "chat-disabled-by-server") : cmd.message;
          await room.sendAs((c) => this.broadcastRoom(room, c), user, content);
          return {};
        }) };
      case "Touches": {
        const room = user.room;
        if (!room) return null;
        if (room.state.type !== "Playing") return null;
        if (room.state.aborted.has(user.id) || room.state.results.has(user.id)) return null;
        const last = cmd.frames.at(-1);
        if (last) user.gameTime = last.time;
        this.state.logger.log("DEBUG", tl(this.state.serverLang, "log-user-touches", { user: user.name, room: room.id, count: String(cmd.frames.length) }), { frames: cmd.frames }, { userId: user.id });
        // monitor数据转发模块 - 聚合缓冲，避免高频实时数据冲击网络
        if (room.monitorIds().length > 0) {
          this.bufferMonitorData("touches", user.id, cmd.frames);
        }
        // 录制回放模块 - 独立判断、独立执行
        if (this.state.replayEnabled && room.replayEligible) {
          this.state.replayRecorder.appendTouches(room.id, user.id, cmd.frames);
        }
        return null;
      }
      case "Judges": {
        const room = user.room;
        if (!room) return null;
        if (room.state.type !== "Playing") return null;
        if (room.state.aborted.has(user.id) || room.state.results.has(user.id)) return null;
        this.state.logger.log("DEBUG", tl(this.state.serverLang, "log-user-judges", { user: user.name, room: room.id, count: String(cmd.judges.length) }), { judges: cmd.judges }, { userId: user.id });
        // monitor数据转发模块 - 聚合缓冲，避免高频实时数据冲击网络
        if (room.monitorIds().length > 0) {
          this.bufferMonitorData("judges", user.id, cmd.judges);
        }
        // 录制回放模块 - 独立判断、独立执行
        if (this.state.replayEnabled && room.replayEligible) {
          this.state.replayRecorder.appendJudges(room.id, user.id, cmd.judges);
        }
        return null;
      }
      case "CreateRoom":
        return { type: "CreateRoom", result: await this.errToStr(async () => this.processCreateRoom(user, cmd.id)) };
      case "JoinRoom":
        return { type: "JoinRoom", result: await this.errToStr(async () => this.processJoinRoom(user, cmd.id, cmd.monitor)) };
      case "LeaveRoom":
        return { type: "LeaveRoom", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          const suffix = user.monitor ? tl(this.state.serverLang, "label-monitor-suffix") : "";
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-left", { user: user.name, suffix }, { userId: user.id });
          const shouldDrop = await room.onUserLeave({
            user,
            ...this.makeRoomCallbacks(room),
            disbandRoom: (r: Room) => this.disbandRoom(r),
          });
          if (shouldDrop) {
            logRoomInfo(this.state.logger, this.state.serverLang, room.id, "log-room-recycled", undefined, { userId: user.id });
            await this.state.mutex.runExclusive(async () => {
              this.state.rooms.delete(room.id);
            });
          } else {
            refreshRoomLiveState(room, this.state.replayEnabled);
          }
          return {};
        }) };
      case "LockRoom":
        return { type: "LockRoom", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          room.checkHost(user);
          room.locked = cmd.lock;
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-lock", { user: user.name, lock: cmd.lock ? "true" : "false" }, { userId: user.id });
          await this.broadcastRoomMessage(room, { type: "LockRoom", lock: cmd.lock });
          return {};
        }) };
      case "CycleRoom":
        return { type: "CycleRoom", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          room.checkHost(user);
          room.cycle = cmd.cycle;
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-cycle", { user: user.name, cycle: cmd.cycle ? "true" : "false" }, { userId: user.id });
          await this.broadcastRoomMessage(room, { type: "CycleRoom", cycle: cmd.cycle });
          return {};
        }) };
      case "SelectChart":
        return { type: "SelectChart", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          room.validateSelectChart(user);
          const chart = await this.fetchChart(user, cmd.id);
          room.chart = chart;
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-select-chart", { user: user.name, userId: String(user.id), chart: chart.name }, { userId: user.id });
          await this.broadcastRoomMessage(room, { type: "SelectChart", user: user.id, name: chart.name, id: chart.id });
          await room.onStateChange((c) => this.broadcastRoom(room, c));
          await room.notifyWebSocket(this.state);
          return {};
        }) };
      case "RequestStart":
        return { type: "RequestStart", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          room.validateStart(user);
          room.resetGameTime((id) => this.state.users.get(id));
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-request-start", { user: user.name }, { userId: user.id });
          await this.broadcastRoomMessage(room, { type: "GameStart", user: user.id });
          room.state = { type: "WaitForReady", started: new Set([user.id]) };
          await room.onStateChange((c) => this.broadcastRoom(room, c));
          await room.notifyWebSocket(this.state);
          await room.checkAllReady({ ...this.makeRoomCallbacks(room), disbandRoom: (r: Room) => this.disbandRoom(r) });
          return {};
        }) };
      case "Ready":
        return { type: "Ready", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "WaitForReady") {
            if (room.state.started.has(user.id)) throw new Error(user.lang.format("room-already-ready"));
            room.state.started.add(user.id);
            logRoomInfo(this.state.logger, this.state.serverLang, room.id, "log-room-ready", { user: user.name }, { userId: user.id });
            await this.broadcastRoomMessage(room, { type: "Ready", user: user.id });
            await room.notifyWebSocket(this.state);
            await this.checkRoomAllReady(room);
          }
          return {};
        }) };
      case "CancelReady":
        return { type: "CancelReady", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "WaitForReady") {
            if (!room.state.started.delete(user.id)) throw new Error(user.lang.format("room-not-ready"));
            if (room.hostId === user.id) {
              logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-cancel-game", { user: user.name }, { userId: user.id });
              await this.broadcastRoomMessage(room, { type: "CancelGame", user: user.id });
              room.state = { type: "SelectChart" };
              await room.onStateChange((c) => this.broadcastRoom(room, c));
              await room.notifyWebSocket(this.state);
            } else {
              logRoomInfo(this.state.logger, this.state.serverLang, room.id, "log-room-cancel-ready", { user: user.name }, { userId: user.id });
              await this.broadcastRoomMessage(room, { type: "CancelReady", user: user.id });
              await room.notifyWebSocket(this.state);
            }
          }
          return {};
        }) };
      case "Played":
        return { type: "Played", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          const record = await this.fetchRecord(user, cmd.id);
          if (record.player !== user.id) throw new Error(user.lang.format("record-invalid"));
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-played", { user: user.name, score: String(record.score), acc: String(record.accuracy) }, { userId: user.id });
          await this.broadcastRoomMessage(room, {
            type: "Played",
            user: user.id,
            score: record.score,
            accuracy: record.accuracy,
            full_combo: record.full_combo
          });
          if (room.state.type === "Playing") {
            if (room.state.aborted.has(user.id)) throw new Error(user.lang.format("room-game-aborted"));
            if (room.state.results.has(user.id)) throw new Error(user.lang.format("record-already-uploaded"));
            room.state.results.set(user.id, record);
            if (this.state.replayEnabled && room.replayEligible) this.state.replayRecorder.setRecordId(room.id, user.id, record.id);
            await room.notifyWebSocket(this.state);
            await this.checkRoomAllReady(room);
          }
          return {};
        }) };
      case "Abort":
        return { type: "Abort", result: await this.errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "Playing") {
            if (room.state.results.has(user.id)) throw new Error(user.lang.format("record-already-uploaded"));
            if (room.state.aborted.has(user.id)) throw new Error(user.lang.format("room-game-aborted"));
            room.state.aborted.add(user.id);
            logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-abort", { user: user.name }, { userId: user.id });
            await this.broadcastRoomMessage(room, { type: "Abort", user: user.id });
            await room.notifyWebSocket(this.state);
            await this.checkRoomAllReady(room);
          }
          return {};
        }) };
      case "Ping":
        return null;
    }
  }

  private requireRoom(user: User): Room {
    const room = user.room;
    if (!room) throw new Error(user.lang.format("room-no-room"));
    return room;
  }

  private async broadcastToIds(ids: number[], cmd: ServerCommand): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const id of ids) {
      const u = this.state.users.get(id);
      if (u) tasks.push(u.trySend(cmd));
    }
    if (tasks.length > 0) await Promise.allSettled(tasks);
  }

  /**
   * 快速广播：fire-and-forget，不等待发送完成
   * 用于实时游戏数据（Touches/Judges），避免慢客户端拖累全场
   */
  private broadcastToIdsFast(ids: number[], cmd: ServerCommand): void {
    for (const id of ids) {
      const u = this.state.users.get(id);
      if (u) void u.trySend(cmd).catch(() => {});
    }
  }

  private broadcastRoom(room: Room, cmd: ServerCommand): Promise<void> {
    return this.broadcastToIds([...room.userIds(), ...room.monitorIds()], cmd);
  }

  /**
   * 观战数据广播：使用 fire-and-forget，避免慢观战客户端拖累实时数据流
   */
  private broadcastRoomMonitors(room: Room, cmd: ServerCommand): void {
    this.broadcastToIdsFast(room.monitorIds(), cmd);
  }

  /**
   * 简化 room.send 调用：自动使用 broadcastRoom 和 state.users.get
   */
  private broadcastRoomMessage(room: Room, msg: Parameters<Room["send"]> [1]): Promise<void> {
    return room.send(
      (c) => this.broadcastRoom(room, c),
      msg,
      (id) => this.state.users.get(id)
    );
  }

  private makeRoomCallbacks(room: Room) {
    return {
      usersById: (id: number) => this.state.users.get(id),
      broadcast: (c: ServerCommand) => this.broadcastRoom(room, c),
      broadcastToMonitors: (c: ServerCommand) => this.broadcastRoomMonitors(room, c),
      pickRandomUserId: (ids: number[]) => pickRandom(ids),
      lang: this.state.serverLang,
      logger: this.state.logger,
      wsService: this.state.wsService,
      onEnterPlaying: async (r: Room) => {
        if (!r.chart) return;
        await this.startReplayRecording(r);
      },
      onGameEnd: async (r: Room) => {
        await this.handleGameEnd(r);
      }
    };
  }

  /**
   * 简化 checkAllReady 调用
   */
  private async checkRoomAllReady(room: Room): Promise<void> {
    await room.checkAllReady({ ...this.makeRoomCallbacks(room), disbandRoom: (r: Room) => this.disbandRoom(r) });
  }

  private async disbandRoom(room: Room): Promise<void> {
    const ids = [...room.userIds(), ...room.monitorIds()];
    for (const id of ids) {
      const u = this.state.users.get(id);
      if (!u) continue;
      if (!u.room || u.room.id !== room.id) continue;
      await room.onUserLeave({ user: u, ...this.makeRoomCallbacks(room) });
    }
    await this.state.mutex.runExclusive(async () => {
      this.state.rooms.delete(room.id);
    });
    logRoomInfo(this.state.logger, this.state.serverLang, room.id, "log-room-recycled", undefined, { userId: this.user?.id });
  }

  private async fetchChart(user: User, id: number): Promise<Chart> {
    // 先尝试从缓存获取
    const cached = await chartCache.get(id);
    if (cached) {
      return cached;
    }

    // 缓存未命中，从远程获取
    const res = await fetchWithRetry(`${this.getPhiraApiEndpoint()}/chart/${id}`, {
      proxy: this.state.config.outbound_proxy
    }, FETCH_TIMEOUT_MS).then(async (r) => {
      if (!r.ok) throw new Error(user.lang.format("chart-fetch-failed"));
      return (await r.json()) as Chart;
    });

    const chart = { id: res.id, name: res.name };

    // 保存到缓存
    await chartCache.set(id, chart);

    return chart;
  }

  private async fetchRecord(user: User, id: number): Promise<RecordData> {
    return await fetchWithRetry(`${this.getPhiraApiEndpoint()}/record/${id}`, {
      proxy: this.state.config.outbound_proxy
    }, FETCH_TIMEOUT_MS).then(async (r) => {
      if (!r.ok) throw new Error(user.lang.format("record-fetch-failed"));
      return (await r.json()) as RecordData;
    });
  }
}
