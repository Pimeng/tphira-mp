/**
 * Phira API 客户端封装
 *
 * 集中管理所有对 Phira 后端 API 的调用,包括:
 * - /me: 用户认证信息(认证流程)
 * - /chart/:id: 谱面信息(选谱时调用)
 * - /record/:id: 游戏记录(上报成绩时验证)
 *
 * 所有请求都携带统一的超时和重试配置,并支持出站代理。
 */
import { fetchWithRetry, type OutboundProxyValue } from "../../../common/http.js";
import type { Chart, RecordData } from "../../core/types.js";

/** Phira API 默认端点 */
export const DEFAULT_PHIRA_API_ENDPOINT = "https://phira.5wyxi.com";
/** API 请求超时时间(毫秒) */
export const FETCH_TIMEOUT_MS = 60000;

/** Phira API 调用通用选项 */
export type PhiraApiOptions = {
  /** API 端点(不带尾部斜杠) */
  endpoint: string;
  /** 出站代理配置 */
  proxy?: OutboundProxyValue;
  /** 请求超时(毫秒),默认 60000 */
  timeoutMs?: number;
};

/** /me 接口返回的用户信息 */
export type PhiraUserInfo = {
  id: number;
  name: string;
  language: string;
};

/**
 * 调用 /me 接口获取当前 token 对应的用户信息
 *
 * 会进行运行时类型校验,任何字段缺失或类型不匹配都会抛出特定的错误码,
 * 用于上层在认证流程中区分错误来源。
 *
 * @throws auth-fetch-me-failed - HTTP 请求失败(非 2xx)
 * @throws auth-invalid-response - 响应体不是合法对象
 * @throws auth-invalid-user-id - id 字段不是整数
 * @throws auth-invalid-user-name - name 字段不是非空字符串
 */
export async function fetchPhiraUserInfo(opts: PhiraApiOptions & { token: string }): Promise<PhiraUserInfo> {
  const { endpoint, token, proxy, timeoutMs } = opts;
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
  return {
    id: obj.id as number,
    name: (obj.name as string).trim(),
    language: typeof obj.language === "string" ? obj.language : ""
  };
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
