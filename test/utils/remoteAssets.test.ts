import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRemoteText, ensureLocalesAvailable } from "../../src/server/utils/remoteAssets.js";

const baseDir = join(tmpdir(), "phira-mp-remote-assets-tests");
const created: string[] = [];

function makeTempDir(name: string): string {
  const dir = join(baseDir, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

function makeLocalesJson(langs: readonly string[]): string {
  return JSON.stringify(
    Object.fromEntries(langs.map((l) => [l, { [`key-${l}`]: `value-${l}` }]))
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fetchRemoteText", () => {
  test("2xx 返回正文", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("hello", { status: 200 })));
    expect(await fetchRemoteText("https://example.com/x")).toBe("hello");
  });

  test("非 2xx 返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await fetchRemoteText("https://example.com/x")).toBeNull();
  });

  test("空正文返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("   \n", { status: 200 })));
    expect(await fetchRemoteText("https://example.com/x")).toBeNull();
  });

  test("抛出/超时返回 null，不抛异常", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    expect(await fetchRemoteText("https://example.com/x", 50)).toBeNull();
  });
});

describe("ensureLocalesAvailable", () => {
  test("缺失时从 release 拉取 locales.json 并写入，返回 1", async () => {
    const dir = makeTempDir("missing");
    const bundle = makeLocalesJson(["en-US", "zh-CN"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/locales.json")) return new Response(bundle, { status: 200 });
        return new Response("nope", { status: 404 });
      })
    );

    const count = await ensureLocalesAvailable(dir);
    expect(count).toBe(1);
    const jsonPath = join(dir, "locales.json");
    expect(existsSync(jsonPath)).toBe(true);
    expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toEqual(JSON.parse(bundle));
  });

  test("已存在 locales.json 时不重复拉取", async () => {
    const dir = makeTempDir("present");
    writeFileSync(join(dir, "locales.json"), makeLocalesJson(["en-US"]));
    const fetchSpy = vi.fn(async () => new Response(makeLocalesJson(["en-US"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const count = await ensureLocalesAvailable(dir);
    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("优先 CNB 镜像：第一个候选成功就不再请求后续", async () => {
    const dir = makeTempDir("cnb-first");
    const fetchSpy = vi.fn(async (_input?: unknown) => new Response(makeLocalesJson(["en-US"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await ensureLocalesAvailable(dir);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain("cnb.cool");
  });

  test("CNB 失败时回退 GitHub release", async () => {
    const dir = makeTempDir("gh-fallback");
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("cnb.cool")) return new Response("blocked", { status: 500 });
      if (url.endsWith("/locales.json")) return new Response(makeLocalesJson(["en-US"]), { status: 200 });
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const count = await ensureLocalesAvailable(dir);
    expect(count).toBe(1);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("github.com"))).toBe(true);
  });

  test("全部候选失败时返回 0，不抛异常（交由嵌入兜底）", async () => {
    const dir = makeTempDir("all-fail");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));

    const count = await ensureLocalesAvailable(dir);
    expect(count).toBe(0);
  });

  test("无效 JSON 时不写入，返回 0", async () => {
    const dir = makeTempDir("bad-json");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        if (String(input).endsWith("/locales.json")) return new Response("not json", { status: 200 });
        return new Response("nope", { status: 404 });
      })
    );

    const count = await ensureLocalesAvailable(dir);
    expect(count).toBe(0);
    expect(existsSync(join(dir, "locales.json"))).toBe(false);
  });
});
