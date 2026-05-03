import { deflateSync, inflateSync, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { BinaryReader, BinaryWriter } from "../../common/binary.js";
import type { JudgeEvent } from "../../common/commands.js";

export const PHIRA_RECORD_MAGIC = Buffer.from("PHIRAREC", "ascii");
export const PHIRA_RECORD_VERSION = 1;
export const PHIRA_RECORD_HEADER_SIZE = 13;

export const COMPRESSION_NONE = 0x00;
export const COMPRESSION_ZSTD = 0x01;
export const COMPRESSION_DEFLATE = 0x02;

export function isPhiraRecordV2(buf: Buffer): boolean {
  return buf.length >= PHIRA_RECORD_HEADER_SIZE && buf.subarray(0, 8).equals(PHIRA_RECORD_MAGIC);
}

export function decodePhiraRecordPayload(buf: Buffer): Buffer {
  const compression = buf.readUInt8(12);
  const payload = buf.subarray(PHIRA_RECORD_HEADER_SIZE);
  switch (compression) {
    case COMPRESSION_NONE:
      return payload;
    case COMPRESSION_DEFLATE:
      return inflateSync(payload);
    case COMPRESSION_ZSTD:
      return zstdDecompressSync(payload);
    default:
      throw new Error(`replay-compression-unsupported:${compression}`);
  }
}

export function encodePhiraRecordPayload(content: Buffer, compression: number): Buffer {
  switch (compression) {
    case COMPRESSION_NONE:
      return content;
    case COMPRESSION_DEFLATE:
      return deflateSync(content);
    case COMPRESSION_ZSTD:
      return zstdCompressSync(content);
    default:
      throw new Error(`replay-compression-unsupported:${compression}`);
  }
}

export function buildPhiraRecordHeader(compression: number): Buffer {
  const header = Buffer.allocUnsafe(PHIRA_RECORD_HEADER_SIZE);
  PHIRA_RECORD_MAGIC.copy(header, 0);
  header.writeInt32LE(PHIRA_RECORD_VERSION, 8);
  header.writeUInt8(compression, 12);
  return header;
}

/**
 * PHIRA record 中的 JudgeEvent 用 I32 编码 line_id / note_id；
 * 与通信协议（U32）有别——为兼容已存在的回放文件，请勿改用 commands.ts 中的版本。
 */
export function encodeReplayJudgeEvent(w: BinaryWriter, v: JudgeEvent): void {
  w.writeF32(v.time);
  w.writeI32(v.line_id);
  w.writeI32(v.note_id);
  w.writeU8(v.judgement);
}

export function decodeReplayJudgeEvent(r: BinaryReader): JudgeEvent {
  const time = r.readF32();
  const line_id = r.readI32();
  const note_id = r.readI32();
  const judgement = r.readU8() as JudgeEvent["judgement"];
  return { time, line_id, note_id, judgement };
}
