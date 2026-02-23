import { Cache } from "./cache.js";
import { fetchWithTimeout } from "../../common/http.js";

const HITOKOTO_URL = "https://v1.hitokoto.cn/";
const HITOKOTO_FETCH_TIMEOUT_MS = 3000;
const HITOKOTO_CACHE_TTL_MS = 60_000;
const HITOKOTO_MIN_INTERVAL_MS = 600;

export type HitokotoValue = { quote: string; from: string };

const hitokotoCache = new Cache<"current", HitokotoValue>({
  fileName: "hitokoto_cache.json",
  maxMemorySize: 10,
  ttl: HITOKOTO_CACHE_TTL_MS,
  persistToDisk: false
});

let lastAttemptAt = 0;
let inFlight: Promise<HitokotoValue | null> | null = null;

async function fetchHitokoto(): Promise<HitokotoValue | null> {
  const res = await fetchWithTimeout(HITOKOTO_URL, {}, HITOKOTO_FETCH_TIMEOUT_MS);
  if (!res.ok) return null;
  const json = (await res.json()) as { hitokoto?: unknown; from?: unknown; from_who?: unknown };
  const quote = typeof json.hitokoto === "string" ? json.hitokoto.trim() : "";
  if (!quote) return null;
  const fromWho = typeof json.from_who === "string" ? json.from_who.trim() : "";
  const from = typeof json.from === "string" ? json.from.trim() : "";
  const displayFrom = fromWho || from;
  return { quote, from: displayFrom };
}

export async function getHitokotoCached(): Promise<HitokotoValue | null> {
  const now = Date.now();
  
  // 先检查缓存
  const cached = await hitokotoCache.get("current");
  if (cached) return cached;
  
  // 如果有正在进行的请求，等待它
  if (inFlight) return await inFlight;
  
  // 检查最小请求间隔
  if (now - lastAttemptAt < HITOKOTO_MIN_INTERVAL_MS) {
    return cached;
  }

  lastAttemptAt = now;
  inFlight = (async () => {
    try {
      const value = await fetchHitokoto();
      if (value) {
        await hitokotoCache.set("current", value);
        return value;
      }
      return cached;
    } catch {
      return cached;
    } finally {
      inFlight = null;
    }
  })();

  return await inFlight;
}
