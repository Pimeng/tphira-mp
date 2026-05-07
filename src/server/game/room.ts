/**
 * 游戏房间管理模块
 *
 * Room 类代表一个多人游戏房间，管理：
 * - 房间状态机（选谱 -> 等待就绪 -> 游戏中 -> 结束）
 * - 用户与观战者管理
 * - 房主转移逻辑
 * - 游戏结果统计与展示
 * - 房间日志记录
 * - 比赛模式支持
 */
import type { ClientRoomState, Message, RoomState, ServerCommand } from "../../common/commands.js";
import type { RoomId } from "../../common/roomId.js";
import { tl, type Language } from "../utils/l10n.js";
import type { Chart, RecordData } from "../core/types.js";
import type { User } from "../game/user.js";
import type { Logger } from "../utils/logger.js";
import { logRoomInfo } from "../utils/logUtils.js";

/** 房间内部状态类型（比客户端状态更详细） */
export type InternalRoomState =
  | { type: "SelectChart" }
  | { type: "WaitForReady"; started: Set<number> }
  | { type: "Playing"; results: Map<number, RecordData>; aborted: Set<number> };

/**
 * 游戏房间类
 *
 * 管理房间内的所有游戏逻辑和状态转换。
 * 房间生命周期：创建 -> 玩家加入 -> 选谱 -> 等待就绪 -> 游戏中 -> 结束 -> 循环/解散
 */
export class Room {
  /** 房间唯一标识符 */
  readonly id: RoomId;
  /** 房间最大用户数 */
  maxUsers: number;
  /** 是否允许录制回放 */
  readonly replayEligible: boolean;
  /** 当前房主用户 ID */
  hostId: number;
  /** 房间内部状态 */
  state: InternalRoomState = { type: "SelectChart" };

  /** 是否处于直播模式 */
  live = false;
  /** 是否已锁定（锁定后禁止加入） */
  locked = false;
  /** 是否启用循环模式（游戏结束后房主轮换） */
  cycle = false;
  /** 比赛模式配置（null 表示普通房间） */
  contest: { whitelist: Set<number>; manualStart: boolean; autoDisband: boolean } | null = null;

  /** 房间内普通用户 ID 列表 */
  private users: number[] = [];
  /** 房间内观战者 ID 列表 */
  private monitors: number[] = [];
  /** 当前选中的谱面 */
  chart: Chart | null = null;

  /** 最近房间日志（用于 WebSocket 实时推送和管理面板） */
  private recentLogs: Array<{ message: string; timestamp: number }> = [];
  /** 最大保留日志条数 */
  private static readonly MAX_RECENT_LOGS = 50;

  /**
   * 创建新房间
   * @param opts - 房间创建选项
   */
  constructor(opts: { id: RoomId; hostId: number; maxUsers: number; replayEligible: boolean }) {
    this.id = opts.id;
    this.maxUsers = opts.maxUsers;
    this.replayEligible = opts.replayEligible;
    this.hostId = opts.hostId;
    this.users = [opts.hostId];
  }

  addLog(message: string, timestamp: number): void {
    this.recentLogs.push({ message, timestamp });
    if (this.recentLogs.length > Room.MAX_RECENT_LOGS) {
      this.recentLogs.shift();
    }
  }

