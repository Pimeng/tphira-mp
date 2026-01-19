import type net from "node:net";
import { encodeLengthPrefixU32, tryDecodeFrame } from "./framing.js";

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
  private recvBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private closed = false;

  private constructor(socket: net.Socket, version: number, codec: StreamCodec<S, R>, handler: StreamHandler<R>) {
    this.socket = socket;
    this.version = version;
    this.codec = codec;
    this.handler = handler;
  }

  static async create<S, R>(opts: { socket: net.Socket; versionToSend?: number; codec: StreamCodec<S, R>; handler: StreamHandler<R> }): Promise<Stream<S, R>> {
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
          reject(new Error("连接已关闭"));
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
        reject(new Error("连接已关闭"));
      };

      opts.socket.on("data", onData);
      opts.socket.once("error", onError);
      opts.socket.once("close", onClose);
    });

    const stream = new Stream<S, R>(opts.socket, version, opts.codec, opts.handler);
    stream.recvBuffer = initialBuffer as Buffer<ArrayBufferLike>;

    stream.socket.on("data", (data) => {
      if (stream.closed) return;
      stream.recvBuffer = stream.recvBuffer.length === 0 ? data : Buffer.concat([stream.recvBuffer, data]);
      void stream.drain();
    });

    stream.socket.on("close", () => {
      stream.closed = true;
    });

    stream.socket.on("error", () => {
      stream.closed = true;
    });

    if (stream.recvBuffer.length > 0) void stream.drain();

    return stream;
  }

  async send(payload: S): Promise<void> {
    const body = this.codec.encodeSend(payload);
    const header = encodeLengthPrefixU32(body.length);
    await new Promise<void>((resolve, reject) => {
      this.socket.write(Buffer.concat([header, body]), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close(): void {
    this.closed = true;
    this.socket.destroy();
  }

  private async drain(): Promise<void> {
    while (true) {
      const res = tryDecodeFrame(this.recvBuffer);
      if (res.type === "need_more") return;
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
      await this.handler(packet);
    }
  }
}
