export function encodeLengthPrefixU32(len: number): Buffer {
  if (!Number.isInteger(len) || len < 0) {
    throw new Error("长度不合法");
  }
  const out = Buffer.allocUnsafe(5);
  let x = len >>> 0;
  let n = 0;
  while (true) {
    let b = x & 0x7f;
    x >>>= 7;
    if (x !== 0) b |= 0x80;
    out[n++] = b;
    if (x === 0) break;
  }
  return out.subarray(0, n);
}

export type DecodeFrameResult =
  | { type: "need_more" }
  | { type: "frame"; payload: Buffer; remaining: Buffer }
  | { type: "error"; error: Error };

export function tryDecodeFrame(buffer: Buffer, maxPayloadBytes = 2 * 1024 * 1024): DecodeFrameResult {
  let len = 0;
  let pos = 0;
  let offset = 0;

  while (true) {
    if (offset >= buffer.length) return { type: "need_more" };
    const byte = buffer[offset++];
    len |= (byte & 0x7f) << pos;
    pos += 7;
    if ((byte & 0x80) === 0) break;
    if (pos > 32) return { type: "error", error: new Error("长度前缀不合法") };
  }

  if (len > maxPayloadBytes) return { type: "error", error: new Error("数据包过大") };
  if (buffer.length - offset < len) return { type: "need_more" };

  const payload = buffer.subarray(offset, offset + len);
  const remaining = buffer.subarray(offset + len);
  return { type: "frame", payload, remaining };
}