  getRecentLogs(): Array<{ message: string; timestamp: number }> {
    return [...this.recentLogs];
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
    if (this.hostId !== user.id) throw new Error(tl(user.lang, "room-only-host"));
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

  async notifyWebSocket(state: { wsService: { broadcastRoomUpdate: (roomId: RoomId) => Promise<void>; broadcastAdminUpdate: () => Promise<void> } | null }): Promise<void> {
    if (state.wsService) {
      // 并行发送，不等待完成
      void Promise.allSettled([
        state.wsService.broadcastRoomUpdate(this.id),
        state.wsService.broadcastAdminUpdate()
      ]);
    }
  }

  addUser(user: User, monitor: boolean): boolean {
    if (monitor) {
      if (!this.monitors.includes(user.id)) this.monitors.push(user.id);
      return true;
    }
    if (this.users.length >= this.maxUsers) return false;
    if (!this.users.includes(user.id)) this.users.push(user.id);
    return true;
  }

  userIds(): number[] {
    return [...this.users];
  }

  monitorIds(): number[] {
    return [...this.monitors];
  }

  async send(
    broadcast: (cmd: ServerCommand) => Promise<void>,
    msg: Message,
    usersById?: (id: number) => { name: string } | undefined
  ): Promise<void> {
    if (msg.type === "Chat") {
      this.addLog(msg.content, Date.now());
    } else {
      const logText = this.formatMessageForLog(msg, usersById);
      if (logText) this.addLog(logText, Date.now());
    }
    await broadcast({ type: "Message", message: msg });
  }

  private formatMessageForLog(msg: Message, usersById?: (id: number) => { name: string } | undefined): string | null {
    const name = (id: number) => usersById?.(id)?.name ?? String(id);

    switch (msg.type) {
      case "CreateRoom":
        return `${name(msg.user)} 创建了房间`;
      case "JoinRoom":
        return `${msg.name} 加入了房间`;
      case "LeaveRoom":
        return `${msg.name} 离开了房间`;
      case "NewHost":
        return `${name(msg.user)} 成为了新的房主`;
      case "SelectChart":
        return `房主 ${name(msg.user)} 选择了谱面 ${msg.name} (#${msg.id})`;
      case "GameStart":
        return `房主 ${name(msg.user)} 开始了游戏，请其他玩家准备`;
      case "Ready":
        return `${name(msg.user)} 已就绪`;
      case "CancelReady":
        return `${name(msg.user)} 取消了准备`;
      case "CancelGame":
        return `${name(msg.user)} 取消了对局`;
      case "StartPlaying":
        return `游戏开始`;
      case "Played": {
        const acc = (msg.accuracy * 100).toFixed(2);
        const fc = msg.full_combo ? "，全连" : "";
        return `${name(msg.user)} 结束了游玩：${msg.score} (${acc}%)${fc}`;
      }
      case "GameEnd":
        return `游戏结束`;
      case "Abort":
        return `${name(msg.user)} 放弃了游戏`;
      case "LockRoom":
        return msg.lock ? "房间已锁定" : "房间已解锁";
      case "CycleRoom":
        return msg.cycle ? "房间已切换为循环模式" : "房间已切换为普通模式";
      default:
        return null;
    }
  }

  async sendAs(broadcast: (cmd: ServerCommand) => Promise<void>, user: User, content: string): Promise<void> {
    await this.send(broadcast, { type: "Chat", user: user.id, content });
  }

  async onUserLeave(opts: {
      user: User;
      usersById: (id: number) => User | undefined;
      broadcast: (cmd: ServerCommand) => Promise<void>;
      broadcastToMonitors: (cmd: ServerCommand) => Promise<void> | void;
      pickRandomUserId: (ids: number[]) => number | null;
      lang: Language;
      logger?: Logger;
      disbandRoom?: (room: Room) => Promise<void>;
      onEnterPlaying?: (room: Room) => Promise<void> | void;
      onGameEnd?: (room: Room) => Promise<void> | void;
      wsService?: { broadcastRoomUpdate: (roomId: RoomId) => Promise<void>; broadcastAdminUpdate: () => Promise<void> } | null;
    }): Promise<boolean> {
      const { user } = opts;
      await this.send(opts.broadcast, { type: "LeaveRoom", user: user.id, name: user.name }, opts.usersById);
      user.room = null;

      if (user.monitor) this.monitors = this.monitors.filter((it) => it !== user.id);
      else this.users = this.users.filter((it) => it !== user.id);

      if (this.hostId === user.id) {
        const users = this.userIds();
        if (users.length === 0) return true;
        const newHost = opts.pickRandomUserId(users);
        if (newHost === null) return true;
        this.hostId = newHost;
        if (opts.logger) logRoomInfo(opts.logger, opts.lang, this.id, "log-room-host-changed-offline", { old: String(user.id), next: String(newHost) });
        await this.send(opts.broadcast, { type: "NewHost", user: newHost }, opts.usersById);
        const newHostUser = opts.usersById(newHost);
        if (newHostUser) await newHostUser.trySend({ type: "ChangeHost", is_host: true });
      }

      if (opts.wsService) {
        void Promise.allSettled([
          opts.wsService.broadcastRoomUpdate(this.id), 
          opts.wsService.broadcastAdminUpdate()
        ]);
      }
      await this.checkAllReady(opts);
      return this.users.length === 0 && this.monitors.length === 0;
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
      broadcastToMonitors: (cmd: ServerCommand) => Promise<void> | void;
      pickRandomUserId: (ids: number[]) => number | null;
      lang: Language;
      logger?: Logger;
      disbandRoom?: (room: Room) => Promise<void>;
      onEnterPlaying?: (room: Room) => Promise<void> | void;
      onGameEnd?: (room: Room) => Promise<void> | void;
      wsService?: { broadcastRoomUpdate: (roomId: RoomId) => Promise<void>; broadcastAdminUpdate: () => Promise<void> } | null;
    }): Promise<void> {
      if (this.state.type === "WaitForReady") {
        const started = this.state.started;
        const allIds = [...this.userIds(), ...this.monitorIds()];
        const allReady = allIds.every((id) => started.has(id));
        if (!allReady) return;

        if (this.contest?.manualStart) return;

        if (opts.onEnterPlaying) await opts.onEnterPlaying(this);

        const users = this.userIds();
        const monitors = this.monitorIds();
        const sep = opts.lang.lang === "zh-CN" ? "、" : ", ";
        const usersText = users.join(sep);
        const monitorsText = monitors.join(sep);
        const monitorsSuffix = monitors.length > 0 ? tl(opts.lang, "log-room-game-start-monitors", { monitors: monitorsText }) : "";
        if (opts.logger) logRoomInfo(opts.logger, opts.lang, this.id, "log-room-game-start", { users: usersText, monitorsSuffix });
        await this.send(opts.broadcast, { type: "StartPlaying" }, opts.usersById);
        this.resetGameTime(opts.usersById);
        this.state = { type: "Playing", results: new Map(), aborted: new Set() };
        await this.onStateChange(opts.broadcast);
        void this.notifyWebSocket({ wsService: opts.wsService ?? null });
        return;
      }

      if (this.state.type === "Playing") {
        const results = this.state.results;
        const aborted = this.state.aborted;
        const playerIds = this.userIds();
        const finished = playerIds.every((id) => results.has(id) || aborted.has(id));
        if (!finished) return;

        if (results.size > 0) {
          const entries = [...results.entries()];

          const bestScore = Math.max(...entries.map(([, r]) => r.score));
          const bestScoreIds = entries.filter(([, r]) => r.score === bestScore).map(([id]) => id);
          const bestScoreName = opts.usersById(bestScoreIds[0]!)?.name ?? String(bestScoreIds[0]!);

          const bestAcc = Math.max(...entries.map(([, r]) => r.accuracy));
          const bestAccIds = entries.filter(([, r]) => r.accuracy === bestAcc).map(([id]) => id);
          const bestAccName = opts.usersById(bestAccIds[0]!)?.name ?? String(bestAccIds[0]!);

          const bestStd = Math.min(...entries.map(([, r]) => r.std));
          const bestStdIds = entries.filter(([, r]) => r.std === bestStd).map(([id]) => id);
          const bestStdName = opts.usersById(bestStdIds[0]!)?.name ?? String(bestStdIds[0]!);
          const bestStdMs = Math.round(bestStd * 1000);

          const scoreText = tl(opts.lang, "chat-game-summary-score", {
            name: bestScoreName,
            id: String(bestScoreIds[0]!),
            score: String(bestScore)
          });
          const accText = tl(opts.lang, "chat-game-summary-acc", {
            name: bestAccName,
            id: String(bestAccIds[0]!),
            acc: `${(bestAcc * 100).toFixed(2)}%`
          });
          const stdText = tl(opts.lang, "chat-game-summary-std", {
            name: bestStdName,
            id: String(bestStdIds[0]!),
            std: String(bestStdMs)
          });
          const summary = tl(opts.lang, "chat-game-summary", { scoreText, accText, stdText });

          await this.send(opts.broadcast, { type: "Chat", user: 0, content: summary });
        }

        if (opts.logger) logRoomInfo(opts.logger, opts.lang, this.id, "log-room-game-end", {
          uploaded: String(results.size),
          aborted: String(aborted.size)
        });
        await this.send(opts.broadcast, { type: "GameEnd" }, opts.usersById);
        if (opts.onGameEnd) await opts.onGameEnd(this);
        this.state = { type: "SelectChart" };

        if (this.contest?.autoDisband && opts.disbandRoom) {
          const chartText = this.chart ? `${this.chart.id}:${this.chart.name}` : "null";
          const rows = [...results.entries()]
            .map(([id, r]) => {
              const name = opts.usersById(id)?.name ?? String(id);
              return { id, name, score: r.score, acc: r.accuracy, fc: r.full_combo, std: r.std, std_score: r.std_score };
            })
            .sort((a, b) => b.score - a.score);
          if (opts.logger) logRoomInfo(opts.logger, opts.lang, this.id, "log-contest-game-results", {
            chart: chartText,
            results: JSON.stringify(rows),
            aborted: JSON.stringify([...aborted].sort((a, b) => a - b))
          });
          await opts.disbandRoom(this);
          return;
        }

        if (this.isCycle()) {
          const users = this.userIds();
          if (users.length > 1) {
            const index = Math.max(0, users.indexOf(this.hostId));
            const newHost = users[(index + 1) % users.length]!;
            const oldHost = this.hostId;
            this.hostId = newHost;
            if (opts.logger) logRoomInfo(opts.logger, opts.lang, this.id, "log-room-host-changed-cycle", { old: String(oldHost), next: String(newHost) });
            await this.send(opts.broadcast, { type: "NewHost", user: newHost }, opts.usersById);
            const oldHostUser = opts.usersById(oldHost);
            if (oldHostUser) await oldHostUser.trySend({ type: "ChangeHost", is_host: false });
            const newHostUser = opts.usersById(newHost);
            if (newHostUser) await newHostUser.trySend({ type: "ChangeHost", is_host: true });
          }
        }

        await this.onStateChange(opts.broadcast);
        void this.notifyWebSocket({ wsService: opts.wsService ?? null });
      }
    }


