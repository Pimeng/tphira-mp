import { describe, it, expect } from "vitest";
import { FluentResource } from "@fluent/bundle";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * i18n 覆盖测试。
 *
 * 本项目使用 Fluent（@fluent/bundle）做本地化，翻译文件在 locales/<lang>.ftl，
 * 代码里通过以下方式引用翻译键：
 *   - tl(lang, "key", args)           显式翻译调用
 *   - lang.format("key", args)        Language.format 直调
 *   - t("key", args)                  路由/CLI 里注入的 tl 包装回调
 *
 * 另外，部分裸键会以 `throw new Error("key")` 抛出，稍后由 lang.format(err.message)
 * 二次本地化。但并非所有 `new Error("...")` 都是翻译键——有些只是内部错误标识符
 * （如 mutex-timeout、server-close-timeout，从不本地化）。因此 new Error 仅作为
 * 「宽松提及」用于「无用翻译」判定，不进入「缺失翻译」的严格检查，以免误报。
 *
 * 该测试做三件事：
 *   1. locale 一致性：两个 .ftl 文件的键集合必须完全相同。
 *   2. 缺失翻译：代码里在 i18n 调用点（tl/format/t）用到的键，必须在 .ftl 中有定义
 *      （否则运行时 Language.format 会抛 "缺少翻译" 错误）。
 *   3. 无用翻译：.ftl 里定义的键，必须在源码中以字符串字面量形式被提及（否则是死翻译）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const localesDir = join(repoRoot, "locales");
const srcDir = join(repoRoot, "src");

const LOCALE_FILES = ["en-US.ftl", "zh-CN.ftl"] as const;

/** kebab/标识符风格的翻译键，例如 join-room-full、cli-invalid-port。 */
const KEY = "[a-z][a-zA-Z0-9_-]*";

/** 解析一个 .ftl 文件，返回其中定义的消息键集合（不含 -term 私有项）。 */
function parseFtlKeys(file: string): Set<string> {
  const source = readFileSync(join(localesDir, file), "utf8");
  const resource = new FluentResource(source);
  const keys = new Set<string>();
  for (const entry of resource.body) {
    // FluentResource.body 里 Message 与 Term 都带 id，Term 以 "-" 开头，过滤掉。
    const id = (entry as { id?: string }).id;
    if (id && !id.startsWith("-")) keys.add(id);
  }
  return keys;
}

/** 递归收集 src 下所有 .ts 文件。 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectSourceFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * 从源码里抽取「显式 i18n 调用点」用到的键。
 * 这些是高置信引用：若键不存在，运行时会直接抛 "缺少翻译" 错误。
 */
function extractReferencedKeys(sources: { file: string; text: string }[]): Map<string, string[]> {
  // 每个模式的捕获组都是翻译键本身。
  const patterns: RegExp[] = [
    // tl(<langExpr>, "key" ...) —— langExpr 形如 lang / user.lang / this.state.serverLang
    new RegExp(`\\btl\\(\\s*[\\w$.\\[\\]]+\\s*,\\s*["'\`](${KEY})["'\`]`, "g"),
    // .format("key" ...)
    new RegExp(`\\.format\\(\\s*["'\`](${KEY})["'\`]`, "g"),
    // t("key" ...) —— 注入的 tl 包装回调；\b 保证不会匹配 format( 等结尾的 t(
    new RegExp(`\\bt\\(\\s*["'\`](${KEY})["'\`]`, "g")
  ];

  const refs = new Map<string, string[]>();
  for (const { file, text } of sources) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const key = m[1]!;
        const rel = file.slice(repoRoot.length + 1).replaceAll("\\", "/");
        const list = refs.get(key) ?? [];
        if (!list.includes(rel)) list.push(rel);
        refs.set(key, list);
      }
    }
  }
  return refs;
}

const localeKeys = new Map(LOCALE_FILES.map((f) => [f, parseFtlKeys(f)]));
const sources = collectSourceFiles(srcDir).map((file) => ({ file, text: readFileSync(file, "utf8") }));
const referenced = extractReferencedKeys(sources);

/** 某个键是否作为字符串字面量在源码任意位置出现（用于「无用键」判定，宽松匹配以容忍间接传参）。 */
function isMentionedInSource(key: string): boolean {
  // 匹配 "key" / 'key' / `key` / `key:...`（带冒号后缀的裸键模板字面量）
  const re = new RegExp(`["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:["'\`]|:)`);
  return sources.some((s) => re.test(s.text));
}

describe("i18n 覆盖", () => {
  it("每个 locale 至少解析出一批键", () => {
    for (const [file, keys] of localeKeys) {
      expect(keys.size, `${file} 应包含翻译键`).toBeGreaterThan(0);
    }
  });

  it("各 locale 的键集合完全一致", () => {
    const [base, ...rest] = LOCALE_FILES;
    const baseKeys = localeKeys.get(base)!;
    for (const file of rest) {
      const keys = localeKeys.get(file)!;
      const missingInThis = [...baseKeys].filter((k) => !keys.has(k)).sort();
      const extraInThis = [...keys].filter((k) => !baseKeys.has(k)).sort();
      expect(missingInThis, `${file} 相比 ${base} 缺少这些键`).toEqual([]);
      expect(extraInThis, `${file} 相比 ${base} 多出这些键`).toEqual([]);
    }
  });

  it("代码引用的每个翻译键都有对应的 .ftl 定义", () => {
    const missing: string[] = [];
    for (const [key, files] of referenced) {
      for (const [locale, keys] of localeKeys) {
        if (!keys.has(key)) {
          missing.push(`键 "${key}" 在 ${locale} 中缺失（引用于 ${files.join(", ")}）`);
        }
      }
    }
    expect(missing.sort()).toEqual([]);
  });

  it("每个 .ftl 翻译键都在源码中被使用", () => {
    // 以第一个 locale 为基准；上一个用例已保证各 locale 键集合一致。
    const allKeys = localeKeys.get(LOCALE_FILES[0])!;
    const unused = [...allKeys].filter((key) => !isMentionedInSource(key)).sort();
    expect(unused, "这些翻译键在源码中没有被引用（疑似死翻译）").toEqual([]);
  });
});
