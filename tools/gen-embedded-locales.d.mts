// tools/gen-embedded-locales.mjs 的类型声明（供测试 import parseFtl/buildLocaleMap 使用）。
export declare const LANGS: readonly string[];
export declare function parseFtl(text: string): Record<string, string>;
export declare function buildLocaleMap(): Record<string, Record<string, string>>;
export declare function buildLocalesJson(): string;
