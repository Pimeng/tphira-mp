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

/** 服务端会以同名 type 回包的 RPC 命令；用作回调表的 key */
type RpcReplyType =
  | "Authenticate"
  | "Chat"
  | "CreateRoom"
  | "JoinRoom"
  | "LeaveRoom"
  | "LockRoom"
  | "CycleRoom"
  | "SelectChart"
  | "RequestStart"
  | "Ready"
  | "CancelReady"
  | "Played"
  | "Abort";

export type LivePlayer = {
  touch_frames: TouchFrame[];
  judge_events: JudgeEvent[];
};

export type ClientOptions = {
  timeoutMs?: number;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  onReconnect?: () => void;
  onReconnectFailed?: () => void;
};

const codec: StreamCodec<ClientCommand, ServerCommand> = {
  encodeSend: (payload) => encodePacket(payload, encodeClientCommand),
  decodeRecv: (payload) => decodePacket(payload, decodeServerCommand),
  isHighPriority: (cmd) => {
    // 心跳、认证、准备/取消准备、放弃 为高优先级
    const highTypes = new Set(["Ping", "Authenticate", "Ready", "CancelReady", "Abort"]);
    return highTypes.has(cmd.type);
  }
};

export class Client {
  private readonly timeoutMs: number;
  private stream: Stream<ClientCommand, ServerCommand> | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

  private pongWaiter: Pending<void> | null = null;
  /** key 是 RpcReplyType,即等待回包的命令类型 */
  private readonly callbacks = new Map<RpcReplyType, Pending<StringResult<unknown>>>();

  private meValue: UserInfo | null = null;
  private roomValue: ClientRoomState | null = null;
  private messages: Message[] = [];
  private livePlayers = new Map<number, LivePlayer>();

  pingFailCount = 0;
  delayMs: number | null = null;

  // 自动重连相关
  private host: string = "";
  private port: number = 0;
  private autoReconnect = false;
  private maxReconnectAttempts = 5;
  private reconnectBaseDelayMs = 1000;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private onReconnectCallback: (() => void) | null = null;
  private onReconnectFailedCallback: (() => void) | null = null;

  // 用于重连后恢复状态
  private lastToken: string | null = null;
  private lastRoomId: RoomId | null = null;
  private lastMonitor = false;
  private isReconnecting = false;

  private constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  static async connect(host: string, port: number, options: ClientOptions = {}): Promise<Client> {
    const client = new Client(options.timeoutMs ?? 7000);
    client.host = host;
    client.port = port;
    client.autoReconnect = options.autoReconnect ?? false;
    client.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    client.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1000;
    client.onReconnectCallback = options.onReconnect ?? null;
    client.onReconnectFailedCallback = options.onReconnectFailed ?? null;
    await client.doConnect();
    return client;
  }

