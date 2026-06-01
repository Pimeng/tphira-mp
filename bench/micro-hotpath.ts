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
import { BinaryWriter } from "../src/common/binary.js";

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

console.log("=====================================================\n");
