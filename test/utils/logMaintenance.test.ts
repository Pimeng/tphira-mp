import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatLocalDateKey } from "../../src/server/utils/logger.js";
import { startLogMaintenance } from "../../src/server/utils/logMaintenance.js";

const baseDir = join(tmpdir(), "phira-mp-log-maintenance-tests");
const created: string[] = [];

function makeTempDir(name: string): string {
  const dir = join(baseDir, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

/** 生成相对今天偏移 deltaDays 天的日志文件名（YYYY-MM-DD.log） */
function logNameDaysAgo(deltaDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - deltaDays);
  return `${formatLocalDateKey(d)}.log`;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("startLogMaintenance", () => {
  test("将超过保留天数的历史日志压缩为 .gz，且不动当天活动日志", async () => {
    const dir = makeTempDir("compress");
    const activeName = `${formatLocalDateKey(new Date())}.log`;
    const oldName = "2000-01-01.log";
    const oldContent = "repeated log line\n".repeat(500);
    writeFileSync(join(dir, oldName), oldContent);
    writeFileSync(join(dir, activeName), "active today\n");

    const handle = startLogMaintenance({
      logsDir: dir,
      getCompressAfterDays: () => 14,
      getMaxTotalBytes: () => 0 // 关闭容量控制，只测压缩
    });
    await handle.runOnce();
    handle.stop();

    expect(existsSync(join(dir, oldName))).toBe(false);
    expect(existsSync(join(dir, `${oldName}.gz`))).toBe(true);
    // 内容可无损还原
    const restored = gunzipSync(readFileSync(join(dir, `${oldName}.gz`))).toString("utf8");
    expect(restored).toBe(oldContent);
    // 活动日志保持明文且内容不变
    expect(existsSync(join(dir, activeName))).toBe(true);
    expect(readFileSync(join(dir, activeName), "utf8")).toBe("active today\n");
  });

  test("保留天数内的近期日志不压缩", async () => {
    const dir = makeTempDir("recent");
    const recentName = logNameDaysAgo(3); // 3 天前 < 14 天，应保持明文
    writeFileSync(join(dir, recentName), "recent\n");

    const handle = startLogMaintenance({
      logsDir: dir,
      getCompressAfterDays: () => 14,
      getMaxTotalBytes: () => 0
    });
    await handle.runOnce();
    handle.stop();

    expect(existsSync(join(dir, recentName))).toBe(true);
    expect(existsSync(join(dir, `${recentName}.gz`))).toBe(false);
  });

  test("compressAfterDays 为 0 时关闭压缩", async () => {
    const dir = makeTempDir("compress-off");
    writeFileSync(join(dir, "2000-01-01.log"), "old\n");

    const handle = startLogMaintenance({
      logsDir: dir,
      getCompressAfterDays: () => 0,
      getMaxTotalBytes: () => 0
    });
    await handle.runOnce();
    handle.stop();

    expect(existsSync(join(dir, "2000-01-01.log"))).toBe(true);
    expect(existsSync(join(dir, "2000-01-01.log.gz"))).toBe(false);
  });

  test("目录总占用超上限时从最旧开始删除，直到回落且永不删活动日志", async () => {
    const dir = makeTempDir("sizecap");
    const activeName = `${formatLocalDateKey(new Date())}.log`;
    const chunk = Buffer.alloc(100 * 1024, 0x61); // 100KB
    writeFileSync(join(dir, "2000-01-01.log"), chunk); // 最旧
    writeFileSync(join(dir, "2000-01-02.log"), chunk);
    writeFileSync(join(dir, "2000-01-03.log"), chunk);
    writeFileSync(join(dir, activeName), chunk); // 当天，不可删

    const handle = startLogMaintenance({
      logsDir: dir,
      getCompressAfterDays: () => 0, // 关闭压缩，专测容量控制
      getMaxTotalBytes: () => 250 * 1024 // 上限 250KB：保留 2 个文件
    });
    await handle.runOnce();
    handle.stop();

    // 最旧两个被删，第三个与活动日志保留
    expect(existsSync(join(dir, "2000-01-01.log"))).toBe(false);
    expect(existsSync(join(dir, "2000-01-02.log"))).toBe(false);
    expect(existsSync(join(dir, "2000-01-03.log"))).toBe(true);
    expect(existsSync(join(dir, activeName))).toBe(true);
  });

  test("不识别的文件不受影响", async () => {
    const dir = makeTempDir("ignore");
    writeFileSync(join(dir, "2000-01-01.log"), "x".repeat(1000));
    writeFileSync(join(dir, "notes.txt"), "keep me");
    writeFileSync(join(dir, "server.log"), "legacy"); // 非按日切分命名，不处理

    const handle = startLogMaintenance({
      logsDir: dir,
      getCompressAfterDays: () => 14,
      getMaxTotalBytes: () => 1 // 极小上限：但仅清理可识别的日志
    });
    await handle.runOnce();
    handle.stop();

    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
    expect(existsSync(join(dir, "server.log"))).toBe(true);
    // 仅被识别的 2000-01-01 日志可能被压缩/清理
    const remaining = readdirSync(dir).sort();
    expect(remaining).toContain("notes.txt");
    expect(remaining).toContain("server.log");
  });
});
