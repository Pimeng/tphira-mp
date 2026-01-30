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
import { tl, type Language } from "./l10n.js";

const HOST = "https://phira.5wyxi.com";
const FETCH_TIMEOUT_MS = 8000;

const HITOKOTO_URL = "https://v1.hitokoto.cn/";
const HITOKOTO_FETCH_TIMEOUT_MS = 3000;
const HITOKOTO_CACHE_TTL_MS = 60_000;
const HITOKOTO_MIN_INTERVAL_MS = 600;

type HitokotoValue = { quote: string; from: string };

let hitokotoCache: { value: HitokotoValue | null; fetchedAt: number; lastAttemptAt: number; inFlight: Promise<HitokotoValue | null> | null } = {
  value: null,
  fetchedAt: 0,
  lastAttemptAt: 0,
  inFlight: null
};

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("net-request-timeout");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function pickRandom<T>(arr: readonly T[]): T | null {
  if (arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx] ?? null;
}

async function fetchHitokoto(): Promise<HitokotoValue | null> {
  const res = await fetchWithTimeout(HITOKOTO_URL, {}, HITOKOTO_FETCH_TIMEOUT_MS);
  if (!res.ok) return null;
  const json = (await res.json()) as { hitokoto?: unknown; from?: unknown; from_who?: unknown };
  const quote = typeof json.hitokoto === "string" ? json.hitokoto.trim() : "";
  if (!quote) return null;
  const fromWho = typeof json.from_who === "string" ? json.from_who.trim() : "";
  const from = typeof json.from === "string" ? json.from.trim() : "";
  const displayFrom = fromWho || from;
  return { quote, from: displayFrom };
}

