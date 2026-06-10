// 共享的测试工具函数
import { BinaryReader, decodePacket } from "../src/common/binary.js";
import {
  decodeClientCommand,
  type ClientCommand,
  type CompactPos,
  type JudgeEvent,
  type TouchFrame
} from "../src/common/commands.js";
import { mkdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync, zstdDecompressSync } from "node:zlib";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let tempDirCounter = 0;

/** 为测试创建唯一的临时目录 */
export async function createTempDir(prefix = "phira-mp-test"): Promise<string> {
  const timestamp = Date.now();
  const random = randomBytes(4).toString("hex");
  const counter = tempDirCounter++;
  const dir = join(tmpdir(), `${prefix}-${timestamp}-${random}-${counter}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** 清理临时目录 */
export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function waitFor(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await sleep(20);
  }
  throw new Error("等待超时");
}

// 预定义的测试令牌常量
export const TOKENS = {
  alice: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  bob: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  carol: "cccccccccccccccccccccccccccccccc",
  dave: "dddddddddddddddddddddddddddddddd"
} as const;

export type ParsedPhiraRecordV2 = {
  recordId: number;
  timestamp: number;
  chartId: number;
  chartName: string;
  userId: number;
  userName: string;
  touchFrames: TouchFrame[];
  judgeEvents: JudgeEvent[];
  version: number;
  compression: number;
};

export function parsePhiraRec(buf: Buffer): ClientCommand[] {
  if (isPhiraRecordV2(buf)) {
    const record = parsePhiraRecordV2(buf);
    const out: ClientCommand[] = [];
    if (record.touchFrames.length > 0) out.push({ type: "Touches", frames: record.touchFrames });
    if (record.judgeEvents.length > 0) out.push({ type: "Judges", judges: record.judgeEvents });
    return out;
  }

  const out: ClientCommand[] = [];
  let offset = 14;
  while (offset + 4 <= buf.length) {
    const len = buf.readUInt32LE(offset);
    offset += 4;
    if (offset + len > buf.length) break;
    const payload = buf.subarray(offset, offset + len);
    offset += len;
    out.push(decodePacket(payload, decodeClientCommand));
  }
  return out;
}

export function parsePhiraRecordV2(buf: Buffer): ParsedPhiraRecordV2 {
  if (!isPhiraRecordV2(buf)) throw new Error("not-phira-record-v2");
  const version = buf.readInt32LE(8);
  const compression = buf.readUInt8(12);
  const r = new BinaryReader(decodePhiraRecordPayload(buf));
  const recordId = r.readI32();
  const timestamp = Number(r.readI64());
  const chartId = r.readI32();
  const chartName = r.readString();
  const userId = r.readI32();
  const userName = r.readString();
  const touchFrames = r.readArray(decodeTouchFrame);
  const judgeEvents = r.readArray(decodeJudgeEvent);
  return { recordId, timestamp, chartId, chartName, userId, userName, touchFrames, judgeEvents, version, compression };
}

function isPhiraRecordV2(buf: Buffer): boolean {
  return buf.length >= 13 && buf.subarray(0, 8).equals(Buffer.from("PHIRAREC", "ascii"));
}

function decodePhiraRecordPayload(buf: Buffer): Buffer {
  const compression = buf.readUInt8(12);
  const payload = buf.subarray(13);
  switch (compression) {
    case 0x00:
      return payload;
    case 0x01:
      return zstdDecompressSync(payload);
    case 0x02:
      return inflateSync(payload);
    default:
      throw new Error(`unsupported-phira-record-compression:${compression}`);
  }
}

function decodeTouchFrame(r: BinaryReader): TouchFrame {
  const time = r.readF32();
  const points = r.readArray((rr) => {
    const id = rr.readI8();
    const pos = decodeCompactPos(rr);
    return [id, pos] as [number, CompactPos];
  });
  return { time, points };
}

function decodeCompactPos(r: BinaryReader): CompactPos {
  return r.readCompactPos();
}

function decodeJudgeEvent(r: BinaryReader): JudgeEvent {
  const time = r.readF32();
  const line_id = r.readI32();
  const note_id = r.readI32();
  const judgement = r.readU8();
  return { time, line_id, note_id, judgement };
}

// Mock fetch 设置和自动清理
export function setupMockFetch() {
  const originalFetch = globalThis.fetch;
  let hitokotoCalls = 0;

  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.startsWith("https://v1.hitokoto.cn/")) {
      hitokotoCalls += 1;
      return new Response(
        JSON.stringify({
          hitokoto: "欲买桂花同载酒，荒泷天下第一斗。",
          from: "原神",
          from_who: "钟离&荒泷一斗"
        }),
        { status: 200 }
      );
    }

    if (url.endsWith("/me")) {
      const auth = String(
        init?.headers && (init.headers as any).Authorization
          ? (init.headers as any).Authorization
          : ((init?.headers as any)?.get?.("Authorization") ?? "")
      );
      const token = auth.replace(/^Bearer\s+/i, "");
      if (token === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
        return new Response(JSON.stringify({ id: 100, name: "Alice", language: "zh-CN" }), { status: 200 });
      }
      if (token === "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
        return new Response(JSON.stringify({ id: 200, name: "Bob", language: "zh-CN" }), { status: 200 });
      }
      if (token === "cccccccccccccccccccccccccccccccc") {
        return new Response(JSON.stringify({ id: 300, name: "Carol", language: "zh-CN" }), { status: 200 });
      }
      if (token === "dddddddddddddddddddddddddddddddd") {
        return new Response(JSON.stringify({ id: 400, name: "Dave", language: "zh-CN" }), { status: 200 });
      }
      return new Response("unauthorized", { status: 401 });
    }

    if (/\/chart\/\d+$/.test(url)) {
      const id = Number(url.split("/").at(-1));
      return new Response(JSON.stringify({ id, name: `Chart-${id}` }), { status: 200 });
    }

    if (/\/record\/\d+$/.test(url)) {
      const id = Number(url.split("/").at(-1));
      const auth = String(
        init?.headers && (init.headers as any).Authorization
          ? (init.headers as any).Authorization
          : ((init?.headers as any)?.get?.("Authorization") ?? "")
      );
      const token = auth.replace(/^Bearer\s+/i, "");
      const playerMap: Record<string, number> = {
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: 100,
        bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: 200,
        cccccccccccccccccccccccccccccccc: 300,
        dddddddddddddddddddddddddddddddd: 400
      };
      return new Response(
        JSON.stringify({
          id,
          player: id === 2 ? 200 : (playerMap[token] ?? 100),
          score: 999999,
          perfect: 1,
          good: 0,
          bad: 0,
          miss: 0,
          max_combo: 1,
          accuracy: 1.0,
          full_combo: true,
          std: 0,
          std_score: 0
        }),
        { status: 200 }
      );
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return {
    originalFetch,
    mockFetch,
    getHitokotoCalls: () => hitokotoCalls,
    resetHitokotoCalls: () => {
      hitokotoCalls = 0;
    }
  };
}
