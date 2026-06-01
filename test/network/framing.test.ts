import { describe, it, expect } from "vitest";
import { encodeLengthPrefixU32, frameWithLengthPrefix, tryDecodeFrame } from "../../src/common/framing.js";

describe("encodeLengthPrefixU32", () => {
  it("编码 0 为单字节", () => {
    const buf = encodeLengthPrefixU32(0);
    expect(buf).toEqual(Buffer.from([0x00]));
  });

  it("编码 127 为单字节", () => {
    const buf = encodeLengthPrefixU32(127);
    expect(buf).toEqual(Buffer.from([0x7f]));
  });

  it("编码 128 为双字节", () => {
    const buf = encodeLengthPrefixU32(128);
    expect(buf).toEqual(Buffer.from([0x80, 0x01]));
  });

  it("编码 16383 为双字节", () => {
    const buf = encodeLengthPrefixU32(16383);
    expect(buf).toEqual(Buffer.from([0xff, 0x7f]));
  });

  it("编码 16384 为三字节", () => {
    const buf = encodeLengthPrefixU32(16384);
    expect(buf).toEqual(Buffer.from([0x80, 0x80, 0x01]));
  });

  it("编码最大 U32 (4294967295) 为五字节", () => {
    const buf = encodeLengthPrefixU32(0xffffffff);
    expect(buf.length).toBe(5);
    expect(buf).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]));
  });

  it("负数应抛出", () => {
    expect(() => encodeLengthPrefixU32(-1)).toThrow("frame-invalid-length");
  });

  it("非整数应抛出", () => {
    expect(() => encodeLengthPrefixU32(1.5)).toThrow("frame-invalid-length");
  });
});

describe("frameWithLengthPrefix", () => {
  it("各种长度下与 concat(encodeLengthPrefixU32(len), body) 逐字节一致", () => {
    for (const len of [0, 1, 5, 127, 128, 16383, 16384, 70000]) {
      const body = Buffer.alloc(len);
      for (let i = 0; i < len; i++) body[i] = (i * 31) & 0xff;
      const expected = Buffer.concat([encodeLengthPrefixU32(len), body]);
      expect(frameWithLengthPrefix(body)).toEqual(expected);
    }
  });

  it("产出的帧可被 tryDecodeFrame 完整解析", () => {
    const body = Buffer.from("hello frame");
    const result = tryDecodeFrame(frameWithLengthPrefix(body));
    expect(result.type).toBe("frame");
    if (result.type === "frame") {
      expect(result.payload.toString()).toBe("hello frame");
      expect(result.remaining.length).toBe(0);
    }
  });
});

describe("tryDecodeFrame", () => {
  it("空缓冲区返回 need_more", () => {
    const result = tryDecodeFrame(Buffer.alloc(0));
    expect(result.type).toBe("need_more");
  });

  it("解码单字节长度帧", () => {
    const payload = Buffer.from("hello");
    const lenBuf = encodeLengthPrefixU32(payload.length);
    const frame = Buffer.concat([lenBuf, payload]);
    const result = tryDecodeFrame(frame);
    expect(result.type).toBe("frame");
    if (result.type === "frame") {
      expect(result.payload.toString()).toBe("hello");
      expect(result.remaining.length).toBe(0);
    }
  });

  it("解码多字节长度帧", () => {
    const payload = Buffer.alloc(200);
    const lenBuf = encodeLengthPrefixU32(payload.length);
    const frame = Buffer.concat([lenBuf, payload]);
    const result = tryDecodeFrame(frame);
    expect(result.type).toBe("frame");
    if (result.type === "frame") {
      expect(result.payload.length).toBe(200);
    }
  });

  it("数据不足返回 need_more", () => {
    const payload = Buffer.from("hello");
    const lenBuf = encodeLengthPrefixU32(payload.length);
    const frame = Buffer.concat([lenBuf, payload.subarray(0, 2)]);
    const result = tryDecodeFrame(frame);
    expect(result.type).toBe("need_more");
  });

  it("长度前缀不足返回 need_more", () => {
    const result = tryDecodeFrame(Buffer.from([0x80]));
    expect(result.type).toBe("need_more");
  });

  it("超过 maxPayloadBytes 返回 error", () => {
    const payload = Buffer.alloc(100);
    const lenBuf = encodeLengthPrefixU32(payload.length);
    const frame = Buffer.concat([lenBuf, payload]);
    const result = tryDecodeFrame(frame, 50);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error.message).toBe("frame-payload-too-large");
    }
  });

  it("无效长度前缀（第六字节继续位）返回 error", () => {
    const frame = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x80]);
    const result = tryDecodeFrame(frame);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.error.message).toBe("frame-invalid-length-prefix");
    }
  });

  it("解析多个连续帧", () => {
    const p1 = Buffer.from("abc");
    const p2 = Buffer.from("de");
    const frame1 = Buffer.concat([encodeLengthPrefixU32(p1.length), p1]);
    const frame2 = Buffer.concat([encodeLengthPrefixU32(p2.length), p2]);
    const combined = Buffer.concat([frame1, frame2]);

    const r1 = tryDecodeFrame(combined);
    expect(r1.type).toBe("frame");
    if (r1.type === "frame") {
      expect(r1.payload.toString()).toBe("abc");
      const r2 = tryDecodeFrame(r1.remaining);
      expect(r2.type).toBe("frame");
      if (r2.type === "frame") {
        expect(r2.payload.toString()).toBe("de");
      }
    }
  });

  it("空 payload 帧", () => {
    const lenBuf = encodeLengthPrefixU32(0);
    const frame = Buffer.concat([lenBuf]);
    const result = tryDecodeFrame(frame);
    expect(result.type).toBe("frame");
    if (result.type === "frame") {
      expect(result.payload.length).toBe(0);
    }
  });

  it("恰好等于 maxPayloadBytes", () => {
    const payload = Buffer.alloc(100);
    const lenBuf = encodeLengthPrefixU32(payload.length);
    const frame = Buffer.concat([lenBuf, payload]);
    const result = tryDecodeFrame(frame, 100);
    expect(result.type).toBe("frame");
    if (result.type === "frame") {
      expect(result.payload.length).toBe(100);
    }
  });
});