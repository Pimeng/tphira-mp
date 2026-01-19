import type net from "node:net";
import { err, ok, type StringResult } from "../common/binary.js";
import type { ClientCommand, ClientRoomState, JoinRoomResponse, ServerCommand } from "../common/commands.js";
import { HEARTBEAT_DISCONNECT_TIMEOUT_MS } from "../common/commands.js";
import { parseRoomId } from "../common/roomId.js";
import type { Stream } from "../common/stream.js";
import type { Room } from "./room.ts";
import { Room as RoomClass } from "./room.js";
import type { ServerState } from "./state.js";
import type { Chart, RecordData } from "./types.js";
import { User } from "./user.js";

const HOST = "https://phira.5wyxi.com";

function pickRandom<T>(arr: readonly T[]): T | null {
  if (arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx] ?? null;
}

export class Session {
  readonly id: string;
  readonly socket: net.Socket;
  readonly state: ServerState;

  private stream: Stream<ServerCommand, ClientCommand> | null = null;
  private protocolVersion: number | null = null;
  private waitingForAuthenticate = true;
  private panicked = false;
  private lost = false;

  private lastRecv = Date.now();
  private heartbeatTimer: NodeJS.Timeout;

  user: User | null = null;

  constructor(opts: { id: string; socket: net.Socket; state: ServerState }) {
    this.id = opts.id;
    this.socket = opts.socket;
    this.state = opts.state;

    this.socket.on("close", () => void this.markLost());
    this.socket.on("error", () => void this.markLost());

    this.heartbeatTimer = setInterval(() => {
      if (this.lost) return;
      if (Date.now() - this.lastRecv > HEARTBEAT_DISCONNECT_TIMEOUT_MS) {
        this.state.logger.warn("心跳超时，准备断开连接", { session: this.id });
        void this.markLost();
      }
    }, 500);
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

  private async handleAuthenticate(token: string): Promise<void> {
    try {
      if (token.length !== 32) throw new Error("invalid token");

      const me = await fetch(`${HOST}/me`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(async (r) => {
        if (!r.ok) throw new Error("failed to fetch info");
        return (await r.json()) as { id: number; name: string; language: string };
      });

      let isReconnect = false;
      const user = await this.state.mutex.runExclusive(async () => {
        const existing = this.state.users.get(me.id);
        if (existing) {
          if (existing.session) {
            throw new Error("该账号已在线，已阻止重复连接");
          }
          isReconnect = true;
          existing.setSession(this);
          return existing;
        }
        const created = new User({ id: me.id, name: me.name, language: me.language, server: this.state });
        created.setSession(this);
        this.state.users.set(me.id, created);
        return created;
      });

      this.user = user;
      const roomState: ClientRoomState | null = user.room ? user.room.clientState(user, (id) => this.state.users.get(id)) : null;
      await this.trySend({ type: "Authenticate", result: ok([user.toInfo(), roomState]) });
      this.waitingForAuthenticate = false;

      const monitorSuffix = user.monitor ? "（观战者）" : "";
      this.state.logger.mark(`连接ID：${this.id}，“${user.name}”${monitorSuffix}认证成功，协议版本：“${this.protocolVersion ?? "?"}”`);

      await this.trySend({
        type: "Message",
        message: {
          type: "Chat",
          user: 0,
          content: `"${user.name}"你好！欢迎来到 ${this.state.serverName} 服务器！`
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed to authenticate";
      this.state.logger.warn(`连接ID：${this.id} 认证失败：${msg}`);
      await this.trySend({ type: "Authenticate", result: err(msg) });
      this.panicked = true;
      await this.markLost();
    }
  }

  private async markLost(): Promise<void> {
    if (this.lost) return;
    this.lost = true;
    clearInterval(this.heartbeatTimer);

    const stream = this.stream;
    if (stream) stream.close();

    const user = this.user;
    await this.state.mutex.runExclusive(async () => {
      this.state.sessions.delete(this.id);
      if (!user) return;
      if (user.session === this) user.setSession(null);
    });

    const who = user ? `，“${user.name}”` : "";
    this.state.logger.mark(`连接断开，连接ID：${this.id}${who}`);

    if (user) await this.dangleUser(user);
  }

  private async dangleUser(user: User): Promise<void> {
    const room = user.room;
    if (room && room.state.type === "Playing") {
      this.state.logger.warn(`“${user.name}” 对局中断线，强制退出房间 “${room.id}”`);
      await this.state.mutex.runExclusive(async () => {
        this.state.users.delete(user.id);
      });
      const shouldDrop = await room.onUserLeave({
        user,
        usersById: (id) => this.state.users.get(id),
        broadcast: (cmd) => this.broadcastRoom(room, cmd),
        broadcastToMonitors: (cmd) => this.broadcastRoomMonitors(room, cmd),
        pickRandomUserId: (ids) => pickRandom(ids),
        logger: this.state.logger
      });
      if (shouldDrop) {
        this.state.logger.info(`房间 “${room.id}” 已回收（无玩家）`);
        await this.state.mutex.runExclusive(async () => {
          this.state.rooms.delete(room.id);
        });
      }
      return;
    }

    this.state.logger.info(`“${user.name}” 断线，进入挂起等待重连`);
    const token = user.markDangle();
    setTimeout(() => {
      if (!user.isStillDangling(token)) return;
      void (async () => {
        const room2 = user.room;
        if (!room2) return;
        this.state.logger.warn(`“${user.name}” 挂起超时，移除用户并退出房间 “${room2.id}”`);
        await this.state.mutex.runExclusive(async () => {
          this.state.users.delete(user.id);
        });
        const shouldDrop = await room2.onUserLeave({
          user,
          usersById: (id) => this.state.users.get(id),
          broadcast: (cmd) => this.broadcastRoom(room2, cmd),
          broadcastToMonitors: (cmd) => this.broadcastRoomMonitors(room2, cmd),
          pickRandomUserId: (ids) => pickRandom(ids),
          logger: this.state.logger
        });
        if (shouldDrop) {
          this.state.logger.info(`房间 “${room2.id}” 已回收（无玩家）`);
          await this.state.mutex.runExclusive(async () => {
            this.state.rooms.delete(room2.id);
          });
        }
      })();
    }, 10_000);
  }

  private async process(cmd: ClientCommand): Promise<ServerCommand | null> {
    const user = this.user;
    if (!user) return null;

    const errToStr = <T>(fn: () => Promise<T>): Promise<StringResult<T>> =>
      fn().then(ok).catch((e) => err(e instanceof Error ? e.message : String(e)));

    switch (cmd.type) {
      case "Authenticate":
        return { type: "Authenticate", result: err("repeated authenticate") };
      case "Chat":
        return { type: "Chat", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          this.state.logger.info(`“${user.name}” 在房间 “${room.id}” 发送聊天消息`);
          await room.sendAs((c) => this.broadcastRoom(room, c), user, cmd.message);
          return {};
        }) };
      case "Touches": {
        const room = user.room;
        if (!room) return null;
        if (!room.isLive()) return null;
        const last = cmd.frames.at(-1);
        if (last) user.gameTime = last.time;
        this.state.logger.info(`“${user.name}” 在房间 “${room.id}” 上报触控帧 ${cmd.frames.length} 条`);
        void this.broadcastRoomMonitors(room, { type: "Touches", player: user.id, frames: cmd.frames });
        return null;
      }
      case "Judges": {
        const room = user.room;
        if (!room) return null;
        if (!room.isLive()) return null;
        this.state.logger.info(`“${user.name}” 在房间 “${room.id}” 上报判定事件 ${cmd.judges.length} 条`);
        void this.broadcastRoomMonitors(room, { type: "Judges", player: user.id, judges: cmd.judges });
        return null;
      }
      case "CreateRoom":
        return { type: "CreateRoom", result: await errToStr(async () => {
          if (user.room) throw new Error("already in room");
          const id = cmd.id;
          await this.state.mutex.runExclusive(async () => {
            if (this.state.rooms.has(id)) throw new Error(user.lang.format("create-id-occupied"));
            const maxUsersRaw = this.state.config.room_max_users;
            const maxUsers =
              typeof maxUsersRaw === "number" && Number.isInteger(maxUsersRaw) ? Math.min(Math.max(maxUsersRaw, 1), 64) : 8;
            const room = new RoomClass({ id, hostId: user.id, maxUsers });
            this.state.rooms.set(id, room);
            user.room = room;
          });
          const room = user.room!;
          this.state.logger.mark(`“${user.name}” 创建房间 “${room.id}”`);
          await room.send((c) => this.broadcastRoom(room, c), { type: "CreateRoom", user: user.id });
          return {};
        }) };
      case "JoinRoom":
        return { type: "JoinRoom", result: await errToStr(async () => {
          if (user.room) throw new Error("already in room");

          const room = await this.state.mutex.runExclusive(async () => this.state.rooms.get(cmd.id) ?? null);
          if (!room) throw new Error("room not found");

          room.validateJoin(user, cmd.monitor);
          const okJoin = room.addUser(user, cmd.monitor);
          if (!okJoin) throw new Error(user.lang.format("join-room-full"));

          user.monitor = cmd.monitor;
          if (cmd.monitor && !room.live) room.live = true;

          const suffix = cmd.monitor ? "（观战者）" : "";
          this.state.logger.mark(`“${user.name}”${suffix} 加入房间 “${room.id}”`);
          await this.broadcastRoom(room, { type: "OnJoinRoom", info: user.toInfo() });
          await room.send((c) => this.broadcastRoom(room, c), { type: "JoinRoom", user: user.id, name: user.name });

          await this.state.mutex.runExclusive(async () => {
            user.room = room;
          });

          const users = [...room.userIds(), ...room.monitorIds()]
            .map((id) => this.state.users.get(id))
            .filter((it): it is User => Boolean(it))
            .map((it) => it.toInfo());

          const resp: JoinRoomResponse = {
            state: room.clientRoomState(),
            users,
            live: room.isLive()
          };
          return resp;
        }) };
      case "LeaveRoom":
        return { type: "LeaveRoom", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          const suffix = user.monitor ? "（观战者）" : "";
          this.state.logger.mark(`“${user.name}”${suffix} 离开房间 “${room.id}”`);
          const shouldDrop = await room.onUserLeave({
            user,
            usersById: (id) => this.state.users.get(id),
            broadcast: (c) => this.broadcastRoom(room, c),
            broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
            pickRandomUserId: (ids) => pickRandom(ids),
            logger: this.state.logger
          });
          if (shouldDrop) {
            this.state.logger.info(`房间 “${room.id}” 已回收（无玩家）`);
            await this.state.mutex.runExclusive(async () => {
              this.state.rooms.delete(room.id);
            });
          }
          return {};
        }) };
      case "LockRoom":
        return { type: "LockRoom", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.checkHost(user);
          room.locked = cmd.lock;
          this.state.logger.mark(`“${user.name}” 将房间 “${room.id}” ${cmd.lock ? "设为锁定" : "取消锁定"}`);
          await room.send((c) => this.broadcastRoom(room, c), { type: "LockRoom", lock: cmd.lock });
          return {};
        }) };
      case "CycleRoom":
        return { type: "CycleRoom", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.checkHost(user);
          room.cycle = cmd.cycle;
          this.state.logger.mark(`“${user.name}” 将房间 “${room.id}” ${cmd.cycle ? "开启轮转房主" : "关闭轮转房主"}`);
          await room.send((c) => this.broadcastRoom(room, c), { type: "CycleRoom", cycle: cmd.cycle });
          return {};
        }) };
      case "SelectChart":
        return { type: "SelectChart", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.validateSelectChart(user);
          const chart = await this.fetchChart(cmd.id);
          room.chart = chart;
          this.state.logger.mark(`“${user.name}”（用户ID：${user.id}）在房间 “${room.id}” 选择了 “${chart.name}”`);
          await room.send((c) => this.broadcastRoom(room, c), { type: "SelectChart", user: user.id, name: chart.name, id: chart.id });
          await room.onStateChange((c) => this.broadcastRoom(room, c));
          return {};
        }) };
      case "RequestStart":
        return { type: "RequestStart", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.validateStart(user);
          room.resetGameTime((id) => this.state.users.get(id));
          this.state.logger.mark(`“${user.name}” 在房间 “${room.id}” 请求开始对局`);
          await room.send((c) => this.broadcastRoom(room, c), { type: "GameStart", user: user.id });
          room.state = { type: "WaitForReady", started: new Set([user.id]) };
          await room.onStateChange((c) => this.broadcastRoom(room, c));
          await room.checkAllReady({
            usersById: (id) => this.state.users.get(id),
            broadcast: (c) => this.broadcastRoom(room, c),
            broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
            pickRandomUserId: (ids) => pickRandom(ids),
            logger: this.state.logger
          });
          return {};
        }) };
      case "Ready":
        return { type: "Ready", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "WaitForReady") {
            if (room.state.started.has(user.id)) throw new Error("already ready");
            room.state.started.add(user.id);
            this.state.logger.info(`“${user.name}” 在房间 “${room.id}” 已准备`);
            await room.send((c) => this.broadcastRoom(room, c), { type: "Ready", user: user.id });
            await room.checkAllReady({
              usersById: (id) => this.state.users.get(id),
              broadcast: (c) => this.broadcastRoom(room, c),
              broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
              pickRandomUserId: (ids) => pickRandom(ids),
              logger: this.state.logger
            });
          }
          return {};
        }) };
      case "CancelReady":
        return { type: "CancelReady", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "WaitForReady") {
            if (!room.state.started.delete(user.id)) throw new Error("not ready");
            if (room.hostId === user.id) {
              this.state.logger.mark(`“${user.name}” 在房间 “${room.id}” 取消了对局`);
              await room.send((c) => this.broadcastRoom(room, c), { type: "CancelGame", user: user.id });
              room.state = { type: "SelectChart" };
              await room.onStateChange((c) => this.broadcastRoom(room, c));
            } else {
              this.state.logger.info(`“${user.name}” 在房间 “${room.id}” 取消准备`);
              await room.send((c) => this.broadcastRoom(room, c), { type: "CancelReady", user: user.id });
            }
          }
          return {};
        }) };
      case "Played":
        return { type: "Played", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          const record = await this.fetchRecord(cmd.id);
          if (record.player !== user.id) throw new Error("invalid record");
          this.state.logger.mark(`“${user.name}” 在房间 “${room.id}” 完成游玩并上传记录（分数：${record.score}，Acc：${record.accuracy}）`);
          await room.send((c) => this.broadcastRoom(room, c), {
            type: "Played",
            user: user.id,
            score: record.score,
            accuracy: record.accuracy,
            full_combo: record.full_combo
          });
          if (room.state.type === "Playing") {
            if (room.state.aborted.has(user.id)) throw new Error("aborted");
            if (room.state.results.has(user.id)) throw new Error("already uploaded");
            room.state.results.set(user.id, record);
            await room.checkAllReady({
              usersById: (id) => this.state.users.get(id),
              broadcast: (c) => this.broadcastRoom(room, c),
              broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
              pickRandomUserId: (ids) => pickRandom(ids),
              logger: this.state.logger
            });
          }
          return {};
        }) };
      case "Abort":
        return { type: "Abort", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "Playing") {
            if (room.state.results.has(user.id)) throw new Error("already uploaded");
            if (room.state.aborted.has(user.id)) throw new Error("aborted");
            room.state.aborted.add(user.id);
            this.state.logger.mark(`“${user.name}” 在房间 “${room.id}” 中止了对局`);
            await room.send((c) => this.broadcastRoom(room, c), { type: "Abort", user: user.id });
            await room.checkAllReady({
              usersById: (id) => this.state.users.get(id),
              broadcast: (c) => this.broadcastRoom(room, c),
              broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
              pickRandomUserId: (ids) => pickRandom(ids),
              logger: this.state.logger
            });
          }
          return {};
        }) };
      case "Ping":
        return null;
    }
  }

  private requireRoom(user: User): Room {
    const room = user.room;
    if (!room) throw new Error("no room");
    return room;
  }

  private async broadcastRoom(room: Room, cmd: ServerCommand): Promise<void> {
    const ids = [...room.userIds(), ...room.monitorIds()];
    for (const id of ids) {
      const u = this.state.users.get(id);
      if (u) await u.trySend(cmd);
    }
  }

  private async broadcastRoomMonitors(room: Room, cmd: ServerCommand): Promise<void> {
    for (const id of room.monitorIds()) {
      const u = this.state.users.get(id);
      if (u) await u.trySend(cmd);
    }
  }

  private async fetchChart(id: number): Promise<Chart> {
    const res = await fetch(`${HOST}/chart/${id}`).then(async (r) => {
      if (!r.ok) throw new Error("failed to fetch chart");
      return (await r.json()) as Chart;
    });
    return { id: res.id, name: res.name };
  }

  private async fetchRecord(id: number): Promise<RecordData> {
    return await fetch(`${HOST}/record/${id}`).then(async (r) => {
      if (!r.ok) throw new Error("failed to fetch record");
      return (await r.json()) as RecordData;
    });
  }
}