  validateJoin(user: User, monitor: boolean): void {
    if (this.contest && !this.contest.whitelist.has(user.id)) throw new Error(tl(user.lang, "room-not-whitelisted"));
    if (this.locked) throw new Error(tl(user.lang, "join-room-locked"));
    // 观战者可以在任何状态加入；普通玩家只能在选谱或游戏进行中加入
    if (!monitor && this.state.type === "WaitForReady") throw new Error(tl(user.lang, "join-game-ongoing"));
    if (monitor && !user.canMonitor()) throw new Error(tl(user.lang, "join-cant-monitor"));
  }

  handleJoin(user: User): void {
    if (this.state.type === "Playing" && !user.monitor) {
      // 游戏进行中加入的普通玩家自动标记为已完成，不影响当前局结束判断
      this.state.aborted.add(user.id);
    }
  }

  validateStart(user: User): void {
    this.checkHost(user);
    if (!this.chart) throw new Error(tl(user.lang, "start-no-chart-selected"));
    if (this.state.type !== "SelectChart") throw new Error(tl(user.lang, "room-invalid-state"));
  }

  validateSelectChart(user: User): void {
    this.checkHost(user);
    if (this.state.type !== "SelectChart") throw new Error(tl(user.lang, "room-invalid-state"));
  }

}
