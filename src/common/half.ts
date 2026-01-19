export function f16BitsToF32(bits: number): number {
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

export function f32ToF16Bits(value: number): number {
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
    const sub = Math.round(abs / Math.pow(2, -14) * 1024);
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

