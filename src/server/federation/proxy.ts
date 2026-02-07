/**
 * FederationProxy - 透明代理
 *
 * 实现跨服务器玩家转发的核心组件。
 *
 * 工作原理：
 * 1. 源服务器通过 HTTP 在目标服务器上创建票据 (prepare)
 * 2. 代理向目标服务器发起 TCP 连接
 * 3. 完成协议版本握手
 * 4. 使用联邦令牌 (@ticket) 进行鉴权
 * 5. 发送 JoinRoom 进入目标房间
 * 6. 之后透明转发所有二进制数据
 *
 * 设计理念：
 * - 低侵入性：实际服务器只需修改鉴权逻辑，无需改动核心代码
 * - 协议黑盒：除鉴权外完全遵循原版协议
 */

import net from "node:net";
import { encodePacket, decodePacket, type StringResult } from "../../common/binary.js";
import {
  encodeClientCommand,
  decodeServerCommand,
  type ClientCommand,
  type ServerCommand,
  HEARTBEAT_INTERVAL_MS,
} from "../../common/commands.js";
import { parseRoomId } from "../../common/roomId.js";
import { encodeLengthPrefixU32, tryDecodeFrame } from "../../common/framing.js";
import { buildFederationToken } from "./protocol.js";
import type { FederationPeer } from "../types.js";
import type { Logger } from "../logger.js";

const CONNECT_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MS = 15_000;
const PROTOCOL_VERSION = 1;

export type ProxySessionState = "connecting" | "handshake" | "authenticating" | "joining" | "active" | "closed";

/**
 * 单个代理会话：管理源玩家到目标服务器的桥接连接
 */
export class ProxySession {
  readonly playerId: number;
  readonly playerName: string;
  readonly targetPeer: FederationPeer;
  readonly targetRoomId: string;
  readonly ticket: string;

  private remoteSocket: net.Socket | null = null;
  private state: ProxySessionState = "connecting";
  private recvBuffer: Buffer = Buffer.alloc(0);
  private logger: Logger;
  private pingTimer: NodeJS.Timeout | null = null;

  /** 当远程服务器发来数据时，转发给本地玩家 */
  onRemoteCommand: ((cmd: ServerCommand) => Promise<void>) | null = null;

  /** 当代理会话关闭时的回调 */
  onClose: (() => void) | null = null;

  /** 鉴权结果回调 */
  private authResolve: ((result: StringResult<ServerCommand>) => void) | null = null;

  constructor(opts: {
    playerId: number;
    playerName: string;
    targetPeer: FederationPeer;
    targetRoomId: string;
    ticket: string;
    logger: Logger;
  }) {
    this.playerId = opts.playerId;
    this.playerName = opts.playerName;
    this.targetPeer = opts.targetPeer;
    this.targetRoomId = opts.targetRoomId;
    this.ticket = opts.ticket;
    this.logger = opts.logger;
  }

