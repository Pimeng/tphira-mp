import type net from "node:net";

/**
 * HAProxy PROXY Protocol 解析器
 * 支持 PROXY Protocol v1 和 v2
 * 
 * PROXY Protocol v1 格式：
 * PROXY TCP4 192.168.0.1 192.168.0.11 56324 443\r\n
 * PROXY TCP6 ::1 ::1 56324 443\r\n
 * PROXY UNKNOWN\r\n
 * 
 * PROXY Protocol v2 格式：
 * 二进制格式，以 \x0D\x0A\x0D\x0A\x00\x0D\x0A\x51\x55\x49\x54\x0A 开头
 */

export type ProxyInfo = {
  /** 真实客户端 IP */
  sourceAddress: string;
  /** 真实客户端端口 */
  sourcePort: number;
  /** 目标地址 */
  destAddress: string;
  /** 目标端口 */
  destPort: number;
  /** 协议族：TCP4 或 TCP6 */
  family: "TCP4" | "TCP6";
};

const PROXY_V2_SIGNATURE = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);

/**
 * 从 socket 读取并解析 PROXY Protocol 头
 * @param socket TCP socket
 * @param timeoutMs 超时时间（毫秒）
 * @returns ProxyInfo 或 null（如果不是 PROXY Protocol 或解析失败）
 */
export async function parseProxyProtocol(socket: net.Socket, timeoutMs = 5000): Promise<ProxyInfo | null> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let buffer = Buffer.alloc(0);
    let resolved = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };

    const finish = (result: ProxyInfo | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      // 检查是否是 PROXY Protocol v2
      if (buffer.length >= PROXY_V2_SIGNATURE.length) {
        if (buffer.subarray(0, PROXY_V2_SIGNATURE.length).equals(PROXY_V2_SIGNATURE)) {
          const result = parseProxyV2(buffer);
          if (result) {
            // 将剩余数据放回 socket
            const remaining = buffer.subarray(result.headerLength);
            if (remaining.length > 0) {
              socket.unshift(remaining);
            }
            finish(result.info);
            return;
          }
        }
      }

      // 检查是否是 PROXY Protocol v1（以 "PROXY " 开头）
      const text = buffer.toString("ascii", 0, Math.min(buffer.length, 108));
      const crlfIndex = text.indexOf("\r\n");
      if (crlfIndex !== -1) {
        const line = text.substring(0, crlfIndex);
        if (line.startsWith("PROXY ")) {
          const result = parseProxyV1(line);
          // 将剩余数据放回 socket
          const remaining = buffer.subarray(crlfIndex + 2);
          if (remaining.length > 0) {
            socket.unshift(remaining);
          }
          finish(result);
          return;
        } else {
          // 不是 PROXY Protocol
          socket.unshift(buffer);
          finish(null);
          return;
        }
      }

      // 如果缓冲区太大但还没找到 \r\n，说明不是有效的 PROXY Protocol
      if (buffer.length > 108) {
        socket.unshift(buffer);
        finish(null);
      }
    };

    const onError = () => {
      finish(null);
    };

    const onEnd = () => {
      finish(null);
    };

    timer = setTimeout(() => {
      socket.unshift(buffer);
      finish(null);
    }, timeoutMs);

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
  });
}

/**
 * 解析 PROXY Protocol v1
 * 格式：PROXY TCP4 192.168.0.1 192.168.0.11 56324 443\r\n
 */
function parseProxyV1(line: string): ProxyInfo | null {
  const parts = line.split(" ");
  if (parts.length < 2) return null;

  // PROXY UNKNOWN
  if (parts[1] === "UNKNOWN") {
    return null;
  }

  // PROXY TCP4/TCP6 source dest sourcePort destPort
  if (parts.length !== 6) return null;

  const family = parts[1];
  if (family !== "TCP4" && family !== "TCP6") return null;

  const sourceAddress = parts[2]!;
  const destAddress = parts[3]!;
  const sourcePort = parseInt(parts[4]!, 10);
  const destPort = parseInt(parts[5]!, 10);

  if (!sourceAddress || !destAddress || isNaN(sourcePort) || isNaN(destPort)) {
    return null;
  }

  return {
    sourceAddress,
    sourcePort,
    destAddress,
    destPort,
    family
  };
}

/**
 * 解析 PROXY Protocol v2
 * 二进制格式
 */
function parseProxyV2(buffer: Buffer): { info: ProxyInfo | null; headerLength: number } | null {
  // 最小长度：12 字节签名 + 4 字节头部
  if (buffer.length < 16) return null;

  // 验证签名
  if (!buffer.subarray(0, 12).equals(PROXY_V2_SIGNATURE)) return null;

  const verCmd = buffer[12]!;
  const version = (verCmd & 0xf0) >> 4;
  const command = verCmd & 0x0f;

  // 版本必须是 2
  if (version !== 2) return null;

  const famProto = buffer[13]!;
  const family = (famProto & 0xf0) >> 4;
  const protocol = famProto & 0x0f;

  const addrLen = buffer.readUInt16BE(14);
  const headerLength = 16 + addrLen;

  if (buffer.length < headerLength) return null;

  // LOCAL 命令：不提供地址信息
  if (command === 0x00) {
    return { info: null, headerLength };
  }

  // PROXY 命令：提供地址信息
  if (command !== 0x01) return null;

  // TCP over IPv4
  if (family === 0x01 && protocol === 0x01) {
    if (addrLen < 12) return null;
    const sourceAddress = `${buffer[16]}.${buffer[17]}.${buffer[18]}.${buffer[19]}`;
    const destAddress = `${buffer[20]}.${buffer[21]}.${buffer[22]}.${buffer[23]}`;
    const sourcePort = buffer.readUInt16BE(24);
    const destPort = buffer.readUInt16BE(26);

    return {
      info: {
        sourceAddress,
        sourcePort,
        destAddress,
        destPort,
        family: "TCP4"
      },
      headerLength
    };
  }

  // TCP over IPv6
  if (family === 0x02 && protocol === 0x01) {
    if (addrLen < 36) return null;
    const sourceAddress = formatIPv6(buffer.subarray(16, 32));
    const destAddress = formatIPv6(buffer.subarray(32, 48));
    const sourcePort = buffer.readUInt16BE(48);
    const destPort = buffer.readUInt16BE(50);

    return {
      info: {
        sourceAddress,
        sourcePort,
        destAddress,
        destPort,
        family: "TCP6"
      },
      headerLength
    };
  }

  // 不支持的协议族或协议
  return { info: null, headerLength };
}

/**
 * 格式化 IPv6 地址
 */
function formatIPv6(buffer: Buffer): string {
  const parts: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    const value = buffer.readUInt16BE(i);
    parts.push(value.toString(16));
  }
  return parts.join(":");
}
