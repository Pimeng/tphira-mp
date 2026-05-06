import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import {
  createAbortError,
  createHttpProxyTunnel,
  establishSocksTunnel,
  parseProxy,
  type ParsedProxy
} from "./httpProxy.js";

export type OutboundProxyValue = string | false | undefined;
export type FetchWithProxyInit = RequestInit & { proxy?: OutboundProxyValue };
type RequestHeadersInit = NonNullable<RequestInit["headers"]>;
type RequestBodyValue = RequestInit["body"];

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

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const msg = error.message.toLowerCase();
  const retryableCodes = [
    "econnreset",
    "etimedout",
    "enotfound",
    "econnrefused",
    "socket hang up",
    "network error",
    "aborted",
    "timeout"
  ];
  return retryableCodes.some((code) => msg.includes(code));
}

function isRetryableResponse(res: Response): boolean {
  // 429 Too Many Requests 也可以重试
  if (res.status === 429) return true;
  // 5xx 服务器错误可以重试
  if (res.status >= 500 && res.status < 600) return true;
  // 4xx 客户端错误不应当重试
  return false;
}

/**
 * 发送带重试的 fetch 请求，默认最多重试 2 次
 * 使用指数退避 + 抖动策略，自动跳过不可重试错误（4xx）
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
      const res = await fetchWithTimeout(input, init, timeoutMs);
      // HTTP 成功直接返回
      if (res.ok) return res;
      // HTTP 失败：判断是否可以重试
      if (!isRetryableResponse(res)) {
        return res; // 4xx 不应当重试，直接返回让调用方处理
      }
      // 5xx/429 进入重试逻辑
      lastError = new Error(`http-${res.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // 不可重试的网络错误直接抛出
      if (!isRetryableError(lastError)) {
        throw lastError;
      }
    }

    if (attempt < maxRetries) {
      // 指数退避：100ms, 200ms, 400ms... 上限 5 秒
      const baseDelay = Math.min(100 * Math.pow(2, attempt), 5000);
      // 20% 随机抖动，避免惊群效应
      const jitter = Math.random() * baseDelay * 0.2;
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
    }
  }

  throw lastError ?? new Error("fetch failed");
}
