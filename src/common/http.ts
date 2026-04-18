import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

export type OutboundProxyValue = string | false | undefined;
export type FetchWithProxyInit = RequestInit & { proxy?: OutboundProxyValue };
type RequestHeadersInit = NonNullable<RequestInit["headers"]>;
type RequestBodyValue = RequestInit["body"];

type ParsedProxy =
  | { type: "http" | "https"; host: string; port: number; auth?: string }
  | { type: "socks4" | "socks5"; host: string; port: number; username?: string; password?: string };

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
 * 写入文本响应
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
 * 从多个来源提取管理员 token
 */
export function extractAdminToken(req: http.IncomingMessage, url: URL): string {
  return (
    (typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : "") ||
    (typeof req.headers.authorization === "string" ? extractBearerToken(req.headers.authorization) : "") ||
    (url.searchParams.get("token") ?? "")
  );
}

/**
 * 提取请求体中的字符串字段
 */
export function extractStringField(body: unknown, field: string): string {
  const value = (body as any)?.[field];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 提取请求体中的数字字段
 */
export function extractNumberField(body: unknown, field: string): number {
  return Number((body as any)?.[field] ?? "");
}

/**
 * 提取请求体中的布尔字段
 */
export function extractBooleanField(body: unknown, field: string): boolean {
  return Boolean((body as any)?.[field]);
}

function createAbortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

function combineSignals(signal: AbortSignal | null | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeoutSignal]);
  if (signal.aborted || timeoutSignal.aborted) return AbortSignal.abort();
  return timeoutSignal;
}

function isHttpsUrl(url: URL): boolean {
  return url.protocol === "https:";
}

function normalizeHeaders(headersInit: RequestHeadersInit | undefined, body: Buffer | undefined, url: URL, useAbsoluteUrl: boolean): Record<string, string> {
  const headers = new Headers(headersInit);
  if (!headers.has("host")) headers.set("host", url.host);
  if (body && !headers.has("content-length")) headers.set("content-length", String(body.length));
  if (!body && !headers.has("content-length")) headers.delete("content-length");
  if (useAbsoluteUrl) headers.set("host", url.host);
  return Object.fromEntries(headers.entries());
}

async function normalizeBody(body: RequestBodyValue | null | undefined): Promise<Buffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new Error("unsupported request body");
}

function parseProxy(proxy: string): ParsedProxy {
  const url = new URL(proxy);
  const host = url.hostname;
  if (!host) throw new Error("invalid proxy host");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 1080;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("invalid proxy port");
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const auth = username !== undefined || password !== undefined
    ? Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64")
    : undefined;

  switch (url.protocol) {
    case "http:":
      return { type: "http", host, port, auth };
    case "https:":
      return { type: "https", host, port, auth };
    case "socks:":
    case "socks5:":
      return { type: "socks5", host, port, username, password };
    case "socks4:":
      return { type: "socks4", host, port, username };
    default:
      throw new Error(`unsupported proxy protocol: ${url.protocol}`);
  }
}

async function connectSocket(host: string, port: number, signal: AbortSignal, secure: boolean): Promise<net.Socket> {
  if (signal.aborted) throw createAbortError();
  return await new Promise<net.Socket>((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });

    const onAbort = () => socket.destroy(createAbortError());
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      socket.removeListener("error", onError);
      socket.removeListener("connect", onConnect);
      socket.removeListener("secureConnect", onConnect);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("error", onError);
    socket.once(secure ? "secureConnect" : "connect", onConnect);
  });
}

async function readUntilDoubleCrlf(socket: net.Socket, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) throw createAbortError();
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    const onAbort = () => socket.destroy(createAbortError());
    const onData = (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
      totalLength += chunk.length;
      const joined = Buffer.concat(chunks, totalLength);
      const endIndex = joined.indexOf("\r\n\r\n");
      if (endIndex >= 0) {
        cleanup();
        const rest = joined.subarray(endIndex + 4);
        if (rest.length > 0) socket.unshift(rest);
        resolve(joined.subarray(0, endIndex + 4));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("proxy closed connection unexpectedly"));
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("end", onEnd);
      socket.removeListener("close", onEnd);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    socket.once("close", onEnd);
  });
}