async function getHitokotoCached(): Promise<HitokotoValue | null> {
  const now = Date.now();
  if (hitokotoCache.value && now - hitokotoCache.fetchedAt <= HITOKOTO_CACHE_TTL_MS) return hitokotoCache.value;
  if (hitokotoCache.inFlight) return await hitokotoCache.inFlight;
  if (hitokotoCache.value && now - hitokotoCache.lastAttemptAt < HITOKOTO_MIN_INTERVAL_MS) return hitokotoCache.value;

  hitokotoCache.lastAttemptAt = now;
  hitokotoCache.inFlight = (async () => {
    try {
      const v = await fetchHitokoto();
      if (v) {
        hitokotoCache.value = v;
        hitokotoCache.fetchedAt = Date.now();
        return v;
      }
      return hitokotoCache.value;
    } catch {
      return hitokotoCache.value;
    } finally {
      hitokotoCache.inFlight = null;
    }
  })();

  return await hitokotoCache.inFlight;
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
  private preserveRoomOnLost = false;

  private lastRecv = Date.now();
  private heartbeatTimer: NodeJS.Timeout;

  user: User | null = null;

  constructor(opts: { id: string; socket: net.Socket; state: ServerState }) {
    this.id = opts.id;
    this.socket = opts.socket;
    this.state = opts.state;

    this.socket.on("close", () => void this.markLost());
    this.socket.on("error", () => void this.markLost());
    this.socket.on("data", () => {
      this.lastRecv = Date.now();
    });

    this.heartbeatTimer = setInterval(() => {
      if (this.lost) return;
      if (Date.now() - this.lastRecv > HEARTBEAT_DISCONNECT_TIMEOUT_MS) {
        this.state.logger.warn(tl(this.state.serverLang, "log-heartbeat-timeout-disconnect", { id: this.id }), { session: this.id });
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

  private async handleAuthenticate(token: string): Promise<void> {
    try {
      if (token.length !== 32) throw new Error("auth-invalid-token");

      const me = await fetchWithTimeout(`${HOST}/me`, {
        headers: { Authorization: `Bearer ${token}` }
      }, FETCH_TIMEOUT_MS).then(async (r) => {
        if (!r.ok) throw new Error("auth-fetch-me-failed");
        return (await r.json()) as { id: number; name: string; language: string };
      });

      const banned = await this.state.mutex.runExclusive(async () => this.state.bannedUsers.has(me.id));
      if (banned) throw new Error("auth-banned");

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
      const roomState: ClientRoomState | null = user.room ? user.room.clientState(user, (id) => this.state.users.get(id)) : null;
      await this.trySend({ type: "Authenticate", result: ok([user.toInfo(), roomState]) });
      this.waitingForAuthenticate = false;

      const monitorSuffix = user.monitor ? tl(this.state.serverLang, "label-monitor-suffix") : "";
      this.state.logger.debug(tl(this.state.serverLang, "log-auth-ok", {
        id: this.id,
        user: user.name,
        monitorSuffix,
        version: String(this.protocolVersion ?? "?")
      }));
      
      this.state.logger.info(tl(this.state.serverLang, "log-player-join", {
        user: user.name,
        monitorSuffix
      }));

      await this.trySend({
        type: "Message",
        message: {
          type: "Chat",
          user: 0,
          content: user.lang.format("chat-welcome", { userName: user.name, serverName: this.state.serverName })
        }
      });

      void this.sendWelcomeExtras(user).catch(() => {});
    } catch (e) {
      const localized = this.localizeError(this.state.serverLang, e instanceof Error ? e : new Error("auth-failed"));
      this.state.logger.warn(tl(this.state.serverLang, "log-auth-failed", { id: this.id, reason: localized }));
      await this.trySend({ type: "Authenticate", result: err(localized) });
      this.panicked = true;
      await this.markLost();
    }
  }

  private async sendSystemChat(content: string): Promise<void> {
    await this.trySend({ type: "Message", message: { type: "Chat", user: 0, content } });
  }

  private async getAvailableRoomsText(lang: Language): Promise<string> {
    const rooms = await this.state.mutex.runExclusive(async () => {
      const out: Array<{ id: string; count: number; max: number }> = [];
      for (const [id, room] of this.state.rooms) {
        if (String(id).startsWith("_")) continue;
        if (room.locked) continue;
        if (room.state.type !== "SelectChart") continue;
        const count = room.userIds().length;
        if (count >= room.maxUsers) continue;
        out.push({ id: String(id), count, max: room.maxUsers });
      }
      out.sort((a, b) => a.id.localeCompare(b.id));
      return out;
    });

    if (rooms.length === 0) return lang.format("chat-roomlist-empty");

    const joiner = lang.lang === "zh-CN" ? "；" : "; ";
    const items = rooms.map((r) => lang.format("chat-roomlist-item", { id: r.id, count: r.count, max: r.max }));
    return items.join(joiner);
  }

  private async sendWelcomeExtras(user: User): Promise<void> {
    const lang = user.lang;

    await this.sendSystemChat(lang.format("chat-separator"));
    await this.sendSystemChat(lang.format("chat-roomlist-title"));
    await this.sendSystemChat(await this.getAvailableRoomsText(lang));

    const tip = this.state.config.room_list_tip?.trim();
    if (tip) await this.sendSystemChat(tip);

    await this.sendSystemChat(lang.format("chat-separator"));

    const hitokoto = await getHitokotoCached();
    if (hitokoto) {
      const fromText = hitokoto.from ? hitokoto.from : lang.format("chat-hitokoto-from-unknown");
      await this.sendSystemChat(lang.format("chat-hitokoto", { quote: hitokoto.quote, from: fromText }));
    } else {
      await this.sendSystemChat(lang.format("chat-hitokoto-unavailable"));
    }
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
    this.state.logger.debug(tl(this.state.serverLang, "log-disconnect", { id: this.id, who }));

    if (user && detachedUserSession && !this.preserveRoomOnLost && user.session === null) await this.dangleUser(user);
  }

  async adminDisconnect(opts: { preserveRoom: boolean }): Promise<void> {
    if (opts.preserveRoom) this.preserveRoomOnLost = true;
    await this.markLost();
  }

  private async dangleUser(user: User): Promise<void> {
    const room = user.room;
    if (room && room.state.type === "Playing") {
      this.state.logger.warn(tl(this.state.serverLang, "log-user-disconnect-playing", { user: user.name, room: room.id }));
      await this.state.mutex.runExclusive(async () => {
        this.state.users.delete(user.id);
      });
      const shouldDrop = await room.onUserLeave({
        user,
        usersById: (id) => this.state.users.get(id),
        broadcast: (cmd) => this.broadcastRoom(room, cmd),
        broadcastToMonitors: (cmd) => this.broadcastRoomMonitors(room, cmd),
        pickRandomUserId: (ids) => pickRandom(ids),
        lang: this.state.serverLang,
        logger: this.state.logger,
        onEnterPlaying: async (r) => {
          if (!r.chart) return;
          if (this.state.replayEnabled && r.replayEligible) await this.state.replayRecorder.startRoom(r.id, r.chart.id, r.userIds());
        },
        onGameEnd: async (r) => {
          await this.state.replayRecorder.endRoom(r.id);
        }
      });
      if (shouldDrop) {
        this.state.logger.info(tl(this.state.serverLang, "log-room-recycled", { room: room.id }));
        await this.state.mutex.runExclusive(async () => {
          this.state.rooms.delete(room.id);
        });
      }
      return;
    }

    this.state.logger.info(tl(this.state.serverLang, "log-user-dangle", { user: user.name }));
    const token = user.markDangle();
    setTimeout(() => {
      if (!user.isStillDangling(token)) return;
      void (async () => {
        const room2 = user.room;
        if (!room2) return;
        this.state.logger.warn(tl(this.state.serverLang, "log-user-dangle-timeout-remove", { user: user.name, room: room2.id }));
        await this.state.mutex.runExclusive(async () => {
          this.state.users.delete(user.id);
        });
        const shouldDrop = await room2.onUserLeave({
          user,
          usersById: (id) => this.state.users.get(id),
          broadcast: (cmd) => this.broadcastRoom(room2, cmd),
          broadcastToMonitors: (cmd) => this.broadcastRoomMonitors(room2, cmd),
          pickRandomUserId: (ids) => pickRandom(ids),
          lang: this.state.serverLang,
          logger: this.state.logger,
          onEnterPlaying: async (r) => {
            if (!r.chart) return;
            if (this.state.replayEnabled && r.replayEligible) await this.state.replayRecorder.startRoom(r.id, r.chart.id, r.userIds());
          },
          onGameEnd: async (r) => {
            await this.state.replayRecorder.endRoom(r.id);
          }
        });
        if (shouldDrop) {
          this.state.logger.info(tl(this.state.serverLang, "log-room-recycled", { room: room2.id }));
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
      fn().then(ok).catch((e) => err(this.localizeError(user.lang, e)));

    switch (cmd.type) {
      case "Authenticate":
        return { type: "Authenticate", result: err(user.lang.format("auth-repeated-authenticate")) };
      case "Chat":
        return { type: "Chat", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          this.state.logger.info(tl(this.state.serverLang, "log-user-chat", { user: user.name, room: room.id }));
          await room.sendAs((c) => this.broadcastRoom(room, c), user, "为符合规范，该服务器已禁用聊天功能"); // "" --> cmd.message
          return {};
        }) };
      case "Touches": {
        const room = user.room;
        if (!room) return null;
        if (room.state.type !== "Playing") return null;
        const canRecord = this.state.replayEnabled && room.replayEligible;
        const canForward = room.isLive();
        if (!canRecord && !canForward) return null;
        const last = cmd.frames.at(-1);
        if (last) user.gameTime = last.time;
        this.state.logger.info(tl(this.state.serverLang, "log-user-touches", { user: user.name, room: room.id, count: String(cmd.frames.length) }));
        if (canRecord) this.state.replayRecorder.appendTouches(room.id, user.id, cmd.frames);
        if (canForward) void this.broadcastRoomMonitors(room, { type: "Touches", player: user.id, frames: cmd.frames });
        return null;
      }
      case "Judges": {
        const room = user.room;
        if (!room) return null;
        if (room.state.type !== "Playing") return null;
        const canRecord = this.state.replayEnabled && room.replayEligible;
        const canForward = room.isLive();
        if (!canRecord && !canForward) return null;
        this.state.logger.info(tl(this.state.serverLang, "log-user-judges", { user: user.name, room: room.id, count: String(cmd.judges.length) }));
        if (canRecord) this.state.replayRecorder.appendJudges(room.id, user.id, cmd.judges);
        if (canForward) void this.broadcastRoomMonitors(room, { type: "Judges", player: user.id, judges: cmd.judges });
        return null;
      }
      case "CreateRoom":
        return { type: "CreateRoom", result: await errToStr(async () => {
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
          this.state.logger.mark(tl(this.state.serverLang, "log-room-created", { user: user.name, room: room.id }));
          await room.send((c) => this.broadcastRoom(room, c), { type: "CreateRoom", user: user.id });
          if (this.state.replayEnabled && room.replayEligible) {
            room.live = true;
            const fake = this.state.replayRecorder.fakeMonitorInfo();
            setTimeout(() => {
              void (async () => {
                const me = this.user;
                if (!me) return;
                if (!me.room || me.room.id !== room.id) return;
                await me.trySend({ type: "OnJoinRoom", info: fake });
                await me.trySend({ type: "Message", message: { type: "JoinRoom", user: fake.id, name: fake.name } });
              })();
            }, 0);
          }
          return {};
        }) };
      case "JoinRoom":
        return { type: "JoinRoom", result: await errToStr(async () => {
          if (user.room) throw new Error(user.lang.format("room-already-in-room"));

          const bannedInRoom = await this.state.mutex.runExclusive(async () => {
            const set = this.state.bannedRoomUsers.get(cmd.id);
            return set ? set.has(user.id) : false;
          });
          if (bannedInRoom) throw new Error(user.lang.format("room-banned", { id: String(cmd.id) }));

          const room = await this.state.mutex.runExclusive(async () => this.state.rooms.get(cmd.id) ?? null);
          if (!room) throw new Error(user.lang.format("room-not-found"));

          room.validateJoin(user, cmd.monitor);
          const okJoin = room.addUser(user, cmd.monitor);
          if (!okJoin) throw new Error(user.lang.format("join-room-full"));

          user.monitor = cmd.monitor;

          const suffix = cmd.monitor ? tl(this.state.serverLang, "label-monitor-suffix") : "";
          this.state.logger.mark(tl(this.state.serverLang, "log-room-joined", { user: user.name, suffix, room: room.id }));
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

          if (this.state.replayEnabled && room.replayEligible) {
            const fake = this.state.replayRecorder.fakeMonitorInfo();
            setTimeout(() => {
              void (async () => {
                if (!user.room || user.room.id !== room.id) return;
                await user.trySend({ type: "OnJoinRoom", info: fake });
                await user.trySend({ type: "Message", message: { type: "JoinRoom", user: fake.id, name: fake.name } });
              })();
            }, 0);
          }

          return resp;
        }) };
      case "LeaveRoom":
        return { type: "LeaveRoom", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          const suffix = user.monitor ? tl(this.state.serverLang, "label-monitor-suffix") : "";
          this.state.logger.mark(tl(this.state.serverLang, "log-room-left", { user: user.name, suffix, room: room.id }));
          const shouldDrop = await room.onUserLeave({
            user,
            usersById: (id) => this.state.users.get(id),
            broadcast: (c) => this.broadcastRoom(room, c),
            broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
            pickRandomUserId: (ids) => pickRandom(ids),
            lang: this.state.serverLang,
            logger: this.state.logger,
            disbandRoom: (r) => this.disbandRoom(r),
            onEnterPlaying: async (r) => {
              if (!r.chart) return;
              if (this.state.replayEnabled && r.replayEligible) await this.state.replayRecorder.startRoom(r.id, r.chart.id, r.userIds());
            },
            onGameEnd: async (r) => {
              await this.state.replayRecorder.endRoom(r.id);
            }
          });
          if (shouldDrop) {
            this.state.logger.info(tl(this.state.serverLang, "log-room-recycled", { room: room.id }));
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
          this.state.logger.mark(tl(this.state.serverLang, "log-room-lock", { user: user.name, room: room.id, lock: cmd.lock ? "true" : "false" }));
          await room.send((c) => this.broadcastRoom(room, c), { type: "LockRoom", lock: cmd.lock });
          return {};
        }) };
      case "CycleRoom":
        return { type: "CycleRoom", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.checkHost(user);
          room.cycle = cmd.cycle;
          this.state.logger.mark(tl(this.state.serverLang, "log-room-cycle", { user: user.name, room: room.id, cycle: cmd.cycle ? "true" : "false" }));
          await room.send((c) => this.broadcastRoom(room, c), { type: "CycleRoom", cycle: cmd.cycle });
          return {};
        }) };
      case "SelectChart":
        return { type: "SelectChart", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.validateSelectChart(user);
          const chart = await this.fetchChart(user, cmd.id);
          room.chart = chart;
          this.state.logger.mark(tl(this.state.serverLang, "log-room-select-chart", { user: user.name, userId: String(user.id), room: room.id, chart: chart.name }));
          await room.send((c) => this.broadcastRoom(room, c), { type: "SelectChart", user: user.id, name: chart.name, id: chart.id });
          await room.onStateChange((c) => this.broadcastRoom(room, c));
          return {};
        }) };
      case "RequestStart":
        return { type: "RequestStart", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          room.validateStart(user);
          room.resetGameTime((id) => this.state.users.get(id));
          this.state.logger.mark(tl(this.state.serverLang, "log-room-request-start", { user: user.name, room: room.id }));
          await room.send((c) => this.broadcastRoom(room, c), { type: "GameStart", user: user.id });
          room.state = { type: "WaitForReady", started: new Set([user.id]) };
          await room.onStateChange((c) => this.broadcastRoom(room, c));
          await room.checkAllReady({
            usersById: (id) => this.state.users.get(id),
            broadcast: (c) => this.broadcastRoom(room, c),
            broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
            pickRandomUserId: (ids) => pickRandom(ids),
            lang: this.state.serverLang,
            logger: this.state.logger,
            disbandRoom: (r) => this.disbandRoom(r),
            onEnterPlaying: async (r) => {
              if (!r.chart) return;
              if (this.state.replayEnabled && r.replayEligible) await this.state.replayRecorder.startRoom(r.id, r.chart.id, r.userIds());
            },
            onGameEnd: async (r) => {
              await this.state.replayRecorder.endRoom(r.id);
            }
          });
          return {};
        }) };
      case "Ready":
        return { type: "Ready", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "WaitForReady") {
            if (room.state.started.has(user.id)) throw new Error(user.lang.format("room-already-ready"));
            room.state.started.add(user.id);
            this.state.logger.info(tl(this.state.serverLang, "log-room-ready", { user: user.name, room: room.id }));
            await room.send((c) => this.broadcastRoom(room, c), { type: "Ready", user: user.id });
            await room.checkAllReady({
              usersById: (id) => this.state.users.get(id),
              broadcast: (c) => this.broadcastRoom(room, c),
              broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
              pickRandomUserId: (ids) => pickRandom(ids),
              lang: this.state.serverLang,
              logger: this.state.logger,
              disbandRoom: (r) => this.disbandRoom(r),
              onEnterPlaying: async (r) => {
                if (!r.chart) return;
                if (this.state.replayEnabled && r.replayEligible) await this.state.replayRecorder.startRoom(r.id, r.chart.id, r.userIds());
              },
              onGameEnd: async (r) => {
                await this.state.replayRecorder.endRoom(r.id);
              }
            });
          }
          return {};
        }) };
      case "CancelReady":
        return { type: "CancelReady", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          if (room.state.type === "WaitForReady") {
            if (!room.state.started.delete(user.id)) throw new Error(user.lang.format("room-not-ready"));
            if (room.hostId === user.id) {
              this.state.logger.mark(tl(this.state.serverLang, "log-room-cancel-game", { user: user.name, room: room.id }));
              await room.send((c) => this.broadcastRoom(room, c), { type: "CancelGame", user: user.id });
              room.state = { type: "SelectChart" };
              await room.onStateChange((c) => this.broadcastRoom(room, c));
            } else {
              this.state.logger.info(tl(this.state.serverLang, "log-room-cancel-ready", { user: user.name, room: room.id }));
              await room.send((c) => this.broadcastRoom(room, c), { type: "CancelReady", user: user.id });
            }
          }
          return {};
        }) };
      case "Played":
        return { type: "Played", result: await errToStr(async () => {
          const room = this.requireRoom(user);
          const record = await this.fetchRecord(user, cmd.id);
          if (record.player !== user.id) throw new Error(user.lang.format("record-invalid"));
          this.state.logger.mark(tl(this.state.serverLang, "log-room-played", { user: user.name, room: room.id, score: String(record.score), acc: String(record.accuracy) }));
          await room.send((c) => this.broadcastRoom(room, c), {
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
            await room.checkAllReady({
              usersById: (id) => this.state.users.get(id),
              broadcast: (c) => this.broadcastRoom(room, c),
              broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
              pickRandomUserId: (ids) => pickRandom(ids),
              lang: this.state.serverLang,
              logger: this.state.logger,
              disbandRoom: (r) => this.disbandRoom(r),
              onEnterPlaying: async (r) => {
                if (!r.chart) return;
                if (this.state.replayEnabled && r.replayEligible) await this.state.replayRecorder.startRoom(r.id, r.chart.id, r.userIds());
              },
              onGameEnd: async (r) => {
                await this.state.replayRecorder.endRoom(r.id);
              }
            });
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
            this.state.logger.mark(tl(this.state.serverLang, "log-room-abort", { user: user.name, room: room.id }));
            await room.send((c) => this.broadcastRoom(room, c), { type: "Abort", user: user.id });
            await room.checkAllReady({
              usersById: (id) => this.state.users.get(id),
              broadcast: (c) => this.broadcastRoom(room, c),
              broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
              pickRandomUserId: (ids) => pickRandom(ids),
              lang: this.state.serverLang,
              logger: this.state.logger,
              disbandRoom: (r) => this.disbandRoom(r),
              onEnterPlaying: async (r) => {
                if (!r.chart) return;
                if (this.state.replayEnabled && r.replayEligible) await this.state.replayRecorder.startRoom(r.id, r.chart.id, r.userIds());
              },
              onGameEnd: async (r) => {
                await this.state.replayRecorder.endRoom(r.id);
              }
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
    if (!room) throw new Error(user.lang.format("room-no-room"));
    return room;
  }

  private async broadcastRoom(room: Room, cmd: ServerCommand): Promise<void> {
    const ids = [...room.userIds(), ...room.monitorIds()];
    const tasks: Promise<void>[] = [];
    for (const id of ids) {
      const u = this.state.users.get(id);
      if (u) tasks.push(u.trySend(cmd));
    }
    await Promise.allSettled(tasks);
  }

  private async broadcastRoomMonitors(room: Room, cmd: ServerCommand): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const id of room.monitorIds()) {
      const u = this.state.users.get(id);
      if (u) tasks.push(u.trySend(cmd));
    }
    await Promise.allSettled(tasks);
  }

  private async disbandRoom(room: Room): Promise<void> {
    const ids = [...room.userIds(), ...room.monitorIds()];
    for (const id of ids) {
      const u = this.state.users.get(id);
      if (!u) continue;
      if (!u.room || u.room.id !== room.id) continue;
      await room.onUserLeave({
        user: u,
        usersById: (uid) => this.state.users.get(uid),
        broadcast: (c) => this.broadcastRoom(room, c),
        broadcastToMonitors: (c) => this.broadcastRoomMonitors(room, c),
        pickRandomUserId: (arr) => pickRandom(arr),
        lang: this.state.serverLang,
        logger: this.state.logger,
        onEnterPlaying: async (r) => {
          if (!r.chart) return;
          if (this.state.replayEnabled && r.replayEligible) await this.state.replayRecorder.startRoom(r.id, r.chart.id, r.userIds());
        },
        onGameEnd: async (r) => {
          await this.state.replayRecorder.endRoom(r.id);
        }
      });
    }
    await this.state.mutex.runExclusive(async () => {
      this.state.rooms.delete(room.id);
    });
    this.state.logger.info(tl(this.state.serverLang, "log-room-recycled", { room: room.id }));
  }

  private async fetchChart(user: User, id: number): Promise<Chart> {
    const res = await fetchWithTimeout(`${HOST}/chart/${id}`, {}, FETCH_TIMEOUT_MS).then(async (r) => {
      if (!r.ok) throw new Error(user.lang.format("chart-fetch-failed"));
      return (await r.json()) as Chart;
    });
    return { id: res.id, name: res.name };
  }

  private async fetchRecord(user: User, id: number): Promise<RecordData> {
    return await fetchWithTimeout(`${HOST}/record/${id}`, {}, FETCH_TIMEOUT_MS).then(async (r) => {
      if (!r.ok) throw new Error(user.lang.format("record-fetch-failed"));
      return (await r.json()) as RecordData;
    });
  }
}
