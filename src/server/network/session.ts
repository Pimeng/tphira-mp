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
import type { ClientCommand, ClientRoomState, JoinRoomResponse, ServerCommand } from "../../common/commands.js";
import { HEARTBEAT_DISCONNECT_TIMEOUT_MS } from "../../common/commands.js";
import type { Stream } from "../../common/stream.js";
import type { Room } from "../game/room.js";
import { Room as RoomClass } from "../game/room.js";
import { parseRoomId } from "../../common/roomId.js";
import { refreshRoomLive as refreshRoomLiveState } from "../game/roomUtils.js";
import type { ServerState } from "../core/state.js";
import type { Chart, RecordData } from "../core/types.js";
import { User } from "../game/user.js";
import { tl, type Language } from "../utils/l10n.js";
import { chartCache } from "../utils/cache.js";
import { logRoomInfo, logRoomMark, logRoomWarn } from "../utils/logUtils.js";
import { MonitorBuffer } from "./session/monitorBuffer.js";
import {
  DEFAULT_PHIRA_API_ENDPOINT,
  FETCH_TIMEOUT_MS,
  fetchPhiraChart,
  fetchPhiraRecord,
  fetchPhiraUserInfo
} from "./session/phiraApiClient.js";
import { sendWelcomeExtras } from "./session/welcomeMessage.js";
import { processClientCommand, type RoomCallbacks } from "./session/commandRouter.js";

/** 观战数据聚合间隔（毫秒） */
const MONITOR_FLUSH_INTERVAL_MS = 50;

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
   * 观战数据聚合缓冲
   *
   * 为避免高频实时数据直接冲击网络，将多个事件帧聚合后批量发送给观战者。
   * 见 ./session/monitorBuffer.ts。
   */
  private readonly monitorBuffer: MonitorBuffer;

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

    this.monitorBuffer = new MonitorBuffer({
      flushIntervalMs: MONITOR_FLUSH_INTERVAL_MS,
      getMonitorIds: () => {
        const room = this.user?.room;
        return room ? room.monitorIds() : null;
      },
      broadcastFast: (ids, cmd) => this.broadcastToIdsFast(ids, cmd)
    });

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
      const me = await fetchPhiraUserInfo({
        endpoint: this.getPhiraApiEndpoint(),
        token,
        proxy: this.state.config.outbound_proxy
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

      void sendWelcomeExtras({
        user,
        state: this.state,
        sendSystemChat: (content) => this.sendSystemChat(content)
      }).catch(() => {});
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

    // 清理已完成回放文件记录，防止已解散房间的元数据泄漏
    this.state.replayRecorder.clearRoomFiles(room.id);
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
    this.monitorBuffer.destroy();

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
      await this.state.mutex.runExclusive(async () => {
        this.state.users.delete(user.id);
      });
      if (room2) {
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
        if (!room2) {
          // 用户已不在房间，直接从状态管理中移除
          await this.state.mutex.runExclusive(async () => {
            this.state.users.delete(user.id);
          });
          return;
        }
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
    return processClientCommand(
      {
        state: this.state,
        user,
        errToStr: (fn) => this.errToStr(fn),
        requireRoom: (u) => this.requireRoom(u),
        broadcastRoom: (room, c) => this.broadcastRoom(room, c),
        broadcastRoomMessage: (room, msg) => this.broadcastRoomMessage(room, msg),
        monitorBuffer: this.monitorBuffer,
        processCreateRoom: (u, id) => this.processCreateRoom(u, id),
        processJoinRoom: (u, id, m) => this.processJoinRoom(u, id, m),
        disbandRoom: (room) => this.disbandRoom(room),
        checkRoomAllReady: (room) => this.checkRoomAllReady(room),
        fetchChart: (u, id) => this.fetchChart(u, id),
        fetchRecord: (u, id) => this.fetchRecord(u, id),
        makeRoomCallbacks: (room) => this.makeRoomCallbacks(room)
      },
      cmd
    );
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

  private makeRoomCallbacks(room: Room): RoomCallbacks {
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
    if (cached) return cached;

    // 缓存未命中，从远程获取并写回缓存
    const chart = await fetchPhiraChart({
      endpoint: this.getPhiraApiEndpoint(),
      id,
      proxy: this.state.config.outbound_proxy,
      errorFactory: () => new Error(user.lang.format("chart-fetch-failed"))
    });
    await chartCache.set(id, chart);
    return chart;
  }

  private async fetchRecord(user: User, id: number): Promise<RecordData> {
    return fetchPhiraRecord({
      endpoint: this.getPhiraApiEndpoint(),
      id,
      proxy: this.state.config.outbound_proxy,
      errorFactory: () => new Error(user.lang.format("record-fetch-failed"))
    });
  }
}
