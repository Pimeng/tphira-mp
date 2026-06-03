import { Cache } from "./cache.js";
import { fetchWithTimeout, type OutboundProxyValue } from "../../common/http.js";

const HITOKOTO_FETCH_TIMEOUT_MS = 3000;
const HITOKOTO_CACHE_TTL_MS = 60_000;
const HITOKOTO_MIN_INTERVAL_MS = 600;

type HitokotoValue = { quote: string; from: string };

const hitokotoCache = new Cache<"current", HitokotoValue>({
  fileName: "hitokoto_cache.json",
  maxMemorySize: 10,
  ttl: HITOKOTO_CACHE_TTL_MS,
  persistToDisk: false
});

let lastAttemptAt = 0;
let inFlight: Promise<HitokotoValue | null> | null = null;
/**
 * 最近一次成功获取的一言，不随 60s 缓存 TTL 过期。
 * 当 TTL 过期后重新获取失败（远端故障/超时）时，回退到它，避免欢迎消息缺一言；
 * 仅在「进程启动后从未成功过」时才为 null。
 */
let lastGood: HitokotoValue | null = null;

async function fetchHitokoto(proxy?: OutboundProxyValue, url?: string): Promise<HitokotoValue | null> {
  if (!url) return null;
  const res = await fetchWithTimeout(url.trim(), { proxy }, HITOKOTO_FETCH_TIMEOUT_MS);
  if (!res.ok) return null;
  const json = (await res.json()) as { hitokoto?: unknown; from?: unknown; from_who?: unknown };
  const quote = typeof json.hitokoto === "string" ? json.hitokoto.trim() : "";
  if (!quote) return null;
  const fromWho = typeof json.from_who === "string" ? json.from_who.trim() : "";
  const from = typeof json.from === "string" ? json.from.trim() : "";
  const displayFrom = fromWho || from;
  return { quote, from: displayFrom };
}

export async function getHitokotoCached(proxy?: OutboundProxyValue, url?: string): Promise<HitokotoValue | null> {
  const now = Date.now();

  // 先检查缓存
  const cached = await hitokotoCache.get("current");
  if (cached) return cached;

  // 如果已经有进行中的请求，直接等待它
  if (inFlight) return await inFlight;

  // 控制最小请求间隔，避免频繁请求远端
  if (now - lastAttemptAt < HITOKOTO_MIN_INTERVAL_MS) {
    return cached ?? lastGood;
  }

  lastAttemptAt = now;
  inFlight = (async () => {
    try {
      const value = await fetchHitokoto(proxy, url);
      if (value) {
        await hitokotoCache.set("current", value);
        lastGood = value;
        return value;
      }
      return cached ?? lastGood;
    } catch {
      return cached ?? lastGood;
    } finally {
      inFlight = null;
    }
  })();

  return await inFlight;
}
