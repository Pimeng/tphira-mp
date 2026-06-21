import { describe, expect, test } from "vitest";
import { Language, SUPPORTED_LANGS } from "../../src/server/utils/l10n.js";

/**
 * 回归测试 issue #9：log-player-join 在 en/ja/ko/ru 曾用占位符 { $who }，
 * 但调用处（session.ts 玩家加入日志）传的是 { user, id, monitorSuffix }，
 * 参数名不匹配导致 Fluent 渲染出字面占位符而非用户名。
 *
 * 这里对全部受支持语言渲染该键，断言：
 * 1. 用户名与 ID 正常出现；
 * 2. 输出中不残留任何 `{ $...}` 占位符（即所有变量都被成功替换）；
 * 3. monitorSuffix 传入时能出现在输出里。
 */
describe("l10n: log-player-join 占位符与调用参数一致 (issue #9)", () => {
  const CALL_ARGS = { user: "Tester", id: 100, monitorSuffix: "" } as const;

  for (const lang of SUPPORTED_LANGS) {
    test(`${lang} 渲染出用户名且无残留占位符`, () => {
      const out = new Language(lang).format("log-player-join", CALL_ARGS);
      expect(out).toContain("Tester");
      expect(out).toContain("100");
      // 任何未被替换的变量都会以 { $name } 形式残留
      expect(out).not.toMatch(/\{\s*\$/);
    });

    test(`${lang} monitorSuffix 能正确插入`, () => {
      const out = new Language(lang).format("log-player-join", {
        user: "Tester",
        id: 100,
        monitorSuffix: "[MON]"
      });
      expect(out).toContain("[MON]");
      expect(out).not.toMatch(/\{\s*\$/);
    });
  }
});
