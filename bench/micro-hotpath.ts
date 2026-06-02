/**
 * 热路径微基准：对比本次优化前后的纯函数性能。
 *
 * 直接内联「优化前」实现（Math.log2/Math.pow 版 half 转换、concat 版帧拼接），
 * 与「优化后」实现（原生 Float16Array、frameWithLengthPrefix / toFrameBuffer）
 * 在同一进程内对比每秒操作数，给出与端到端压测无关的干净信号。
 *
 *   npx tsx bench/micro-hotpath.ts
 */
import { f16BitsToF32, f32ToF16Bits } from "../src/common/half.js";
import { encodeLengthPrefixU32, frameWithLengthPrefix } from "../src/common/framing.js";
import { BinaryReader, BinaryWriter } from "../src/common/binary.js";

// ===== 优化前的参考实现（迁移前的 half.ts） =====
function oldF16BitsToF32(bits: number): number {
  const sign = (bits & 0x8000) !== 0 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const frac = bits & 0x03ff;
  if (exp === 0) {
    if (frac === 0) return sign * 0;
    return sign * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 0x1f) {
    if (frac === 0) return sign * Infinity;
    return NaN;
  }
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}
function oldF32ToF16Bits(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Infinity) return 0x7c00;
  if (value === -Infinity) return 0xfc00;
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const abs = Math.abs(value);
  if (abs === 0) return sign;
  const exp = Math.floor(Math.log2(abs));
  const frac = abs / Math.pow(2, exp) - 1;
  const halfExp = exp + 15;
  if (halfExp >= 0x1f) return sign | 0x7c00;
  if (halfExp <= 0) {
    const sub = Math.round((abs / Math.pow(2, -14)) * 1024);
    if (sub <= 0) return sign;
    return sign | (sub & 0x03ff);
  }
  const halfFrac = Math.round(frac * 1024);
  if (halfFrac === 1024) {
    const nextExp = halfExp + 1;
    if (nextExp >= 0x1f) return sign | 0x7c00;
    return sign | (nextExp << 10);
  }
  return sign | (halfExp << 10) | (halfFrac & 0x03ff);
}

// ===== 计时工具 =====
function bench(name: string, iters: number, fn: () => void): number {
  // 预热
  for (let i = 0; i < Math.min(iters, 100000); i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0);
  const opsPerSec = (iters / ns) * 1e9;
  console.log(`  ${name.padEnd(34)} ${(opsPerSec / 1e6).toFixed(1).padStart(8)} M ops/s   (${(ns / iters).toFixed(2)} ns/op)`);
  return opsPerSec;
}

function pair(label: string, oldOps: number, newOps: number): void {
  const speedup = newOps / oldOps;
  console.log(`  → ${label}: ${speedup.toFixed(2)}x  (${speedup >= 1 ? "+" : ""}${((speedup - 1) * 100).toFixed(0)}%)\n`);
}

const ITERS = 20_000_000;

// 触摸坐标典型样本（[-1, 1) 附近）
const samples = new Float64Array(4096);
for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() - 0.5) * 2;
const bitsSamples = new Uint16Array(4096);
for (let i = 0; i < bitsSamples.length; i++) bitsSamples[i] = (Math.random() * 0x10000) & 0xffff;

console.log("\n========== 热路径微基准（优化前 vs 优化后） ==========\n");

console.log("[1] f32 → f16 编码（每个触摸坐标都会调用）");
let si = 0;
const oldEnc = bench("old (Math.log2/pow/round)", ITERS, () => { oldF32ToF16Bits(samples[(si++) & 4095]!); });
si = 0;
const newEnc = bench("new (Float16Array)", ITERS, () => { f32ToF16Bits(samples[(si++) & 4095]!); });
pair("encode 加速", oldEnc, newEnc);

console.log("[2] f16 → f32 解码（每个入站触摸坐标都会调用）");
let di = 0;
const oldDec = bench("old (Math.pow)", ITERS, () => { oldF16BitsToF32(bitsSamples[(di++) & 4095]!); });
di = 0;
const newDec = bench("new (Float16Array)", ITERS, () => { f16BitsToF32(bitsSamples[(di++) & 4095]!); });
pair("decode 加速", oldDec, newDec);

console.log("[3] 帧拼接（每条广播命令都会调用）");
const body = Buffer.alloc(48);
for (let i = 0; i < body.length; i++) body[i] = (i * 13) & 0xff;
const FRAME_ITERS = 10_000_000;
const oldFrame = bench("old (concat[header, body])", FRAME_ITERS, () => {
  const header = encodeLengthPrefixU32(body.length);
  Buffer.concat([header, body]);
});
const newFrame = bench("new (frameWithLengthPrefix)", FRAME_ITERS, () => {
  frameWithLengthPrefix(body);
});
pair("帧拼接加速", oldFrame, newFrame);

console.log("[4] 命令编码 + 加帧（prepareServerCommand 模式：写 body 后加长度前缀）");
const oldPrep = bench("old (writer→concat)", FRAME_ITERS, () => {
  const w = new BinaryWriter();
  w.writeU8(8);
  w.writeI32(12345);
  w.writeF32(0.5);
  const b = w.toBuffer();
  const header = encodeLengthPrefixU32(b.length);
  Buffer.concat([header, b]);
});
const newPrep = bench("new (reserveHead→toFrameBuffer)", FRAME_ITERS, () => {
  const w = new BinaryWriter(512, 5);
  w.writeU8(8);
  w.writeI32(12345);
  w.writeF32(0.5);
  w.toFrameBuffer();
});
pair("命令加帧加速", oldPrep, newPrep);

