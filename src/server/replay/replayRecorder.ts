import { writeFile } from "node:fs/promises";
import { BinaryWriter } from "../../common/binary.js";
import { encodeTouchFrame, type JudgeEvent, type TouchFrame, type UserInfo } from "../../common/commands.js";
import { parseRoomId, roomIdToString, type RoomId } from "../../common/roomId.js";
import type { Chart } from "../core/types.js";
import type { Language } from "../utils/l10n.js";
import { ensureReplayDir, replayFilePath } from "../replay/replayStorage.js";
import {
  COMPRESSION_ZSTD,
  buildPhiraRecordHeader,
  encodePhiraRecordPayload,
  encodeReplayJudgeEvent
} from "./replayFormat.js";
import type { Logger } from "../utils/logger.js";

type ReplayParticipant = {
  id: number;
  name?: string;
};

/** 每玩家单局录制帧数上限, 超出后停止追加防止内存无限增长 */
const MAX_FRAMES_PER_INFLIGHT = 15_000;

type InFlight = {
  roomKey: string;
  userId: number;
  userName: string;
  chartId: number;
  chartName: string;
  timestamp: number;
  recordId: number;
  path: string;
  closed: boolean;
  touchFrames: TouchFrame[];
  judgeEvents: JudgeEvent[];
  /** 计数器: 超过 MAX_FRAMES_PER_INFLIGHT 后静默丢弃 */
  _touchCount: number;
  _judgeCount: number;
  _overflowWarned: boolean;
};

type ReplayFileInfo = {
  userId: number;
  chartId: number;
  timestamp: number;
  path: string;
};

export class ReplayRecorder {
  private _baseDir: string;
  private readonly inflightByKey = new Map<string, InFlight>();
  private readonly keysByRoom = new Map<string, Set<string>>();
  private readonly completedFilesByRoom = new Map<string, ReplayFileInfo[]>();
  private readonly logger: Logger | null;

  constructor(baseDir: string, logger?: Logger) {
    this._baseDir = baseDir;
    this.logger = logger ?? null;
  }

  get baseDir(): string {
    return this._baseDir;
  }

  setBaseDir(baseDir: string): void {
    this._baseDir = baseDir;
  }

  private log(level: "DEBUG" | "INFO" | "WARN" | "ERROR", message: string): void {
    this.logger?.log(level, `[Replay] ${message}`);
  }

  async startRoom(roomId: RoomId, chart: number | Chart, users: Array<number | ReplayParticipant>): Promise<void> {
    const roomKey = roomIdToString(roomId);
    const chartId = typeof chart === "number" ? chart : chart.id;
    const chartName = typeof chart === "number" ? "" : chart.name;
    const userIdsText = users.map((it) => (typeof it === "number" ? String(it) : String(it.id))).join(",");
    this.log("DEBUG", `startRoom: roomKey=${roomKey}, chartId=${chartId}, userIds=[${userIdsText}]`);
    const existing = this.keysByRoom.get(roomKey);
    if (existing && existing.size > 0) {
      this.log("DEBUG", `startRoom skipped: room already exists with ${existing.size} recordings`);
      return;
    }

    this.completedFilesByRoom.delete(roomKey);
    const keys = new Set<string>();
    for (const participant of users) {
      const userId = typeof participant === "number" ? participant : participant.id;
      const userName = typeof participant === "number" ? "" : (participant.name ?? "");
      if (!Number.isInteger(userId) || userId < 0) {
        this.log("DEBUG", `startRoom skipped userId=${userId}: invalid`);
        continue;
      }
      const ts = Date.now();
      await ensureReplayDir(this._baseDir, userId, chartId);
      const path = replayFilePath(this._baseDir, userId, chartId, ts);
      this.log("DEBUG", `Preparing replay file: ${path}`);
      const key = `${roomKey}:${userId}`;
      this.inflightByKey.set(key, {
        roomKey,
        userId,
        userName,
        chartId,
        chartName,
        timestamp: ts,
        recordId: 0,
        path,
        closed: false,
        touchFrames: [],
        judgeEvents: [],
        _touchCount: 0,
        _judgeCount: 0,
        _overflowWarned: false
      });
      keys.add(key);
      this.log("DEBUG", `Recording started for userId=${userId}`);
    }
    if (keys.size > 0) this.keysByRoom.set(roomKey, keys);
    this.log("DEBUG", `startRoom completed: ${keys.size} recordings started`);
  }

