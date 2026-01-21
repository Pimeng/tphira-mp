import { createWriteStream, type WriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { encodePacket } from "../common/binary.js";
import { encodeClientCommand, type ClientCommand, type JudgeEvent, type TouchFrame, type UserInfo } from "../common/commands.js";
import { roomIdToString, type RoomId } from "../common/roomId.js";
import { ensureReplayDir, replayFilePath } from "./replayStorage.js";

type InFlight = {
  roomKey: string;
  userId: number;
  chartId: number;
  timestamp: number;
  path: string;
  stream: WriteStream;
  closed: boolean;
  queue: Promise<void>;
};

export class ReplayRecorder {
  private readonly baseDir: string;
  private readonly inflightByKey = new Map<string, InFlight>();
  private readonly keysByRoom = new Map<string, Set<string>>();
  private readonly magicU16 = 0x504d;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async startRoom(roomId: RoomId, chartId: number, userIds: number[]): Promise<void> {
    const roomKey = roomIdToString(roomId);
    const existing = this.keysByRoom.get(roomKey);
    if (existing && existing.size > 0) return;

    const keys = new Set<string>();
    for (const userId of userIds) {
      if (!Number.isInteger(userId) || userId < 0) continue;
      const ts = Date.now();
      await ensureReplayDir(this.baseDir, userId, chartId);
      const path = replayFilePath(this.baseDir, userId, chartId, ts);
      const handle = await open(path, "w");
      await handle.write(this.buildHeader(chartId, userId, 0), 0, 14, 0);
      await handle.close();

      const stream = createWriteStream(path, { flags: "a" });
      const key = `${roomKey}:${userId}`;
      this.inflightByKey.set(key, { roomKey, userId, chartId, timestamp: ts, path, stream, closed: false, queue: Promise.resolve() });
      keys.add(key);
    }
    if (keys.size > 0) this.keysByRoom.set(roomKey, keys);
  }

  async endRoom(roomId: RoomId): Promise<void> {
    const roomKey = roomIdToString(roomId);
    const keys = this.keysByRoom.get(roomKey);
    if (!keys) return;
    this.keysByRoom.delete(roomKey);
    const tasks: Promise<void>[] = [];
    for (const key of keys) {
      const it = this.inflightByKey.get(key);
      if (!it) continue;
      this.inflightByKey.delete(key);
      tasks.push(this.closeInFlight(it));
    }
    await Promise.allSettled(tasks);
  }

  setRecordId(roomId: RoomId, userId: number, recordId: number): void {
    const roomKey = roomIdToString(roomId);
    const key = `${roomKey}:${userId}`;
    const it = this.inflightByKey.get(key);
    if (!it || it.closed) return;
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(recordId >>> 0, 0);
    void it.queue.then(async () => {
      const handle = await open(it.path, "r+");
      try {
        await handle.write(buf, 0, 4, 10);
      } finally {
        await handle.close();
      }
    }).catch(() => {});
  }

  appendTouches(roomId: RoomId, userId: number, frames: TouchFrame[]): void {
    const it = this.get(roomId, userId);
    if (!it) return;
    const cmd: ClientCommand = { type: "Touches", frames };
    this.appendPacket(it, cmd);
  }

  appendJudges(roomId: RoomId, userId: number, judges: JudgeEvent[]): void {
    const it = this.get(roomId, userId);
    if (!it) return;
    const cmd: ClientCommand = { type: "Judges", judges };
    this.appendPacket(it, cmd);
  }

  listRoomFiles(roomId: RoomId): Array<{ userId: number; chartId: number; timestamp: number; path: string }> {
    const roomKey = roomIdToString(roomId);
    const keys = this.keysByRoom.get(roomKey);
    if (!keys) return [];
    const out: Array<{ userId: number; chartId: number; timestamp: number; path: string }> = [];
    for (const key of keys) {
      const it = this.inflightByKey.get(key);
      if (!it) continue;
      out.push({ userId: it.userId, chartId: it.chartId, timestamp: it.timestamp, path: it.path });
    }
    return out;
  }

  fakeMonitorInfo(): UserInfo {
    return { id: 2_000_000_000, name: "回放录制器", monitor: true };
  }

  private buildHeader(chartId: number, userId: number, recordId: number): Buffer {
    const buf = Buffer.allocUnsafe(14);
    buf.writeUInt16LE(this.magicU16, 0);
    buf.writeUInt32LE(chartId >>> 0, 2);
    buf.writeUInt32LE(userId >>> 0, 6);
    buf.writeUInt32LE(recordId >>> 0, 10);
    return buf;
  }

  private get(roomId: RoomId, userId: number): InFlight | null {
    const roomKey = roomIdToString(roomId);
    const key = `${roomKey}:${userId}`;
    const it = this.inflightByKey.get(key);
    if (!it || it.closed) return null;
    return it;
  }

  private appendPacket(it: InFlight, cmd: ClientCommand): void {
    const payload = encodePacket(cmd, encodeClientCommand);
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(payload.length >>> 0, 0);
    const chunk = Buffer.concat([header, payload]);
    void this.enqueueWrite(it, chunk).catch(() => {});
  }

  private enqueueWrite(it: InFlight, chunk: Buffer): Promise<void> {
    it.queue = it.queue.then(() => this.writeChunk(it, chunk));
    return it.queue;
  }

  private async writeChunk(it: InFlight, chunk: Buffer): Promise<void> {
    if (it.closed) return;
    await new Promise<void>((resolve, reject) => {
      it.stream.write(chunk, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async closeInFlight(it: InFlight): Promise<void> {
    if (it.closed) return;
    it.closed = true;
    await it.queue.catch(() => {});
    await new Promise<void>((resolve) => {
      it.stream.end(() => resolve());
    });
  }
}