// ===== [5] writeUleb：number 快路径 vs BigInt =====
console.log("[5] writeUleb 编码（每个数组/字符串长度前缀、每个触摸点数组长度都会调用）");
const ulebSamples = new Int32Array(4096);
for (let i = 0; i < ulebSamples.length; i++) ulebSamples[i] = (Math.random() * 100000) | 0;
const ulebScratch = Buffer.allocUnsafe(8);
function oldWriteUleb(buf: Buffer, v: number): void {
  let x = BigInt(v);
  let p = 0;
  while (true) {
    let byte = Number(x & 0x7fn);
    x >>= 7n;
    if (x !== 0n) byte |= 0x80;
    buf[p++] = byte;
    if (x === 0n) return;
  }
}
const w5 = new BinaryWriter(64, 0);
let ui = 0;
const oldUleb = bench("old (BigInt)", ITERS, () => { oldWriteUleb(ulebScratch, ulebSamples[(ui++) & 4095]!); });
ui = 0;
const newUleb = bench("new (number fast path)", ITERS, () => { w5.reset(); w5.writeUleb(ulebSamples[(ui++) & 4095]!); });
pair("writeUleb 加速", oldUleb, newUleb);

// ===== [6] readUleb：number 域 vs BigInt =====
console.log("[6] readUleb 解码（每个入站数组/字符串/Map 的长度前缀都会调用）");
const ulebBytes = Buffer.allocUnsafe(ulebSamples.length * 5);
const ulebOffsets = new Int32Array(ulebSamples.length + 1);
{
  let p = 0;
  for (let i = 0; i < ulebSamples.length; i++) {
    ulebOffsets[i] = p;
    let x = ulebSamples[i]! >>> 0;
    while (x >= 0x80) { ulebBytes[p++] = (x & 0x7f) | 0x80; x >>>= 7; }
    ulebBytes[p++] = x;
  }
  ulebOffsets[ulebSamples.length] = p;
}
function oldReadUleb(buf: Buffer, off: number): number {
  let result = 0n;
  let shift = 0n;
  while (true) {
    const byte = buf[off++]!;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return Number(result);
    shift += 7n;
  }
}
let ri = 0;
const oldRead = bench("old (BigInt)", ITERS, () => { oldReadUleb(ulebBytes, ulebOffsets[(ri++) & 4095]!); });
ri = 0;
const rdr = new BinaryReader(ulebBytes);
const newRead = bench("new (number)", ITERS, () => { rdr.offset = ulebOffsets[(ri++) & 4095]!; rdr.readUlebNumber(); });
pair("readUleb 加速", oldRead, newRead);

// ===== [7] writeString：直写 vs Buffer.from+copy =====
console.log("[7] writeString 编码（用户名/聊天/谱面名等字符串字段）");
const strSamples = ["Alice", "玩家小明", "PhiraMaster_2024", "测试谱面 - Hard Lv.15", "x"];
function oldWriteString(w: BinaryWriter, s: string): void {
  const buf = Buffer.from(s, "utf8");
  w.writeUleb(buf.length);
  w.writeBuffer(buf);
}
const w7 = new BinaryWriter(128, 0);
let szi = 0;
const oldStr = bench("old (Buffer.from+copy)", FRAME_ITERS, () => { w7.reset(); oldWriteString(w7, strSamples[(szi++) % strSamples.length]!); });
szi = 0;
const newStr = bench("new (buf.write 直写)", FRAME_ITERS, () => { w7.reset(); w7.writeString(strSamples[(szi++) % strSamples.length]!); });
pair("writeString 加速", oldStr, newStr);

// ===== [8] 观战广播扇出：每接收者 async Promise vs 同步入队 =====
// 一条 Touches/Judges 命令分发给 K 个观战者。旧路径每个接收者
// `void trySendPrepared(p).catch()`：分配 Promise + then/catch 闭包；
// 新路径 trySendPreparedFast 同步 void 入队，零 Promise 分配。
// 这里隔离出每接收者的「分发开销」（帧仍只编码一次）。
console.log("[8] 观战广播扇出分发开销（一条命令分发给 K 个观战者）");
const FANOUT_K = 50;
const fanFrame = Buffer.alloc(24);
const fanBatch: Buffer[] = [];
// 旧路径：async trySendPrepared + .catch（每接收者一个 Promise + catch 闭包）
async function oldTrySend(frame: Buffer): Promise<void> { fanBatch.push(frame); }
// 新路径：同步 void 入队（零 Promise）
function newTrySendFast(frame: Buffer): void { fanBatch.push(frame); }
// 控制未决 microtask 规模：每轮分发后清空 batch；迭代数取较小值
const FAN_ITERS = 20_000;
const oldFan = bench(`old (async Promise/接收者 ×${FANOUT_K})`, FAN_ITERS, () => {
  fanBatch.length = 0;
  for (let k = 0; k < FANOUT_K; k++) void oldTrySend(fanFrame).catch(() => {});
});
const newFan = bench(`new (同步入队/接收者 ×${FANOUT_K})`, FAN_ITERS, () => {
  fanBatch.length = 0;
  for (let k = 0; k < FANOUT_K; k++) newTrySendFast(fanFrame);
});
pair("扇出分发加速", oldFan, newFan);

console.log("=====================================================\n");
