import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Mutex } from "./mutex.js";
import type { RoomId } from "../common/roomId.js";
import { parseRoomId, roomIdToString } from "../common/roomId.js";
import type { ServerConfig } from "./types.js";
import { Room } from "./room.js";
import type { Session } from "./session.js";
import type { User } from "./user.js";
import type { Logger } from "./logger.js";
import { Language } from "./l10n.js";
import { ReplayRecorder } from "./replayRecorder.js";
import { defaultReplayBaseDir } from "./replayStorage.js";
import type { RedisService } from "./redis.js";
import type { ServerCommand } from "../common/commands.js";
import type { MpEventPayload } from "./redis.js";
import { RedisRoomState } from "./redis.js";

type AdminDataFile = { version: 1; bannedUsers: number[]; bannedRoomUsers: Record<string, number[]> };

export class ServerState {
  readonly mutex = new Mutex();
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly serverName: string;
  readonly serverLang: Language;
  readonly adminDataPath: string;
  replayEnabled: boolean;

  readonly sessions = new Map<string, Session>();
  readonly users = new Map<number, User>();
  readonly rooms = new Map<RoomId, Room>();

  readonly bannedUsers = new Set<number>();
  readonly bannedRoomUsers = new Map<RoomId, Set<number>>();
  readonly contestRooms = new Map<RoomId, { whitelist: Set<number> }>();

  readonly replayRecorder: ReplayRecorder;
  /** 分布式 Redis，未配置时为 null */
  readonly redis: RedisService | null;

  constructor(
    config: ServerConfig,
    logger: Logger,
    serverName: string,
    adminDataPath: string,
    redis: RedisService | null = null
  ) {
    this.config = config;
    this.logger = logger;
    this.serverName = serverName;
    this.serverLang = new Language(process.env.PHIRA_MP_LANG?.trim() || process.env.LANG?.trim() || "");
    this.adminDataPath = adminDataPath;
    this.replayEnabled = Boolean(config.replay_enabled);
    this.replayRecorder = new ReplayRecorder(defaultReplayBaseDir());
    this.redis = redis;
  }

  /** 向指定房间内所有成员（含观战）推送命令，用于 Redis Pub/Sub 收到事件时广播 */
  async broadcastToRoomById(roomIdStr: string, cmd: ServerCommand): Promise<void> {
    let rid: RoomId;
    try {
      rid = parseRoomId(roomIdStr);
    } catch {
      return;
    }
    const room = this.rooms.get(rid);
    if (!room) return;
    const ids = [...room.userIds(), ...room.monitorIds()];
    for (const id of ids) {
      const u = this.users.get(id);
      if (u) void u.trySend(cmd);
    }
  }

