import { describe, it, expect } from "vitest";
import { BinaryReader, BinaryWriter, decodePacket, encodePacket, ok, err, encodeStringResult, decodeStringResult } from "../../src/common/binary.js";
import { encodeLengthPrefixU32 } from "../../src/common/framing.js";

describe("BinaryReader", () => {
  it("readU8", () => {
    const r = new BinaryReader(Buffer.from([0, 255, 128]));
    expect(r.readU8()).toBe(0);
    expect(r.readU8()).toBe(255);
    expect(r.readU8()).toBe(128);
  });

  it("readI8", () => {
    const r = new BinaryReader(Buffer.from([0, 255, 128]));
    expect(r.readI8()).toBe(0);
    expect(r.readI8()).toBe(-1);
    expect(r.readI8()).toBe(-128);
  });

  it("readBool", () => {
    const r = new BinaryReader(Buffer.from([0, 1, 2]));
    expect(r.readBool()).toBe(false);
    expect(r.readBool()).toBe(true);
    expect(r.readBool()).toBe(false);
  });

  it("readU16", () => {
    const buf = Buffer.allocUnsafe(2);
    buf.writeUInt16LE(0x1234, 0);
    const r = new BinaryReader(buf);
    expect(r.readU16()).toBe(0x1234);
  });

  it("readU32", () => {
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(0xdeadbeef, 0);
    const r = new BinaryReader(buf);
    expect(r.readU32()).toBe(0xdeadbeef >>> 0);
  });

  it("readI32", () => {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32LE(-1, 0);
    const r = new BinaryReader(buf);
    expect(r.readI32()).toBe(-1);
  });

  it("readU64", () => {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(0x123456789abcdef0n, 0);
    const r = new BinaryReader(buf);
    expect(r.readU64()).toBe(0x123456789abcdef0n);
  });

  it("readI64", () => {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigInt64LE(-1n, 0);
    const r = new BinaryReader(buf);
    expect(r.readI64()).toBe(-1n);
  });

  it("readF32", () => {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatLE(3.14, 0);
    const r = new BinaryReader(buf);
    expect(r.readF32()).toBeCloseTo(3.14, 2);
  });

  it("readUlebBigInt", () => {
    // 0
    let r = new BinaryReader(Buffer.from([0x00]));
    expect(r.readUlebBigInt()).toBe(0n);
    // 1
    r = new BinaryReader(Buffer.from([0x01]));
    expect(r.readUlebBigInt()).toBe(1n);
    // 128 = 0x80 -> 0x80 0x01
    r = new BinaryReader(Buffer.from([0x80, 0x01]));
    expect(r.readUlebBigInt()).toBe(128n);
    // 16384 = 0x4000 -> 0x80 0x80 0x01
    r = new BinaryReader(Buffer.from([0x80, 0x80, 0x01]));
    expect(r.readUlebBigInt()).toBe(16384n);
  });

  it("readUlebNumber 超过 MAX_SAFE_INTEGER 应抛出", () => {
    // 编码 MAX_SAFE_INTEGER + 1 (9007199254740992)
    const bytes = Buffer.from([0x80, 0xd8, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10]);
    const r = new BinaryReader(bytes);
    expect(() => r.readUlebNumber()).toThrow("binary-length-too-large");
  });

  it("readString", () => {
    const w = new BinaryWriter();
    w.writeString("hello");
    const r = new BinaryReader(w.toBuffer());
    expect(r.readString()).toBe("hello");
  });

  it("readVarchar 超过 maxLen 应抛出", () => {
    const w = new BinaryWriter();
    w.writeString("hello world");
    const r = new BinaryReader(w.toBuffer());
    expect(() => r.readVarchar(5)).toThrow("binary-string-too-long");
  });

  it("readOption", () => {
    const w = new BinaryWriter();
    w.writeBool(true);
    w.writeU32(42);
    w.writeBool(false);
    const r = new BinaryReader(w.toBuffer());
    expect(r.readOption((rr) => rr.readU32())).toBe(42);
    expect(r.readOption((rr) => rr.readU32())).toBeNull();
  });

  it("readResult", () => {
    const w = new BinaryWriter();
    w.writeBool(true);
    w.writeU32(42);
    w.writeBool(false);
    w.writeString("error");
    const r = new BinaryReader(w.toBuffer());
    const okRes = r.readResult((rr) => rr.readU32(), (rr) => rr.readString());
    expect(okRes.ok).toBe(true);
    if (okRes.ok) expect(okRes.value).toBe(42);
    const errRes = r.readResult((rr) => rr.readU32(), (rr) => rr.readString());
    expect(errRes.ok).toBe(false);
    if (!errRes.ok) expect(errRes.error).toBe("error");
  });

  it("readArray", () => {
    const w = new BinaryWriter();
    w.writeUleb(3);
    w.writeU32(1);
    w.writeU32(2);
    w.writeU32(3);
    const r = new BinaryReader(w.toBuffer());
    const arr = r.readArray((rr) => rr.readU32());
    expect(arr).toEqual([1, 2, 3]);
  });

  it("readMap", () => {
    const w = new BinaryWriter();
    w.writeUleb(2);
    w.writeString("a");
    w.writeU32(1);
    w.writeString("b");
    w.writeU32(2);
    const r = new BinaryReader(w.toBuffer());
    const map = r.readMap((rr) => rr.readString(), (rr) => rr.readU32());
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBe(2);
  });

  it("readUuid", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const w = new BinaryWriter();
    w.writeUuid(uuid);
    const r = new BinaryReader(w.toBuffer());
    expect(r.readUuid()).toBe(uuid);
  });

  it("readCompactPos", () => {
    const w = new BinaryWriter();
    w.writeCompactPos({ x: 1.5, y: -2.5 });
    const r = new BinaryReader(w.toBuffer());
    const pos = r.readCompactPos();
    expect(pos.x).toBeCloseTo(1.5, 2);
    expect(pos.y).toBeCloseTo(-2.5, 2);
  });

  it("take", () => {
    const r = new BinaryReader(Buffer.from([1, 2, 3, 4, 5]));
    expect(r.take(2)).toEqual(Buffer.from([1, 2]));
    expect(r.take(3)).toEqual(Buffer.from([3, 4, 5]));
  });

  it("越界读取应抛出 binary-unexpected-eof", () => {
    const r = new BinaryReader(Buffer.from([1]));
    expect(() => r.readU16()).toThrow("binary-unexpected-eof");
  });
});

