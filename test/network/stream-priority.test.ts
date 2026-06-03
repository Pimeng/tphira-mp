// 消息优先级批量发送测试
import { describe, expect, test } from "vitest";
import net from "node:net";
import { Stream } from "../../src/common/stream.js";
import type { StreamCodec } from "../../src/common/stream.js";

describe("Stream 消息优先级批量发送", () => {
  test("高优先级消息应立即发送，不等待批量窗口", async () => {
    const server = net.createServer();
    const serverReady = new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });
    const port = await serverReady;

    const receivedBuffers: Buffer[] = [];

    server.on("connection", (socket) => {
      socket.on("data", (data) => {
        receivedBuffers.push(Buffer.from(data));
      });
    });

    const socket = net.createConnection({ host: "127.0.0.1", port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    type TestMsg = { type: "high" | "low"; id: number };

    const codec: StreamCodec<TestMsg, TestMsg> = {
      encodeSend: (msg) => {
        const buf = Buffer.alloc(5);
        buf.writeUInt8(msg.type === "high" ? 1 : 0, 0);
        buf.writeUInt32LE(msg.id, 1);
        return buf;
      },
      decodeRecv: (payload) => {
        const type = payload[0] === 1 ? "high" : "low";
        const id = payload.readUInt32LE(1);
        return { type, id };
      },
      isHighPriority: (msg) => msg.type === "high"
    };

    const stream = await Stream.create<TestMsg, TestMsg>({
      socket,
      versionToSend: 1,
      codec,
      handler: () => {}
    });

    // 先发低优先级消息
    await stream.send({ type: "low", id: 1 });

    // 立即发高优先级消息
    const beforeHigh = Date.now();
    await stream.send({ type: "high", id: 2 });
    const afterHigh = Date.now();

    // 高优先级消息应该立即发送（flush 批量）
    expect(afterHigh - beforeHigh).toBeLessThan(100);

    await stream.close();
    server.close();

    // 等待数据到达
    await sleep(50);

    // 验证收到了消息
    expect(receivedBuffers.length).toBeGreaterThan(0);
  });

  test("低优先级消息应进入批量队列", async () => {
    const server = net.createServer();
    const serverReady = new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });
    const port = await serverReady;

    let receivedCount = 0;

    server.on("connection", (socket) => {
      socket.on("data", () => {
        receivedCount++;
      });
    });

    const socket = net.createConnection({ host: "127.0.0.1", port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    type TestMsg = { type: "low"; id: number };

    const codec: StreamCodec<TestMsg, TestMsg> = {
      encodeSend: (msg) => {
        const buf = Buffer.alloc(5);
        buf.writeUInt8(0, 0);
        buf.writeUInt32LE(msg.id, 1);
        return buf;
      },
      decodeRecv: (payload) => {
        const id = payload.readUInt32LE(1);
        return { type: "low", id };
      },
      isHighPriority: () => false
    };

    const stream = await Stream.create<TestMsg, TestMsg>({
      socket,
      versionToSend: 1,
      codec,
      handler: () => {}
    });

    // 连续发送多个低优先级消息
    await stream.send({ type: "low", id: 1 });
    await stream.send({ type: "low", id: 2 });
    await stream.send({ type: "low", id: 3 });

    // 等待批量发送
    await sleep(20);

    await stream.close();
    server.close();

    // 等待数据到达
    await sleep(50);

    // 批量发送应该减少写入次数（多个消息合并成一个 buffer）
    expect(receivedCount).toBeLessThanOrEqual(2);
  });

  test("批量大小达到阈值应立即发送", async () => {
    const server = net.createServer();
    const serverReady = new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });
    const port = await serverReady;

    let receivedCount = 0;

    server.on("connection", (socket) => {
      socket.on("data", () => {
        receivedCount++;
      });
    });

    const socket = net.createConnection({ host: "127.0.0.1", port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    type TestMsg = { type: "low"; id: number };

    const codec: StreamCodec<TestMsg, TestMsg> = {
      encodeSend: (msg) => {
        const buf = Buffer.alloc(5);
        buf.writeUInt8(0, 0);
        buf.writeUInt32LE(msg.id, 1);
        return buf;
      },
      decodeRecv: (payload) => {
        const id = payload.readUInt32LE(1);
        return { type: "low", id };
      },
      isHighPriority: () => false
    };

    const stream = await Stream.create<TestMsg, TestMsg>({
      socket,
      versionToSend: 1,
      codec,
      handler: () => {}
    });

    // 快速发送大量低优先级消息，超过批量大小阈值
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 25; i++) {
      promises.push(stream.send({ type: "low", id: i }));
    }

    await Promise.all(promises);

    await stream.close();
    server.close();

    // 等待数据到达
    await sleep(50);

    // 应该至少有一次批量发送
    expect(receivedCount).toBeGreaterThan(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
