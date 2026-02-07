/**
 * Federation Protocol - 互通服协议
 *
 * 实现跨服务器玩家同步的核心编解码逻辑：
 * - 6-bit Room ID 压缩编码（将 8-bit 字符压缩为 6-bit）
 * - 紧凑数据包结构（8-20 字节核心玩家信息）
 * - HMAC-SHA256-96 服务器间身份验证
 * - 联邦令牌格式（MSB 标志位检测）
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// ==================== 6-bit Room ID 编码 ====================
//
// Room ID 使用的字符集恰好 64 个字符，可用 6-bit 表示：
// A-Z (0-25), a-z (26-51), 0-9 (52-61), - (62), _ (63)
// 原本每字符 8 bit，压缩后每字符 6 bit，节省 25% 空间

const ROOM_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const CHAR_TO_6BIT = new Map<string, number>();
for (let i = 0; i < ROOM_ID_CHARS.length; i++) {
  CHAR_TO_6BIT.set(ROOM_ID_CHARS[i]!, i);
}

/**
 * 将 Room ID 字符串编码为 6-bit 紧凑字节流
 *
 * 例如 "Hello" (5 chars) -> ceil(5 * 6 / 8) = 4 bytes
 * 压缩率: 4/5 = 80%（节省 20%）
 */
export function encodeRoomId6bit(roomId: string): Buffer {
  const charCount = roomId.length;
  const byteCount = Math.ceil((charCount * 6) / 8);
  const buf = Buffer.alloc(byteCount);

  let bitOffset = 0;
  for (let i = 0; i < charCount; i++) {
    const val = CHAR_TO_6BIT.get(roomId[i]!);
    if (val === undefined) throw new Error("federation-invalid-roomid-char");

    const byteIdx = Math.floor(bitOffset / 8);
    const bitIdx = bitOffset % 8;

    // 写入 6 bits，可能跨越两个字节
    buf[byteIdx] = (buf[byteIdx]! | ((val << bitIdx) & 0xff)) & 0xff;
    if (bitIdx > 2) {
      // 溢出到下一个字节
      buf[byteIdx + 1] = (buf[byteIdx + 1]! | ((val >> (8 - bitIdx)) & 0xff)) & 0xff;
    }

    bitOffset += 6;
  }
  return buf;
}

/**
 * 将 6-bit 紧凑字节流解码为 Room ID 字符串
 */
export function decodeRoomId6bit(buf: Buffer, charCount: number): string {
  let result = "";
  let bitOffset = 0;

  for (let i = 0; i < charCount; i++) {
    const byteIdx = Math.floor(bitOffset / 8);
    const bitIdx = bitOffset % 8;

    let val = (buf[byteIdx]! >> bitIdx) & 0x3f;
    if (bitIdx > 2 && byteIdx + 1 < buf.length) {
      val = (val | ((buf[byteIdx + 1]! << (8 - bitIdx)) & 0x3f)) & 0x3f;
    }

    const ch = ROOM_ID_CHARS[val];
    if (!ch) throw new Error("federation-invalid-6bit-value");
    result += ch;
    bitOffset += 6;
  }
  return result;
}

// ==================== 紧凑数据包结构 ====================
//
// 用于在服务器间传输核心玩家信息，极限压缩到 17-32 字节：
//
// ┌─────────────────────────────────────────────────────────┐
// │ Byte 0: [1-bit 标志位][5-bit 房间ID长度][2-bit 预留]    │
// │         MSB=1 表示来自转发服务器                          │
// │         bits 6-2: 房间 ID 字符数 (0-31)                  │
// │         bits 1-0: 预留标志 (00=普通, 01=观战, etc.)      │
// ├─────────────────────────────────────────────────────────┤
// │ Bytes 1-4: 玩家 ID (uint32 LE)                          │
// ├─────────────────────────────────────────────────────────┤
// │ Bytes 5-N: 房间 ID (6-bit 紧凑编码)                     │
// │           N = 5 + ceil(roomIdLen * 6 / 8)               │
// ├─────────────────────────────────────────────────────────┤
// │ Bytes N-(N+11): HMAC-SHA256-96 (12 字节, 服务器身份验证) │
// └─────────────────────────────────────────────────────────┘
//
// 总长度: 17 字节(最小) ~ 32 字节(最大, 20字符房间ID)

export const COMPACT_HMAC_LEN = 12; // HMAC-SHA256 截断为 96 bits

/** 紧凑联邦数据包 */
export type CompactFederationPacket = {
  playerId: number;
  roomId: string;
  flags: number; // 2-bit flags: 0=normal, 1=monitor
  hmac: Buffer;  // 12 bytes
};

/** 将紧凑数据包编码为字节流 */
export function encodeCompactPacket(packet: CompactFederationPacket, sharedSecret: string): Buffer {
  const roomIdLen = packet.roomId.length;
  if (roomIdLen > 31) throw new Error("federation-roomid-too-long");

  const roomIdBytes = encodeRoomId6bit(packet.roomId);
  const totalLen = 1 + 4 + roomIdBytes.length + COMPACT_HMAC_LEN;
  const buf = Buffer.alloc(totalLen);

  // Byte 0: MSB=1, roomIdLen in bits 6-2, flags in bits 1-0
  buf[0] = 0x80 | ((roomIdLen & 0x1f) << 2) | (packet.flags & 0x03);

  // Bytes 1-4: Player ID (uint32 LE)
  buf.writeUInt32LE(packet.playerId >>> 0, 1);

  // Room ID bytes (6-bit packed)
  roomIdBytes.copy(buf, 5);

  // 计算 HMAC 覆盖前面所有数据
  const dataToSign = buf.subarray(0, 5 + roomIdBytes.length);
  const hmac = computeHmac(sharedSecret, dataToSign);
  hmac.copy(buf, 5 + roomIdBytes.length, 0, COMPACT_HMAC_LEN);

  return buf;
}