  /**
   * 发起到目标服务器的连接并完成联邦鉴权
   *
   * 流程：连接 -> 握手 -> 鉴权(@ticket) -> JoinRoom -> 透明转发
   */
  async connect(): Promise<{ success: boolean; error?: string }> {
    try {
      // 步骤 1: TCP 连接
      this.state = "connecting";
      const { host, port } = this.parseAddress(this.targetPeer.address);

      this.remoteSocket = await this.tcpConnect(host, port);
      this.logger.debug(
        `[FederationProxy] 已连接到 ${this.targetPeer.name} (${host}:${port}), player=${this.playerName}`
      );

      // 步骤 2: 协议版本握手
      this.state = "handshake";
      await this.doHandshake();
      this.logger.debug(`[FederationProxy] 握手完成, player=${this.playerName}`);

      // 步骤 3: 联邦鉴权
      this.state = "authenticating";
      const authResult = await this.doAuthenticate();
      if (!authResult.ok) {
        this.close();
        return { success: false, error: authResult.error };
      }
      this.logger.debug(`[FederationProxy] 鉴权成功, player=${this.playerName}`);

      // 步骤 4: 加入房间
      this.state = "joining";
      const joinResult = await this.doJoinRoom();
      if (!joinResult.ok) {
        this.close();
        return { success: false, error: joinResult.error };
      }
      this.logger.debug(`[FederationProxy] 加入房间成功, player=${this.playerName}, room=${this.targetRoomId}`);

      // 步骤 5: 进入透明转发模式
      this.state = "active";
      this.setupTransparentForwarding();
      this.startPingLoop();

      return { success: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[FederationProxy] 连接失败: ${msg}, player=${this.playerName}`);
      this.close();
      return { success: false, error: msg };
    }
  }

  /**
   * 从本地玩家转发命令到远程服务器
   */
  async forwardToRemote(cmd: ClientCommand): Promise<void> {
    if (this.state !== "active" || !this.remoteSocket) return;
    try {
      const body = encodePacket(cmd, encodeClientCommand);
      const header = encodeLengthPrefixU32(body.length);
      await new Promise<void>((resolve, reject) => {
        this.remoteSocket!.write(Buffer.concat([header, body]), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch {
      this.close();
    }
  }

  /** 关闭代理会话 */
  close(): void {
    if (this.state === "closed") return;
    this.state = "closed";

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    if (this.remoteSocket) {
      this.remoteSocket.destroy();
      this.remoteSocket = null;
    }

    this.onClose?.();
  }

  get isActive(): boolean {
    return this.state === "active";
  }

  // ==================== 内部方法 ====================

  private parseAddress(address: string): { host: string; port: number } {
    // 支持 "host:port" 和 "[ipv6]:port" 格式
    const m = /^\[(.+)\]:(\d+)$/.exec(address) || /^(.+):(\d+)$/.exec(address);
    if (!m) throw new Error(`federation-invalid-peer-address: ${address}`);
    return { host: m[1]!, port: Number(m[2]) };
  }

  private tcpConnect(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("federation-connect-timeout"));
      }, CONNECT_TIMEOUT_MS);

      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      socket.connect({ host, port }, () => {
        clearTimeout(timer);
        socket.removeAllListeners("error");
        resolve(socket);
      });
    });
  }

  /** 协议版本握手：发送版本号并等待确认 */
  private async doHandshake(): Promise<void> {
    const socket = this.remoteSocket!;
    socket.setNoDelay(true);

    // 发送协议版本号
    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.from([PROTOCOL_VERSION]), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** 发送联邦鉴权命令并等待结果 */
  private async doAuthenticate(): Promise<StringResult<true>> {
    const socket = this.remoteSocket!;
    const token = buildFederationToken(this.ticket);

    // 构造 Authenticate 命令
    const authCmd: ClientCommand = { type: "Authenticate", token };
    const body = encodePacket(authCmd, encodeClientCommand);
    const header = encodeLengthPrefixU32(body.length);

    // 发送鉴权命令
    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.concat([header, body]), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 等待鉴权响应
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, error: "federation-auth-timeout" });
      }, AUTH_TIMEOUT_MS);

      let buffer: Buffer<ArrayBuffer> = Buffer.alloc(0);

      const onData = (data: Buffer) => {
        buffer = (buffer.length === 0 ? data : Buffer.concat([buffer, data])) as Buffer<ArrayBuffer>;

        // 尝试解码帧
        const res = tryDecodeFrame(buffer);
        if (res.type === "need_more") return;
        if (res.type === "error") {
          cleanup();
          resolve({ ok: false, error: "federation-auth-decode-error" });
          return;
        }

        // 解码服务器命令
        try {
          const cmd = decodePacket(res.payload, decodeServerCommand);
          if (cmd.type === "Authenticate") {
            cleanup();
            // 保存剩余缓冲区
            this.recvBuffer = res.remaining as Buffer;
            if (cmd.result.ok) {
              resolve({ ok: true, value: true });
            } else {
              resolve({ ok: false, error: cmd.result.error });
            }
            return;
          }
          // 忽略非 Authenticate 响应（如 Pong）
        } catch {
          cleanup();
          resolve({ ok: false, error: "federation-auth-parse-error" });
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("close", onClose);
        socket.off("error", onError);
      };

      const onClose = () => {
        cleanup();
        resolve({ ok: false, error: "federation-auth-connection-closed" });
      };

      const onError = () => {
        cleanup();
        resolve({ ok: false, error: "federation-auth-connection-error" });
      };

      socket.on("data", onData);
      socket.once("close", onClose);
      socket.once("error", onError);
    });
  }

  /** 发送 JoinRoom 命令并等待结果 */
  private async doJoinRoom(): Promise<StringResult<true>> {
    const socket = this.remoteSocket!;
    const roomId = parseRoomId(this.targetRoomId);

    const joinCmd: ClientCommand = { type: "JoinRoom", id: roomId, monitor: false };
    const body = encodePacket(joinCmd, encodeClientCommand);
    const header = encodeLengthPrefixU32(body.length);

    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.concat([header, body]), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // 等待 JoinRoom 响应
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, error: "federation-join-timeout" });
      }, AUTH_TIMEOUT_MS);

      let buffer = this.recvBuffer;
      this.recvBuffer = Buffer.alloc(0);

      const processBuffer = () => {
        while (true) {
          const res = tryDecodeFrame(buffer);
          if (res.type === "need_more") return;
          if (res.type === "error") {
            cleanup();
            resolve({ ok: false, error: "federation-join-decode-error" });
            return;
          }

          buffer = res.remaining as Buffer;

          try {
            const cmd = decodePacket(res.payload, decodeServerCommand);
            if (cmd.type === "JoinRoom") {
              cleanup();
              this.recvBuffer = buffer;
              if (cmd.result.ok) {
                resolve({ ok: true, value: true });
              } else {
                resolve({ ok: false, error: cmd.result.error });
              }
              return;
            }
            // 其他命令（如 Message, OnJoinRoom）转发给本地玩家
            if (this.onRemoteCommand) {
              void this.onRemoteCommand(cmd);
            }
          } catch {
            cleanup();
            resolve({ ok: false, error: "federation-join-parse-error" });
            return;
          }
        }
      };

      const onData = (data: Buffer) => {
        buffer = buffer.length === 0 ? data : Buffer.concat([buffer, data]);
        processBuffer();
      };

      const cleanup = () => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("close", onClose);
        socket.off("error", onError);
      };

      const onClose = () => {
        cleanup();
        resolve({ ok: false, error: "federation-join-connection-closed" });
      };

      const onError = () => {
        cleanup();
        resolve({ ok: false, error: "federation-join-connection-error" });
      };

      socket.on("data", onData);
      socket.once("close", onClose);
      socket.once("error", onError);

      // 处理握手/鉴权阶段遗留的缓冲区
      if (buffer.length > 0) processBuffer();
    });
  }

  /** 设置透明转发：远程服务器的数据 → 本地玩家 */
  private setupTransparentForwarding(): void {
    const socket = this.remoteSocket!;
    let buffer = this.recvBuffer;
    this.recvBuffer = Buffer.alloc(0);

    const processBuffer = () => {
      while (true) {
        const res = tryDecodeFrame(buffer);
        if (res.type === "need_more") return;
        if (res.type === "error") {
          this.close();
          return;
        }

        buffer = res.remaining as Buffer;

        try {
          const cmd = decodePacket(res.payload, decodeServerCommand);
          if (this.onRemoteCommand) {
            void this.onRemoteCommand(cmd);
          }
        } catch {
          this.close();
          return;
        }
      }
    };

    socket.on("data", (data) => {
      if (this.state !== "active") return;
      buffer = buffer.length === 0 ? data : Buffer.concat([buffer, data]);
      processBuffer();
    });

    socket.on("close", () => this.close());
    socket.on("error", () => this.close());

    // 处理剩余缓冲区
    if (buffer.length > 0) processBuffer();
  }

  /** 心跳维持 */
  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      if (this.state !== "active") return;
      void this.forwardToRemote({ type: "Ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }
}

/**
 * FederationProxyManager - 管理所有代理会话
 */
export class FederationProxyManager {
  private readonly sessions = new Map<number, ProxySession>();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** 为玩家创建代理会话 */
  createSession(opts: {
    playerId: number;
    playerName: string;
    targetPeer: FederationPeer;
    targetRoomId: string;
    ticket: string;
  }): ProxySession {
    // 如果该玩家已有代理会话，先关闭
    const existing = this.sessions.get(opts.playerId);
    if (existing) {
      existing.close();
      this.sessions.delete(opts.playerId);
    }

    const session = new ProxySession({
      ...opts,
      logger: this.logger,
    });

    session.onClose = () => {
      this.sessions.delete(opts.playerId);
      this.logger.debug(`[FederationProxy] 代理会话关闭: player=${opts.playerName}(${opts.playerId})`);
    };

    this.sessions.set(opts.playerId, session);
    return session;
  }

  /** 获取玩家的代理会话 */
  getSession(playerId: number): ProxySession | null {
    return this.sessions.get(playerId) ?? null;
  }

  /** 关闭玩家的代理会话 */
  closeSession(playerId: number): void {
    const session = this.sessions.get(playerId);
    if (session) {
      session.close();
      this.sessions.delete(playerId);
    }
  }

  /** 关闭所有代理会话 */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
  }

  /** 当前活跃的代理会话数 */
  get activeCount(): number {
    return this.sessions.size;
  }
}
