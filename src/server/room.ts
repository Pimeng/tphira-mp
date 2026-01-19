import type { ClientRoomState, Message, RoomState, ServerCommand } from "../common/commands.js";
import type { RoomId } from "../common/roomId.js";
import { tl } from "./l10n.js";
import type { Chart, RecordData } from "./types.js";
import type { User } from "./user.js";

const ROOM_MAX_USERS = 8;

export type InternalRoomState =
  | { type: "SelectChart" }
  | { type: "WaitForReady"; started: Set<number> }
  | { type: "Playing"; results: Map<number, RecordData>; aborted: Set<number> };

export class Room {
  readonly id: RoomId;
  hostId: number;
  state: InternalRoomState = { type: "SelectChart" };

  live = false;
  locked = false;
  cycle = false;

  private users: number[] = [];
  private monitors: number[] = [];
  chart: Chart | null = null;

  constructor(opts: { id: RoomId; hostId: number }) {
    this.id = opts.id;
    this.hostId = opts.hostId;
    this.users = [opts.hostId];
  }

  isLive(): boolean {
    return this.live;
  }

  isLocked(): boolean {
    return this.locked;
  }

  isCycle(): boolean {
    return this.cycle;
  }

  checkHost(user: User): void {
    if (this.hostId !== user.id) throw new Error("only host can do this");
  }

  clientRoomState(): RoomState {
    if (this.state.type === "SelectChart") {
      return { type: "SelectChart", id: this.chart ? this.chart.id : null };
    }
    if (this.state.type === "WaitForReady") return { type: "WaitingForReady" };
    return { type: "Playing" };
  }

  clientState(user: User, usersById: (id: number) => User | undefined): ClientRoomState {
    const users = new Map<number, User>();
    for (const id of [...this.users, ...this.monitors]) {
      const u = usersById(id);
      if (u) users.set(id, u);
    }

    const infoMap = new Map<number, ReturnType<User["toInfo"]>>();
    for (const [id, u] of users) infoMap.set(id, u.toInfo());

    const isReady = this.state.type === "WaitForReady" ? this.state.started.has(user.id) : false;

    return {
      id: this.id,
      state: this.clientRoomState(),
      live: this.isLive(),
      locked: this.isLocked(),
      cycle: this.isCycle(),
      is_host: this.hostId === user.id,
      is_ready: isReady,
      users: infoMap
    };
  }

  async onStateChange(broadcast: (cmd: ServerCommand) => Promise<void>): Promise<void> {
    await broadcast({ type: "ChangeState", state: this.clientRoomState() });
  }

  addUser(user: User, monitor: boolean): boolean {
    if (monitor) {
      if (!this.monitors.includes(user.id)) this.monitors.push(user.id);
      return true;
    }
    if (this.users.length >= ROOM_MAX_USERS) return false;
    if (!this.users.includes(user.id)) this.users.push(user.id);
    return true;
  }

  userIds(): number[] {
    return [...this.users];
  }

  monitorIds(): number[] {
    return [...this.monitors];
  }

  async send(broadcast: (cmd: ServerCommand) => Promise<void>, msg: Message): Promise<void> {
    await broadcast({ type: "Message", message: msg });
  }

  async sendAs(broadcast: (cmd: ServerCommand) => Promise<void>, user: User, content: string): Promise<void> {
    await this.send(broadcast, { type: "Chat", user: user.id, content });
  }

  async onUserLeave(opts: {
    user: User;
    usersById: (id: number) => User | undefined;
    broadcast: (cmd: ServerCommand) => Promise<void>;
    broadcastToMonitors: (cmd: ServerCommand) => Promise<void>;
    pickRandomUserId: (ids: number[]) => number | null;
  }): Promise<boolean> {
    const { user } = opts;
    await this.send(opts.broadcast, { type: "LeaveRoom", user: user.id, name: user.name });
    user.room = null;

    if (user.monitor) this.monitors = this.monitors.filter((it) => it !== user.id);
    else this.users = this.users.filter((it) => it !== user.id);

    if (this.hostId === user.id) {
      const users = this.userIds();
      if (users.length === 0) return true;
      const newHost = opts.pickRandomUserId(users);
      if (newHost === null) return true;
      this.hostId = newHost;
      await this.send(opts.broadcast, { type: "NewHost", user: newHost });
      const newHostUser = opts.usersById(newHost);
      if (newHostUser) await newHostUser.trySend({ type: "ChangeHost", is_host: true });
    }

    await this.checkAllReady(opts);
    return false;
  }

  resetGameTime(usersById: (id: number) => User | undefined): void {
    for (const id of this.userIds()) {
      const u = usersById(id);
      if (u) u.gameTime = Number.NEGATIVE_INFINITY;
    }
  }

  async checkAllReady(opts: {
    user?: User;
    usersById: (id: number) => User | undefined;
    broadcast: (cmd: ServerCommand) => Promise<void>;
    broadcastToMonitors: (cmd: ServerCommand) => Promise<void>;
    pickRandomUserId: (ids: number[]) => number | null;
  }): Promise<void> {
    if (this.state.type === "WaitForReady") {
      const started = this.state.started;
      const allIds = [...this.userIds(), ...this.monitorIds()];
      const allReady = allIds.every((id) => started.has(id));
      if (!allReady) return;

      await this.send(opts.broadcast, { type: "StartPlaying" });
      this.resetGameTime(opts.usersById);
      this.state = { type: "Playing", results: new Map(), aborted: new Set() };
      await this.onStateChange(opts.broadcast);
      return;
    }

    if (this.state.type === "Playing") {
      const results = this.state.results;
      const aborted = this.state.aborted;
      const playerIds = this.userIds();
      const finished = playerIds.every((id) => results.has(id) || aborted.has(id));
      if (!finished) return;

      await this.send(opts.broadcast, { type: "GameEnd" });
      this.state = { type: "SelectChart" };

      if (this.isCycle()) {
        const users = this.userIds();
        if (users.length > 0) {
          const index = Math.max(0, users.indexOf(this.hostId));
          const newHost = users[(index + 1) % users.length]!;
          const oldHost = this.hostId;
          this.hostId = newHost;
          await this.send(opts.broadcast, { type: "NewHost", user: newHost });
          const oldHostUser = opts.usersById(oldHost);
          if (oldHostUser) await oldHostUser.trySend({ type: "ChangeHost", is_host: false });
          const newHostUser = opts.usersById(newHost);
          if (newHostUser) await newHostUser.trySend({ type: "ChangeHost", is_host: true });
        }
      }

      await this.onStateChange(opts.broadcast);
    }
  }

  validateJoin(user: User, monitor: boolean): void {
    if (this.locked) throw new Error(tl(user.lang, "join-room-locked"));
    if (this.state.type !== "SelectChart") throw new Error(tl(user.lang, "join-game-ongoing"));
    if (monitor && !user.canMonitor()) throw new Error(tl(user.lang, "join-cant-monitor"));
  }

  validateStart(user: User): void {
    this.checkHost(user);
    if (!this.chart) throw new Error(tl(user.lang, "start-no-chart-selected"));
    if (this.state.type !== "SelectChart") throw new Error("invalid state");
  }

  validateSelectChart(user: User): void {
    this.checkHost(user);
    if (this.state.type !== "SelectChart") throw new Error("invalid state");
  }

  requireRoom(user: User): Room {
    if (!user.room) throw new Error("no room");
    return user.room;
  }

}
