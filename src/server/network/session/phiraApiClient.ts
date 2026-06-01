/**
 * Phira API 客户端封装
 *
 * 集中管理所有对 Phira 后端 API 的调用,包括:
 * - /me: 用户认证信息(认证流程)
 * - /chart/:id: 谱面信息(选谱时调用)
 * - /record/:id: 游戏记录(上报成绩时验证)
 *
 * 所有请求都携带统一的超时和重试配置,并支持出站代理。
 * /me 接口的结果会缓存 30 秒,以加速重连场景的认证流程。
 */
import { Cache } from "../../utils/cache.js";
import { fetchWithRetry, type OutboundProxyValue } from "../../../common/http.js";
import type { Chart, RecordData } from "../../core/types.js";

/** Phira API 默认端点 */
export const DEFAULT_PHIRA_API_ENDPOINT = "https://phira.5wyxi.com";
/** API 请求超时时间(毫秒) */
const FETCH_TIMEOUT_MS = 10000;

/** Phira API 调用通用选项 */
type PhiraApiOptions = {
  /** API 端点(不带尾部斜杠) */
  endpoint: string;
  /** 出站代理配置 */
  proxy?: OutboundProxyValue;
  /** 请求超时(毫秒),默认 60000 */
  timeoutMs?: number;
};

/** /me 接口返回的用户信息 */
type PhiraUserInfo = {
  id: number;
  name: string;
  language: string;
};

/** Token 校验结果缓存(30 秒 TTL),重连场景下避免重复 HTTP 请求 */
const tokenCache = new Cache<string, PhiraUserInfo>({
  fileName: "token_cache.json",
  maxMemorySize: 500,
  ttl: 30_000,
  persistToDisk: false
});

/** 正在进行的 token 校验请求(用于合并并发请求) */
const tokenInFlight = new Map<string, Promise<PhiraUserInfo>>();

/** 清空 token 缓存(仅用于测试) */
export function clearTokenCache(): void {
  tokenInFlight.clear();
  void tokenCache.clear();
}

/**
 * 调用 /me 接口获取当前 token 对应的用户信息
 *
 * 结果会按 token 缓存 30 秒,重连时直接返回缓存结果,跳过 HTTP 请求。
 * 并发的相同 token 请求会自动合并为一个 HTTP 调用。
 *
 * @throws auth-fetch-me-failed - HTTP 请求失败(非 2xx)
 * @throws auth-invalid-response - 响应体不是合法对象
 * @throws auth-invalid-user-id - id 字段不是整数
 * @throws auth-invalid-user-name - name 字段不是非空字符串
 */
export async function fetchPhiraUserInfo(opts: PhiraApiOptions & { token: string }): Promise<PhiraUserInfo> {
  const { token } = opts;

  // 先查缓存
  const cached = await tokenCache.get(token);
  if (cached) return cached;

  // 合并并发请求: 如果已有进行中的相同 token 请求,直接等待它
  const existing = tokenInFlight.get(token);
  if (existing) return await existing;

  const promise = (async () => {
    try {
      const { endpoint, proxy, timeoutMs } = opts;
      const r = await fetchWithRetry(
        `${endpoint}/me`,
        {
          headers: { Authorization: `Bearer ${token}` },
          proxy
        },
        timeoutMs ?? FETCH_TIMEOUT_MS
      );
      if (!r.ok) throw new Error("auth-fetch-me-failed");
      const data: unknown = await r.json();
      if (!data || typeof data !== "object") throw new Error("auth-invalid-response");
      const obj = data as Record<string, unknown>;
      if (!Number.isInteger(obj.id)) throw new Error("auth-invalid-user-id");
      if (typeof obj.name !== "string" || !obj.name.trim()) throw new Error("auth-invalid-user-name");
      const info: PhiraUserInfo = {
        id: obj.id as number,
        name: (obj.name as string).trim(),
        language: typeof obj.language === "string" ? obj.language : ""
      };
      await tokenCache.set(token, info);
      return info;
    } finally {
      tokenInFlight.delete(token);
    }
  })();

  tokenInFlight.set(token, promise);
  return await promise;
}

/**
 * 调用 /chart/:id 接口获取谱面信息
 *
 * @param errorFactory - HTTP 失败时使用的错误工厂(通常用于注入本地化错误信息)
 */
export async function fetchPhiraChart(
  opts: PhiraApiOptions & { id: number; errorFactory: () => Error }
): Promise<Chart> {
  const { endpoint, id, proxy, timeoutMs, errorFactory } = opts;
  const r = await fetchWithRetry(
    `${endpoint}/chart/${id}`,
    { proxy },
    timeoutMs ?? FETCH_TIMEOUT_MS
  );
  if (!r.ok) throw errorFactory();
  const res = (await r.json()) as Chart;
  return { id: res.id, name: res.name };
}

/**
 * 调用 /record/:id 接口获取游戏记录
 *
 * @param errorFactory - HTTP 失败时使用的错误工厂(通常用于注入本地化错误信息)
 */
export async function fetchPhiraRecord(
  opts: PhiraApiOptions & { id: number; errorFactory: () => Error }
): Promise<RecordData> {
  const { endpoint, id, proxy, timeoutMs, errorFactory } = opts;
  const r = await fetchWithRetry(
    `${endpoint}/record/${id}`,
    { proxy },
    timeoutMs ?? FETCH_TIMEOUT_MS
  );
  if (!r.ok) throw errorFactory();
  return (await r.json()) as RecordData;
}