async function createHttpProxyTunnel(proxy: Extract<ParsedProxy, { type: "http" | "https" }>, targetHost: string, targetPort: number, signal: AbortSignal): Promise<net.Socket> {
  const socket = await connectSocket(proxy.host, proxy.port, signal, proxy.type === "https");
  const headers = [
    `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
    `Host: ${targetHost}:${targetPort}`
  ];
  if (proxy.auth) headers.push(`Proxy-Authorization: Basic ${proxy.auth}`);
  headers.push("", "");
  socket.write(headers.join("\r\n"));

  const responseHead = (await readUntilDoubleCrlf(socket, signal)).toString("utf8");
  const statusLine = responseHead.split("\r\n", 1)[0] ?? "";
  const match = /^HTTP\/1\.\d\s+(\d+)/i.exec(statusLine);
  const statusCode = match ? Number(match[1]) : NaN;
  if (statusCode !== 200) {
    socket.destroy();
    throw new Error(`proxy tunnel failed: ${statusLine || "unknown response"}`);
  }
  return socket;
}

function writeAll(socket: net.Socket, chunk: Uint8Array): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => socket.removeListener("error", onError);
    socket.once("error", onError);
    socket.write(chunk, (error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    });
  });
}

function ipv4Bytes(host: string): number[] | null {
  if (net.isIP(host) !== 4) return null;
  return host.split(".").map((part) => Number(part));
}

function ipv6Bytes(host: string): Buffer | null {
  if (net.isIP(host) !== 6) return null;
  const segments = host.split("::");
  const left = segments[0] ? segments[0].split(":").filter(Boolean) : [];
  const right = segments[1] ? segments[1].split(":").filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  const parts = [...left, ...Array.from({ length: Math.max(missing, 0) }, () => "0"), ...right];
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    const value = Number.parseInt(parts[i] ?? "0", 16);
    bytes.writeUInt16BE(value & 0xffff, i * 2);
  }
  return bytes;
}

async function establishSocksTunnel(proxy: Extract<ParsedProxy, { type: "socks4" | "socks5" }>, targetHost: string, targetPort: number, signal: AbortSignal): Promise<net.Socket> {
  const socket = await connectSocket(proxy.host, proxy.port, signal, false);
  try {
    if (proxy.type === "socks4") {
      const ipv4 = ipv4Bytes(targetHost);
      const user = Buffer.from(proxy.username ?? "");
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(targetPort, 0);
      const hostBuf = ipv4 ? Buffer.from(ipv4) : Buffer.from([0, 0, 0, 1]);
      const domainBuf = ipv4 ? Buffer.alloc(0) : Buffer.from(`${targetHost}\0`);
      const req = Buffer.concat([Buffer.from([0x04, 0x01]), portBuf, hostBuf, user, Buffer.from([0x00]), domainBuf]);
      await writeAll(socket, req);
      const resp = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const onData = (chunk: Buffer) => {
          chunks.push(Buffer.from(chunk));
          total += chunk.length;
          if (total >= 8) {
            cleanup();
            const joined = Buffer.concat(chunks, total);
            const rest = joined.subarray(8);
            if (rest.length > 0) socket.unshift(rest);
            resolve(joined.subarray(0, 8));
          }
        };
        const onAbort = () => socket.destroy(createAbortError());
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          signal.removeEventListener("abort", onAbort);
          socket.removeListener("data", onData);
          socket.removeListener("error", onError);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        socket.on("data", onData);
        socket.once("error", onError);
      });
      if (resp[1] !== 0x5a) throw new Error(`socks4 connect failed: ${resp[1]}`);
      return socket;
    }

    const methods = proxy.username !== undefined || proxy.password !== undefined ? [0x00, 0x02] : [0x00];
    await writeAll(socket, Buffer.from([0x05, methods.length, ...methods]));
    const greeting = await new Promise<Buffer>((resolve, reject) => {
      const onAbort = () => socket.destroy(createAbortError());
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onData = (chunk: Buffer) => {
        cleanup();
        if (chunk.length > 2) socket.unshift(chunk.subarray(2));
        resolve(chunk.subarray(0, 2));
      };
      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        socket.removeListener("error", onError);
        socket.removeListener("data", onData);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      socket.once("error", onError);
      socket.once("data", onData);
    });
    if (greeting[0] !== 0x05) throw new Error("invalid socks5 greeting");
    if (greeting[1] === 0xff) throw new Error("socks5 authentication method rejected");
    if (greeting[1] === 0x02) {
      const user = Buffer.from(proxy.username ?? "");
      const pass = Buffer.from(proxy.password ?? "");
      await writeAll(socket, Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const authResp = await new Promise<Buffer>((resolve, reject) => {
        const onAbort = () => socket.destroy(createAbortError());
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onData = (chunk: Buffer) => {
          cleanup();
          if (chunk.length > 2) socket.unshift(chunk.subarray(2));
          resolve(chunk.subarray(0, 2));
        };
        const cleanup = () => {
          signal.removeEventListener("abort", onAbort);
          socket.removeListener("error", onError);
          socket.removeListener("data", onData);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        socket.once("error", onError);
        socket.once("data", onData);
      });
      if (authResp[1] !== 0x00) throw new Error("socks5 authentication failed");
    }

    const ipv4 = ipv4Bytes(targetHost);
    const ipv6 = ipv6Bytes(targetHost);
    const hostBuf = ipv4
      ? Buffer.from(ipv4)
      : ipv6
        ? ipv6
        : Buffer.from(targetHost, "utf8");
    const atyp = ipv4 ? 0x01 : ipv6 ? 0x04 : 0x03;
    const portBuf = Buffer.alloc(2);
    portBuf.writeUInt16BE(targetPort, 0);
    const req = atyp === 0x03
      ? Buffer.concat([Buffer.from([0x05, 0x01, 0x00, atyp, hostBuf.length]), hostBuf, portBuf])
      : Buffer.concat([Buffer.from([0x05, 0x01, 0x00, atyp]), hostBuf, portBuf]);
    await writeAll(socket, req);

    const head = await new Promise<Buffer>((resolve, reject) => {
      const onAbort = () => socket.destroy(createAbortError());
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onData = (chunk: Buffer) => {
        cleanup();
        resolve(chunk);
      };
      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        socket.removeListener("error", onError);
        socket.removeListener("data", onData);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      socket.once("error", onError);
      socket.once("data", onData);
    });
    if (head[1] !== 0x00) throw new Error(`socks5 connect failed: ${head[1]}`);
    const atypResp = head[3];
    const addrLen = atypResp === 0x01 ? 4 : atypResp === 0x04 ? 16 : head[4] ?? 0;
    const totalLen = 4 + (atypResp === 0x03 ? 1 : 0) + addrLen + 2;
    if (head.length > totalLen) socket.unshift(head.subarray(totalLen));
    else if (head.length < totalLen) {
      const missing = totalLen - head.length;
      await new Promise<void>((resolve, reject) => {
        let received = 0;
        const onAbort = () => socket.destroy(createAbortError());
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onData = (chunk: Buffer) => {
          received += chunk.length;
          if (received >= missing) {
            cleanup();
            if (received > missing) socket.unshift(chunk.subarray(missing));
            resolve();
          }
        };
        const cleanup = () => {
          signal.removeEventListener("abort", onAbort);
          socket.removeListener("error", onError);
          socket.removeListener("data", onData);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        socket.on("data", onData);
        socket.once("error", onError);
      });
    }
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function toNodeRequestOptions(url: URL, method: string, headers: Record<string, string>, path: string): http.RequestOptions {
  return {
    protocol: url.protocol,
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    method,
    path,
    headers,
    agent: false
  };
}

async function collectResponse(res: http.IncomingMessage): Promise<Response> {
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(Buffer.from(chunk));
  return new Response(Buffer.concat(chunks), {
    status: res.statusCode ?? 500,
    statusText: res.statusMessage,
    headers: res.headers as RequestHeadersInit
  });
}

async function executeRequest(
  requestFn: typeof http.request | typeof https.request,
  options: http.RequestOptions,
  body: Buffer | undefined,
  signal: AbortSignal
): Promise<Response> {
  if (signal.aborted) throw createAbortError();
  return await new Promise<Response>((resolve, reject) => {
    const req = requestFn(options, (res) => {
      void collectResponse(res).then(resolve, reject);
    });
    const onAbort = () => req.destroy(createAbortError());
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    req.once("error", (error) => {
      cleanup();
      reject(error);
    });
    req.once("close", cleanup);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchDirect(url: URL, init: FetchWithProxyInit, signal: AbortSignal): Promise<Response> {
  const method = init.method ?? "GET";
  const body = await normalizeBody(init.body);
  const headers = normalizeHeaders(init.headers, body, url, false);
  const options = toNodeRequestOptions(url, method, headers, `${url.pathname}${url.search}`);
  return await executeRequest(isHttpsUrl(url) ? https.request : http.request, options, body, signal);
}

async function fetchViaHttpProxy(url: URL, init: FetchWithProxyInit, signal: AbortSignal, proxy: Extract<ParsedProxy, { type: "http" | "https" }>): Promise<Response> {
  const method = init.method ?? "GET";
  const body = await normalizeBody(init.body);

  if (!isHttpsUrl(url)) {
    const headers = normalizeHeaders(init.headers, body, url, true);
    if (proxy.auth) headers["proxy-authorization"] = `Basic ${proxy.auth}`;
    const requestUrl = new URL(`${proxy.type}://${proxy.host}:${proxy.port}`);
    const options = toNodeRequestOptions(requestUrl, method, headers, url.toString());
    return await executeRequest(proxy.type === "https" ? https.request : http.request, options, body, signal);
  }

  const tunneledSocket = await createHttpProxyTunnel(proxy, url.hostname, Number(url.port || 443), signal);
  const secureSocket = tls.connect({
    socket: tunneledSocket,
    servername: url.hostname
  });
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => secureSocket.destroy(createAbortError());
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onSecure = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      secureSocket.removeListener("error", onError);
      secureSocket.removeListener("secureConnect", onSecure);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    secureSocket.once("error", onError);
    secureSocket.once("secureConnect", onSecure);
  });

  const headers = normalizeHeaders(init.headers, body, url, false);
  const options: https.RequestOptions = {
    ...toNodeRequestOptions(url, method, headers, `${url.pathname}${url.search}`),
    createConnection: () => secureSocket
  };
  return await executeRequest(https.request, options, body, signal);
}