  /** 处理来自 mp:events 的 JSON 消息，转换为 ServerCommand 并广播到本机该房间连接 */
  async handleRedisEvent(payload: MpEventPayload): Promise<void> {
    const { room_id: roomIdStr, event } = payload;
    try {
      switch (event) {
        case "ROOM_CREATE": {
          const d = payload.data as { uid: number; name: string };
          this.logger.debug("[Redis] 收到 ROOM_CREATE", { room_id: roomIdStr, uid: d.uid, name: d.name });
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdStr);
          } catch {
            break;
          }
          const maxUsersRaw = this.config.room_max_users;
          const maxUsers =
            typeof maxUsersRaw === "number" && Number.isInteger(maxUsersRaw)
              ? Math.min(Math.max(maxUsersRaw, 1), 64)
              : 8;
          const room = new Room({
            id: rid,
            hostId: d.uid,
            maxUsers,
            replayEligible: false
          });
          room.remote = true;
          await this.mutex.runExclusive(async () => {
            if (!this.rooms.has(rid)) {
              this.rooms.set(rid, room);
              this.logger.debug("[Redis] 已同步本地房间列表 ROOM_CREATE", { room_id: roomIdStr });
            }
          });
          break;
        }
        case "ROOM_DELETE": {
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdStr);
          } catch {
            break;
          }
          const room = this.rooms.get(rid);
          if (!room) break;
          if (!room.remote) {
            if (room.userIds().length > 0) {
              this.logger.debug("[Redis] 收到 ROOM_DELETE 但房间为本机创建且仍有玩家，忽略删除", { room_id: roomIdStr });
              break;
            }
          }
          for (const id of [...room.userIds(), ...room.monitorIds()]) {
            const u = this.users.get(id);
            if (u && u.room?.id === room.id) u.room = null;
          }
          await this.mutex.runExclusive(async () => {
            this.rooms.delete(rid);
          });
          this.logger.debug("[Redis] 已同步删除本地房间", { room_id: roomIdStr });
          break;
        }
        case "PLAYER_JOIN": {
          const d = payload.data as { uid: number; name: string; is_monitor: boolean };
          await this.broadcastToRoomById(roomIdStr, { type: "OnJoinRoom", info: { id: d.uid, name: d.name, monitor: d.is_monitor } });
          await this.broadcastToRoomById(roomIdStr, { type: "Message", message: { type: "JoinRoom", user: d.uid, name: d.name } });
          this.logger.debug("[Redis] 已广播 PLAYER_JOIN", { room_id: roomIdStr, uid: d.uid });
          break;
        }
        case "PLAYER_LEAVE": {
          const d = payload.data as { uid: number; is_host_changed?: boolean; new_host?: number };
          await this.broadcastToRoomById(roomIdStr, { type: "Message", message: { type: "LeaveRoom", user: d.uid, name: String(d.uid) } });
          if (d.is_host_changed && d.new_host !== undefined) {
            await this.broadcastToRoomById(roomIdStr, { type: "Message", message: { type: "NewHost", user: d.new_host } });
          }
          this.logger.debug("[Redis] 已广播 PLAYER_LEAVE", { room_id: roomIdStr, uid: d.uid });
          break;
        }
        case "STATE_CHANGE": {
          const d = payload.data as { new_state: number; chart_id?: number };
          const state =
            d.new_state === RedisRoomState.SelectChart
              ? { type: "SelectChart" as const, id: d.chart_id ?? null }
              : d.new_state === RedisRoomState.WaitingForReady
                ? { type: "WaitingForReady" as const }
                : { type: "Playing" as const };
          await this.broadcastToRoomById(roomIdStr, { type: "ChangeState", state });
          this.logger.debug("[Redis] 已广播 STATE_CHANGE", { room_id: roomIdStr, new_state: d.new_state });
          break;
        }
        case "SYNC_SCORE": {
          const d = payload.data as { uid: number; record_id: string };
          this.logger.debug("[Redis] 收到 SYNC_SCORE", { room_id: roomIdStr, uid: d.uid, record_id: d.record_id });
          break;
        }
        default:
          break;
      }
    } catch (e) {
      this.logger.warn("[Redis] handleRedisEvent 异常", { event, room_id: roomIdStr, error: String(e) });
    }
  }

  /**
   * 服务器关闭时清理本机在 Redis 中的连接/房间/玩家信息（规范 4.3 清理）：
   * 对本机有房主或玩家的房间：房主则移交房主权限并广播离开，玩家则广播离开；最后删除本机玩家会话。
   */
  async cleanupRedisOnShutdown(): Promise<void> {
    if (!this.redis) return;
    const snapshot = await this.mutex.runExclusive(async () => {
      const ourUserIds = new Set<number>();
      const roomToOurUsers = new Map<RoomId, number[]>();
      for (const session of this.sessions.values()) {
        const user = session.user;
        if (!user) continue;
        ourUserIds.add(user.id);
        const room = user.room;
        if (!room) continue;
        const ids = roomToOurUsers.get(room.id) ?? [];
        if (!ids.includes(user.id)) ids.push(user.id);
        roomToOurUsers.set(room.id, ids);
      }
      return { ourUserIds: [...ourUserIds], roomToOurUsers };
    });

    const { ourUserIds, roomToOurUsers } = snapshot;
    if (ourUserIds.length === 0) {
      this.logger.info("[Redis] 关闭清理：本机无在线玩家");
      return;
    }

    for (const [rid, ourUids] of roomToOurUsers) {
      const room = this.rooms.get(rid);
      if (!room) continue;
      const hostId = room.hostId;
      const isOurHost = ourUids.includes(hostId);
      const rStr = roomIdToString(rid);

      if (isOurHost) {
        await this.redis.removeRoomPlayer(rid, hostId);
        const remaining = await this.redis.getRoomPlayerIds(rid);
        const hostName = this.users.get(hostId)?.name ?? String(hostId);
        if (remaining.length > 0) {
          const newHost = remaining[0]!;
          await this.redis.setRoomInfo({
            rid,
            hostId: newHost,
            state:
              room.state.type === "SelectChart"
                ? RedisRoomState.SelectChart
                : room.state.type === "WaitForReady"
                  ? RedisRoomState.WaitingForReady
                  : RedisRoomState.Playing,
            chartId: room.chart?.id ?? 0,
            isLocked: room.locked,
            isCycle: room.cycle
          });
          await this.redis.publishEvent({
            event: "PLAYER_LEAVE",
            room_id: rStr,
            data: { uid: hostId, is_host_changed: true, new_host: newHost }
          });
        } else {
          await this.redis.deleteRoom(rid);
          await this.redis.publishEvent({
            event: "ROOM_DELETE",
            room_id: rStr,
            data: { uid: hostId, name: hostName }
          });
        }
      }

      for (const uid of ourUids) {
        await this.redis.removeRoomPlayer(rid, uid);
        await this.redis.setPlayerSession({
          uid,
          roomId: null,
          name: this.users.get(uid)?.name ?? String(uid),
          isMonitor: this.users.get(uid)?.monitor ?? false
        });
        if (!isOurHost || uid !== hostId) {
          await this.redis.publishEvent({
            event: "PLAYER_LEAVE",
            room_id: rStr,
            data: { uid, is_host_changed: false }
          });
        }
      }
    }

    for (const uid of ourUserIds) {
      await this.redis.deletePlayerSession(uid);
    }
    this.logger.info("[Redis] 关闭清理已完成", { users: ourUserIds.length });
  }

  private snapshotAdminData(): AdminDataFile {
    const bannedUsers = [...this.bannedUsers].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
    const bannedRoomUsers: Record<string, number[]> = {};
    const entries = [...this.bannedRoomUsers.entries()].map(([rid, set]) => [roomIdToString(rid), [...set]] as const);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [rid, users] of entries) {
      const ids = users.filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
      if (ids.length > 0) bannedRoomUsers[rid] = ids;
    }
    return { version: 1, bannedUsers, bannedRoomUsers };
  }

  private applyAdminDataFile(data: AdminDataFile): void {
    this.bannedUsers.clear();
    for (const id of data.bannedUsers) {
      if (Number.isInteger(id)) this.bannedUsers.add(id);
    }
    this.bannedRoomUsers.clear();
    for (const [ridText, ids] of Object.entries(data.bannedRoomUsers ?? {})) {
      try {
        const rid = parseRoomId(ridText);
        const set = new Set<number>();
        for (const id of ids ?? []) if (Number.isInteger(id)) set.add(id);
        if (set.size > 0) this.bannedRoomUsers.set(rid, set);
      } catch {
      }
    }
  }

  async loadAdminData(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      try {
        const text = await readFile(this.adminDataPath, "utf8");
        const raw = JSON.parse(text) as Partial<AdminDataFile>;
        if (raw.version !== 1) return;
        const bannedUsers = Array.isArray(raw.bannedUsers) ? raw.bannedUsers : [];
        const bannedRoomUsers = raw.bannedRoomUsers && typeof raw.bannedRoomUsers === "object" ? (raw.bannedRoomUsers as Record<string, number[]>) : {};
        this.applyAdminDataFile({ version: 1, bannedUsers: bannedUsers as number[], bannedRoomUsers });
      } catch {
      }
    });
  }

  async saveAdminData(): Promise<void> {
    const data = await this.mutex.runExclusive(async () => this.snapshotAdminData());
    const dir = dirname(this.adminDataPath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.adminDataPath}.tmp`;
    const text = JSON.stringify(data, null, 2);
    await writeFile(tmp, text, "utf8");
    try {
      await rename(tmp, this.adminDataPath);
    } catch {
      try {
        await unlink(this.adminDataPath);
      } catch {
      }
      await rename(tmp, this.adminDataPath);
    }
  }
}
