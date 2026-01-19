import net from "node:net";
import { decodePacket, encodePacket, type StringResult } from "../common/binary.js";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  type ClientCommand,
  type ClientRoomState,
  type JoinRoomResponse,
  type Message,
  type RoomState,
  type ServerCommand,
  type TouchFrame,
  type JudgeEvent,
  type UserInfo,
  decodeServerCommand,
  encodeClientCommand
} from "../common/commands.js";
import { Stream, type StreamCodec } from "../common/stream.js";
import { parseRoomId, type RoomId } from "../common/roomId.js";

type Pending<T> = {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

type RCallback<T> = Pending<StringResult<T>> | null;

export type LivePlayer = {
  touch_frames: TouchFrame[];
  judge_events: JudgeEvent[];
};

export type ClientOptions = {
  timeoutMs?: number;
};

const codec: StreamCodec<ClientCommand, ServerCommand> = {
  encodeSend: (payload) => encodePacket(payload, encodeClientCommand),
  decodeRecv: (payload) => decodePacket(payload, decodeServerCommand)
};

export class Client {
  private readonly timeoutMs: number;
  private stream: Stream<ClientCommand, ServerCommand> | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastPingAt: number | null = null;

  private pongWaiter: Pending<void> | null = null;

  private cbAuthenticate: RCallback<[UserInfo, ClientRoomState | null]> = null;
  private cbChat: RCallback<Record<never, never>> = null;
  private cbCreateRoom: RCallback<Record<never, never>> = null;
  private cbJoinRoom: RCallback<JoinRoomResponse> = null;
  private cbLeaveRoom: RCallback<Record<never, never>> = null;
  private cbLockRoom: RCallback<Record<never, never>> = null;
  private cbCycleRoom: RCallback<Record<never, never>> = null;
  private cbSelectChart: RCallback<Record<never, never>> = null;
  private cbRequestStart: RCallback<Record<never, never>> = null;
  private cbReady: RCallback<Record<never, never>> = null;
  private cbCancelReady: RCallback<Record<never, never>> = null;
  private cbPlayed: RCallback<Record<never, never>> = null;
  private cbAbort: RCallback<Record<never, never>> = null;

  private meValue: UserInfo | null = null;
  private roomValue: ClientRoomState | null = null;
  private messages: Message[] = [];
  private livePlayers = new Map<number, LivePlayer>();

  pingFailCount = 0;
  delayMs: number | null = null;

  private constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  static async connect(host: string, port: number, options: ClientOptions = {}): Promise<Client> {
    const socket = net.createConnection({ host, port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const client = new Client(options.timeoutMs ?? 7000);
    const stream = await Stream.create<ClientCommand, ServerCommand>({
      socket,
      versionToSend: 1,
      codec,
      handler: async (cmd) => {
        await client.onServerCommand(cmd);
      }
    });
    client.stream = stream;
    client.startHeartbeat();
    return client;
  }

  me(): UserInfo | null {
    return this.meValue ? { ...this.meValue } : null;
  }

  state(): ClientRoomState | null {
    return this.roomValue ? { ...this.roomValue, users: new Map(this.roomValue.users) } : null;
  }

  roomId(): RoomId | null {
    return this.roomValue ? this.roomValue.id : null;
  }

  roomState(): RoomState | null {
    return this.roomValue ? this.roomValue.state : null;
  }

  isHost(): boolean | null {
    return this.roomValue ? this.roomValue.is_host : null;
  }

  isReady(): boolean | null {
    return this.roomValue ? this.roomValue.is_ready : null;
  }

  takeMessages(): Message[] {
    const out = this.messages;
    this.messages = [];
    return out;
  }

  livePlayer(playerId: number): LivePlayer {
    const existing = this.livePlayers.get(playerId);
    if (existing) return existing;
    const created: LivePlayer = { touch_frames: [], judge_events: [] };
    this.livePlayers.set(playerId, created);
    return created;
  }

  async close(): Promise<void> {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.rejectAllPending(new Error("连接已关闭"));
    this.stream?.close();
    this.stream = null;
  }

  async ping(): Promise<number> {
    const start = Date.now();
    await this.send({ type: "Ping" });
    await this.waitPong(HEARTBEAT_TIMEOUT_MS);
    const delay = Date.now() - start;
    this.delayMs = delay;
    return delay;
  }

  async authenticate(token: string): Promise<void> {
    const res = await this.rcall<[UserInfo, ClientRoomState | null]>(
      { type: "Authenticate", token },
      (p) => (this.cbAuthenticate = p)
    );
    if (!res.ok) throw new Error(res.error);
    const [me, room] = res.value;
    this.meValue = me;
    this.roomValue = room;
  }

  async chat(message: string): Promise<void> {
    await this.rcallUnit({ type: "Chat", message }, (p) => (this.cbChat = p));
  }

  async createRoom(id: string): Promise<void> {
    const roomId = parseRoomId(id);
    await this.rcallUnit({ type: "CreateRoom", id: roomId }, (p) => (this.cbCreateRoom = p));
    const me = this.meValue;
    if (!me) return;
    const users = new Map<number, UserInfo>();
    users.set(me.id, me);
    this.roomValue = {
      id: roomId,
      state: { type: "SelectChart", id: null },
      live: false,
      locked: false,
      cycle: false,
      is_host: true,
      is_ready: false,
      users
    };
  }

  async joinRoom(id: string, monitor: boolean): Promise<JoinRoomResponse> {
    const roomId = parseRoomId(id);
    const res = await this.rcall<JoinRoomResponse>({ type: "JoinRoom", id: roomId, monitor }, (p) => (this.cbJoinRoom = p));
    if (!res.ok) throw new Error(res.error);
    const users = new Map<number, UserInfo>();
    for (const u of res.value.users) users.set(u.id, u);
    this.roomValue = {
      id: roomId,
      state: res.value.state,
      live: res.value.live,
      locked: false,
      cycle: false,
      is_host: false,
      is_ready: false,
      users
    };
    return res.value;
  }

  async leaveRoom(): Promise<void> {
    await this.rcallUnit({ type: "LeaveRoom" }, (p) => (this.cbLeaveRoom = p));
    this.roomValue = null;
  }

  async lockRoom(lock: boolean): Promise<void> {
    await this.rcallUnit({ type: "LockRoom", lock }, (p) => (this.cbLockRoom = p));
    if (this.roomValue) this.roomValue.locked = lock;
  }

  async cycleRoom(cycle: boolean): Promise<void> {
    await this.rcallUnit({ type: "CycleRoom", cycle }, (p) => (this.cbCycleRoom = p));
    if (this.roomValue) this.roomValue.cycle = cycle;
  }

  async selectChart(id: number): Promise<void> {
    await this.rcallUnit({ type: "SelectChart", id }, (p) => (this.cbSelectChart = p));
  }

  async requestStart(): Promise<void> {
    await this.rcallUnit({ type: "RequestStart" }, (p) => (this.cbRequestStart = p));
  }

  async ready(): Promise<void> {
    await this.rcallUnit({ type: "Ready" }, (p) => (this.cbReady = p));
    if (this.roomValue) this.roomValue.is_ready = true;
  }

  async cancelReady(): Promise<void> {
    await this.rcallUnit({ type: "CancelReady" }, (p) => (this.cbCancelReady = p));
    if (this.roomValue) this.roomValue.is_ready = false;
  }

  async played(id: number): Promise<void> {
    await this.rcallUnit({ type: "Played", id }, (p) => (this.cbPlayed = p));
  }

  async abort(): Promise<void> {
    await this.rcallUnit({ type: "Abort" }, (p) => (this.cbAbort = p));
  }

  async sendTouches(frames: TouchFrame[]): Promise<void> {
    await this.send({ type: "Touches", frames });
  }

  async sendJudges(judges: JudgeEvent[]): Promise<void> {
    await this.send({ type: "Judges", judges });
  }

  private async send(cmd: ClientCommand): Promise<void> {
    if (!this.stream) throw new Error("未连接");
    await this.stream.send(cmd);
  }

  private startHeartbeat(): void {
    this.pingTimer = setInterval(() => {
      void (async () => {
        const start = Date.now();
        try {
          await this.send({ type: "Ping" });
          await this.waitPong(HEARTBEAT_TIMEOUT_MS);
          this.pingFailCount = 0;
        } catch {
          this.pingFailCount += 1;
        } finally {
          this.delayMs = Date.now() - start;
        }
      })();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async waitPong(timeoutMs: number): Promise<void> {
    if (this.pongWaiter) throw new Error("上一次 ping 尚未完成");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pongWaiter = null;
        reject(new Error("heartbeat timeout"));
      }, timeoutMs);

      this.pongWaiter = {
        timer,
        resolve: () => {
          clearTimeout(timer);
          this.pongWaiter = null;
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          this.pongWaiter = null;
          reject(e);
        }
      };
    });
  }

  private resolvePongWaiter(): void {
    const p = this.pongWaiter;
    if (!p) return;
    clearTimeout(p.timer);
    this.pongWaiter = null;
    p.resolve();
  }

  private rejectAllPending(e: Error): void {
    const pong = this.pongWaiter;
    if (pong) {
      clearTimeout(pong.timer);
      this.pongWaiter = null;
      pong.reject(e);
    }

    this.rejectCb(this.cbAuthenticate, (v) => (this.cbAuthenticate = v), e);
    this.rejectCb(this.cbChat, (v) => (this.cbChat = v), e);
    this.rejectCb(this.cbCreateRoom, (v) => (this.cbCreateRoom = v), e);
    this.rejectCb(this.cbJoinRoom, (v) => (this.cbJoinRoom = v), e);
    this.rejectCb(this.cbLeaveRoom, (v) => (this.cbLeaveRoom = v), e);
    this.rejectCb(this.cbLockRoom, (v) => (this.cbLockRoom = v), e);
    this.rejectCb(this.cbCycleRoom, (v) => (this.cbCycleRoom = v), e);
    this.rejectCb(this.cbSelectChart, (v) => (this.cbSelectChart = v), e);
    this.rejectCb(this.cbRequestStart, (v) => (this.cbRequestStart = v), e);
    this.rejectCb(this.cbReady, (v) => (this.cbReady = v), e);
    this.rejectCb(this.cbCancelReady, (v) => (this.cbCancelReady = v), e);
    this.rejectCb(this.cbPlayed, (v) => (this.cbPlayed = v), e);
    this.rejectCb(this.cbAbort, (v) => (this.cbAbort = v), e);
  }

  private rejectCb<T>(cb: RCallback<T>, set: (v: RCallback<T>) => void, e: Error): void {
    if (!cb) return;
    clearTimeout(cb.timer);
    set(null);
    cb.reject(e);
  }

  private makePending<T>(timeoutMs: number, onTimeout: () => void): Pending<T> {
    const pending = {
      resolve: (_: T) => {},
      reject: (_: Error) => {},
      timer: setTimeout(() => {
        onTimeout();
        pending.reject(new Error("timeout"));
      }, timeoutMs)
    };
    return pending;
  }

  private async rcall<T>(cmd: ClientCommand, setCb: (p: Pending<StringResult<T>>) => void): Promise<StringResult<T>> {
    await this.send(cmd);
    const pending = this.makePending<StringResult<T>>(this.timeoutMs, () => {});
    setCb(pending);
    return await new Promise<StringResult<T>>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
  }

  private async rcallUnit(cmd: ClientCommand, setCb: (p: Pending<StringResult<Record<never, never>>>) => void): Promise<void> {
    const res = await this.rcall<Record<never, never>>(cmd, setCb);
    if (!res.ok) throw new Error(res.error);
  }

  private async onServerCommand(cmd: ServerCommand): Promise<void> {
    switch (cmd.type) {
      case "Pong":
        this.resolvePongWaiter();
        return;
      case "Authenticate":
        this.finishCb(this.cbAuthenticate, cmd.result, (p) => (this.cbAuthenticate = p));
        return;
      case "Chat":
        this.finishCb(this.cbChat, cmd.result, (p) => (this.cbChat = p));
        return;
      case "CreateRoom":
        this.finishCb(this.cbCreateRoom, cmd.result, (p) => (this.cbCreateRoom = p));
        return;
      case "JoinRoom":
        this.finishCb(this.cbJoinRoom, cmd.result, (p) => (this.cbJoinRoom = p));
        return;
      case "LeaveRoom":
        this.finishCb(this.cbLeaveRoom, cmd.result, (p) => (this.cbLeaveRoom = p));
        return;
      case "LockRoom":
        this.finishCb(this.cbLockRoom, cmd.result, (p) => (this.cbLockRoom = p));
        return;
      case "CycleRoom":
        this.finishCb(this.cbCycleRoom, cmd.result, (p) => (this.cbCycleRoom = p));
        return;
      case "SelectChart":
        this.finishCb(this.cbSelectChart, cmd.result, (p) => (this.cbSelectChart = p));
        return;
      case "RequestStart":
        this.finishCb(this.cbRequestStart, cmd.result, (p) => (this.cbRequestStart = p));
        return;
      case "Ready":
        this.finishCb(this.cbReady, cmd.result, (p) => (this.cbReady = p));
        return;
      case "CancelReady":
        this.finishCb(this.cbCancelReady, cmd.result, (p) => (this.cbCancelReady = p));
        return;
      case "Played":
        this.finishCb(this.cbPlayed, cmd.result, (p) => (this.cbPlayed = p));
        return;
      case "Abort":
        this.finishCb(this.cbAbort, cmd.result, (p) => (this.cbAbort = p));
        return;
      case "Message":
        this.messages.push(cmd.message);
        if (this.roomValue) {
          if (cmd.message.type === "LockRoom") this.roomValue.locked = cmd.message.lock;
          if (cmd.message.type === "CycleRoom") this.roomValue.cycle = cmd.message.cycle;
        }
        return;
      case "ChangeState":
        if (this.roomValue) {
          this.roomValue.state = cmd.state;
          if (cmd.state.type !== "WaitingForReady") this.roomValue.is_ready = false;
        }
        return;
      case "ChangeHost":
        if (this.roomValue) this.roomValue.is_host = cmd.is_host;
        return;
      case "OnJoinRoom":
        if (this.roomValue) this.roomValue.users.set(cmd.info.id, cmd.info);
        return;
      case "Touches": {
        const p = this.livePlayer(cmd.player);
        p.touch_frames.push(...cmd.frames);
        return;
      }
      case "Judges": {
        const p = this.livePlayer(cmd.player);
        p.judge_events.push(...cmd.judges);
        return;
      }
    }
  }

  private finishCb<T>(cb: RCallback<T>, value: StringResult<T>, set: (v: RCallback<T>) => void): void {
    const pending = cb;
    if (!pending) return;
    clearTimeout(pending.timer);
    set(null);
    pending.resolve(value);
  }
}
