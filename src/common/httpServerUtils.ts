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
 * 设置 CORS 响应头
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
 */
export function extractAdminToken(req: http.IncomingMessage, url: URL): string {
  return (
    (typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : "") ||
    (typeof req.headers.authorization === "string" ? extractBearerToken(req.headers.authorization) : "") ||
    (url.searchParams.get("token") ?? "")
  );
}

