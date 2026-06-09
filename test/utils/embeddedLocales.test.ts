import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { EMBEDDED_LOCALES } from "../../src/server/utils/embeddedLocales.js";
import { SUPPORTED_LANGS } from "../../src/server/utils/l10n.js";

describe("嵌入式 locales 兜底", () => {
  test("覆盖全部受支持语言且非空", () => {
    for (const lang of SUPPORTED_LANGS) {
      const messages = EMBEDDED_LOCALES[lang];
      expect(messages, `缺少嵌入语言 ${lang}`).toBeTruthy();
      expect(Object.keys(messages).length, `${lang} 不应为空`).toBeGreaterThan(0);
    }
  });

  test("嵌入内容与磁盘 locales.json 的 message id 完全一致（防止忘记 pnpm gen:locales）", () => {
    const diskData = JSON.parse(readFileSync("locales.json", "utf8")) as Record<
      string,
      Record<string, string>
    >;
    for (const lang of SUPPORTED_LANGS) {
      const diskIds = Object.keys(diskData[lang] ?? {}).sort();
      const embeddedIds = Object.keys(EMBEDDED_LOCALES[lang] ?? {}).sort();
      expect(embeddedIds, `${lang} 的嵌入内容已过期，请运行 pnpm gen:locales`).toEqual(diskIds);
    }
  });
});
