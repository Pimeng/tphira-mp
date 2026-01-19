import { parse as uuidParse, stringify as uuidStringify, v4 as uuidV4 } from "uuid";

export type U64Pair = {
  high: bigint;
  low: bigint;
};

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bigIntToBytesBE(v: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let x = v;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

export function uuidToU64Pair(uuid: string): U64Pair {
  const bytes = uuidParse(uuid);
  const high = bytesToBigIntBE(bytes.subarray(0, 8));
  const low = bytesToBigIntBE(bytes.subarray(8, 16));
  return { high, low };
}

export function u64PairToUuid(pair: U64Pair): string {
  const highBytes = bigIntToBytesBE(pair.high, 8);
  const lowBytes = bigIntToBytesBE(pair.low, 8);
  const bytes = new Uint8Array(16);
  bytes.set(highBytes, 0);
  bytes.set(lowBytes, 8);
  return uuidStringify(bytes);
}

export function newUuid(): string {
  return uuidV4();
}

