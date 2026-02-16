import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export type ReplayHeader = {
  chartId: number;
  userId: number;
  recordId: number;
};

export type ReplayEntry = {
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
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(16);
    const res = await handle.read(buf, 0, 16, 0);
    if (res.bytesRead < 12) return null;

    const magicU16 = res.bytesRead >= 2 ? buf.readUInt16LE(0) : null;
    const isMagicPM = magicU16 === 0x504d || magicU16 === 0x4d50;
    if (isMagicPM) {
      if (res.bytesRead < 14) return null;
      const chartId = buf.readUInt32LE(2);
      const userId = buf.readUInt32LE(6);
      const recordId = buf.readUInt32LE(10);
      return { chartId, userId, recordId };
    }

    const isMagicPHIR = res.bytesRead >= 4 && buf[0] === 0x50 && buf[1] === 0x48 && buf[2] === 0x49 && buf[3] === 0x52;
    if (isMagicPHIR) {
      if (res.bytesRead < 16) return null;
      const chartId = buf.readUInt32LE(4);
      const userId = buf.readUInt32LE(8);
      const recordId = buf.readUInt32LE(12);
      return { chartId, userId, recordId };
    }

    const chartId = buf.readUInt32LE(0);
    const userId = buf.readUInt32LE(4);
    const recordId = buf.readUInt32LE(8);
    return { chartId, userId, recordId };
  } finally {
    await handle.close();
  }
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
  const remainChart = await readdir(chartDir).catch(() => []);
  if (remainChart.length === 0) await rm(chartDir, { recursive: true, force: true }).catch(() => {});

  const userDir = join(baseDir, String(userId));
  const remainUser = await readdir(userDir).catch(() => []);
  if (remainUser.length === 0) await rm(userDir, { recursive: true, force: true }).catch(() => {});

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

      const remain = await readdir(chartDir).catch(() => []);
      if (remain.length === 0) await rm(chartDir, { recursive: true, force: true }).catch(() => {});
    }

    const remainUser = await readdir(userDir).catch(() => []);
    if (remainUser.length === 0) await rm(userDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function patchReplayRecordId(filePath: string, recordId: number): Promise<void> {
  if (!Number.isInteger(recordId) || recordId < 0) return;
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
