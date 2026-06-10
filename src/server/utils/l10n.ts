import { FluentBundle, FluentResource, type FluentVariable } from "@fluent/bundle";
import { negotiateLanguages } from "@fluent/langneg";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAppPaths } from "../utils/appPaths.js";
import { EMBEDDED_LOCALES } from "./embeddedLocales.js";

export const SUPPORTED_LANGS = ["en-US", "zh-CN", "zh-TW", "ja-JP", "ko-KR", "ru-RU"] as const;
type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/**
 * 将结构化的 message 映射组装回 Fluent 源文本。
 */
function assembleFtl(messages: Record<string, string>): string {
  const parts: string[] = [];
  for (const [id, body] of Object.entries(messages)) {
    parts.push(`${id} =${body}`);
  }
  return parts.join("\n\n");
}

/**
 * 读取某语言的 .ftl 源文本。优先磁盘（源码根目录或 locales 缓存目录下的 locales.json），
 * 缺失或为空时回退到嵌入二进制的内容，保证离线时仍可用。
 */
function readLocaleSource(lang: SupportedLang): string {
  const paths = getAppPaths();
  for (const base of [paths.rootDir, paths.localesDir]) {
    try {
      const data = JSON.parse(readFileSync(join(base, "locales.json"), "utf8")) as Record<
        string,
        Record<string, string>
      >;
      const messages = data[lang];
      if (messages && Object.keys(messages).length > 0) return assembleFtl(messages);
    } catch {
      // 文件不存在 / 不可读 / JSON 解析失败，继续尝试下一个
    }
  }
  const embedded = EMBEDDED_LOCALES[lang];
  return embedded ? assembleFtl(embedded) : "";
}

/**
 * 读取运行时覆盖文件 locales/<lang>.ftl 的源文本。
 *
 * 服主可在 locales 目录放一个只含「要改的键」的 .ftl，运行时逐键覆盖二进制自带翻译
 * （覆盖而非整体替换：未列出的键仍走内置）。开发期源码自带的全量 locales/*.ftl 也走这里
 * ——它覆盖全部键，等价于「直接按 ftl 解析」。文件不存在 / 为空 / 不可读时返回 null。
 */
function readLocaleOverride(lang: SupportedLang): string | null {
  const path = join(getAppPaths().localesDir, `${lang}.ftl`);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** 统计一段 .ftl 源里定义了多少个消息键（顶格的 `id =` 行）。 */
function countFtlMessages(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (/^[A-Za-z][\w-]* *=/.test(line)) count++;
  }
  return count;
}

/**
 * 探测各受支持语言是否存在 locales/<lang>.ftl 覆盖文件及其键数，供启动日志提示。
 * 纯只读，不构建 bundle、不抛错。
 */
export function detectLocaleOverrides(): { lang: SupportedLang; count: number }[] {
  const result: { lang: SupportedLang; count: number }[] = [];
  for (const lang of SUPPORTED_LANGS) {
    const text = readLocaleOverride(lang);
    if (text) result.push({ lang, count: countFtlMessages(text) });
  }
  return result;
}

// 懒加载并缓存。延迟到首次使用，使入口可在加载前先在线拉取 / 落盘 locales。
const bundleCache = new Map<SupportedLang, FluentBundle>();

function getBundle(lang: SupportedLang): FluentBundle {
  const cached = bundleCache.get(lang);
  if (cached) return cached;
  const bundle = new FluentBundle(lang, { useIsolating: false });
  // 基础层：磁盘 locales.json → 嵌入兜底。
  bundle.addResource(new FluentResource(readLocaleSource(lang)));
  // 覆盖层：locales/<lang>.ftl 若存在则逐键覆盖（allowOverrides 实现「覆盖不替换」）。
  const override = readLocaleOverride(lang);
  if (override) {
    bundle.addResource(new FluentResource(override), { allowOverrides: true });
  }
  bundleCache.set(lang, bundle);
  return bundle;
}

export class Language {
  readonly lang: SupportedLang;

  constructor(lang: string) {
    const normalized = normalizeLocaleHint(lang);
    const resolved = negotiateLanguages([normalized], SUPPORTED_LANGS, { defaultLocale: "zh-CN" });
    this.lang = (resolved[0] as SupportedLang) ?? "zh-CN";
  }

  format(key: string, args?: Record<string, FluentVariable>): string {
    const bundle = getBundle(this.lang);
    const msg = bundle.getMessage(key);
    if (!msg || !msg.value) {
      throw new Error(`缺少翻译：${key}（lang=${this.lang}）`);
    }
    return bundle.formatPattern(msg.value, args ?? null, null);
  }
}

/**
 * 把 POSIX 形式的 locale 提示（如 "en_US.UTF-8"、"zh_CN"）规范成 BCP 47 风格
 * （"en-US"、"zh-CN"），方便 negotiateLanguages 协商。空字符串原样返回。
 */
function normalizeLocaleHint(hint: string): string {
  const trimmed = hint.trim();
  if (!trimmed) return "";
  // 去掉编码后缀（@... 或 .UTF-8 等）
  const base = trimmed.split(/[.@]/, 1)[0] ?? trimmed;
  return base.replace(/_/g, "-");
}

export function tl(lang: Language, key: string, args?: Record<string, FluentVariable>): string {
  return lang.format(key, args);
}
