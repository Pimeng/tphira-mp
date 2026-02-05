/**
 * Redis 分布式状态层（参考 redis-data-schema.md）
 * Key 前缀 mp:，玩家会话 / 房间信息 / 房间成员，以及 mp:events Pub/Sub。
 */
import { Redis } from "ioredis";
import type { RoomId } from "../common/roomId.js";
import { roomIdToString } from "../common/roomId.js";
import type { Logger } from "./logger.js";

const PREFIX = "mp:";
const EVENTS_CHANNEL = "mp:events";
/** 玩家会话中 room_id 表示「不在房间内」时的取值，与 redis-data-schema 一致 */
const ROOM_ID_NULL = "Null";

/** Redis 房间状态枚举，与规范一致 */
export const RedisRoomState = {
  SelectChart: 0,
  WaitingForReady: 1,
  Playing: 2
} as const;

export type MpEventType =
  | "ROOM_CREATE"
  | "ROOM_DELETE"
  | "PLAYER_JOIN"
  | "PLAYER_LEAVE"
  | "STATE_CHANGE"
  | "SYNC_SCORE";

export type MpEventPayload =
  | { event: "ROOM_CREATE"; room_id: string; data: { uid: number; name: string } }
  | { event: "ROOM_DELETE"; room_id: string; data: { uid: number; name: string } }
  | { event: "PLAYER_JOIN"; room_id: string; data: { uid: number; name: string; is_monitor: boolean } }
  | { event: "PLAYER_LEAVE"; room_id: string; data: { uid: number; is_host_changed?: boolean; new_host?: number } }
  | { event: "STATE_CHANGE"; room_id: string; data: { new_state: number; chart_id?: number } }
  | { event: "SYNC_SCORE"; room_id: string; data: { uid: number; record_id: string } };

const LUA_JOIN_ROOM = `
local current_count = redis.call('SCARD', KEYS[1])
if current_count < tonumber(ARGV[2]) then
    redis.call('SADD', KEYS[1], ARGV[1])
    return 1
else
    return 0
end
`;

export type RedisServiceOptions = {
  host: string;
  port: number;
  db: number;
  /** 可选，未设置则不鉴权 */
  password?: string;
  serverId: string;
  logger: Logger;
};

export class RedisService {
  private readonly client: Redis;
  private readonly subscriber: Redis;
  private readonly serverId: string;
  private readonly logger: Logger;

  constructor(opts: RedisServiceOptions) {
    this.serverId = opts.serverId;
    this.logger = opts.logger;
    const redisOpts: { host: string; port: number; db: number; password?: string; maxRetriesPerRequest: number; retryStrategy: (times: number) => number | null } = {
      host: opts.host,
      port: opts.port,
      db: opts.db,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => (times <= 3 ? Math.min(times * 500, 2000) : null)
    };
    if (opts.password !== undefined && opts.password !== "") redisOpts.password = opts.password;
    this.client = new Redis(redisOpts);
    // 订阅连接进入 subscriber mode 后只能执行订阅相关命令，关闭 readyCheck 避免 ioredis 发送 INFO 等命令触发错误
    this.subscriber = new Redis({
      ...redisOpts,
      enableReadyCheck: false
    });

    this.client.on("connect", () => {
      this.logger.info("[Redis] 已连接", { host: opts.host, port: opts.port, db: opts.db });
    });
    this.client.on("error", (err: Error) => {
      const msg = err?.message ?? String(err);
      this.logger.warn(`[Redis] 客户端错误: ${msg}`, { error: String(err) });
    });
    this.subscriber.on("error", (err: Error) => {
      const msg = err?.message ?? String(err);
      this.logger.warn(`[Redis] 订阅端错误: ${msg}`, { error: String(err) });
    });
  }

  private keyPlayerSession(uid: number): string {
    return `${PREFIX}player:${uid}:session`;
  }

  private keyRoomInfo(rid: RoomId): string {
    return `${PREFIX}room:${roomIdToString(rid)}:info`;
  }

  private keyRoomPlayers(rid: RoomId): string {
    return `${PREFIX}room:${roomIdToString(rid)}:players`;
  }

  /** 写入/更新玩家会话（鉴权通过后调用） */
  async setPlayerSession(opts: {
    uid: number;
    roomId: RoomId | null;
    name: string;
    isMonitor: boolean;
  }): Promise<void> {
    const key = this.keyPlayerSession(opts.uid);
    const roomIdStr = opts.roomId ? roomIdToString(opts.roomId) : ROOM_ID_NULL;
    const now = String(Date.now());
    await this.client.hset(key, {
      server_id: this.serverId,
      room_id: roomIdStr,
      name: opts.name,
      is_monitor: opts.isMonitor ? "1" : "0",
      last_seen: now
    });
    this.logger.debug("[Redis] 设置玩家会话", { uid: opts.uid, room_id: roomIdStr, server_id: this.serverId });
  }

