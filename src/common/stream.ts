import type net from "node:net";
import { encodeLengthPrefixU32, tryDecodeFrame } from "./framing.js";

const SEND_TIMEOUT_MS = 5000;
const BATCH_SEND_DELAY_MS = 0; // 优化：立即发送，减少延迟
const MAX_BATCH_SIZE = 20; // 优化：增加批量大小

export type StreamHandler<R> = (packet: R) => void | Promise<void>;

export type StreamCodec<S, R> = {
  encodeSend: (payload: S) => Buffer;
  decodeRecv: (payload: Buffer) => R;
};

export class Stream<S, R> {
  readonly socket: net.Socket;
  readonly version: number;
  private readonly codec: StreamCodec<S, R>;
  private readonly handler: StreamHandler<R>;
  private readonly fastPath: ((packet: R) => boolean) | undefined;
  private recvBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private closed = false;
  private decodeScheduled = false;
  private processing = false;
  private queue: R[] = [];
  
  // 批量发送优化
  private sendBatch: Buffer[] = [];
  private sendBatchTimer: NodeJS.Timeout | null = null;
  private sending = false;

  private constructor(
    socket: net.Socket,
    version: number,
    codec: StreamCodec<S, R>,
    handler: StreamHandler<R>,
    fastPath: ((packet: R) => boolean) | undefined
  ) {
    this.socket = socket;
    this.version = version;
    this.codec = codec;
    this.handler = handler;
    this.fastPath = fastPath;
  }

  static async create<S, R>(opts: {
    socket: net.Socket;
    versionToSend?: number;
    expectedVersion?: number;
    codec: StreamCodec<S, R>;
    handler: StreamHandler<R>;
    fastPath?: (packet: R) => boolean;
  }): Promise<Stream<S, R>> {
    opts.socket.setNoDelay(true);

    const { version, initialBuffer } = await new Promise<{ version: number; initialBuffer: Buffer }>((resolve, reject) => {
      if (opts.versionToSend !== undefined) {
        const v = opts.versionToSend & 0xff;
        opts.socket.write(Buffer.from([v]), (err) => {
          if (err) reject(err);
          else resolve({ version: v, initialBuffer: Buffer.alloc(0) });
        });
        return;
      }

      const onData = (buf: Buffer) => {
        opts.socket.off("error", onError);
        opts.socket.off("close", onClose);
        opts.socket.off("data", onData);

        if (buf.length === 0) {
          reject(new Error("net-connection-closed"));
          return;
        }

        const v = buf[0];
        const rest = buf.subarray(1);
        resolve({ version: v, initialBuffer: rest });
      };

      const onError = (err: Error) => {
        opts.socket.off("data", onData);
        opts.socket.off("close", onClose);
        reject(err);
      };

      const onClose = () => {
        opts.socket.off("data", onData);
        opts.socket.off("error", onError);
        reject(new Error("net-connection-closed"));
      };

      opts.socket.on("data", onData);
      opts.socket.once("error", onError);
      opts.socket.once("close", onClose);
    });

    if (opts.versionToSend === undefined && opts.expectedVersion !== undefined && version !== (opts.expectedVersion & 0xff)) {
      opts.socket.destroy();
      throw new Error(`net-unsupported-protocol-version:${version}`);
    }

    const stream = new Stream<S, R>(opts.socket, version, opts.codec, opts.handler, opts.fastPath);
    stream.recvBuffer = initialBuffer as Buffer<ArrayBufferLike>;

    stream.socket.on("data", (data) => {
      if (stream.closed) return;
      stream.recvBuffer = stream.recvBuffer.length === 0 ? data : Buffer.concat([stream.recvBuffer, data]);
      stream.scheduleDecode();
    });

    stream.socket.on("close", () => {
      stream.closed = true;
    });

    stream.socket.on("error", () => {
      stream.closed = true;
    });

    if (stream.recvBuffer.length > 0) setImmediate(() => stream.scheduleDecode());

    return stream;
  }

  async send(payload: S): Promise<void> {
    if (this.closed) throw new Error("net-connection-closed");
    
    const body = this.codec.encodeSend(payload);
    const header = encodeLengthPrefixU32(body.length);
    const frame = Buffer.concat([header, body]);
    
    // 添加到批量发送队列
    this.sendBatch.push(frame);
    
    // 如果达到批量大小，立即发送
    if (this.sendBatch.length >= MAX_BATCH_SIZE) {
      await this.flushSendBatch();
      return;
    }
    
    // 否则设置延迟发送（如果延迟为0则立即发送）
    if (BATCH_SEND_DELAY_MS === 0) {
      await this.flushSendBatch();
    } else if (!this.sendBatchTimer) {
      this.sendBatchTimer = setTimeout(() => {
        void this.flushSendBatch();
      }, BATCH_SEND_DELAY_MS);
    }
  }
  
  /** 立即把累计的发送批次写入 socket（认证响应等需要绕过批量延迟的场景使用） */
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
    }
  }

  close(): void {
    this.closed = true;
    if (this.sendBatchTimer) {
      clearTimeout(this.sendBatchTimer);
      this.sendBatchTimer = null;
    }
    this.socket.destroy();
  }

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
        this.close();
        return;
      }

      this.recvBuffer = res.remaining as Buffer<ArrayBufferLike>;
      let packet: R;
      try {
        packet = this.codec.decodeRecv(res.payload);
      } catch {
        this.close();
        return;
      }
      if (this.fastPath?.(packet) === true) {
        void Promise.resolve(this.handler(packet)).catch(() => {
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
        } catch {
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