  private async doConnect(): Promise<void> {
    const socket = net.createConnection({ host: this.host, port: this.port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const stream = await Stream.create<ClientCommand, ServerCommand>({
      socket,
      versionToSend: 1,
      codec,
      fastPath: (cmd) => cmd.type === "Pong",
      handler: async (cmd) => {
        await this.onServerCommand(cmd);
      }
    });
    this.stream = stream;
    this.startHeartbeat();

    // 监听底层 socket 断开，触发自动重连
    socket.once("close", () => {
      this.cleanupConnection();
      if (this.autoReconnect && !this.isReconnecting) {
        void this.scheduleReconnect();
      }
    });
  }

  private cleanupConnection(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.stream = null;
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.isReconnecting = false;
      this.onReconnectFailedCallback?.();
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // 指数退避：baseDelay, 2*baseDelay, 4*baseDelay... 上限 30s
    const delay = Math.min(this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1), 30000);
    const jitter = Math.random() * delay * 0.2;
    const totalDelay = delay + jitter;

    this.rejectAllPending(new Error(`client-reconnecting-attempt-${this.reconnectAttempts}`));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attemptReconnect();
    }, totalDelay);
  }

  private async attemptReconnect(): Promise<void> {
    try {
      await this.doConnect();
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      // 恢复认证和房间状态
      if (this.lastToken) {
        await this.authenticate(this.lastToken);
        if (this.lastRoomId) {
          await this.joinRoom(this.lastRoomId, this.lastMonitor);
        }
      }

      this.onReconnectCallback?.();
    } catch {
      void this.scheduleReconnect();
    }
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

  /** 主动断开底层连接（会触发自动重连，与 close 不同） */
  disconnect(): void {
    this.stream?.close();
  }

  async close(): Promise<void> {
    this.autoReconnect = false; // 主动关闭不再重连
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPending(new Error("连接已关闭"));
    const stream = this.stream;
    this.stream = null;
    this.cleanupConnection();
    stream?.close();
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
    this.lastToken = token;
    const res = await this.rcall<[UserInfo, ClientRoomState | null]>("Authenticate", { type: "Authenticate", token });
    if (!res.ok) throw new Error(res.error);
    const [me, room] = res.value;
    this.meValue = me;
    this.roomValue = room;
  }

  async chat(message: string): Promise<void> {
    await this.rcallUnit("Chat", { type: "Chat", message });
  }

  async createRoom(id: string): Promise<void> {
    const roomId = parseRoomId(id);
    await this.rcallUnit("CreateRoom", { type: "CreateRoom", id: roomId });
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

  async joinRoom(id: string | RoomId, monitor: boolean): Promise<JoinRoomResponse> {
    const roomId = typeof id === "string" ? parseRoomId(id) : id;
    this.lastRoomId = roomId;
    this.lastMonitor = monitor;
    const res = await this.rcall<JoinRoomResponse>("JoinRoom", { type: "JoinRoom", id: roomId, monitor });
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
    await this.rcallUnit("LeaveRoom", { type: "LeaveRoom" });
    this.roomValue = null;
    this.lastRoomId = null;
    this.lastMonitor = false;
  }

  async lockRoom(lock: boolean): Promise<void> {
    await this.rcallUnit("LockRoom", { type: "LockRoom", lock });
    if (this.roomValue) this.roomValue.locked = lock;
  }

  async cycleRoom(cycle: boolean): Promise<void> {
    await this.rcallUnit("CycleRoom", { type: "CycleRoom", cycle });
    if (this.roomValue) this.roomValue.cycle = cycle;
  }

  async selectChart(id: number): Promise<void> {
    await this.rcallUnit("SelectChart", { type: "SelectChart", id });
  }

  async requestStart(): Promise<void> {
    await this.rcallUnit("RequestStart", { type: "RequestStart" });
  }

  async ready(): Promise<void> {
    await this.rcallUnit("Ready", { type: "Ready" });
    if (this.roomValue) this.roomValue.is_ready = true;
  }

  async cancelReady(): Promise<void> {
    await this.rcallUnit("CancelReady", { type: "CancelReady" });
    if (this.roomValue) this.roomValue.is_ready = false;
  }

  async played(id: number): Promise<void> {
    await this.rcallUnit("Played", { type: "Played", id });
  }

  async abort(): Promise<void> {
    await this.rcallUnit("Abort", { type: "Abort" });
  }

  async sendTouches(frames: TouchFrame[]): Promise<void> {
    await this.send({ type: "Touches", frames });
  }

  async sendJudges(judges: JudgeEvent[]): Promise<void> {
    await this.send({ type: "Judges", judges });
  }

  private async send(cmd: ClientCommand): Promise<void> {
    if (!this.stream) throw new Error("client-not-connected");
    await this.stream.send(cmd);
  }

  private startHeartbeat(): void {
    const runHeartbeat = async () => {
      if (!this.stream) return;
      const start = Date.now();
      try {
        await this.send({ type: "Ping" });
        await this.waitPong(HEARTBEAT_TIMEOUT_MS);
        this.pingFailCount = 0;
      } catch {
        this.pingFailCount += 1;
        // 连续 3 次心跳失败，认为连接已断开，关闭 socket 触发重连
        if (this.pingFailCount >= 3) {
          this.stream?.socket.destroy();
          return;
        }
      } finally {
        this.delayMs = Date.now() - start;
      }

      // 自适应心跳间隔
      let nextInterval = HEARTBEAT_INTERVAL_MS;
      if (this.delayMs !== null) {
        if (this.delayMs < 100) nextInterval = 5000;
        else if (this.delayMs > 300) nextInterval = 1000;
      }

      this.pingTimer = setTimeout(runHeartbeat, nextInterval);
    };

    this.pingTimer = setTimeout(runHeartbeat, HEARTBEAT_INTERVAL_MS);
  }

  private async waitPong(timeoutMs: number): Promise<void> {
    if (this.pongWaiter) throw new Error("client-ping-in-flight");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pongWaiter = null;
        reject(new Error("client-heartbeat-timeout"));
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
    for (const [, cb] of this.callbacks) {
      clearTimeout(cb.timer);
      cb.reject(e);
    }
    this.callbacks.clear();
  }

  private async rcall<T>(replyType: RpcReplyType, cmd: ClientCommand): Promise<StringResult<T>> {
    await this.send(cmd);
    return await new Promise<StringResult<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.callbacks.delete(replyType);
        reject(new Error("client-timeout"));
      }, this.timeoutMs);
      this.callbacks.set(replyType, {
        timer,
        resolve: resolve as (v: StringResult<unknown>) => void,
        reject
      });
    });
  }

  private async rcallUnit(replyType: RpcReplyType, cmd: ClientCommand): Promise<void> {
    const res = await this.rcall<Record<never, never>>(replyType, cmd);
    if (!res.ok) throw new Error(res.error);
  }

  private async onServerCommand(cmd: ServerCommand): Promise<void> {
    switch (cmd.type) {
      case "Pong":
        this.resolvePongWaiter();
        return;
      case "Message":
        this.messages.push(cmd.message);
        if (this.roomValue) {
          if (cmd.message.type === "LockRoom") this.roomValue.locked = cmd.message.lock;
          if (cmd.message.type === "CycleRoom") this.roomValue.cycle = cmd.message.cycle;
          if (cmd.message.type === "LeaveRoom" && this.meValue && cmd.message.user === this.meValue.id)
            this.roomValue = null;
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
      case "Authenticate":
      case "Chat":
      case "CreateRoom":
      case "JoinRoom":
      case "LeaveRoom":
      case "LockRoom":
      case "CycleRoom":
      case "SelectChart":
      case "RequestStart":
      case "Ready":
      case "CancelReady":
      case "Played":
      case "Abort":
        this.finishCallback(cmd.type, cmd.result);
        return;
    }
  }

  private finishCallback(replyType: RpcReplyType, value: StringResult<unknown>): void {
    const cb = this.callbacks.get(replyType);
    if (!cb) return;
    this.callbacks.delete(replyType);
    clearTimeout(cb.timer);
    cb.resolve(value);
  }
}
