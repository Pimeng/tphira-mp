import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LANGS } from "./l10n.js";
import { readAppVersion } from "../core/version.js";

/**
 * release 资产下载基址。
 * - CNB 国内镜像优先（raw.githubusercontent / GitHub 在国内常被墙或很慢）；
 * - 回退到 GitHub release，覆盖镜像缺该版本的情况。
 */
const CNB_RELEASE_BASE = "https://cnb.cool/Phira-download/tphira-mp-mirror/-/releases/download";
const GITHUB_RELEASE_BASE = "https://github.com/Pimeng/tphira-mp/releases/download";

const FETCH_TIMEOUT_MS = 5000;

/** 当前版本对应的 release 资产候选 URL（按优先级）。 */
function releaseAssetUrls(asset: string): string[] {
  const tag = `v${readAppVersion()}`;
  return [`${CNB_RELEASE_BASE}/${tag}/${asset}`, `${GITHUB_RELEASE_BASE}/${tag}/${asset}`];
}

/**
 * 带超时地拉取一段远程文本。任何失败（网络/超时/非 2xx/空）都返回 null，绝不抛出。
 */
export async function fetchRemoteText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 依次尝试多个候选 URL，返回第一个成功的正文；全部失败返回 null。 */
async function fetchFirstAvailable(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    const text = await fetchRemoteText(url);
    if (text) return text;
  }
  return null;
}

/**
 * 在线获取配置示例（server_config.example.yml）：CNB 镜像优先、GitHub release 回退。
 * 失败返回 null，由调用方回退到内置最小模板。
 */
export async function fetchRemoteConfigExample(): Promise<string | null> {
  return fetchFirstAvailable(releaseAssetUrls("server_config.example.yml"));
}

/**
 * 确保磁盘上存在 locales.json：缺失时从 release 拉取补齐。
 * CNB 镜像优先、GitHub release 回退；全部失败时交由 l10n 的嵌入兜底处理。
 * 本函数永不抛出。
 *
 * 跳过条件（均返回 0，不拉取也不写盘）：
 *   - locales.json 已存在；
 *   - localesDir 下已有 <语言>.ftl 源 / 覆盖文件——此时本地化由源码检出或服主手动管理，
 *     不应被在线拉取覆盖，也避免污染开发环境的 locales/ 目录。
 *
 * @returns 是否成功写入（1=成功，0=失败 / 已存在 / 跳过）
 */
export async function ensureLocalesAvailable(localesDir: string): Promise<number> {
  const jsonPath = join(localesDir, "locales.json");
  if (existsSync(jsonPath)) return 0;
  // 存在任一受支持语言的 ftl 时，认为本地化由本地管理，跳过在线拉取。
  if (SUPPORTED_LANGS.some((lang) => existsSync(join(localesDir, `${lang}.ftl`)))) return 0;

  const bundle = await fetchFirstAvailable(releaseAssetUrls("locales.json"));
  if (!bundle) return 0;

  try {
    // 验证 JSON 有效
    JSON.parse(bundle);
    mkdirSync(localesDir, { recursive: true });
    writeFileSync(jsonPath, bundle, "utf8");
    return 1;
  } catch {
    return 0; // 目录不可写或 JSON 无效，交给嵌入兜底
  }
}
