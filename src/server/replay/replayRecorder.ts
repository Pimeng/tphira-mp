import { writeFile } from "node:fs/promises";
import { zstdCompressSync } from "node:zlib";
import { BinaryWriter } from "../../common/binary.js";
import type { CompactPos, JudgeEvent, TouchFrame, UserInfo } from "../../common/commands.js";
import { roomIdToString, type RoomId } from "../../common/roomId.js";
import type { Chart } from "../core/types.js";
import { ensureReplayDir, replayFilePath } from "../replay/replayStorage.js";
import type { Logger } from "../utils/logger.js";

type ReplayParticipant = {
  id: number;
  name?: string;
};

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
};

type ReplayFileInfo = {
  userId: number;
  chartId: number;
  timestamp: number;
  path: string;
};

const phiraRecordMagic = Buffer.from("PHIRAREC", "ascii");
const phiraRecordVersion = 1;
const compressionZstd = 0x01;

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
    const userIdsText = users.map((it) => typeof it === "number" ? String(it) : String(it.id)).join(",");
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
        judgeEvents: []
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
      this.log("DEBUG", `endRoom stats: roomKey=${roomKey}, userId=${it.userId}, recordId=${it.recordId}, touchFrames=${it.touchFrames.length}, judgeEvents=${it.judgeEvents.length}`);
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

  setRecordId(roomId: RoomId, userId: number, recordId: number): void {
    const roomKey = roomIdToString(roomId);
    const key = `${roomKey}:${userId}`;
    const it = this.inflightByKey.get(key);
    if (!it || it.closed) return;
    it.recordId = recordId;
  }

  appendTouches(roomId: RoomId, userId: number, frames: TouchFrame[]): void {
    this.log("DEBUG", `appendTouches: roomId=${roomIdToString(roomId)}, userId=${userId}, frames=${frames.length}`);
    const it = this.get(roomId, userId);
    if (!it) return;
    this.appendPacket(it, { type: "Touches", frames });
  }

  appendJudges(roomId: RoomId, userId: number, judges: JudgeEvent[]): void {
    this.log("DEBUG", `appendJudges: roomId=${roomIdToString(roomId)}, userId=${userId}, judges=${judges.length}`);
    const it = this.get(roomId, userId);
    if (!it) return;
    this.appendPacket(it, { type: "Judges", judges });
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

  fakeMonitorInfo(): UserInfo {
    return { id: 2_000_000_000, name: "回放录制器", monitor: true };
  }

  private get(roomId: RoomId, userId: number): InFlight | null {
    const roomKey = roomIdToString(roomId);
    const key = `${roomKey}:${userId}`;
    const it = this.inflightByKey.get(key);
    if (!it || it.closed) return null;
    return it;
  }

  private appendPacket(it: InFlight, cmd: { type: "Touches"; frames: TouchFrame[] } | { type: "Judges"; judges: JudgeEvent[] }): void {
    if (cmd.type === "Touches") {
      it.touchFrames.push(...cmd.frames);
      return;
    }
    it.judgeEvents.push(...cmd.judges);
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
    w.writeArray(it.judgeEvents, encodeJudgeEvent);
    return w.toBuffer();
  }

  private async writeRecordFile(it: InFlight): Promise<void> {
    const content = this.buildRecordContent(it);
    const payload = zstdCompressSync(content);
    const header = Buffer.allocUnsafe(13);
    phiraRecordMagic.copy(header, 0);
    header.writeInt32LE(phiraRecordVersion, 8);
    header.writeUInt8(compressionZstd, 12);
    await writeFile(it.path, Buffer.concat([header, payload]));
  }
}

function encodeTouchFrame(w: BinaryWriter, v: TouchFrame): void {
  w.writeF32(v.time);
  w.writeArray(v.points, (ww, [id, pos]) => {
    ww.writeI8(id);
    encodeCompactPos(ww, pos);
  });
}

function encodeCompactPos(w: BinaryWriter, v: CompactPos): void {
  w.writeCompactPos(v);
}

function encodeJudgeEvent(w: BinaryWriter, v: JudgeEvent): void {
  w.writeF32(v.time);
  w.writeI32(v.line_id);
  w.writeI32(v.note_id);
  w.writeU8(v.judgement);
}
