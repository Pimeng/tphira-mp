// HTTP 通用工具函数

import type http from "node:http";

/**
 * 获取客户端真实 IP 地址
 */
export function getClientIp(req: http.IncomingMessage, headerName: string = "X-Forwarded-For"): string {
  const normalizedHeader = headerName.toLowerCase();
  const headerValue = typeof req.headers[normalizedHeader] === "string" ? req.headers[normalizedHeader] : "";
  const first = headerValue ? headerValue.split(",")[0]?.trim() : "";
  const raw = first || req.socket.remoteAddress || "";
  return raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
}

/**
 * 应用 CORS 头
 */
export function applyCors(res: http.ServerResponse, req: http.IncomingMessage): void {
  const reqHeaders = typeof req.headers["access-control-request-headers"] === "string" 
    ? req.headers["access-control-request-headers"] 
    : "";
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", reqHeaders || "content-type,x-admin-token,authorization");
  res.setHeader("access-control-max-age", "600");
}

/**
 * 写入 JSON 响应
 */
export function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(text);
}

/**
 * 读取请求体并解析为 JSON
 */
export async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.once("end", () => resolve());
    req.once("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

/**
 * 发送文本响应
 */
export function writeText(res: http.ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(text);
}

/**
 * 处理 OPTIONS 预检请求
 */
export function handleOptionsRequest(res: http.ServerResponse): void {
  res.statusCode = 204;
  res.end();
}

/**
 * 从 Authorization 头中提取 Bearer token
 */
export function extractBearerToken(value: string): string {
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : value.trim();
}

/**
 * 提取管理员 token（从多个来源）
 */
export function extractAdminToken(req: http.IncomingMessage, url: URL): string {
  return (
    (typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : "") ||
    (typeof req.headers.authorization === "string" ? extractBearerToken(req.headers.authorization) : "") ||
    (url.searchParams.get("token") ?? "")
  );
}

/**
 * 验证并提取请求体中的字符串字段
 */
export function extractStringField(body: unknown, field: string): string {
  const value = (body as any)?.[field];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 验证并提取请求体中的数字字段
 */
export function extractNumberField(body: unknown, field: string): number {
  return Number((body as any)?.[field] ?? "");
}

/**
 * 验证并提取请求体中的布尔字段
 */
export function extractBooleanField(body: unknown, field: string): boolean {
  return Boolean((body as any)?.[field]);
}

/**
 * 带超时的 fetch 请求
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试机制的 fetch 请求（最多重试2次）
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
  maxRetries: number = 2
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(input, init, timeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // 如果还有重试次数，继续重试
      if (attempt < maxRetries) {
        // 添加延迟，避免立即重试（指数退避）
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
    }
  }
  
  // 所有重试都失败，抛出最后一个错误
  throw lastError ?? new Error("fetch failed");
}
