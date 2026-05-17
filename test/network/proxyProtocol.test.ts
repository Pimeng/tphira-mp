import { describe, it, expect, vi } from "vitest";
import net from "node:net";
import { parseProxyProtocol } from "../../src/server/network/proxyProtocol.js";

function createMockSocket(_data: Buffer): net.Socket {
  const socket = new net.Socket();
  return socket;
}

async function emitData(socket: net.Socket, data: Buffer, delayMs = 0): Promise<void> {
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }
  socket.emit("data", data);
}

describe("parseProxyProtocol", () => {
  it("v1 TCP4", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);
    await emitData(socket, Buffer.from("PROXY TCP4 192.168.0.1 192.168.0.11 56324 443\r\n"));
    const result = await promise;
    expect(result).not.toBeNull();
    if (result) {
      expect(result.sourceAddress).toBe("192.168.0.1");
      expect(result.sourcePort).toBe(56324);
      expect(result.destAddress).toBe("192.168.0.11");
      expect(result.destPort).toBe(443);
      expect(result.family).toBe("TCP4");
    }
  });

  it("v1 TCP6", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);
    await emitData(socket, Buffer.from("PROXY TCP6 ::1 ::1 56324 443\r\n"));
    const result = await promise;
    expect(result).not.toBeNull();
    if (result) {
      expect(result.sourceAddress).toBe("::1");
      expect(result.family).toBe("TCP6");
    }
  });

  it("v1 UNKNOWN 返回 null", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);
    await emitData(socket, Buffer.from("PROXY UNKNOWN\r\n"));
    const result = await promise;
    expect(result).toBeNull();
  });

  it("v1 格式错误返回 null", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);
    await emitData(socket, Buffer.from("PROXY TCP4 1.2.3.4\r\n"));
    const result = await promise;
    expect(result).toBeNull();
  });

  it("非 PROXY 数据返回 null", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);
    await emitData(socket, Buffer.from("GET / HTTP/1.1\r\n"));
    const result = await promise;
    expect(result).toBeNull();
  });

  it("v2 TCP4", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);

    // 构建 v2 二进制头
    const sig = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);
    const verCmd = 0x21; // ver=2, cmd=PROXY
    const famProto = 0x11; // TCP over IPv4
    const addrLen = 12;
    const header = Buffer.concat([
      sig,
      Buffer.from([verCmd, famProto]),
      Buffer.allocUnsafe(2)
    ]);
    header.writeUInt16BE(addrLen, 14);

    const addr = Buffer.alloc(addrLen);
    addr[0] = 192; addr[1] = 168; addr[2] = 0; addr[3] = 1; // source
    addr[4] = 192; addr[5] = 168; addr[6] = 0; addr[7] = 11; // dest
    addr.writeUInt16BE(56324, 8); // sourcePort
    addr.writeUInt16BE(443, 10); // destPort

    await emitData(socket, Buffer.concat([header, addr]));
    const result = await promise;
    expect(result).not.toBeNull();
    if (result) {
      expect(result.sourceAddress).toBe("192.168.0.1");
      expect(result.sourcePort).toBe(56324);
      expect(result.destAddress).toBe("192.168.0.11");
      expect(result.destPort).toBe(443);
      expect(result.family).toBe("TCP4");
    }
  });

  it("v2 LOCAL 返回 null", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);

    const sig = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);
    const verCmd = 0x20; // ver=2, cmd=LOCAL
    const famProto = 0x00;
    const addrLen = 0;
    const header = Buffer.concat([
      sig,
      Buffer.from([verCmd, famProto]),
      Buffer.allocUnsafe(2)
    ]);
    header.writeUInt16BE(addrLen, 14);

    await emitData(socket, header);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("超时返回 null", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 50);
    const result = await promise;
    expect(result).toBeNull();
  });

  it("socket 错误返回 null", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);
    socket.emit("error", new Error("test error"));
    const result = await promise;
    expect(result).toBeNull();
  });

  it("socket end 返回 null", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);
    socket.emit("end");
    const result = await promise;
    expect(result).toBeNull();
  });

  it("数据分批到达", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const promise = parseProxyProtocol(socket, 1000);

    const data = Buffer.from("PROXY TCP4 10.0.0.1 10.0.0.2 1234 5678\r\n");
    // 分两次发送
    await emitData(socket, data.subarray(0, 20));
    await emitData(socket, data.subarray(20));

    const result = await promise;
    expect(result).not.toBeNull();
    if (result) {
      expect(result.sourceAddress).toBe("10.0.0.1");
      expect(result.sourcePort).toBe(1234);
    }
  });

  it("剩余数据放回 socket", async () => {
    const socket = createMockSocket(Buffer.alloc(0));
    const unshiftSpy = vi.spyOn(socket, "unshift").mockImplementation(() => {});

    const promise = parseProxyProtocol(socket, 1000);
    await emitData(socket, Buffer.from("PROXY TCP4 1.2.3.4 5.6.7.8 1234 5678\r\nEXTRA"));
    await promise;

    expect(unshiftSpy).toHaveBeenCalled();
    unshiftSpy.mockRestore();
  });
});