async function fetchViaSocksProxy(url: URL, init: FetchWithProxyInit, signal: AbortSignal, proxy: Extract<ParsedProxy, { type: "socks4" | "socks5" }>): Promise<Response> {
  const method = init.method ?? "GET";
  const body = await normalizeBody(init.body);
  const targetPort = Number(url.port || (isHttpsUrl(url) ? 443 : 80));
  const socket = await establishSocksTunnel(proxy, url.hostname, targetPort, signal);
  const finalSocket = isHttpsUrl(url)
    ? await new Promise<net.Socket>((resolve, reject) => {
        const secureSocket = tls.connect({ socket, servername: url.hostname });
        const onAbort = () => secureSocket.destroy(createAbortError());
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onSecure = () => {
          cleanup();
          resolve(secureSocket);
        };
        const cleanup = () => {
          signal.removeEventListener("abort", onAbort);
          secureSocket.removeListener("error", onError);
          secureSocket.removeListener("secureConnect", onSecure);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        secureSocket.once("error", onError);
        secureSocket.once("secureConnect", onSecure);
      })
    : socket;

  const headers = normalizeHeaders(init.headers, body, url, false);
  const options: http.RequestOptions = {
    ...toNodeRequestOptions(url, method, headers, `${url.pathname}${url.search}`),
    createConnection: () => finalSocket
  };
  return await executeRequest(isHttpsUrl(url) ? https.request : http.request, options, body, signal);
}

async function fetchWithConfiguredProxy(input: string | URL, init: FetchWithProxyInit, signal: AbortSignal): Promise<Response> {
  const url = input instanceof URL ? input : new URL(String(input));
  if (init.proxy === false) return await fetchDirect(url, init, signal);

  const proxy = parseProxy(init.proxy ?? "");
  if (proxy.type === "http" || proxy.type === "https") {
    return await fetchViaHttpProxy(url, init, signal, proxy);
  }
  return await fetchViaSocksProxy(url, init, signal, proxy as Extract<ParsedProxy, { type: "socks4" | "socks5" }>);
}

/**
 * 发送带超时的 fetch 请求
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: FetchWithProxyInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = combineSignals(init.signal, controller.signal);
  try {
    if (init.proxy === undefined) {
      const { proxy: _proxy, ...nativeInit } = init;
      return await fetch(input, { ...nativeInit, signal });
    }
    return await fetchWithConfiguredProxy(input, init, signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 发送带重试的 fetch 请求，默认最多重试 2 次
 */
export async function fetchWithRetry(
  input: string | URL,
  init: FetchWithProxyInit,
  timeoutMs: number,
  maxRetries: number = 2
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(input, init, timeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError ?? new Error("fetch failed");
}
