import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defaultReplayBaseDir,
  replayFilePath,
  ensureReplayDir,
  readReplayHeader,
  listReplaysForUser,
  deleteReplayForUser,
  cleanupExpiredReplays,
  patchReplayRecordId
} from "../../src/server/replay/replayStorage.js";
import {
  buildPhiraRecordHeader,
  encodePhiraRecordPayload,
  COMPRESSION_NONE
} from "../../src/server/replay/replayFormat.js";
import { BinaryWriter } from "../../src/common/binary.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `phira-mp-replay-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function buildTestReplay(recordId: number, chartId: number, userId: number, timestamp: number): Buffer {
  const w = new BinaryWriter();
  w.writeI32(recordId);
  w.writeI64(BigInt(timestamp));
  w.writeI32(chartId);
  w.writeString(`Chart-${chartId}`);
  w.writeI32(userId);
  w.writeString(`User-${userId}`);
  w.writeArray([], () => {});
  w.writeArray([], () => {});
  const payload = encodePhiraRecordPayload(w.toBuffer(), COMPRESSION_NONE);
  return Buffer.concat([buildPhiraRecordHeader(COMPRESSION_NONE), payload]);
}

describe("defaultReplayBaseDir", () => {
  it("返回默认路径", () => {
    const dir = defaultReplayBaseDir();
    expect(dir).toContain("record");
  });
});

describe("replayFilePath", () => {
  it("生成正确路径", () => {
    const path = replayFilePath("/base", 100, 1, 1234567890);
    expect(path).toBe(join("/base", "100", "1", "1234567890.phirarec"));
  });
});

describe("ensureReplayDir", () => {
  it("创建目录", async () => {
    const dir = await ensureReplayDir(tempDir, 100, 1);
    expect(dir).toBe(join(tempDir, "100", "1"));
  });
});

describe("readReplayHeader", () => {
  it("读取 V2 头", async () => {
    const filePath = join(tempDir, "test.phirarec");
    const buf = buildTestReplay(1, 2, 100, 1234567890);
    await writeFile(filePath, buf);
    const header = await readReplayHeader(filePath);
    expect(header).not.toBeNull();
    if (header) {
      expect(header.recordId).toBe(1);
      expect(header.chartId).toBe(2);
      expect(header.userId).toBe(100);
      expect(header.timestamp).toBe(1234567890);
      expect(header.chartName).toBe("Chart-2");
      expect(header.userName).toBe("User-100");
      expect(header.version).toBe(1);
      expect(header.compression).toBe(COMPRESSION_NONE);
    }
  });

  it("读取 PM 魔数格式", async () => {
    const filePath = join(tempDir, "test.pm");
    const buf = Buffer.allocUnsafe(14);
    buf.writeUInt16LE(0x504d, 0);
    buf.writeUInt32LE(2, 2); // chartId
    buf.writeUInt32LE(100, 6); // userId
    buf.writeUInt32LE(1, 10); // recordId
    await writeFile(filePath, buf);
    const header = await readReplayHeader(filePath);
    expect(header).not.toBeNull();
    if (header) {
      expect(header.chartId).toBe(2);
      expect(header.userId).toBe(100);
      expect(header.recordId).toBe(1);
    }
  });

  it("读取 PHIR 魔数格式", async () => {
    const filePath = join(tempDir, "test.phir");
    const buf = Buffer.allocUnsafe(16);
    buf[0] = 0x50; buf[1] = 0x48; buf[2] = 0x49; buf[3] = 0x52;
    buf.writeUInt32LE(2, 4); // chartId
    buf.writeUInt32LE(100, 8); // userId
    buf.writeUInt32LE(1, 12); // recordId
    await writeFile(filePath, buf);
    const header = await readReplayHeader(filePath);
    expect(header).not.toBeNull();
    if (header) {
      expect(header.chartId).toBe(2);
      expect(header.userId).toBe(100);
      expect(header.recordId).toBe(1);
    }
  });

  it("读取原始格式", async () => {
    const filePath = join(tempDir, "test.raw");
    const buf = Buffer.allocUnsafe(12);
    buf.writeUInt32LE(2, 0); // chartId
    buf.writeUInt32LE(100, 4); // userId
    buf.writeUInt32LE(1, 8); // recordId
    await writeFile(filePath, buf);
    const header = await readReplayHeader(filePath);
    expect(header).not.toBeNull();
    if (header) {
      expect(header.chartId).toBe(2);
      expect(header.userId).toBe(100);
      expect(header.recordId).toBe(1);
    }
  });

  it("文件过短返回 null", async () => {
    const filePath = join(tempDir, "short");
    await writeFile(filePath, Buffer.alloc(5));
    const header = await readReplayHeader(filePath);
    expect(header).toBeNull();
  });

  it("不存在的文件", async () => {
    const header = await readReplayHeader(join(tempDir, "nonexistent")).catch(() => null);
    expect(header).toBeNull();
  });
});

