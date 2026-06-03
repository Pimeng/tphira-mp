import { FluentBundle, FluentResource, type FluentVariable } from "@fluent/bundle";
import { negotiateLanguages } from "@fluent/langneg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAppPaths } from "../utils/appPaths.js";

const SUPPORTED_LANGS = ["en-US", "zh-CN", "zh-TW", "ja-JP", "ko-KR", "ru-RU"] as const;
type SupportedLang = (typeof SUPPORTED_LANGS)[number];

function loadBundle(lang: SupportedLang): FluentBundle {
  const bundle = new FluentBundle(lang, { useIsolating: false });
  const path = join(getAppPaths().localesDir, `${lang}.ftl`);
  const source = readFileSync(path, "utf8");
  bundle.addResource(new FluentResource(source));
  return bundle;
}

const bundles: Record<SupportedLang, FluentBundle> = Object.fromEntries(
  SUPPORTED_LANGS.map((lang) => [lang, loadBundle(lang)])
) as Record<SupportedLang, FluentBundle>;

export class Language {
  readonly lang: SupportedLang;

  constructor(lang: string) {
    const normalized = normalizeLocaleHint(lang);
    const resolved = negotiateLanguages([normalized], SUPPORTED_LANGS, { defaultLocale: "zh-CN" });
    this.lang = (resolved[0] as SupportedLang) ?? "zh-CN";
  }

  format(key: string, args?: Record<string, FluentVariable>): string {
    const bundle = bundles[this.lang];
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
