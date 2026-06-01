/**
 * 半精度浮点（IEEE-754 binary16）与单精度浮点的互转。
 *
 * 直接复用运行时原生的 `Float16Array` 做硬件级转换，避免 `Math.log2` /
 * `Math.pow` 等超越函数开销——这两个函数在游戏数据管线里对每个触摸点的
 * x、y 坐标、在解码（入站）与编码（广播给观战者）两个方向上都会被调用，
 * 是高频热路径。
 *
 * 共享一个长度为 1 的 `Float16Array` 与其上的 `Uint16Array` 视图：写入浮点
 * 数后读出底层 16 位即得编码结果，反之亦然。转换遵循 IEEE-754 标准的
 * round-to-nearest-even，与原版 Phira（Rust `half` crate）一致；subnormal /
 * Inf / NaN 均由原生实现正确处理。
 */

/** 长度为 1 的转换暂存区，f16 与 u16 共享同一段内存。 */
const f16 = new Float16Array(1);
const u16 = new Uint16Array(f16.buffer);

/**
 * 将 16 位半精度位模式解码为单精度浮点数。
 * @param bits - 半精度的 16 位表示（仅低 16 位有效）
 */
export function f16BitsToF32(bits: number): number {
  u16[0] = bits & 0xffff;
  return f16[0]!;
}

/**
 * 将单精度浮点数编码为 16 位半精度位模式。
 * @param value - 待编码的浮点数
 * @returns 半精度的 16 位无符号表示
 */
export function f32ToF16Bits(value: number): number {
  f16[0] = value;
  return u16[0]!;
}
