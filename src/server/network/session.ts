import type net from "node:net";
import { err, ok, type StringResult } from "../../common/binary.js";
import type { ClientCommand, ClientRoomState, JoinRoomResponse, ServerCommand } from "../../common/commands.js";
import { HEARTBEAT_DISCONNECT_TIMEOUT_MS } from "../../common/commands.js";
import type { Stream } from "../../common/stream.js";
import { fetchWithRetry } from "../../common/http.js";
import type { Room } from "../game/room.js";
import { Room as RoomClass } from "../game/room.js";
import { refreshRoomLive as refreshRoomLiveState } from "../game/roomUtils.js";
import type { ServerState } from "../core/state.js";
import type { Chart, RecordData } from "../core/types.js";
import { User } from "../game/user.js";
import { tl, type Language } from "../utils/l10n.js";
import { chartCache } from "../utils/cache.js";
import { getHitokotoCached } from "../utils/hitokotoCache.js";
import { logRoomInfo, logRoomMark, logRoomWarn } from "../utils/logUtils.js";

const DEFAULT_PHIRA_API_ENDPOINT = "https://phira.5wyxi.com";
const FETCH_TIMEOUT_MS = 8000;

// 房间列表缓存
type RoomListCache = {
  text: Map<string, string>; // lang -> text
  timestamp: number;
};

let roomListCache: RoomListCache = {
  text: new Map(),
  timestamp: 0
};

const ROOM_LIST_CACHE_TTL_MS = 2000; // 2秒缓存

function pickRandom<T>(arr: readonly T[]): T | null {
  if (arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx] ?? null;
}

export class Session {
  readonly id: string;
  readonly socket: net.Socket;
  readonly state: ServerState;
  readonly remoteIp: string;

  private stream: Stream<ServerCommand, ClientCommand> | null = null;
  private protocolVersion: number | null = null;
  private waitingForAuthenticate = true;
  private panicked = false;
  private lost = false;
  private preserveRoomOnLost = false;

  private lastRecv = Date.now();
  private heartbeatTimer: NodeJS.Timeout;

  user: User | null = null;

