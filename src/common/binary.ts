/**
 * 二进制数据读写工具模块
 *
 * 提供 BinaryReader 和 BinaryWriter 类，用于在 Buffer 上进行类型安全的二进制读写操作。
 * 支持的数据类型包括：整数（8/16/32/64位）、浮点数（32位）、布尔值、字符串、
 * UUID、LEB128 变长编码、Option/Result/Array/Map 等复合类型。
 *
 * 所有数值均采用小端序（Little Endian）。
 */
import { f16BitsToF32, f32ToF16Bits } from "./half.js";
import { u64PairToUuid, uuidToU64Pair } from "./uuid.js";

/**
 * 确保缓冲区中有足够的数据可读
 * @param buffer - 数据缓冲区
 * @param offset - 当前读取偏移
 * @param need - 需要的字节数
 * @throws 当数据不足时抛出 "binary-unexpected-eof" 错误
 */
function ensureAvailable(buffer: Buffer, offset: number, need: number): void {
  if (offset + need > buffer.length) throw new Error("binary-unexpected-eof");
}

/**
 * 二进制数据读取器
 *
 * 提供从 Buffer 中顺序读取各种数据类型的方法。
 * 内部维护一个 offset 指针，每次读取后自动前进。
 */
export class BinaryReader {
  /** 底层数据缓冲区 */
  readonly buffer: Buffer;
  /** 当前读取偏移量 */
  offset = 0;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  /**
   * 读取指定长度的字节
   * @param n - 字节数
   * @returns 包含 n 个字节的 Buffer
   */
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

  /**
   * 在 number 域解码 LEB128 无符号整数，避免 BigInt 堆分配。
   *
   * 热路径：每个入站数组/字符串/Map 的长度前缀都经过这里。使用「累乘因子」而非
   * 位移，规避 32 位符号位陷阱；超过 MAX_SAFE_INTEGER 时抛出与原实现一致的错误。
   */
  readUlebNumber(): number {
    let result = 0;
    let mul = 1;
    while (true) {
      const byte = this.readU8();
      result += (byte & 0x7f) * mul;
      if ((byte & 0x80) === 0) break;
      mul *= 128;
    }
    if (result > Number.MAX_SAFE_INTEGER) throw new Error("binary-length-too-large");
    return result;
  }

  readString(): string {
    const len = this.readUlebNumber();
    return this.take(len).toString("utf8");
  }

