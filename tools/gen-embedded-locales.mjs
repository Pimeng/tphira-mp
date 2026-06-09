/**
 * 从 locales.json 生成 src/server/utils/embeddedLocales.ts。
 *
 * 嵌入二进制的本地化兜底：SEA / 精简发布不再随包附带 locales.json，
 * 运行时优先读磁盘（源码运行或在线拉取后的缓存），缺失时回退到这里嵌入的内容，
 * 保证离线 / raw.githubusercontent 被墙时服务端仍能输出本地化文本。
 *
 * 修改 locales.json 后需重新运行（`pnpm gen:locales`，已串入 build / package:sea）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const localesFile = "locales.json";
const outFile = join("src", "server", "utils", "embeddedLocales.ts");

// 统一换行为 \n，避免 CRLF/LF 在不同平台检出导致嵌入内容与磁盘版本无谓差异
const raw = readFileSync(localesFile, "utf8").replace(/\r\n/g, "\n");
const map = JSON.parse(raw);

const entries = Object.entries(map)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([lang, messages]) => {
    const msgEntries = Object.entries(messages)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, body]) => `      ${JSON.stringify(id)}: ${JSON.stringify(body)}`);
    return `  ${JSON.stringify(lang)}: {
${msgEntries.join(",\n")}
  }`;
  });

const out = `// 本文件由 tools/gen-embedded-locales.mjs 自动生成，请勿手动编辑。
// 修改 locales.json 后运行 \`pnpm gen:locales\` 重新生成。
/* eslint-disable */
export const EMBEDDED_LOCALES: Record<string, Record<string, string>> = {
${entries.join(",\n")}
};
`;

writeFileSync(outFile, out, "utf8");
console.log(`已生成 ${outFile}（${entries.length} 个语言）`);
