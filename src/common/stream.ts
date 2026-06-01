/**
 * 网络流管理模块
 *
 * Stream 类封装了基于 TCP socket 的双向通信流，提供：
 * - 协议版本协商（握手时交换版本号）
 * - 基于长度前缀的帧编解码（解决 TCP 粘包问题）
 * - 批量发送优化（低优先级消息延迟 5ms 批量发送，提高吞吐量）
 * - 高优先级消息快速通道（心跳、认证等消息立即发送）
 * - 接收队列与异步处理（避免阻塞 socket 事件循环）
 * - Fast Path 优化（Ping 等简单命令绕过队列直接处理）
 */
import type net from "node:net";
import { encodeLengthPrefixU32, tryDecodeFrame } from "./framing.js";
import { NOOP } from "./utils.js";

/** Socket 发送超时时间（毫秒） */
const SEND_TIMEOUT_MS = 5000;
/** 低优先级消息批量发送延迟（轻微延迟换取更高吞吐量） */
const BATCH_SEND_DELAY_MS = 5;
/** 批量发送最大帧数（达到此数量立即发送） */
const MAX_BATCH_SIZE = 20;
/** 接收缓冲区最大大小（超过此值将关闭连接，防止恶意客户端发送不完整帧导致内存泄漏） */
const RECV_BUFFER_MAX_SIZE = 4 * 1024 * 1024;

/** 流消息处理器类型 */
export type StreamHandler<R> = (packet: R) => void | Promise<void>;

/**
 * 流编解码器接口
 *
 * 定义了发送/接收消息的编解码方式，以及高优先级消息的判断逻辑。
 */
export type StreamCodec<S, R> = {
  /** 将发送消息编码为 Buffer */
  encodeSend: (payload: S) => Buffer;
  /** 将接收到的 Buffer 解码为消息 */
  decodeRecv: (payload: Buffer) => R;
  /** 判断消息是否为高优先级；高优先级消息会跳过批量延迟，立即发送 */
  isHighPriority?: (payload: S) => boolean;
};

/** 流错误处理器 */
export type StreamErrorHandler = (phase: "decode" | "handler", error: Error) => void;

/**
 * 双向网络流类
 *
 * 管理单个 TCP 连接上的消息收发，提供批量发送、优先级控制和帧解析功能。
 */
export class Stream<S, R> {
  /** 底层 TCP Socket */
  readonly socket: net.Socket;
  /** 协商后的协议版本 */
  readonly version: number;
  /** 编解码器实例 */
  private readonly codec: StreamCodec<S, R>;
  /** 消息处理器 */
  private readonly handler: StreamHandler<R>;
  /** 快速路径判断函数（可选，用于绕过队列直接处理特定消息） */
  private readonly fastPath: ((packet: R) => boolean) | undefined;
  /** 接收缓冲区（累积未完整帧的数据） */
  private recvBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  /** 连接是否已关闭 */
  private closed = false;
  /** 是否有待执行的解码任务 */
  private decodeScheduled = false;
  /** 是否正在处理接收队列 */
  private processing = false;
  /** 接收消息队列（非 fast path 消息进入此队列） */
  private queue: R[] = [];
  /** 错误处理器（可选） */
  private readonly onError?: StreamErrorHandler;

  // ========== 批量发送优化 ==========

  /** 发送批次缓冲区 */
  private sendBatch: Buffer[] = [];
  /** 批量发送定时器 */
  private sendBatchTimer: NodeJS.Timeout | null = null;
  /** 是否正在执行批量发送 */
  private sending = false;

  private constructor(
    socket: net.Socket,
    version: number,
    codec: StreamCodec<S, R>,
    handler: StreamHandler<R>,
    fastPath: ((packet: R) => boolean) | undefined,
    onError?: StreamErrorHandler
  ) {
    this.socket = socket;
    this.version = version;
    this.codec = codec;
    this.handler = handler;
    this.fastPath = fastPath;
    this.onError = onError;
  }

/**
   * 创建新的 Stream 实例
   *
   * 完成协议版本协商：
   * - 如果指定了 versionToSend，则发送版本号并等待对方回复
   * - 否则接收对方发送的版本号
   *
   * @param opts - 创建选项
   * @returns 协商完成的 Stream 实例
   * @throws 当连接关闭或版本不匹配时抛出异常
   */
  /** 协议版本协商超时时间（毫秒） */
  static readonly HANDSHAKE_TIMEOUT_MS = 10000;