/** 从字节流解码紧凑数据包 */
export function decodeCompactPacket(buf: Buffer): CompactFederationPacket {
  if (buf.length < 1 + 4 + 1 + COMPACT_HMAC_LEN) {
    throw new Error("federation-packet-too-short");
  }

  const header = buf[0]!;
  if ((header & 0x80) === 0) throw new Error("federation-flag-not-set");

  const roomIdLen = (header >> 2) & 0x1f;
  const flags = header & 0x03;
  const roomIdByteLen = Math.ceil((roomIdLen * 6) / 8);

  const expectedLen = 1 + 4 + roomIdByteLen + COMPACT_HMAC_LEN;
  if (buf.length < expectedLen) throw new Error("federation-packet-incomplete");

  const playerId = buf.readUInt32LE(1);
  const roomId = roomIdLen > 0
    ? decodeRoomId6bit(buf.subarray(5, 5 + roomIdByteLen), roomIdLen)
    : "";

  const hmacStart = 5 + roomIdByteLen;
  const hmac = Buffer.from(buf.subarray(hmacStart, hmacStart + COMPACT_HMAC_LEN));

  return { playerId, roomId, flags, hmac };
}

/** 验证紧凑数据包的 HMAC */
export function verifyCompactPacket(buf: Buffer, sharedSecret: string): boolean {
  const header = buf[0]!;
  const roomIdLen = (header >> 2) & 0x1f;
  const roomIdByteLen = Math.ceil((roomIdLen * 6) / 8);
  const hmacStart = 5 + roomIdByteLen;

  const dataToSign = buf.subarray(0, hmacStart);
  const receivedHmac = buf.subarray(hmacStart, hmacStart + COMPACT_HMAC_LEN);

  return verifyHmac(sharedSecret, receivedHmac, dataToSign);
}

// ==================== HMAC 工具 ====================

/** 计算 HMAC-SHA256 并截断为 96 bits (12 bytes) */
export function computeHmac(sharedSecret: string, data: Buffer): Buffer {
  const hmac = createHmac("sha256", sharedSecret);
  hmac.update(data);
  return hmac.digest().subarray(0, COMPACT_HMAC_LEN);
}

/** 时间安全的 HMAC 比较 */
export function verifyHmac(sharedSecret: string, expectedHmac: Buffer, data: Buffer): boolean {
  const computed = computeHmac(sharedSecret, data);
  if (computed.length !== expectedHmac.length) return false;
  return timingSafeEqual(computed, expectedHmac);
}

// ==================== 联邦令牌格式 ====================
//
// 在鉴权阶段的 token 字段中，通过前缀区分普通令牌和联邦令牌：
// - 普通令牌: "eyJ..." (JWT/bearer token, 首字节 MSB=0)
// - 联邦令牌: "@<24-char hex ticket>"
//
// 由于 HTTP Bearer token 在协议中首位通常为 ASCII (MSB=0)，
// 使用 "@" 前缀 (0x40) 作为联邦令牌标志位，安全地与普通令牌区分。

export const FEDERATION_TOKEN_PREFIX = "@";
export const FEDERATION_TICKET_BYTES = 12; // 12 bytes = 24 hex chars

/** 检测 token 是否为联邦令牌 */
export function isFederationToken(token: string): boolean {
  return token.startsWith(FEDERATION_TOKEN_PREFIX);
}

/** 从联邦令牌中提取 ticket */
export function extractFederationTicket(token: string): string {
  if (!isFederationToken(token)) throw new Error("federation-not-federation-token");
  return token.slice(FEDERATION_TOKEN_PREFIX.length);
}

/** 生成随机 ticket (12 bytes -> 24 hex chars) */
export function generateTicket(): string {
  return randomBytes(FEDERATION_TICKET_BYTES).toString("hex");
}

/** 构造联邦令牌 (用于放入 Authenticate 命令的 token 字段) */
export function buildFederationToken(ticket: string): string {
  return `${FEDERATION_TOKEN_PREFIX}${ticket}`;
}

// ==================== 联邦票据 (Ticket) ====================
//
// 两步联邦鉴权流程：
// 1. 源服务器通过 HTTP 调用目标服务器创建票据 (prepare)
// 2. 透明代理使用票据 (@ticket) 进行 TCP 鉴权
//
// 票据包含预注册的玩家信息，避免 varchar(32) 空间限制

export type FederationTicket = {
  ticket: string;           // 24-char hex ticket
  playerId: number;
  playerName: string;
  targetRoomId: string;     // 目标房间 ID
  sourceServer: string;     // 来源服务器名称
  monitor: boolean;         // 是否以观战者身份加入
  createdAt: number;        // 创建时间 (ms)
  expiresAt: number;        // 过期时间 (ms)
};

export const FEDERATION_TICKET_TTL_MS = 30_000; // 票据有效期 30 秒
