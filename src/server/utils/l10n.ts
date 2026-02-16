import { FluentBundle, FluentResource, type FluentVariable } from "@fluent/bundle";
import { negotiateLanguages } from "@fluent/langneg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAppPaths } from "../utils/appPaths.js";

export const SUPPORTED_LANGS = ["en-US", "zh-CN"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

function loadBundle(lang: SupportedLang): FluentBundle {
  const bundle = new FluentBundle(lang, { useIsolating: false });
  const path = join(getAppPaths().localesDir, `${lang}.ftl`);
  const source = readFileSync(path, "utf8");
  bundle.addResource(new FluentResource(source));
  return bundle;
}

const bundles: Record<SupportedLang, FluentBundle> = {
  "en-US": loadBundle("en-US"),
  "zh-CN": loadBundle("zh-CN")
};

export class Language {
  readonly lang: SupportedLang;

  constructor(lang: string) {
    const resolved = negotiateLanguages([lang], SUPPORTED_LANGS, { defaultLocale: "zh-CN" });
    this.lang = (resolved[0] as SupportedLang) ?? "zh-CN";
  }

  format(key: string, args?: Record<string, FluentVariable>): string {
    const bundle = bundles[this.lang];
    const msg = bundle.getMessage(key);
    if (!msg || !msg.value) {
      throw new Error(`缺少翻译：${key}（lang=${this.lang}）`);
    }
    const errors: Error[] = [];
    const out = bundle.formatPattern(msg.value, args ?? null, errors);
    return out;
  }
}

export function tl(lang: Language, key: string, args?: Record<string, FluentVariable>): string {
  return lang.format(key, args);
}
