import { describe, it, expect } from "vitest";
import { f16BitsToF32, f32ToF16Bits } from "../../src/common/half.js";

describe("f16BitsToF32", () => {
  it("0 -> 0", () => {
    expect(f16BitsToF32(0x0000)).toBe(0);
  });

  it("-0 -> -0", () => {
    expect(Object.is(f16BitsToF32(0x8000), -0)).toBe(true);
  });

  it("1 -> 1", () => {
    expect(f16BitsToF32(0x3c00)).toBe(1);
  });

  it("-1 -> -1", () => {
    expect(f16BitsToF32(0xbc00)).toBe(-1);
  });

  it("2 -> 2", () => {
    expect(f16BitsToF32(0x4000)).toBe(2);
  });

  it("Infinity", () => {
    expect(f16BitsToF32(0x7c00)).toBe(Infinity);
  });

  it("-Infinity", () => {
    expect(f16BitsToF32(0xfc00)).toBe(-Infinity);
  });

  it("NaN", () => {
    expect(Number.isNaN(f16BitsToF32(0x7e00))).toBe(true);
    expect(Number.isNaN(f16BitsToF32(0x7e01))).toBe(true);
  });

  it("次正规数", () => {
    // 最小的正次正规数: exp=0, frac=1 -> 2^-14 * (1/1024)
    const expected = Math.pow(2, -14) * (1 / 1024);
    expect(f16BitsToF32(0x0001)).toBe(expected);
  });

  it("次正规负数", () => {
    const expected = -Math.pow(2, -14) * (1 / 1024);
    expect(f16BitsToF32(0x8001)).toBe(expected);
  });

  it("常规数 0.5", () => {
    // 0.5 = 2^-1, exp = -1 + 15 = 14 = 0x0e, frac = 0
    expect(f16BitsToF32(0x3800)).toBe(0.5);
  });
});

describe("f32ToF16Bits", () => {
  it("0 -> 0", () => {
    expect(f32ToF16Bits(0)).toBe(0x0000);
  });

  it("-0 -> -0", () => {
    expect(f32ToF16Bits(-0)).toBe(0x8000);
  });

  it("1 -> 1", () => {
    expect(f32ToF16Bits(1)).toBe(0x3c00);
  });

  it("-1 -> -1", () => {
    expect(f32ToF16Bits(-1)).toBe(0xbc00);
  });

  it("2 -> 2", () => {
    expect(f32ToF16Bits(2)).toBe(0x4000);
  });

  it("Infinity", () => {
    expect(f32ToF16Bits(Infinity)).toBe(0x7c00);
  });

  it("-Infinity", () => {
    expect(f32ToF16Bits(-Infinity)).toBe(0xfc00);
  });

  it("NaN", () => {
    expect(f32ToF16Bits(NaN)).toBe(0x7e00);
  });

  it("溢出到 Infinity", () => {
    // float16 最大正规数约 65504, 65535 应溢出
    expect(f32ToF16Bits(70000)).toBe(0x7c00);
  });

  it("负溢出到 -Infinity", () => {
    expect(f32ToF16Bits(-70000)).toBe(0xfc00);
  });

  it("往返一致性", () => {
    const testValues = [0, 1, -1, 0.5, -0.5, 2, 100, -100, 0.1, -0.1];
    for (const v of testValues) {
      const bits = f32ToF16Bits(v);
      const back = f16BitsToF32(bits);
      // float16 精度有限，允许一定误差
      expect(Math.abs(back - v) / Math.max(Math.abs(v), 1)).toBeLessThan(0.01);
    }
  });
});

/**
 * 参考实现：迁移到原生 Float16Array 之前的纯数学解码逻辑。
 * 对所有正规/次正规/Inf 值都是精确的 IEEE-754 结果，用于逐位回归比对，
 * 确保 wire 行为不变。
 */
function refDecode(bits: number): number {
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

function isNanBits(bits: number): boolean {
  return (bits & 0x7c00) === 0x7c00 && (bits & 0x03ff) !== 0;
}

describe("half 穷举回归（全部 65536 个位模式）", () => {
  it("f16BitsToF32 与迁移前参考实现逐位等价", () => {
    for (let bits = 0; bits <= 0xffff; bits++) {
      const got = f16BitsToF32(bits);
      if (isNanBits(bits)) {
        expect(Number.isNaN(got)).toBe(true);
      } else {
        // 精确相等，包含 ±0（用 Object.is 区分 -0）
        expect(Object.is(got, refDecode(bits))).toBe(true);
      }
    }
  });

  it("decode→encode 往返稳定（非 NaN 位模式还原自身）", () => {
    for (let bits = 0; bits <= 0xffff; bits++) {
      if (isNanBits(bits)) continue;
      const roundtrip = f32ToF16Bits(f16BitsToF32(bits));
      expect(roundtrip).toBe(bits);
    }
  });

  it("encode 对随机 f32 样本结果落在有效 half 范围且解码可还原", () => {
    for (let i = 0; i < 100000; i++) {
      const v = (Math.random() - 0.5) * 4; // 触摸坐标典型范围
      const bits = f32ToF16Bits(v);
      expect(bits).toBeGreaterThanOrEqual(0);
      expect(bits).toBeLessThanOrEqual(0xffff);
      // 编码再解码应得到同一个 half 值（量化后稳定）
      expect(f32ToF16Bits(f16BitsToF32(bits))).toBe(bits);
    }
  });
});
