import { mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BinaryReader } from "../../common/binary.js";
import {
  PHIRA_RECORD_HEADER_SIZE,
  decodePhiraRecordPayload,
  encodePhiraRecordPayload,
  isPhiraRecordV2
} from "./replayFormat.js";

type ReplayHeader = {
  chartId: number;
  userId: number;
  recordId: number;
  timestamp?: number;
  chartName?: string;
  userName?: string;
  version?: number;
  compression?: number;
};

type ReplayEntry = {
  chartId: number;
  timestamp: number;
  recordId: number;
  path: string;
};

export function defaultReplayBaseDir(): string {
  return join(process.cwd(), "record");
}

export function replayFilePath(baseDir: string, userId: number, chartId: number, timestamp: number): string {
  return join(baseDir, String(userId), String(chartId), `${timestamp}.phirarec`);
}

export async function ensureReplayDir(baseDir: string, userId: number, chartId: number): Promise<string> {
  const dir = join(baseDir, String(userId), String(chartId));
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readReplayHeader(filePath: string): Promise<ReplayHeader | null> {
  const buf = await readFile(filePath);
  if (buf.length < 12) return null;

  if (isPhiraRecordV2(buf)) {
    return readPhiraRecordV2Header(buf);
  }

  const magicU16 = buf.length >= 2 ? buf.readUInt16LE(0) : null;
  const isMagicPM = magicU16 === 0x504d || magicU16 === 0x4d50;
  if (isMagicPM) {
    if (buf.length < 14) return null;
    const chartId = buf.readUInt32LE(2);
    const userId = buf.readUInt32LE(6);
    const recordId = buf.readUInt32LE(10);
    return { chartId, userId, recordId };
  }

  const isMagicPHIR = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x48 && buf[2] === 0x49 && buf[3] === 0x52;
  if (isMagicPHIR) {
    if (buf.length < 16) return null;
    const chartId = buf.readUInt32LE(4);
    const userId = buf.readUInt32LE(8);
    const recordId = buf.readUInt32LE(12);
    return { chartId, userId, recordId };
  }

  const chartId = buf.readUInt32LE(0);
  const userId = buf.readUInt32LE(4);
  const recordId = buf.readUInt32LE(8);
  return { chartId, userId, recordId };
}

function readPhiraRecordV2Header(buf: Buffer): ReplayHeader | null {
  const version = buf.readInt32LE(8);
  if (version !== 1) return null;
  const compression = buf.readUInt8(12);
  const content = decodePhiraRecordPayload(buf);
  const r = new BinaryReader(content);
  const recordId = r.readI32();
  const timestampBig = r.readI64();
  const timestamp = Number(timestampBig);
  const chartId = r.readI32();
  const chartName = r.readString();
  const userId = r.readI32();
  const userName = r.readString();
  return { chartId, userId, recordId, timestamp, chartName, userName, version, compression };
}

async function removeIfEmpty(dir: string): Promise<void> {
  const remain = await readdir(dir).catch(() => []);
  if (remain.length === 0) await rm(dir, { recursive: true, force: true }).catch(() => {});
}

function parseTimestampFromName(name: string): number | null {
  const m = /^(\d+)\.phirarec$/i.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function listReplaysForUser(baseDir: string, userId: number): Promise<Map<number, ReplayEntry[]>> {
  const out = new Map<number, ReplayEntry[]>();
  const userDir = join(baseDir, String(userId));
  let charts: string[];
  try {
    charts = await readdir(userDir, { withFileTypes: true }).then((ents) => ents.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    return out;
  }
  for (const chartName of charts) {
    const chartId = Number(chartName);
    if (!Number.isInteger(chartId) || chartId < 0) continue;
    const chartDir = join(userDir, chartName);
    let files: string[];
    try {
      files = await readdir(chartDir, { withFileTypes: true }).then((ents) => ents.filter((e) => e.isFile()).map((e) => e.name));
    } catch {
      continue;
    }
    const entries: ReplayEntry[] = [];
    for (const file of files) {
      const ts = parseTimestampFromName(file);
      if (ts === null) continue;
      const path = join(chartDir, file);
      const header = await readReplayHeader(path).catch(() => null);
      if (!header) continue;
      entries.push({ chartId, timestamp: ts, recordId: header.recordId, path });
    }
    entries.sort((a, b) => b.timestamp - a.timestamp);
    if (entries.length > 0) out.set(chartId, entries);
  }
  return out;
}

export async function deleteReplayForUser(baseDir: string, userId: number, chartId: number, timestamp: number): Promise<boolean> {
  const filePath = replayFilePath(baseDir, userId, chartId, timestamp);
  try {
    await rm(filePath);
  } catch (e: any) {
    if (e && typeof e === "object" && "code" in e && (e as any).code === "ENOENT") return false;
    throw e;
  }

  const chartDir = join(baseDir, String(userId), String(chartId));
  await removeIfEmpty(chartDir);

  const userDir = join(baseDir, String(userId));
  await removeIfEmpty(userDir);

  return true;
}

export async function cleanupExpiredReplays(baseDir: string, nowMs: number, ttlDays: number): Promise<void> {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  let users: string[];
  try {
    users = await readdir(baseDir, { withFileTypes: true }).then((ents) => ents.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    return;
  }

  for (const userName of users) {
    const userId = Number(userName);
    if (!Number.isInteger(userId) || userId < 0) continue;
    const userDir = join(baseDir, userName);
    let charts: string[];
    try {
      charts = await readdir(userDir, { withFileTypes: true }).then((ents) => ents.filter((e) => e.isDirectory()).map((e) => e.name));
    } catch {
      continue;
    }

    for (const chartName of charts) {
      const chartId = Number(chartName);
      if (!Number.isInteger(chartId) || chartId < 0) continue;
      const chartDir = join(userDir, chartName);
      let files: string[];
      try {
        files = await readdir(chartDir, { withFileTypes: true }).then((ents) => ents.filter((e) => e.isFile()).map((e) => e.name));
      } catch {
        continue;
      }

      for (const file of files) {
        const ts = parseTimestampFromName(file);
        if (ts === null) continue;
        if (nowMs - ts <= ttlMs) continue;
        await rm(join(chartDir, file), { force: true }).catch(() => {});
      }

      await removeIfEmpty(chartDir);
    }

    await removeIfEmpty(userDir);
  }
}

export async function patchReplayRecordId(filePath: string, recordId: number): Promise<void> {
  if (!Number.isInteger(recordId) || recordId < 0) return;

  const file = await readFile(filePath);
  if (isPhiraRecordV2(file)) {
    const compression = file.readUInt8(12);
    const content = Buffer.from(decodePhiraRecordPayload(file));
    content.writeInt32LE(recordId | 0, 0);
    const header = Buffer.from(file.subarray(0, PHIRA_RECORD_HEADER_SIZE));
    const payload = encodePhiraRecordPayload(content, compression);
    await writeFile(filePath, Buffer.concat([header, payload]));
    return;
  }

  const handle = await open(filePath, "r+");
  try {
    const head = Buffer.allocUnsafe(4);
    const read = await handle.read(head, 0, 4, 0);
    const hasMagicPHIR = read.bytesRead === 4 && head[0] === 0x50 && head[1] === 0x48 && head[2] === 0x49 && head[3] === 0x52;
    const magicU16 = read.bytesRead >= 2 ? head.readUInt16LE(0) : null;
    const hasMagicPM = magicU16 === 0x504d || magicU16 === 0x4d50;
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(recordId >>> 0, 0);
    await handle.write(buf, 0, 4, hasMagicPM ? 10 : hasMagicPHIR ? 12 : 8);
  } finally {
    await handle.close();
  }
}
