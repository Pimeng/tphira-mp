/**
 * 把 locales/*.ftl 合并生成 release 资产 locales.json，落盘到【构建目录】（默认 dist-bundle/），
 * 而非源码 locales/ 目录——后者只放 ftl 源，不被生成产物污染。
 *
 * 用法：node tools/emit-locales-json.mjs [输出路径]
 *   - 缺省输出：dist-bundle/locales.json
 *   - CI / Dockerfile 传入显式路径（如 phira-mp-nodejs/locales/locales.json）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildLocalesJson } from "./gen-embedded-locales.mjs";

const out = process.argv[2] || "dist-bundle/locales.json";
mkdirSync(dirname(out) || ".", { recursive: true });
writeFileSync(out, buildLocalesJson(), "utf8");
console.log(`已生成 ${out}`);
