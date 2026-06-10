import { describe, expect, test } from "vitest";
import { EMBEDDED_LOCALES } from "../../src/server/utils/embeddedLocales.js";
import { SUPPORTED_LANGS } from "../../src/server/utils/l10n.js";
// 用与 gen:locales 同一套解析器从 ftl 还原，作为嵌入产物的对照基准。
import { buildLocaleMap } from "../../tools/gen-embedded-locales.mjs";

describe("嵌入式 locales 兜底", () => {
  test("覆盖全部受支持语言且非空", () => {
    for (const lang of SUPPORTED_LANGS) {
      const messages = EMBEDDED_LOCALES[lang];
      expect(messages, `缺少嵌入语言 ${lang}`).toBeTruthy();
      expect(Object.keys(messages).length, `${lang} 不应为空`).toBeGreaterThan(0);
    }
  });

  test("嵌入内容与 locales/*.ftl 完全一致（防止忘记 pnpm gen:locales）", () => {
    const parsed = buildLocaleMap() as Record<string, Record<string, string>>;
    for (const lang of SUPPORTED_LANGS) {
      // toEqual 比较对象内容（忽略键顺序：嵌入按字典序、ftl 按源顺序）。
      expect(EMBEDDED_LOCALES[lang], `${lang} 的嵌入内容已过期，请运行 pnpm gen:locales`).toEqual(parsed[lang]);
    }
  });
});