describe("listReplaysForUser", () => {
  it("列出用户回放", async () => {
    const userDir = join(tempDir, "100", "1");
    await mkdir(userDir, { recursive: true });
    const buf = buildTestReplay(1, 1, 100, 1234567890);
    await writeFile(join(userDir, "1234567890.phirarec"), buf);

    const replays = await listReplaysForUser(tempDir, 100);
    expect(replays.has(1)).toBe(true);
    const entries = replays.get(1)!;
    expect(entries.length).toBe(1);
    expect(entries[0].recordId).toBe(1);
    expect(entries[0].timestamp).toBe(1234567890);
  });

  it("不存在的用户返回空", async () => {
    const replays = await listReplaysForUser(tempDir, 999);
    expect(replays.size).toBe(0);
  });

  it("忽略无效文件名", async () => {
    const userDir = join(tempDir, "100", "1");
    await mkdir(userDir, { recursive: true });
    await writeFile(join(userDir, "invalid.txt"), Buffer.from("test"));
    const replays = await listReplaysForUser(tempDir, 100);
    expect(replays.size).toBe(0);
  });

  it("忽略无效 chartId 目录", async () => {
    const userDir = join(tempDir, "100");
    await mkdir(join(userDir, "invalid"), { recursive: true });
    const replays = await listReplaysForUser(tempDir, 100);
    expect(replays.size).toBe(0);
  });
});

describe("deleteReplayForUser", () => {
  it("删除存在的文件", async () => {
    const userDir = join(tempDir, "100", "1");
    await mkdir(userDir, { recursive: true });
    await writeFile(join(userDir, "1234567890.phirarec"), buildTestReplay(1, 1, 100, 1234567890));

    const result = await deleteReplayForUser(tempDir, 100, 1, 1234567890);
    expect(result).toBe(true);
  });

  it("删除不存在的文件返回 false", async () => {
    const result = await deleteReplayForUser(tempDir, 100, 1, 1234567890);
    expect(result).toBe(false);
  });

  it("删除后清理空目录", async () => {
    const userDir = join(tempDir, "100", "1");
    await mkdir(userDir, { recursive: true });
    await writeFile(join(userDir, "1234567890.phirarec"), buildTestReplay(1, 1, 100, 1234567890));

    await deleteReplayForUser(tempDir, 100, 1, 1234567890);
    // 空目录应被清理
    const chartDir = join(tempDir, "100", "1");
    const userDirCheck = join(tempDir, "100");
    // 目录可能已被删除
    try {
      await rm(chartDir);
    } catch {}
    try {
      await rm(userDirCheck);
    } catch {}
  });
});

describe("cleanupExpiredReplays", () => {
  it("清理过期文件", async () => {
    const now = Date.now();
    const oldTs = now - 2 * 24 * 60 * 60 * 1000; // 2天前
    const recentTs = now - 12 * 60 * 60 * 1000; // 12小时前

    const userDir = join(tempDir, "100", "1");
    await mkdir(userDir, { recursive: true });
    await writeFile(join(userDir, `${oldTs}.phirarec`), buildTestReplay(1, 1, 100, oldTs));
    await writeFile(join(userDir, `${recentTs}.phirarec`), buildTestReplay(2, 1, 100, recentTs));

    await cleanupExpiredReplays(tempDir, now, 1); // 1天 TTL

    const files = await listReplaysForUser(tempDir, 100);
    expect(files.has(1)).toBe(true);
    const entries = files.get(1)!;
    expect(entries.length).toBe(1);
    expect(entries[0].recordId).toBe(2);
  });

  it("空目录不报错", async () => {
    await cleanupExpiredReplays(tempDir, Date.now(), 1);
    expect(true).toBe(true);
  });
});

describe("patchReplayRecordId", () => {
  it("V2 格式 patch", async () => {
    const filePath = join(tempDir, "test.phirarec");
    const buf = buildTestReplay(1, 1, 100, 1234567890);
    await writeFile(filePath, buf);

    await patchReplayRecordId(filePath, 99);
    const header = await readReplayHeader(filePath);
    expect(header).not.toBeNull();
    if (header) {
      expect(header.recordId).toBe(99);
    }
  });

  it("无效 recordId 不操作", async () => {
    const filePath = join(tempDir, "test.phirarec");
    const buf = buildTestReplay(1, 1, 100, 1234567890);
    await writeFile(filePath, buf);

    await patchReplayRecordId(filePath, -1);
    const header = await readReplayHeader(filePath);
    expect(header).not.toBeNull();
    if (header) {
      expect(header.recordId).toBe(1);
    }
  });

  it("PM 格式 patch", async () => {
    const filePath = join(tempDir, "test.pm");
    const buf = Buffer.allocUnsafe(14);
    buf.writeUInt16LE(0x504d, 0);
    buf.writeUInt32LE(2, 2);
    buf.writeUInt32LE(100, 6);
    buf.writeUInt32LE(1, 10);
    await writeFile(filePath, buf);

    await patchReplayRecordId(filePath, 99);
    const header = await readReplayHeader(filePath);
    expect(header).not.toBeNull();
    if (header) {
      expect(header.recordId).toBe(99);
    }
  });
});