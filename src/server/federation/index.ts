/**
 * FederationManager - 联邦管理器
 *
 * 负责管理跨服务器联邦的核心逻辑：
 * - 票据 (ticket) 的创建、验证、过期清理
 * - 对等服务器 (peer) 的管理
 * - 联邦启用/禁用控制
 */

import type { Logger } from "../logger.js";
import {
  generateTicket,
  computeHmac,
  verifyHmac,
  COMPACT_HMAC_LEN,
  FEDERATION_TICKET_TTL_MS,
  type FederationTicket,
} from "./protocol.js";
import type { FederationConfig, FederationPeer } from "../types.js";

export type FederationManagerOptions = {
  config: FederationConfig;
  logger: Logger;
};

export class FederationManager {
  readonly config: FederationConfig;
  private readonly logger: Logger;

  /** 本地票据存储: ticket -> FederationTicket */
  private readonly tickets = new Map<string, FederationTicket>();

  /** 远程房间缓存: roomId -> { peerName, lastSeen } */
  private readonly remoteRooms = new Map<
    string,
    { peer: FederationPeer; hostName: string; playerCount: number; maxUsers: number; state: string; lastSeen: number }
  >();

  /** 票据清理定时器 */
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(opts: FederationManagerOptions) {
    this.config = opts.config;
    this.logger = opts.logger;

    // 每 10 秒清理过期票据
    this.cleanupTimer = setInterval(() => this.cleanupExpiredTickets(), 10_000);
  }

  /** 是否启用联邦 */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /** 共享密钥 */
  get sharedSecret(): string {
    return this.config.shared_secret;
  }

  /** 对等服务器列表 */
  get peers(): readonly FederationPeer[] {
    return this.config.peers;
  }

  // ==================== 票据管理 ====================

  /**
   * 创建联邦票据（由目标服务器调用）
   *
   * 当源服务器通过 HTTP API 请求为某玩家创建票据时，
   * 目标服务器验证 HMAC 后创建并存储票据。
   */
  createTicket(opts: {
    playerId: number;
    playerName: string;
    targetRoomId: string;
    sourceServer: string;
    monitor?: boolean;
  }): FederationTicket {
    const ticket = generateTicket();
    const now = Date.now();

    const entry: FederationTicket = {
      ticket,
      playerId: opts.playerId,
      playerName: opts.playerName,
      targetRoomId: opts.targetRoomId,
      sourceServer: opts.sourceServer,
      monitor: opts.monitor ?? false,
      createdAt: now,
      expiresAt: now + FEDERATION_TICKET_TTL_MS,
    };

    this.tickets.set(ticket, entry);
    this.logger.debug(
      `[Federation] 创建票据: ticket=${ticket.slice(0, 8)}..., player=${opts.playerName}(${opts.playerId}), room=${opts.targetRoomId}, from=${opts.sourceServer}`
    );

    return entry;
  }

  /**
   * 验证并消费票据（由目标服务器在 TCP 鉴权时调用）
   *
   * 票据是一次性的，验证成功后立即删除。
   */
  consumeTicket(ticket: string): FederationTicket | null {
    const entry = this.tickets.get(ticket);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.tickets.delete(ticket);
      return null;
    }

    // 一次性消费
    this.tickets.delete(ticket);
    this.logger.debug(
      `[Federation] 消费票据: ticket=${ticket.slice(0, 8)}..., player=${entry.playerName}(${entry.playerId})`
    );

    return entry;
  }

  /**
   * 验证来自对等服务器的 HMAC 签名
   */
  verifyPeerHmac(hmacHex: string, data: string): boolean {
    const hmacBuf = Buffer.from(hmacHex, "hex");
    if (hmacBuf.length !== COMPACT_HMAC_LEN) return false;
    const dataBuf = Buffer.from(data, "utf8");
    return verifyHmac(this.sharedSecret, hmacBuf, dataBuf);
  }

  /**
   * 为对等服务器请求计算 HMAC 签名
   */
  computePeerHmac(data: string): string {
    const dataBuf = Buffer.from(data, "utf8");
    return computeHmac(this.sharedSecret, dataBuf).toString("hex");
  }

  // ==================== 远程房间缓存 ====================

  /**
   * 更新远程房间缓存（由 sync 模块调用）
   */
  updateRemoteRooms(
    peer: FederationPeer,
    rooms: Array<{ roomId: string; hostName: string; playerCount: number; maxUsers: number; state: string }>
  ): void {
    const now = Date.now();

    // 清除该 peer 的旧条目
    for (const [key, value] of this.remoteRooms) {
      if (value.peer.name === peer.name) {
        this.remoteRooms.delete(key);
      }
    }

    // 添加新条目
    for (const room of rooms) {
      this.remoteRooms.set(room.roomId, {
        peer,
        hostName: room.hostName,
        playerCount: room.playerCount,
        maxUsers: room.maxUsers,
        state: room.state,
        lastSeen: now,
      });
    }
  }

  /**
   * 查找远程房间所在的服务器
   */
  findRemoteRoom(roomId: string): { peer: FederationPeer; hostName: string; playerCount: number; maxUsers: number; state: string } | null {
    const entry = this.remoteRooms.get(roomId);
    if (!entry) return null;

    // 检查缓存是否过期（60 秒）
    if (Date.now() - entry.lastSeen > 60_000) {
      this.remoteRooms.delete(roomId);
      return null;
    }

    return entry;
  }

  /**
   * 获取所有远程房间列表
   */
  getRemoteRooms(): Array<{ roomId: string; peer: string; hostName: string; playerCount: number; maxUsers: number; state: string }> {
    const now = Date.now();
    const out: Array<{ roomId: string; peer: string; hostName: string; playerCount: number; maxUsers: number; state: string }> = [];

    for (const [roomId, entry] of this.remoteRooms) {
      if (now - entry.lastSeen > 60_000) continue;
      out.push({
        roomId,
        peer: entry.peer.name,
        hostName: entry.hostName,
        playerCount: entry.playerCount,
        maxUsers: entry.maxUsers,
        state: entry.state,
      });
    }

    return out;
  }

  // ==================== 清理 ====================

  private cleanupExpiredTickets(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.tickets) {
      if (now > entry.expiresAt) {
        this.tickets.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`[Federation] 清理过期票据: ${cleaned} 个`);
    }
  }

  /** 关闭联邦管理器 */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.tickets.clear();
    this.remoteRooms.clear();
  }
}