describe("BinaryWriter", () => {
  it("writeU8", () => {
    const w = new BinaryWriter();
    w.writeU8(255);
    expect(w.toBuffer()).toEqual(Buffer.from([255]));
  });

  it("reserveHead 不影响 toBuffer 的 body 内容", () => {
    const a = new BinaryWriter(512, 0);
    const b = new BinaryWriter(512, 5);
    for (const w of [a, b]) {
      w.writeU32(0xdeadbeef);
      w.writeString("hi");
    }
    expect(b.toBuffer()).toEqual(a.toBuffer());
  });

  it("toFrameBuffer 等价于「LEB128 长度前缀 + body」", () => {
    for (const bodyLen of [0, 1, 127, 128, 16384]) {
      const w = new BinaryWriter(512, 5);
      for (let i = 0; i < bodyLen; i++) w.writeU8((i * 7) & 0xff);
      const frame = w.toFrameBuffer();
      const expectedPrefix = encodeLengthPrefixU32(bodyLen);
      expect(frame.subarray(0, expectedPrefix.length)).toEqual(expectedPrefix);
      expect(frame.length).toBe(expectedPrefix.length + bodyLen);
      // body 部分应与原始内容一致
      for (let i = 0; i < bodyLen; i++) {
        expect(frame[expectedPrefix.length + i]).toBe((i * 7) & 0xff);
      }
    }
  });

  it("reserveHead 不足以容纳长度前缀时抛出", () => {
    const w = new BinaryWriter(512, 1);
    // 写入 >127 字节 body，需要 2 字节前缀，超出 reserveHead=1
    for (let i = 0; i < 200; i++) w.writeU8(0);
    expect(() => w.toFrameBuffer()).toThrow("frame-reserve-head-too-small");
  });

  it("writeI8", () => {
    const w = new BinaryWriter();
    w.writeI8(-1);
    expect(w.toBuffer()).toEqual(Buffer.from([255]));
  });

  it("writeBool", () => {
    const w = new BinaryWriter();
    w.writeBool(true);
    w.writeBool(false);
    expect(w.toBuffer()).toEqual(Buffer.from([1, 0]));
  });

  it("writeU16", () => {
    const w = new BinaryWriter();
    w.writeU16(0x1234);
    const buf = w.toBuffer();
    expect(buf.readUInt16LE(0)).toBe(0x1234);
  });

  it("writeU32", () => {
    const w = new BinaryWriter();
    w.writeU32(0xdeadbeef);
    const buf = w.toBuffer();
    expect(buf.readUInt32LE(0)).toBe(0xdeadbeef >>> 0);
  });

  it("writeI32", () => {
    const w = new BinaryWriter();
    w.writeI32(-1);
    const buf = w.toBuffer();
    expect(buf.readInt32LE(0)).toBe(-1);
  });

  it("writeU64", () => {
    const w = new BinaryWriter();
    w.writeU64(0x123456789abcdef0n);
    const buf = w.toBuffer();
    expect(buf.readBigUInt64LE(0)).toBe(0x123456789abcdef0n);
  });

  it("writeI64", () => {
    const w = new BinaryWriter();
    w.writeI64(-1n);
    const buf = w.toBuffer();
    expect(buf.readBigInt64LE(0)).toBe(-1n);
  });

  it("writeF32", () => {
    const w = new BinaryWriter();
    w.writeF32(3.14);
    const buf = w.toBuffer();
    expect(buf.readFloatLE(0)).toBeCloseTo(3.14, 2);
  });

  it("writeUleb", () => {
    const w = new BinaryWriter();
    w.writeUleb(128);
    expect(w.toBuffer()).toEqual(Buffer.from([0x80, 0x01]));
  });

  it("writeString", () => {
    const w = new BinaryWriter();
    w.writeString("hello");
    const buf = w.toBuffer();
    expect(buf[0]).toBe(5);
    expect(buf.subarray(1).toString("utf8")).toBe("hello");
  });

  it("writeVarchar 超过 maxLen 应抛出", () => {
    const w = new BinaryWriter();
    expect(() => w.writeVarchar(5, "hello world")).toThrow("binary-string-too-long");
  });

  it("writeOption", () => {
    const w = new BinaryWriter();
    w.writeOption(42, (ww, v) => ww.writeU32(v));
    w.writeOption<number>(null, (ww, v) => ww.writeU32(v));
    const buf = w.toBuffer();
    expect(buf).toEqual(Buffer.from([1, 42, 0, 0, 0, 0]));
  });

  it("writeResult", () => {
    const w = new BinaryWriter();
    w.writeResult(ok(42), (ww, v) => ww.writeU32(v), (ww, e) => ww.writeString(e));
    w.writeResult(err("fail"), (ww, v) => ww.writeU32(v), (ww, e) => ww.writeString(e));
    const r = new BinaryReader(w.toBuffer());
    const res1 = r.readResult((rr) => rr.readU32(), (rr) => rr.readString());
    expect(res1.ok).toBe(true);
    const res2 = r.readResult((rr) => rr.readU32(), (rr) => rr.readString());
    expect(res2.ok).toBe(false);
  });

  it("writeArray", () => {
    const w = new BinaryWriter();
    w.writeArray([1, 2, 3], (ww, v) => ww.writeU32(v));
    const r = new BinaryReader(w.toBuffer());
    expect(r.readUlebNumber()).toBe(3);
    expect(r.readU32()).toBe(1);
    expect(r.readU32()).toBe(2);
    expect(r.readU32()).toBe(3);
  });

  it("writeMap", () => {
    const w = new BinaryWriter();
    const map = new Map([["a", 1], ["b", 2]]);
    w.writeMap(map, (ww, k) => ww.writeString(k), (ww, v) => ww.writeU32(v));
    const r = new BinaryReader(w.toBuffer());
    expect(r.readUlebNumber()).toBe(2);
    expect(r.readString()).toBe("a");
    expect(r.readU32()).toBe(1);
    expect(r.readString()).toBe("b");
    expect(r.readU32()).toBe(2);
  });

  it("writeUuid", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const w = new BinaryWriter();
    w.writeUuid(uuid);
    const r = new BinaryReader(w.toBuffer());
    expect(r.readUuid()).toBe(uuid);
  });

  it("writeCompactPos", () => {
    const w = new BinaryWriter();
    w.writeCompactPos({ x: 1.5, y: -2.5 });
    const r = new BinaryReader(w.toBuffer());
    const pos = r.readCompactPos();
    expect(pos.x).toBeCloseTo(1.5, 2);
    expect(pos.y).toBeCloseTo(-2.5, 2);
  });

  it("writeBuffer", () => {
    const w = new BinaryWriter();
    w.writeBuffer(Buffer.from([1, 2, 3]));
    expect(w.toBuffer()).toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("encodePacket / decodePacket", () => {
  it("编码解码往返正确", () => {
    const buf = encodePacket(42, (w, v) => w.writeU32(v));
    const v = decodePacket(buf, (r) => r.readU32());
    expect(v).toBe(42);
  });
});

describe("StringResult", () => {
  it("encodeStringResult / decodeStringResult", () => {
    const w = new BinaryWriter();
    encodeStringResult(w, ok(42), (ww, v) => ww.writeU32(v));
    encodeStringResult(w, err("bad"), (ww, v) => ww.writeU32(v));
    const r = new BinaryReader(w.toBuffer());
    const res1 = decodeStringResult(r, (rr) => rr.readU32());
    expect(res1.ok).toBe(true);
    if (res1.ok) expect(res1.value).toBe(42);
    const res2 = decodeStringResult(r, (rr) => rr.readU32());
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.error).toBe("bad");
  });
});