  static async create<S, R>(opts: {
    socket: net.Socket;
    versionToSend?: number;
    expectedVersion?: number;
    codec: StreamCodec<S, R>;
    handler: StreamHandler<R>;
    fastPath?: (packet: R) => boolean;
    onError?: StreamErrorHandler;
  }): Promise<Stream<S, R>> {
    // 禁用 Nagle 算法，减少延迟
    opts.socket.setNoDelay(true);
    // 启用 TCP KeepAlive，防止中间 NAT/防火墙断开静默连接
    opts.socket.setKeepAlive(true, 60000);

    // 协议版本协商（带超时保护，防止恶意连接挂起）
    const { version, initialBuffer } = await new Promise<{ version: number; initialBuffer: Buffer }>((resolve, reject) => {
      let timeoutTimer: NodeJS.Timeout | null = null;
      const cleanup = (): void => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        opts.socket.off("data", onData);
        opts.socket.off("error", onError);
        opts.socket.off("close", onClose);
      };

      const onData = (buf: Buffer) => {
        cleanup();
        if (buf.length === 0) {
          reject(new Error("net-connection-closed"));
          return;
        }
        const v = buf[0];
        const rest = buf.subarray(1);
        resolve({ version: v, initialBuffer: rest });
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onClose = () => {
        cleanup();
        reject(new Error("net-connection-closed"));
      };

      if (opts.versionToSend !== undefined) {
        const v = opts.versionToSend & 0xff;
        opts.socket.write(Buffer.from([v]), (err) => {
          if (err) {
            cleanup();
            reject(err);
          } else {
            resolve({ version: v, initialBuffer: Buffer.alloc(0) });
          }
        });
        return;
      }

      opts.socket.on("data", onData);
      opts.socket.once("error", onError);
      opts.socket.once("close", onClose);

      // 设置协商超时
      timeoutTimer = setTimeout(() => {
        cleanup();
        opts.socket.destroy();
        reject(new Error("net-handshake-timeout"));
      }, Stream.HANDSHAKE_TIMEOUT_MS);
    });

    if (opts.versionToSend === undefined && opts.expectedVersion !== undefined && version !== (opts.expectedVersion & 0xff)) {
      opts.socket.destroy();
      throw new Error(`net-unsupported-protocol-version:${version}`);
    }

    const stream = new Stream<S, R>(opts.socket, version, opts.codec, opts.handler, opts.fastPath, opts.onError);
    stream.recvBuffer = initialBuffer as Buffer<ArrayBufferLike>;

    stream.socket.on("data", stream.onSocketData);
    stream.socket.on("close", stream.onSocketClose);
    stream.socket.on("error", stream.onSocketError);

    if (stream.recvBuffer.length > 0) setImmediate(() => stream.scheduleDecode());

    return stream;
  }

  /**
   * 发送消息
   *
   * 发送策略：
   * - 高优先级消息：立即发送（先 flush 现有批量队列保证顺序）
   * - 低优先级消息：进入批量队列，达到 MAX_BATCH_SIZE 或 BATCH_SEND_DELAY_MS 后发送
   *
   * @param payload - 要发送的消息
   * @throws 当连接已关闭时抛出 "net-connection-closed"
   */
  async send(payload: S): Promise<void> {
    if (this.closed) throw new Error("net-connection-closed");

    const body = this.codec.encodeSend(payload);
    const header = encodeLengthPrefixU32(body.length);

    // 高优先级消息：立即 flush 并发送，不进入批量队列
    // 先 flush 已有的低优先级批量，保证消息顺序
    if (this.codec.isHighPriority?.(payload)) {
      await this.flushSendBatch();
      // 直接拼接 header + body 一次性写入，省去中间 frame 分配
      const frame = Buffer.concat([header, body]);
      this.sendBatch.push(frame);
      await this.flushSendBatch();
      return;
    }

    const frame = Buffer.concat([header, body]);

    // 低优先级消息：添加到批量发送队列
    this.sendBatch.push(frame);

    // 如果达到批量大小上限，立即发送
    if (this.sendBatch.length >= MAX_BATCH_SIZE) {
      await this.flushSendBatch();
      return;
    }

    // 设置延迟发送定时器（轻微延迟换取更高吞吐量）
    if (!this.sendBatchTimer) {
      this.sendBatchTimer = setTimeout(() => {
        void this.flushSendBatch().catch(NOOP);
      }, BATCH_SEND_DELAY_MS);
    }
  }

