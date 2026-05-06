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