  async endRoom(roomId: RoomId): Promise<void> {
    const roomKey = roomIdToString(roomId);
    this.log("DEBUG", `endRoom: roomKey=${roomKey}`);
    const keys = this.keysByRoom.get(roomKey);
    if (!keys) {
      this.log("DEBUG", "endRoom: no keys found for room");
      return;
    }
    this.keysByRoom.delete(roomKey);
    const tasks: Promise<ReplayFileInfo>[] = [];
    for (const key of keys) {
      const it = this.inflightByKey.get(key);
      if (!it) continue;
      this.log(
        "DEBUG",
        `endRoom stats: roomKey=${roomKey}, userId=${it.userId}, recordId=${it.recordId}, touchFrames=${it.touchFrames.length}, judgeEvents=${it.judgeEvents.length}`
      );
      this.inflightByKey.delete(key);
      tasks.push(this.closeInFlight(it).then(() => this.fileInfo(it)));
    }
    const results = await Promise.allSettled(tasks);
    const completed = results
      .filter((it): it is PromiseFulfilledResult<ReplayFileInfo> => it.status === "fulfilled")
      .map((it) => it.value);
    if (completed.length > 0) this.completedFilesByRoom.set(roomKey, completed);
    this.log("DEBUG", `endRoom completed: ${keys.size} recordings closed`);
  }

  async closeAll(): Promise<void> {
    const roomKeys = [...this.keysByRoom.keys()];
    if (roomKeys.length === 0) return;
    this.log("DEBUG", `closeAll: flushing ${roomKeys.length} inflight room(s)`);
    await Promise.allSettled(roomKeys.map((roomKey) => this.endRoom(parseRoomId(roomKey))));
  }

  setRecordId(roomId: RoomId, userId: number, recordId: number): void {
    const roomKey = roomIdToString(roomId);
    const key = `${roomKey}:${userId}`;
    const it = this.inflightByKey.get(key);
    if (!it || it.closed) return;
    it.recordId = recordId;
  }

  appendTouches(roomId: RoomId, userId: number, frames: TouchFrame[]): void {
    const it = this.get(roomId, userId);
    if (!it) return;
    const remaining = MAX_FRAMES_PER_INFLIGHT - it._touchCount;
    if (remaining <= 0) {
      if (!it._overflowWarned) {
        this.log("WARN", `TouchFrame overflow for userId=${userId}, dropping frames`);
        it._overflowWarned = true;
      }
      return;
    }
    const toAdd = Math.min(frames.length, remaining);
    for (let i = 0; i < toAdd; i++) it.touchFrames.push(frames[i]!);
    it._touchCount += toAdd;
  }

  appendJudges(roomId: RoomId, userId: number, judges: JudgeEvent[]): void {
    const it = this.get(roomId, userId);
    if (!it) return;
    const remaining = MAX_FRAMES_PER_INFLIGHT - it._judgeCount;
    if (remaining <= 0) {
      if (!it._overflowWarned) {
        this.log("WARN", `JudgeEvent overflow for userId=${userId}, dropping judges`);
        it._overflowWarned = true;
      }
      return;
    }
    const toAdd = Math.min(judges.length, remaining);
    for (let i = 0; i < toAdd; i++) it.judgeEvents.push(judges[i]!);
    it._judgeCount += toAdd;
  }

  listRoomFiles(roomId: RoomId): ReplayFileInfo[] {
    const roomKey = roomIdToString(roomId);
    const keys = this.keysByRoom.get(roomKey);
    if (!keys) return [...(this.completedFilesByRoom.get(roomKey) ?? [])];
    const out: ReplayFileInfo[] = [];
    for (const key of keys) {
      const it = this.inflightByKey.get(key);
      if (!it) continue;
      out.push(this.fileInfo(it));
    }
    return out;
  }

  /** 清理已完成回放文件记录（防止已解散房间的元数据泄漏） */
  clearRoomFiles(roomId: RoomId): void {
    const roomKey = roomIdToString(roomId);
    this.completedFilesByRoom.delete(roomKey);
  }

  fakeMonitorInfo(lang: Language): UserInfo {
    return { id: 2_000_000_000, name: lang.format("replay-recorder-name"), monitor: true };
  }

  private get(roomId: RoomId, userId: number): InFlight | null {
    const roomKey = roomIdToString(roomId);
    const key = `${roomKey}:${userId}`;
    const it = this.inflightByKey.get(key);
    if (!it || it.closed) return null;
    return it;
  }

  private async closeInFlight(it: InFlight): Promise<void> {
    if (it.closed) return;
    it.closed = true;
    await this.writeRecordFile(it);
  }

  private fileInfo(it: InFlight): ReplayFileInfo {
    return { userId: it.userId, chartId: it.chartId, timestamp: it.timestamp, path: it.path };
  }

  private buildRecordContent(it: InFlight): Buffer {
    const w = new BinaryWriter();
    w.writeI32(it.recordId);
    w.writeI64(BigInt(Math.trunc(it.timestamp)));
    w.writeI32(it.chartId);
    w.writeString(it.chartName);
    w.writeI32(it.userId);
    w.writeString(it.userName);
    w.writeArray(it.touchFrames, encodeTouchFrame);
    w.writeArray(it.judgeEvents, encodeReplayJudgeEvent);
    return w.toBuffer();
  }

  private async writeRecordFile(it: InFlight): Promise<void> {
    const content = this.buildRecordContent(it);
    const payload = encodePhiraRecordPayload(content, COMPRESSION_ZSTD);
    const header = buildPhiraRecordHeader(COMPRESSION_ZSTD);
    await writeFile(it.path, Buffer.concat([header, payload]));
  }
}
