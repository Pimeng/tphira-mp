/**
 * 从 locales/*.ftl 生成 src/server/utils/embeddedLocales.ts（嵌入 SEA 二进制 / 打进 bundle 的
 * 离线兜底，键按字典序便于 diff）。
 *
 * i18n 的唯一手工编辑源是 locales/<语言>.ftl；embeddedLocales.ts 是其唯一提交的生成产物。
 * 修改任意 .ftl 后运行 `pnpm gen:locales` 重新生成。
 *
 * 注意：本脚本【不】往 locales/ 写 locales.json（避免污染源码目录）。release 资产 locales.json
 * 由 tools/emit-locales-json.mjs 按需生成到构建目录，见该文件与 CI / Dockerfile。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 与 SUPPORTED_LANGS 保持一致（l10n.ts）。
export const LANGS = ["en-US", "zh-CN", "zh-TW", "ja-JP", "ko-KR", "ru-RU"];
const localesDir = "locales";
const outFile = join("src", "server", "utils", "embeddedLocales.ts");

/** 消息行：`id =<body>`（保留 = 之后的全部字符，含前导空格）。 */
const MESSAGE_RE = /^([A-Za-z][\w-]*) *=(.*)$/;

/**
 * 行级解析单个 .ftl 文本为 { 键: body } 映射。
 *
 * 规则（与 l10n.ts 的 assembleFtl `${id} =${body}`、消息间以空行分隔 互为逆操作）：
 *   - 顶格的 `id =` 行是消息边界，其余行（含空行、# 注释、列 0 的选择器闭合 `}`）
 *     都归属于上一条消息的 body；
 *   - body = 该 `id =` 行 = 之后的内容，再以 \n 拼接到下一条边界前的所有行，
 *     最后去掉尾部空行（消息间分隔符，不属于值）。
 * 这样可无损还原多行值与 `{ $x -> ... }` 选择器（即便注释/空行夹在其中）。
 */
export function parseFtl(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const messages = {};
  let curId = null;
  let body = [];
  const flush = () => {
    if (curId === null) return;
    // 去掉尾部空行（消息间分隔，不属于值）
    while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
    messages[curId] = body.join("\n");
    curId = null;
    body = [];
  };
  for (const line of lines) {
    const m = MESSAGE_RE.exec(line);
    if (m) {
      flush();
      curId = m[1];
      body = [m[2]];
    } else if (curId !== null) {
      body.push(line);
    }
  }
  flush();
  return messages;
}

/** 解析全部语言的 .ftl 为 { 语言: { 键: body } }（键保持 ftl 源顺序）。 */
export function buildLocaleMap() {
  const map = {};
  for (const lang of LANGS) {
    map[lang] = parseFtl(readFileSync(join(localesDir, `${lang}.ftl`), "utf8"));
  }
  return map;
}

function main() {
  const map = buildLocaleMap();
  // 语言一律按 localeCompare 排序。
  const sortedLangs = [...LANGS].sort((a, b) => a.localeCompare(b));

  // embeddedLocales.ts：键按字典序，diff 友好。
  const entries = sortedLangs.map((lang) => {
    const msgEntries = Object.entries(map[lang])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, body]) => `      ${JSON.stringify(id)}: ${JSON.stringify(body)}`);
    return `  ${JSON.stringify(lang)}: {
${msgEntries.join(",\n")}
  }`;
  });

  const out = `// 本文件由 tools/gen-embedded-locales.mjs 自动生成，请勿手动编辑。
// 修改 locales/*.ftl 后运行 \`pnpm gen:locales\` 重新生成。
/* eslint-disable */
export const EMBEDDED_LOCALES: Record<string, Record<string, string>> = {
${entries.join(",\n")}
};
`;

  writeFileSync(outFile, out, "utf8");
  console.log(`已从 ${LANGS.length} 个 .ftl 生成 ${outFile}`);
}

/**
 * 把全部语言合并为 release 资产用的 locales.json 文本（语言按 localeCompare，键保持 ftl 源顺序）。
 * 供 tools/emit-locales-json.mjs 落盘到构建目录。
 */
export function buildLocalesJson() {
  const map = buildLocaleMap();
  const jsonMap = {};
  for (const lang of [...LANGS].sort((a, b) => a.localeCompare(b))) jsonMap[lang] = map[lang];
  return JSON.stringify(jsonMap, null, 2) + "\n";
}

// 仅在作为脚本直接执行时运行（被测试 import 时不产生副作用）。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
