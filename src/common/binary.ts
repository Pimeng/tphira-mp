import { f16BitsToF32, f32ToF16Bits } from "./half.js";
import { u64PairToUuid, uuidToU64Pair } from "./uuid.js";

function ensureAvailable(buffer: Buffer, offset: number, need: number): void {
  if (offset + need > buffer.length) throw new Error("意外的 EOF");
}

export class BinaryReader {
  readonly buffer: Buffer;
  offset = 0;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  take(n: number): Buffer {
    ensureAvailable(this.buffer, this.offset, n);
    const out = this.buffer.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  readU8(): number {
    ensureAvailable(this.buffer, this.offset, 1);
    return this.buffer[this.offset++];
  }

  readI8(): number {
    const b = this.readU8();
    return (b << 24) >> 24;
  }

  readBool(): boolean {
    return this.readU8() === 1;
  }

  readU16(): number {
    ensureAvailable(this.buffer, this.offset, 2);
    const v = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    ensureAvailable(this.buffer, this.offset, 4);
    const v = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readI32(): number {
    ensureAvailable(this.buffer, this.offset, 4);
    const v = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readU64(): bigint {
    ensureAvailable(this.buffer, this.offset, 8);
    const v = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  readI64(): bigint {
    ensureAvailable(this.buffer, this.offset, 8);
    const v = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  readF32(): number {
    ensureAvailable(this.buffer, this.offset, 4);
    const v = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return v;
  }

  readUlebBigInt(): bigint {
    let result = 0n;
    let shift = 0n;
    while (true) {
      const byte = this.readU8();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
  }

  readUlebNumber(): number {
    const v = this.readUlebBigInt();
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("长度过大");
    return Number(v);
  }

  readString(): string {
    const len = this.readUlebNumber();
    return this.take(len).toString("utf8");
  }

  readVarchar(maxLen: number): string {
    const len = this.readUlebNumber();
    if (len > maxLen) throw new Error("字符串过长");
    return this.take(len).toString("utf8");
  }

  readOption<T>(decode: (r: BinaryReader) => T): T | null {
    return this.readBool() ? decode(this) : null;
  }

  readResult<Ok, Err>(decodeOk: (r: BinaryReader) => Ok, decodeErr: (r: BinaryReader) => Err): { ok: true; value: Ok } | { ok: false; error: Err } {
    if (this.readBool()) return { ok: true, value: decodeOk(this) };
    return { ok: false, error: decodeErr(this) };
  }

  readArray<T>(decode: (r: BinaryReader) => T): T[] {
    const n = this.readUlebNumber();
    const out: T[] = [];
    out.length = n;
    for (let i = 0; i < n; i++) out[i] = decode(this);
    return out;
  }

  readMap<K, V>(decodeK: (r: BinaryReader) => K, decodeV: (r: BinaryReader) => V): Map<K, V> {
    const n = this.readUlebNumber();
    const out = new Map<K, V>();
    for (let i = 0; i < n; i++) {
      const k = decodeK(this);
      const v = decodeV(this);
      out.set(k, v);
    }
    return out;
  }

  readUuid(): string {
    const low = this.readU64();
    const high = this.readU64();
    return u64PairToUuid({ high, low });
  }

  readCompactPos(): { x: number; y: number } {
    const xBits = this.readU16();
    const yBits = this.readU16();
    return { x: f16BitsToF32(xBits), y: f16BitsToF32(yBits) };
  }
}

export class BinaryWriter {
  private chunks: Buffer[] = [];

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  writeBuffer(buf: Buffer): void {
    this.chunks.push(buf);
  }

  writeU8(v: number): void {
    const b = Buffer.allocUnsafe(1);
    b[0] = v & 0xff;
    this.chunks.push(b);
  }

  writeI8(v: number): void {
    this.writeU8(v & 0xff);
  }

  writeBool(v: boolean): void {
    this.writeU8(v ? 1 : 0);
  }

  writeU16(v: number): void {
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16LE(v & 0xffff, 0);
    this.chunks.push(b);
  }

  writeU32(v: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.chunks.push(b);
  }

  writeI32(v: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeInt32LE(v | 0, 0);
    this.chunks.push(b);
  }

  writeU64(v: bigint): void {
    const b = Buffer.allocUnsafe(8);
    b.writeBigUInt64LE(v, 0);
    this.chunks.push(b);
  }

  writeI64(v: bigint): void {
    const b = Buffer.allocUnsafe(8);
    b.writeBigInt64LE(v, 0);
    this.chunks.push(b);
  }

  writeF32(v: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeFloatLE(v, 0);
    this.chunks.push(b);
  }

  writeUleb(v: number | bigint): void {
    let x = typeof v === "bigint" ? v : BigInt(v);
    while (true) {
      let byte = Number(x & 0x7fn);
      x >>= 7n;
      if (x !== 0n) byte |= 0x80;
      this.writeU8(byte);
      if (x === 0n) return;
    }
  }

  writeString(s: string): void {
    const buf = Buffer.from(s, "utf8");
    this.writeUleb(buf.length);
    this.chunks.push(buf);
  }

  writeVarchar(maxLen: number, s: string): void {
    const buf = Buffer.from(s, "utf8");
    if (buf.length > maxLen) throw new Error("字符串过长");
    this.writeUleb(buf.length);
    this.chunks.push(buf);
  }

  writeOption<T>(value: T | null, encode: (w: BinaryWriter, v: T) => void): void {
    if (value === null) {
      this.writeBool(false);
      return;
    }
    this.writeBool(true);
    encode(this, value);
  }

  writeResult<Ok, Err>(value: { ok: true; value: Ok } | { ok: false; error: Err }, encodeOk: (w: BinaryWriter, v: Ok) => void, encodeErr: (w: BinaryWriter, v: Err) => void): void {
    if (value.ok) {
      this.writeBool(true);
      encodeOk(this, value.value);
    } else {
      this.writeBool(false);
      encodeErr(this, value.error);
    }
  }

  writeArray<T>(arr: readonly T[], encode: (w: BinaryWriter, v: T) => void): void {
    this.writeUleb(arr.length);
    for (const it of arr) encode(this, it);
  }

  writeMap<K, V>(map: Map<K, V>, encodeK: (w: BinaryWriter, v: K) => void, encodeV: (w: BinaryWriter, v: V) => void): void {
    this.writeUleb(map.size);
    for (const [k, v] of map) {
      encodeK(this, k);
      encodeV(this, v);
    }
  }

  writeUuid(uuid: string): void {
    const { high, low } = uuidToU64Pair(uuid);
    this.writeU64(low);
    this.writeU64(high);
  }

  writeCompactPos(pos: { x: number; y: number }): void {
    this.writeU16(f32ToF16Bits(pos.x));
    this.writeU16(f32ToF16Bits(pos.y));
  }
}

export function decodePacket<T>(data: Buffer, decode: (r: BinaryReader) => T): T {
  const r = new BinaryReader(data);
  const v = decode(r);
  return v;
}

export function encodePacket<T>(value: T, encode: (w: BinaryWriter, v: T) => void): Buffer {
  const w = new BinaryWriter();
  encode(w, value);
  return w.toBuffer();
}

export type StringResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type Unit = Record<never, never>;

export function ok<T>(value: T): StringResult<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): StringResult<T> {
  return { ok: false, error };
}

export function encodeStringResult<T>(w: BinaryWriter, value: StringResult<T>, encodeOk: (w: BinaryWriter, v: T) => void): void {
  w.writeResult(value, encodeOk, (ww, s) => ww.writeString(s));
}

export function decodeStringResult<T>(r: BinaryReader, decodeOk: (r: BinaryReader) => T): StringResult<T> {
  const res = r.readResult(decodeOk, (rr) => rr.readString());
  if (res.ok) return { ok: true, value: res.value };
  return { ok: false, error: res.error };
}