  /** 心跳：更新 last_seen（每 3 秒 Ping 时调用） */
  async updatePlayerLastSeen(uid: number): Promise<void> {
    const key = this.keyPlayerSession(uid);
    await this.client.hset(key, "last_seen", String(Date.now()));
  }

  /** 删除玩家会话（断线/登出时调用） */
  async deletePlayerSession(uid: number): Promise<void> {
    const key = this.keyPlayerSession(uid);
    await this.client.del(key);
    this.logger.debug("[Redis] 删除玩家会话", { uid });
  }

  /** 设置房间信息 Hash */
  async setRoomInfo(opts: {
    rid: RoomId;
    hostId: number;
    state: number;
    chartId: number;
    isLocked: boolean;
    isCycle: boolean;
  }): Promise<void> {
    const key = this.keyRoomInfo(opts.rid);
    await this.client.hset(key, {
      host_id: String(opts.hostId),
      state: String(opts.state),
      chart_id: String(opts.chartId),
      is_locked: opts.isLocked ? "1" : "0",
      is_cycle: opts.isCycle ? "1" : "0"
    });
    this.logger.debug("[Redis] 设置房间信息", {
      room_id: roomIdToString(opts.rid),
      state: opts.state,
      chart_id: opts.chartId
    });
  }

  /** 原子加入房间（Lua），返回是否成功 */
  async tryAddRoomPlayer(rid: RoomId, uid: number, maxPlayers: number): Promise<boolean> {
    const key = this.keyRoomPlayers(rid);
    const result = await this.client.eval(LUA_JOIN_ROOM, 1, key, String(uid), String(maxPlayers));
    const ok = result === 1;
    if (ok) this.logger.debug("[Redis] 房间加入成功", { room_id: roomIdToString(rid), uid });
    else this.logger.debug("[Redis] 房间已满，加入失败", { room_id: roomIdToString(rid), uid });
    return ok;
  }

  /** 从房间成员集合移除 */
  async removeRoomPlayer(rid: RoomId, uid: number): Promise<void> {
    const key = this.keyRoomPlayers(rid);
    await this.client.srem(key, String(uid));
    this.logger.debug("[Redis] 房间移除玩家", { room_id: roomIdToString(rid), uid });
  }

  /** 获取房间内所有成员 UID（用于关闭时移交房主等） */
  async getRoomPlayerIds(rid: RoomId): Promise<number[]> {
    const key = this.keyRoomPlayers(rid);
    const members = await this.client.smembers(key);
    return members.map((s: string) => Number(s)).filter((n: number) => Number.isInteger(n));
  }

  /** 删除房间相关 Key（房间解散时） */
  async deleteRoom(rid: RoomId): Promise<void> {
    const r = roomIdToString(rid);
    await this.client.del(this.keyRoomInfo(rid));
    await this.client.del(this.keyRoomPlayers(rid));
    this.logger.debug("[Redis] 删除房间", { room_id: r });
  }

  /** 创建房间时初始化房间信息与成员集合（仅房主） */
  async initRoom(rid: RoomId, hostId: number, maxPlayers: number): Promise<void> {
    await this.setRoomInfo({
      rid,
      hostId,
      state: RedisRoomState.SelectChart,
      chartId: 0,
      isLocked: false,
      isCycle: false
    });
    const key = this.keyRoomPlayers(rid);
    await this.client.del(key);
    await this.client.sadd(key, String(hostId));
    this.logger.debug("[Redis] 初始化房间", { room_id: roomIdToString(rid), host_id: hostId });
  }

  /** 发布事件到 mp:events */
  async publishEvent(payload: MpEventPayload): Promise<void> {
    const msg = JSON.stringify(payload);
    await this.client.publish(EVENTS_CHANNEL, msg);
    this.logger.debug("[Redis] 发布事件", { event: payload.event, room_id: payload.room_id });
  }

  /** 订阅 mp:events，收到消息时调用 onMessage（仅解析 JSON，业务层决定是否转发） */
  async subscribe(onMessage: (payload: MpEventPayload) => void | Promise<void>): Promise<void> {
    await this.subscriber.subscribe(EVENTS_CHANNEL);
    this.logger.info("[Redis] 已订阅 mp:events");
    this.subscriber.on("message", (channel: string, message: string) => {
      if (channel !== EVENTS_CHANNEL) return;
      try {
        const payload = JSON.parse(message) as MpEventPayload;
        if (payload && typeof payload.event === "string" && payload.room_id !== undefined) {
          void Promise.resolve(onMessage(payload)).catch((err) => {
            this.logger.warn("[Redis] 处理订阅消息异常", { error: String(err) });
          });
        }
      } catch (e) {
        this.logger.warn("[Redis] 解析订阅消息失败", { error: String(e) });
      }
    });
  }

  /** 关闭连接 */
  async close(): Promise<void> {
    await this.client.quit();
    await this.subscriber.quit();
    this.logger.info("[Redis] 连接已关闭");
  }
}
