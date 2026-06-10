import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 运行时 ftl 覆盖测试。
 *
 * 在 locales/<lang>.ftl 放一个「只含要改的键」的局部 ftl，启动后应逐键覆盖二进制自带翻译：
 *   - 被列出的键 → 取覆盖值；
 *   - 未列出的键 → 仍回退内置（覆盖而非整体替换）；
 *   - 覆盖文件可新增内置不存在的键。
 *
 * getAppPaths 与 l10n 的 bundle 都有模块级缓存，故每个用例 resetModules + 动态 import 以隔离。
 */
describe("locales/<lang>.ftl 运行时覆盖", () => {
  let home: string;
  const prevHome = process.env.PHIRA_MP_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "l10n-override-"));
    mkdirSync(join(home, "locales"), { recursive: true });
    process.env.PHIRA_MP_HOME = home;
    vi.resetModules();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.PHIRA_MP_HOME;
    else process.env.PHIRA_MP_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("覆盖列出的键、保留未列出的键、支持新增键", async () => {
    writeFileSync(
      join(home, "locales", "zh-CN.ftl"),
      "chat-hitokoto-from-unknown = 测试匿名覆盖\ncustom-override-key = 这是新增键\n",
      "utf8"
    );

    const { Language, tl } = await import("../../src/server/utils/l10n.js");
    const lang = new Language("zh-CN");

    // 被覆盖的键 → 取覆盖值
    expect(tl(lang, "chat-hitokoto-from-unknown").trim()).toBe("测试匿名覆盖");
    // 覆盖文件新增的键 → 可用
    expect(tl(lang, "custom-override-key").trim()).toBe("这是新增键");
    // 未覆盖的键 → 仍回退内置
    expect(tl(lang, "join-room-full").trim()).toBe("房间已满");
  });

  it("无覆盖文件时全部走内置", async () => {
    const { Language, tl } = await import("../../src/server/utils/l10n.js");
    const lang = new Language("zh-CN");
    expect(tl(lang, "chat-hitokoto-from-unknown").trim()).toBe("佚名");
  });

  it("覆盖层不破坏内置的 Fluent 选择器", async () => {
    writeFileSync(join(home, "locales", "zh-CN.ftl"), "join-room-full = 满了\n", "utf8");

    const { Language, tl } = await import("../../src/server/utils/l10n.js");
    const lang = new Language("zh-CN");
    // log-msg-lock-room 是内置的 { $lock -> ... } 选择器，未被覆盖，仍应正常求值
    expect(tl(lang, "log-msg-lock-room", { lock: "true" }).trim()).toBe("房间已锁定");
    expect(tl(lang, "join-room-full").trim()).toBe("满了");
  });
});
