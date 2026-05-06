import { describe, it, expect } from "vitest";
import {
  PHIRA_RECORD_MAGIC,
  PHIRA_RECORD_VERSION,
  PHIRA_RECORD_HEADER_SIZE,
  COMPRESSION_NONE,
  COMPRESSION_ZSTD,
  COMPRESSION_DEFLATE,
  isPhiraRecordV2,
  decodePhiraRecordPayload,
  encodePhiraRecordPayload,
  buildPhiraRecordHeader,
  encodeReplayJudgeEvent,
  decodeReplayJudgeEvent
} from "../../src/server/replay/replayFormat.js";
import { BinaryReader, BinaryWriter } from "../../src/common/binary.js";
import type { JudgeEvent } from "../../src/common/commands.js";

describe("isPhiraRecordV2", () => {
  it("有效头", () => {
    const buf = Buffer.concat([PHIRA_RECORD_MAGIC, Buffer.alloc(5)]);
    expect(isPhiraRecordV2(buf)).toBe(true);
  });

  it("长度不足", () => {
    expect(isPhiraRecordV2(Buffer.alloc(12))).toBe(false);
  });

  it("错误魔数", () => {
    const buf = Buffer.from("INVALID!!!");
    expect(isPhiraRecordV2(buf)).toBe(false);
  });
});

describe("buildPhiraRecordHeader", () => {
  it("构建头", () => {
    const header = buildPhiraRecordHeader(COMPRESSION_NONE);
    expect(header.length).toBe(PHIRA_RECORD_HEADER_SIZE);
    expect(header.subarray(0, 8).toString("ascii")).toBe("PHIRAREC");
    expect(header.readInt32LE(8)).toBe(PHIRA_RECORD_VERSION);
    expect(header.readUInt8(12)).toBe(COMPRESSION_NONE);
  });
});

describe("decodePhiraRecordPayload / encodePhiraRecordPayload", () => {
  it("无压缩往返", () => {
    const payload = Buffer.from("hello world");
    const encoded = encodePhiraRecordPayload(payload, COMPRESSION_NONE);
    expect(encoded).toEqual(payload);

    const header = buildPhiraRecordHeader(COMPRESSION_NONE);
    const buf = Buffer.concat([header, encoded]);
    const decoded = decodePhiraRecordPayload(buf);
    expect(decoded.toString()).toBe("hello world");
  });

  it("DEFLATE 压缩往返", () => {
    const payload = Buffer.from("hello world");
    const encoded = encodePhiraRecordPayload(payload, COMPRESSION_DEFLATE);
    expect(encoded.length).toBeLessThan(payload.length + 10); // 应该压缩或相近

    const header = buildPhiraRecordHeader(COMPRESSION_DEFLATE);
    const buf = Buffer.concat([header, encoded]);
    const decoded = decodePhiraRecordPayload(buf);
    expect(decoded.toString()).toBe("hello world");
  });

  it("ZSTD 压缩往返", () => {
    const payload = Buffer.from("hello world hello world hello world");
    const encoded = encodePhiraRecordPayload(payload, COMPRESSION_ZSTD);

    const header = buildPhiraRecordHeader(COMPRESSION_ZSTD);
    const buf = Buffer.concat([header, encoded]);
    const decoded = decodePhiraRecordPayload(buf);
    expect(decoded.toString()).toBe("hello world hello world hello world");
  });

  it("不支持压缩方式应抛出", () => {
    const payload = Buffer.from("test");
    expect(() => encodePhiraRecordPayload(payload, 0xff)).toThrow("replay-compression-unsupported:255");

    const header = buildPhiraRecordHeader(0xff);
    const buf = Buffer.concat([header, payload]);
    expect(() => decodePhiraRecordPayload(buf)).toThrow("replay-compression-unsupported:255");
  });
});

describe("encodeReplayJudgeEvent / decodeReplayJudgeEvent", () => {
  it("往返", () => {
    const event: JudgeEvent = { time: 1.5, line_id: 10, note_id: -5, judgement: 2 };
    const w = new BinaryWriter();
    encodeReplayJudgeEvent(w, event);
    const r = new BinaryReader(w.toBuffer());
    const decoded = decodeReplayJudgeEvent(r);
    expect(decoded.time).toBeCloseTo(1.5, 3);
    expect(decoded.line_id).toBe(10);
    expect(decoded.note_id).toBe(-5);
    expect(decoded.judgement).toBe(2);
  });

  it("边界值", () => {
    const event: JudgeEvent = { time: 0, line_id: 0, note_id: 0, judgement: 0 };
    const w = new BinaryWriter();
    encodeReplayJudgeEvent(w, event);
    const r = new BinaryReader(w.toBuffer());
    const decoded = decodeReplayJudgeEvent(r);
    expect(decoded.time).toBe(0);
    expect(decoded.line_id).toBe(0);
    expect(decoded.note_id).toBe(0);
    expect(decoded.judgement).toBe(0);
  });
});