  /**
   * 立即把累计的发送批次写入 socket
   *
   * 用于需要绕过批量延迟的场景（如认证响应）。
   * 会自动合并批次中的所有帧，一次性写入 socket。
   */
  async flushSendBatch(): Promise<void> {
    if (this.sendBatchTimer) {
      clearTimeout(this.sendBatchTimer);
      this.sendBatchTimer = null;
    }

    if (this.sendBatch.length === 0 || this.sending) return;

    const batch = this.sendBatch;
    this.sendBatch = [];
    this.sending = true;

    try {
      const combined = Buffer.concat(batch);
      await new Promise<void>((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error("net-send-timeout"));
        }, SEND_TIMEOUT_MS);
        this.socket.write(combined, (err) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      this.sending = false;
      // 批量发送期间如果有新消息进入队列（例如高优先级消息），继续发送
      if (this.sendBatch.length > 0 && !this.sendBatchTimer) {
        this.sendBatchTimer = setTimeout(() => {
          this.sendBatchTimer = null;
          void this.flushSendBatch().catch(NOOP);
        }, 0);
      }
    }
  }

  close(): void {
    this.closed = true;
    if (this.sendBatchTimer) {
      clearTimeout(this.sendBatchTimer);
      this.sendBatchTimer = null;
    }
    // 移除 socket 事件监听器，防止 socket 通过闭包长期引用 Stream 导致内存泄漏
    this.socket.off("data", this.onSocketData);
    this.socket.off("close", this.onSocketClose);
    this.socket.off("error", this.onSocketError);
    this.socket.destroy();
  }

  /** socket data 事件处理（提取为具名方法以便正确移除） */
  private readonly onSocketData = (data: Buffer): void => {
    if (this.closed) return;
    // 防止 recvBuffer 无限增长（恶意客户端发送不完整帧）
    const newSize = this.recvBuffer.length + data.length;
    if (newSize > RECV_BUFFER_MAX_SIZE) {
      this.onError?.("decode", new Error("recv-buffer-overflow"));
      this.close();
      return;
    }
    if (this.recvBuffer.length === 0) {
      this.recvBuffer = data;
    } else {
      const merged = Buffer.allocUnsafe(newSize);
      this.recvBuffer.copy(merged, 0);
      data.copy(merged, this.recvBuffer.length);
      this.recvBuffer = merged;
    }
    this.scheduleDecode();
  };

  /** socket close 事件处理（提取为具名方法以便正确移除） */
  private readonly onSocketClose = (): void => {
    this.closed = true;
  };

  /** socket error 事件处理（提取为具名方法以便正确移除） */
  private readonly onSocketError = (): void => {
    this.closed = true;
  };

  private scheduleDecode(): void {
    if (this.closed) return;
    if (this.decodeScheduled) return;
    this.decodeScheduled = true;
    setImmediate(() => {
      this.decodeScheduled = false;
      this.decode();
    });
  }

  private decode(): void {
    if (this.closed) return;
    while (true) {
      const res = tryDecodeFrame(this.recvBuffer);
      if (res.type === "need_more") {
        if (this.queue.length > 0) void this.processQueue();
        return;
      }
      if (res.type === "error") {
        this.onError?.("decode", res.error);
        this.close();
        return;
      }

      this.recvBuffer = res.remaining as Buffer<ArrayBufferLike>;
      let packet: R;
      try {
        packet = this.codec.decodeRecv(res.payload);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        this.onError?.("decode", error);
        this.close();
        return;
      }
      if (this.fastPath?.(packet) === true) {
        void Promise.resolve(this.handler(packet)).catch((e) => {
          const error = e instanceof Error ? e : new Error(String(e));
          this.onError?.("handler", error);
          this.close();
        });
      } else {
        this.queue.push(packet);
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.closed) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const packet = this.queue.shift()!;
        try {
          await this.handler(packet);
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          this.onError?.("handler", error);
          this.close();
          return;
        }
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0 && !this.closed) void this.processQueue();
    }
  }
}
