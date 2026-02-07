/**
 * FederationSync - 房间状态同步
 *
 * 在联邦服务器之间实时同步房间列表和状态信息。
 *
 * 工作模式：
 * - 定期（每 15 秒）从每个对等服务器拉取房间列表
 * - 通过各服务器的 HTTP API (/federation/rooms) 获取数据
 * - 使用 HMAC 签名验证请求合法性
 * - 缓存远程房间信息供本地查询
 */

import type { Logger } from "../logger.js";
import type { FederationManager } from "./index.js";
import { computeHmac } from "./protocol.js";
import type { FederationPeer } from "../types.js";

const SYNC_INTERVAL_MS = 15_000;  // 同步间隔 15 秒
const FETCH_TIMEOUT_MS = 8_000;   // HTTP 请求超时 8 秒

export type RemoteRoomInfo = {
  roomId: string;
  hostName: string;
  playerCount: number;
  maxUsers: number;
  state: "select_chart" | "waiting_for_ready" | "playing";
  locked: boolean;
};

export class FederationSync {
  private readonly manager: FederationManager;
  private readonly logger: Logger;
  private syncTimer: NodeJS.Timeout | null = null;
  private syncing = false;

  constructor(opts: { manager: FederationManager; logger: Logger }) {
    this.manager = opts.manager;
    this.logger = opts.logger;
  }

  /** 启动定期同步 */
  start(): void {
    if (this.syncTimer) return;

    this.logger.debug("[FederationSync] 启动房间同步服务");

    // 立即执行一次同步
    void this.syncAll();

    // 定期同步
    this.syncTimer = setInterval(() => {
      void this.syncAll();
    }, SYNC_INTERVAL_MS);
  }

  /** 停止同步 */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /** 同步所有对等服务器的房间列表 */
  private async syncAll(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;

    try {
      const peers = this.manager.peers;
      if (peers.length === 0) return;

      const tasks = peers.map((peer) => this.syncPeer(peer));
      await Promise.allSettled(tasks);
    } finally {
      this.syncing = false;
    }
  }

  /** 从单个对等服务器拉取房间列表 */
  private async syncPeer(peer: FederationPeer): Promise<void> {
    if (!peer.http_address) return;

    try {
      const url = `${peer.http_address}/federation/rooms`;

      // 计算请求签名
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signData = `GET:/federation/rooms:${timestamp}`;
      const hmac = computeHmac(this.manager.sharedSecret, Buffer.from(signData, "utf8")).toString("hex");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "X-Federation-Timestamp": timestamp,
            "X-Federation-Hmac": hmac,
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          this.logger.debug(`[FederationSync] ${peer.name} HTTP ${res.status}`);
          return;
        }

        const data = (await res.json()) as {
          rooms?: Array<{
            roomid: string;
            host?: { name: string };
            players?: Array<unknown>;
            state?: string;
            lock?: boolean;
          }>;
          total?: number;
        };

        if (!data.rooms || !Array.isArray(data.rooms)) return;

        const rooms = data.rooms.map((r) => ({
          roomId: r.roomid,
          hostName: r.host?.name ?? "Unknown",
          playerCount: Array.isArray(r.players) ? r.players.length : 0,
          maxUsers: 8, // 默认值
          state: r.state ?? "select_chart",
        }));

        this.manager.updateRemoteRooms(peer, rooms);
        this.logger.debug(
          `[FederationSync] 同步 ${peer.name}: ${rooms.length} 个房间, ${data.total ?? 0} 名玩家`
        );
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        this.logger.debug(`[FederationSync] ${peer.name} 同步超时`);
      } else {
        this.logger.debug(`[FederationSync] ${peer.name} 同步失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
