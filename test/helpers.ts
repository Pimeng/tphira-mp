// 共享的测试工具函数
import { decodePacket } from "../src/common/binary.js";
import { decodeClientCommand, type ClientCommand } from "../src/common/commands.js";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let tempDirCounter = 0;

/** 为测试创建唯一的临时目录 */
export async function createTempDir(prefix = "phira-mp-test"): Promise<string> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
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
    await sleep(30);
  }
  throw new Error("等待超时");
}

export function parsePhiraRec(buf: Buffer): ClientCommand[] {
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
      const auth = String(init?.headers && (init.headers as any).Authorization ? (init.headers as any).Authorization : (init?.headers as any)?.get?.("Authorization") ?? "");
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
      return new Response("unauthorized", { status: 401 });
    }

    if (/\/chart\/\d+$/.test(url)) {
      const id = Number(url.split("/").at(-1));
      return new Response(JSON.stringify({ id, name: `Chart-${id}` }), { status: 200 });
    }

    if (/\/record\/\d+$/.test(url)) {
      const id = Number(url.split("/").at(-1));
      return new Response(
        JSON.stringify({
          id,
          player: 100,
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
    resetHitokotoCalls: () => { hitokotoCalls = 0; }
  };
}

/**
 * 自动设置和清理 Mock Fetch 的辅助函数
 * 在 beforeAll 中安装，在 afterAll 中恢复
 */
export function useMockFetch() {
  const { originalFetch, mockFetch, getHitokotoCalls, resetHitokotoCalls } = setupMockFetch();
  
  return {
    install: () => { globalThis.fetch = mockFetch; },
    restore: () => { globalThis.fetch = originalFetch; },
    getHitokotoCalls,
    resetHitokotoCalls
  };
}
