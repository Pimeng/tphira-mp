import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { applyConfigUpdates, persistConfigValues } from "../../src/server/core/configPersist.js";
import { createTempDir } from "../helpers.js";

describe("applyConfigUpdates（保留注释的逐行更新）", () => {
  it("替换已存在的顶层键，保留其余注释/空行/键", () => {
    const text = ["# 是否启用回放", "REPLAY_ENABLED: false", "", "# 端口", "PORT: 12346", ""].join("\n");
    const out = applyConfigUpdates(text, { REPLAY_ENABLED: true });
    expect(out).toBe(["# 是否启用回放", "REPLAY_ENABLED: true", "", "# 端口", "PORT: 12346", ""].join("\n"));
  });

  it("键不存在时在末尾追加，原内容不动", () => {
    const text = "PORT: 12346\n";
    const out = applyConfigUpdates(text, { ROOM_CREATION_ENABLED: false });
    expect(out).toBe("PORT: 12346\nROOM_CREATION_ENABLED: false\n");
  });

  it("空内容也能追加，并补全结尾换行", () => {
    expect(applyConfigUpdates("", { REPLAY_ENABLED: true })).toBe("REPLAY_ENABLED: true\n");
    expect(applyConfigUpdates("PORT: 1", { REPLAY_ENABLED: true })).toBe("PORT: 1\nREPLAY_ENABLED: true\n");
  });

  it("不误伤嵌套块里的同名子键（仅匹配行首无缩进的顶层键）", () => {
    const text = ["REDIS:", "  ENABLED: false", "  PORT: 6379"].join("\n");
    // 顶层并无 ENABLED 键，应作为新键追加，而非改动 REDIS.ENABLED
    const out = applyConfigUpdates(text, { ENABLED: true });
    expect(out).toBe(["REDIS:", "  ENABLED: false", "  PORT: 6379", "ENABLED: true", ""].join("\n"));
  });

  it("被注释掉的示例行不算命中，追加活动行", () => {
    const text = "# ROOM_CREATION_ENABLED: true\n";
    const out = applyConfigUpdates(text, { ROOM_CREATION_ENABLED: false });
    expect(out).toBe("# ROOM_CREATION_ENABLED: true\nROOM_CREATION_ENABLED: false\n");
  });

  it("保留 CRLF 行尾", () => {
    const text = "REPLAY_ENABLED: false\r\nPORT: 12346\r\n";
    const out = applyConfigUpdates(text, { REPLAY_ENABLED: true });
    expect(out).toBe("REPLAY_ENABLED: true\r\nPORT: 12346\r\n");
  });

  it("字符串值带引号转义", () => {
    expect(applyConfigUpdates("", { SERVER_NAME: "My Server" })).toBe('SERVER_NAME: "My Server"\n');
  });
});

describe("persistConfigValues（原子落盘）", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("写回保留注释；文件不存在时新建", async () => {
    const dir = await createTempDir("phira-cfgpersist");
    dirs.push(dir);
    const path = join(dir, "server_config.yml");

    // 文件不存在 → 新建仅含目标键
    await persistConfigValues(path, { ROOM_CREATION_ENABLED: false });
    expect(await readFile(path, "utf8")).toBe("ROOM_CREATION_ENABLED: false\n");

    // 再次写：替换值，保留其它行/注释
    await persistConfigValues(path, { ROOM_CREATION_ENABLED: true });
    expect(await readFile(path, "utf8")).toBe("ROOM_CREATION_ENABLED: true\n");
  });

  it("值未变化时跳过写入（不产生差异）", async () => {
    const dir = await createTempDir("phira-cfgpersist-noop");
    dirs.push(dir);
    const path = join(dir, "server_config.yml");
    await persistConfigValues(path, { REPLAY_ENABLED: true });
    const before = await readFile(path, "utf8");
    await persistConfigValues(path, { REPLAY_ENABLED: true });
    expect(await readFile(path, "utf8")).toBe(before);
  });
});