  readVarchar(maxLen: number): string {
    const len = this.readUlebNumber();
    if (len > maxLen) throw new Error("binary-string-too-long");
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

/**
 * 二进制数据写入器
 *
 * 使用单 buffer 直接写入替代 chunks 数组，消除 per-field allocUnsafe 和最终 Buffer.concat。
 * 初始容量 512 字节，按需 2x 扩容。
 */
export class BinaryWriter {
  private buf: Buffer;
  private pos = 0;
  /** 头部预留字节数；body 从该偏移开始写入，供 toFrameBuffer 原地回填长度前缀 */
  private readonly reserveHead: number;

  /**
   * @param initialCapacity - 初始容量（含预留头部），按需 2x 扩容
   * @param reserveHead - 在 body 之前预留的字节数（用于 toFrameBuffer 写入变长长度前缀）
   */
  constructor(initialCapacity = 512, reserveHead = 0) {
    this.buf = Buffer.allocUnsafe(initialCapacity);
    this.reserveHead = reserveHead;
    this.pos = reserveHead;
  }

  /** 重置写入位置以复用缓冲区，避免重复分配 */
  reset(): void {
    this.pos = this.reserveHead;
  }

  private ensure(capacity: number): void {
    if (this.pos + capacity <= this.buf.length) return;
    let newSize = this.buf.length * 2;
    while (newSize < this.pos + capacity) newSize *= 2;
    const newBuf = Buffer.allocUnsafe(newSize);
    this.buf.copy(newBuf, 0, 0, this.pos);
    this.buf = newBuf;
  }

  toBuffer(): Buffer {
    return this.buf.subarray(this.reserveHead, this.pos);
  }

  /**
   * 把 body 长度的 LEB128(u32) 前缀原地回填进预留头部，返回「长度前缀 + body」的完整帧。
   *
   * 要求构造时 `reserveHead >= 5`（u32 LEB128 最多 5 字节）。相比「先编码 body 再
   * 拼接 header」省去一次 buffer 分配和一次 body 拷贝——返回的是底层 buffer 的 subarray。
   */
  toFrameBuffer(): Buffer {
    const bodyLen = this.pos - this.reserveHead;
    // 计算 LEB128(u32) 前缀字节数：每 7 位一字节
    let prefixLen = 1;
    let v = bodyLen >>> 0;
    while (v >= 0x80) {
      v >>>= 7;
      prefixLen++;
    }
    if (prefixLen > this.reserveHead) {
      throw new Error("frame-reserve-head-too-small");
    }
    // 从预留区末尾往前对齐写入前缀，使其紧邻 body
    const start = this.reserveHead - prefixLen;
    let x = bodyLen >>> 0;
    let i = start;
    while (x >= 0x80) {
      this.buf[i++] = (x & 0x7f) | 0x80;
      x >>>= 7;
    }
    this.buf[i] = x;
    return this.buf.subarray(start, this.pos);
  }

  writeBuffer(buf: Buffer): void {
    this.ensure(buf.length);
    buf.copy(this.buf, this.pos);
    this.pos += buf.length;
  }

  writeU8(v: number): void {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
  }

  writeI8(v: number): void {
    this.writeU8(v & 0xff);
  }

  writeBool(v: boolean): void {
    this.writeU8(v ? 1 : 0);
  }

  writeU16(v: number): void {
    this.ensure(2);
    this.buf.writeUInt16LE(v & 0xffff, this.pos);
    this.pos += 2;
  }

  writeU32(v: number): void {
    this.ensure(4);
    this.buf.writeUInt32LE(v >>> 0, this.pos);
    this.pos += 4;
  }

  writeI32(v: number): void {
    this.ensure(4);
    this.buf.writeInt32LE(v | 0, this.pos);
    this.pos += 4;
  }

  writeU64(v: bigint): void {
    this.ensure(8);
    this.buf.writeBigUInt64LE(v, this.pos);
    this.pos += 8;
  }

  writeI64(v: bigint): void {
    this.ensure(8);
    this.buf.writeBigInt64LE(v, this.pos);
    this.pos += 8;
  }

  writeF32(v: number): void {
    this.ensure(4);
    this.buf.writeFloatLE(v, this.pos);
    this.pos += 4;
  }

  /**
   * 写入 LEB128 变长无符号整数
   *
   * 每字节使用 7 位存储数据，最高位为 continuation flag。
   * 适用于编码长度等通常较小的数值。
   */
  writeUleb(v: number | bigint): void {
    // number 快路径：避免 BigInt 堆分配（热路径：数组/字符串长度前缀、触摸点数组长度）
    if (typeof v === "number" && v >= 0 && v <= 0xffffffff) {
      this.ensure(5);
      const buf = this.buf;
      let x = v >>> 0;
      let p = this.pos;
      while (x >= 0x80) {
        buf[p++] = (x & 0x7f) | 0x80;
        x >>>= 7;
      }
      buf[p++] = x;
      this.pos = p;
      return;
    }
    // 慢路径：bigint 或超 32 位的 number
    let x = typeof v === "bigint" ? v : BigInt(v);
    while (true) {
      let byte = Number(x & 0x7fn);
      x >>= 7n;
      if (x !== 0n) byte |= 0x80;
      this.writeU8(byte);
      if (x === 0n) return;
    }
  }

  /** 写入 UTF-8 字符串（先写 LEB128 长度，再写内容） */
  writeString(s: string): void {
    // 直接写入内部 buffer，省去中间 Buffer.from 的分配与拷贝
    const n = Buffer.byteLength(s, "utf8");
    this.writeUleb(n);
    this.ensure(n);
    this.buf.write(s, this.pos, "utf8");
    this.pos += n;
  }

  /**
   * 写入带最大长度限制的字符串
   * @param maxLen - 最大允许字节数
   * @throws 当字符串超过 maxLen 时抛出 "binary-string-too-long"
   */
  writeVarchar(maxLen: number, s: string): void {
    const n = Buffer.byteLength(s, "utf8");
    if (n > maxLen) throw new Error("binary-string-too-long");
    this.writeUleb(n);
    this.ensure(n);
    this.buf.write(s, this.pos, "utf8");
    this.pos += n;
  }

  /** 写入 Option<T>（null 编码为 false，非 null 编码为 true + 值） */
  writeOption<T>(value: T | null, encode: (w: BinaryWriter, v: T) => void): void {
    if (value === null) {
      this.writeBool(false);
      return;
    }
    this.writeBool(true);
    encode(this, value);
  }

  /** 写入 Result<Ok, Err>（ok 编码为 true + value，err 编码为 false + error） */
  writeResult<Ok, Err>(value: { ok: true; value: Ok } | { ok: false; error: Err }, encodeOk: (w: BinaryWriter, v: Ok) => void, encodeErr: (w: BinaryWriter, v: Err) => void): void {
    if (value.ok) {
      this.writeBool(true);
      encodeOk(this, value.value);
    } else {
      this.writeBool(false);
      encodeErr(this, value.error);
    }
  }

  /** 写入数组（先写 LEB128 长度，再逐个编码元素） */
  writeArray<T>(arr: readonly T[], encode: (w: BinaryWriter, v: T) => void): void {
    this.writeUleb(arr.length);
    for (const it of arr) encode(this, it);
  }

  /** 写入 Map（先写 LEB128 大小，再逐个编码键值对） */
  writeMap<K, V>(map: Map<K, V>, encodeK: (w: BinaryWriter, v: K) => void, encodeV: (w: BinaryWriter, v: V) => void): void {
    this.writeUleb(map.size);
    for (const [k, v] of map) {
      encodeK(this, k);
      encodeV(this, v);
    }
  }

  /** 写入 UUID（编码为两个 64 位整数：low, high） */
  writeUuid(uuid: string): void {
    const { high, low } = uuidToU64Pair(uuid);
    this.writeU64(low);
    this.writeU64(high);
  }

  /** 写入压缩位置（将 32 位浮点数压缩为 16 位半精度存储） */
  writeCompactPos(pos: { x: number; y: number }): void {
    this.writeU16(f32ToF16Bits(pos.x));
    this.writeU16(f32ToF16Bits(pos.y));
  }
}

/**
 * 解码数据包
 * @param data - 原始二进制数据
 * @param decode - 解码函数
 * @returns 解码后的值
 */
export function decodePacket<T>(data: Buffer, decode: (r: BinaryReader) => T): T {
  const r = new BinaryReader(data);
  const v = decode(r);
  return v;
}

/**
 * 编码数据包
 * @param value - 要编码的值
 * @param encode - 编码函数
 * @returns 编码后的二进制数据
 */
export function encodePacket<T>(value: T, encode: (w: BinaryWriter, v: T) => void): Buffer {
  const w = new BinaryWriter();
  encode(w, value);
  return w.toBuffer();
}

/** 字符串结果类型（Rust 风格的 Result，但错误类型固定为 string） */
export type StringResult<T> = { ok: true; value: T } | { ok: false; error: string };
/** 空类型（相当于 Rust 的 ()） */
export type Unit = Record<never, never>;

/** 创建成功的 StringResult */
export function ok<T>(value: T): StringResult<T> {
  return { ok: true, value };
}

/** 创建失败的 StringResult */
export function err<T = never>(error: string): StringResult<T> {
  return { ok: false, error };
}

/** 编码 StringResult（错误类型固定为 string） */
export function encodeStringResult<T>(w: BinaryWriter, value: StringResult<T>, encodeOk: (w: BinaryWriter, v: T) => void): void {
  w.writeResult(value, encodeOk, (ww, s) => ww.writeString(s));
}

/** 解码 StringResult（错误类型固定为 string） */
export function decodeStringResult<T>(r: BinaryReader, decodeOk: (r: BinaryReader) => T): StringResult<T> {
  const res = r.readResult(decodeOk, (rr) => rr.readString());
  if (res.ok) return { ok: true, value: res.value };
  return { ok: false, error: res.error };
}
