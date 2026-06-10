import http from "node:http";

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
 * 判断 IP 是否为本机回环地址（127.0.0.0/8 或 ::1）。
 * 输入应为 getClientIp 的输出（IPv4 映射地址已剥离 ::ffff: 前缀）。
 */
export function isLoopbackIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "::1") return true;
  return ip.startsWith("127.");
}

/**
 * 设置 CORS 响应头
 *
 * @param allowedOrigins - 允许的源列表；空数组时只允许同域（不设置 allow-origin）
 */
export function applyCors(res: http.ServerResponse, req: http.IncomingMessage, allowedOrigins: string[] = []): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  // 如果配置了允许的来源列表，且当前请求来源匹配，则设置具体的来源
  // 否则不设置 allow-origin（浏览器会阻止跨域访问）
  if (allowedOrigins.length === 0) {
    // 未配置时允许所有来源（向后兼容，但建议生产环境配置具体来源）
    res.setHeader("access-control-allow-origin", "*");
  } else if (allowedOrigins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }

  const reqHeaders =
    typeof req.headers["access-control-request-headers"] === "string"
      ? req.headers["access-control-request-headers"]
      : "";
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
  res.setHeader("x-content-type-options", "nosniff");
  res.end(text);
}

/** 默认请求体大小限制：1MB */
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;

/**
 * 读取请求体并解析为 JSON
 *
 * 限制请求体大小以防止恶意客户端发送超大请求体导致内存耗尽。
 * 超过限制时抛出 Error("request-body-too-large")。
 */
export async function readJson(req: http.IncomingMessage, maxBodySize = DEFAULT_MAX_BODY_SIZE): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c: Buffer) => {
      totalSize += c.length;
      if (totalSize > maxBodySize) {
        reject(new Error("request-body-too-large"));
        return;
      }
      chunks.push(Buffer.from(c));
    });
    req.once("end", () => resolve());
    req.once("error", reject);
  });
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
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
function extractBearerToken(value: string): string {
  const trimmed = value.trim();
  const prefix = "Bearer ";
  if (trimmed.length > prefix.length && trimmed.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
    return trimmed.slice(prefix.length).trim();
  }
  return trimmed;
}

/**
 * 从多个来源提取管理员 token
 *
 * 优先级：X-Admin-Token 头 > Authorization Bearer > URL 查询参数（仅当 allowTokenInQuery 为 true）
 * 注意：从 URL 查询参数提取 token 会暴露 token 到服务器日志和代理日志中，默认禁用。
 * 仅当配置项 ALLOW_TOKEN_IN_QUERY 为 true 时才启用，适用于无 Header 能力的简单脚本场景。
 */
export function extractAdminToken(req: http.IncomingMessage, url: URL, allowTokenInQuery = false): string {
  const headerToken = typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : "";
  if (headerToken) return headerToken;
  const authToken = typeof req.headers.authorization === "string" ? extractBearerToken(req.headers.authorization) : "";
  if (authToken) return authToken;
  if (allowTokenInQuery) {
    return url.searchParams.get("token") ?? "";
  }
  return "";
}
