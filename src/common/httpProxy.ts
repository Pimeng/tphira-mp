import net from "node:net";
import tls from "node:tls";

export type ParsedProxy =
  | { type: "http" | "https"; host: string; port: number; auth?: string }
  | { type: "socks4" | "socks5"; host: string; port: number; username?: string; password?: string };

export function createAbortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

export function parseProxy(proxy: string): ParsedProxy {
  const url = new URL(proxy);
  const host = url.hostname;
  if (!host) throw new Error("invalid proxy host");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 1080;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("invalid proxy port");
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const auth =
    username !== undefined || password !== undefined
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
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });

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

/** HTTP 代理响应头最大大小：64KB（正常 CONNECT 响应远小于此值） */
const MAX_PROXY_RESPONSE_HEAD_SIZE = 64 * 1024;

async function readUntilDoubleCrlf(socket: net.Socket, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) throw createAbortError();
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    const onAbort = () => socket.destroy(createAbortError());
    const onData = (chunk: Buffer) => {
      totalLength += chunk.length;
      // 限制代理响应头大小，防止恶意代理发送无限数据导致内存耗尽
      if (totalLength > MAX_PROXY_RESPONSE_HEAD_SIZE) {
        cleanup();
        socket.destroy();
        reject(new Error("proxy response header too large"));
        return;
      }
      chunks.push(Buffer.from(chunk));
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

export async function createHttpProxyTunnel(
  proxy: Extract<ParsedProxy, { type: "http" | "https" }>,
  targetHost: string,
  targetPort: number,
  signal: AbortSignal
): Promise<net.Socket> {
  const socket = await connectSocket(proxy.host, proxy.port, signal, proxy.type === "https");
  const headers = [`CONNECT ${targetHost}:${targetPort} HTTP/1.1`, `Host: ${targetHost}:${targetPort}`];
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

export async function establishSocksTunnel(
  proxy: Extract<ParsedProxy, { type: "socks4" | "socks5" }>,
  targetHost: string,
  targetPort: number,
  signal: AbortSignal
): Promise<net.Socket> {
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
    const hostBuf = ipv4 ? Buffer.from(ipv4) : ipv6 ? ipv6 : Buffer.from(targetHost, "utf8");
    const atyp = ipv4 ? 0x01 : ipv6 ? 0x04 : 0x03;
    const portBuf = Buffer.alloc(2);
    portBuf.writeUInt16BE(targetPort, 0);
    const req =
      atyp === 0x03
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
    const addrLen = atypResp === 0x01 ? 4 : atypResp === 0x04 ? 16 : (head[4] ?? 0);
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