  constructor(opts: { id: string; socket: net.Socket; state: ServerState; remoteIp?: string }) {
    this.id = opts.id;
    this.socket = opts.socket;
    this.state = opts.state;
    this.remoteIp = opts.remoteIp ?? opts.socket.remoteAddress ?? "unknown";

    this.socket.on("close", () => void this.markLost());
    this.socket.on("error", () => void this.markLost());
    this.socket.on("data", () => {
      this.lastRecv = Date.now();
    });

    this.heartbeatTimer = setInterval(() => {
      if (this.lost) return;
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
    } catch {
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
        return (await r.json()) as { id: number; name: string; language: string };
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
      if (room.state.type !== "SelectChart") continue;
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

  private async process(cmd: ClientCommand): Promise<ServerCommand | null> {
    const user = this.user;
    if (!user) return null;

    const errToStr = <T>(fn: () => Promise<T>): Promise<StringResult<T>> =>
      fn().then(ok).catch((e) => err(this.localizeError(user.lang, e)));

    switch (cmd.type) {
      case "Authenticate":
        return { type: "Authenticate", result: err(user.lang.format("auth-repeated-authenticate")) };
      case "Chat":
        return { type: "Chat", result: await errToStr(async () => {
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
        const last = cmd.frames.at(-1);
        if (last) user.gameTime = last.time;
        this.state.logger.log("DEBUG", tl(this.state.serverLang, "log-user-touches", { user: user.name, room: room.id, count: String(cmd.frames.length) }), { frames: cmd.frames }, { userId: user.id });
        // monitor数据转发模块 - 独立判断、独立执行
        if (room.monitorIds().length > 0) {
          void this.broadcastRoomMonitors(room, { type: "Touches", player: user.id, frames: cmd.frames });
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
        this.state.logger.log("DEBUG", tl(this.state.serverLang, "log-user-judges", { user: user.name, room: room.id, count: String(cmd.judges.length) }), { judges: cmd.judges }, { userId: user.id });
        // monitor数据转发模块 - 独立判断、独立执行
        if (room.monitorIds().length > 0) {
          void this.broadcastRoomMonitors(room, { type: "Judges", player: user.id, judges: cmd.judges });
        }
        // 录制回放模块 - 独立判断、独立执行
        if (this.state.replayEnabled && room.replayEligible) {
          this.state.replayRecorder.appendJudges(room.id, user.id, cmd.judges);
        }
        return null;
      }
      case "CreateRoom":
        return { type: "CreateRoom", result: await errToStr(async () => {
          if (await this.checkAndHandleBan(user)) throw new Error(user.lang.format("user-banned-by-server"));
          if (!this.state.roomCreationEnabled) throw new Error(user.lang.format("room-creation-disabled"));
          if (user.room) throw new Error(user.lang.format("room-already-in-room"));
          const id = cmd.id;
          await this.state.mutex.runExclusive(async () => {
            if (this.state.rooms.has(id)) throw new Error(user.lang.format("create-id-occupied"));
            const maxUsersRaw = this.state.config.room_max_users;
            const maxUsers =
              typeof maxUsersRaw === "number" && Number.isInteger(maxUsersRaw) ? Math.min(Math.max(maxUsersRaw, 1), 64) : 8;
            const room = new RoomClass({ id, hostId: user.id, maxUsers, replayEligible: this.state.replayEnabled });
            this.state.rooms.set(id, room);
            user.room = room;
          });
          const room = user.room!;
          refreshRoomLiveState(room, this.state.replayEnabled);
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-created", { user: user.name }, { userId: user.id });
          await room.send((c) => this.broadcastRoom(room, c), { type: "CreateRoom", user: user.id }, (id) => this.state.users.get(id));
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
        }) };
      case "JoinRoom":
        return { type: "JoinRoom", result: await errToStr(async () => {
          if (await this.checkAndHandleBan(user)) throw new Error(user.lang.format("user-banned-by-server"));
          if (user.room) throw new Error(user.lang.format("room-already-in-room"));

          // 优化：先检查房间封禁，不需要mutex
          const bannedInRoom = (() => {
            const set = this.state.bannedRoomUsers.get(cmd.id);
            return set ? set.has(user.id) : false;
          })();
          if (bannedInRoom) throw new Error(user.lang.format("room-banned", { id: String(cmd.id) }));

          // 优化：获取房间也不需要mutex（读操作）
          const room = this.state.rooms.get(cmd.id) ?? null;
          if (!room) throw new Error(user.lang.format("room-not-found"));

          room.validateJoin(user, cmd.monitor);
          const okJoin = room.addUser(user, cmd.monitor);
          if (!okJoin) throw new Error(user.lang.format("join-room-full"));

          user.monitor = cmd.monitor;
          user.room = room; // 直接设置，不需要mutex
          refreshRoomLiveState(room, this.state.replayEnabled);

          const suffix = cmd.monitor ? tl(this.state.serverLang, "label-monitor-suffix") : "";
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-joined", { user: user.name, suffix }, { userId: user.id });
          await this.broadcastRoom(room, { type: "OnJoinRoom", info: user.toInfo() });
          await room.send((c) => this.broadcastRoom(room, c), { type: "JoinRoom", user: user.id, name: user.name }, (id) => this.state.users.get(id));

          const users = [...room.userIds(), ...room.monitorIds()]
            .map((id) => this.state.users.get(id))
            .filter((it): it is User => Boolean(it))
            .map((it) => it.toInfo());

          const resp: JoinRoomResponse = {
            state: room.clientRoomState(),
            users,
            live: room.isLive()
          };

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
        }) };
      case "LeaveRoom":
        return { type: "LeaveRoom", result: await errToStr(async () => {
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
        return { type: "LockRoom", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.checkHost(user);
          room.locked = cmd.lock;
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-lock", { user: user.name, lock: cmd.lock ? "true" : "false" }, { userId: user.id });
          await room.send((c) => this.broadcastRoom(room, c), { type: "LockRoom", lock: cmd.lock }, (id) => this.state.users.get(id));
          return {};
        }) };
      case "CycleRoom":
        return { type: "CycleRoom", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.checkHost(user);
          room.cycle = cmd.cycle;
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-cycle", { user: user.name, cycle: cmd.cycle ? "true" : "false" }, { userId: user.id });
          await room.send((c) => this.broadcastRoom(room, c), { type: "CycleRoom", cycle: cmd.cycle }, (id) => this.state.users.get(id));
          return {};
        }) };
      case "SelectChart":
        return { type: "SelectChart", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.validateSelectChart(user);
          const chart = await this.fetchChart(user, cmd.id);
          room.chart = chart;
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-select-chart", { user: user.name, userId: String(user.id), chart: chart.name }, { userId: user.id });
          await room.send((c) => this.broadcastRoom(room, c), { type: "SelectChart", user: user.id, name: chart.name, id: chart.id }, (id) => this.state.users.get(id));
          await room.onStateChange((c) => this.broadcastRoom(room, c));
          await room.notifyWebSocket(this.state);
          return {};
        }) };
      case "RequestStart":
        return { type: "RequestStart", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.validateStart(user);
          room.resetGameTime((id) => this.state.users.get(id));
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-request-start", { user: user.name }, { userId: user.id });
          await room.send((c) => this.broadcastRoom(room, c), { type: "GameStart", user: user.id }, (id) => this.state.users.get(id));
          room.state = { type: "WaitForReady", started: new Set([user.id]) };
          await room.onStateChange((c) => this.broadcastRoom(room, c));
          await room.notifyWebSocket(this.state);
          await room.checkAllReady({ ...this.makeRoomCallbacks(room), disbandRoom: (r: Room) => this.disbandRoom(r) });
          return {};
        }) };
      case "Ready":
        return { type: "Ready", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "WaitForReady") {
            if (room.state.started.has(user.id)) throw new Error(user.lang.format("room-already-ready"));
            room.state.started.add(user.id);
            logRoomInfo(this.state.logger, this.state.serverLang, room.id, "log-room-ready", { user: user.name }, { userId: user.id });
            await room.send((c) => this.broadcastRoom(room, c), { type: "Ready", user: user.id }, (id) => this.state.users.get(id));
            await room.notifyWebSocket(this.state);
            await room.checkAllReady({ ...this.makeRoomCallbacks(room), disbandRoom: (r: Room) => this.disbandRoom(r) });
          }
          return {};
        }) };
      case "CancelReady":
        return { type: "CancelReady", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "WaitForReady") {
            if (!room.state.started.delete(user.id)) throw new Error(user.lang.format("room-not-ready"));
            if (room.hostId === user.id) {
              logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-cancel-game", { user: user.name }, { userId: user.id });
              await room.send((c) => this.broadcastRoom(room, c), { type: "CancelGame", user: user.id }, (id) => this.state.users.get(id));
              room.state = { type: "SelectChart" };
              await room.onStateChange((c) => this.broadcastRoom(room, c));
              await room.notifyWebSocket(this.state);
            } else {
              logRoomInfo(this.state.logger, this.state.serverLang, room.id, "log-room-cancel-ready", { user: user.name }, { userId: user.id });
              await room.send((c) => this.broadcastRoom(room, c), { type: "CancelReady", user: user.id }, (id) => this.state.users.get(id));
              await room.notifyWebSocket(this.state);
            }
          }
          return {};
        }) };
      case "Played":
        return { type: "Played", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          const record = await this.fetchRecord(user, cmd.id);
          if (record.player !== user.id) throw new Error(user.lang.format("record-invalid"));
          logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-played", { user: user.name, score: String(record.score), acc: String(record.accuracy) }, { userId: user.id });
          await room.send((c) => this.broadcastRoom(room, c), {
            type: "Played",
            user: user.id,
            score: record.score,
            accuracy: record.accuracy,
            full_combo: record.full_combo
          }, (id) => this.state.users.get(id));
          if (room.state.type === "Playing") {
            if (room.state.aborted.has(user.id)) throw new Error(user.lang.format("room-game-aborted"));
            if (room.state.results.has(user.id)) throw new Error(user.lang.format("record-already-uploaded"));
            room.state.results.set(user.id, record);
            if (this.state.replayEnabled && room.replayEligible) this.state.replayRecorder.setRecordId(room.id, user.id, record.id);
            await room.notifyWebSocket(this.state);
            await room.checkAllReady({ ...this.makeRoomCallbacks(room), disbandRoom: (r: Room) => this.disbandRoom(r) });
          }
          return {};
        }) };
      case "Abort":
        return { type: "Abort", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "Playing") {
            if (room.state.results.has(user.id)) throw new Error(user.lang.format("record-already-uploaded"));
            if (room.state.aborted.has(user.id)) throw new Error(user.lang.format("room-game-aborted"));
            room.state.aborted.add(user.id);
            logRoomMark(this.state.logger, this.state.serverLang, room.id, "log-room-abort", { user: user.name }, { userId: user.id });
            await room.send((c) => this.broadcastRoom(room, c), { type: "Abort", user: user.id }, (id) => this.state.users.get(id));
            await room.notifyWebSocket(this.state);
            await room.checkAllReady({ ...this.makeRoomCallbacks(room), disbandRoom: (r: Room) => this.disbandRoom(r) });
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

  private broadcastRoom(room: Room, cmd: ServerCommand): Promise<void> {
    return this.broadcastToIds([...room.userIds(), ...room.monitorIds()], cmd);
  }

  private broadcastRoomMonitors(room: Room, cmd: ServerCommand): Promise<void> {
    return this.broadcastToIds(room.monitorIds(), cmd);
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
