import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../../src/client/client.js";
import { startServer } from "../../src/server/core/server.js";
import { recordCache } from "../../src/server/utils/cache.js";
import { cleanupTempDir, createTempDir, waitFor } from "../helpers.js";

/**
 * 反作弊：Played 上报的成绩必须对应房间当前谱面。
 *
 * 这里用专属 mock 让 /record/:id 返回 chart 字段（共享 helpers 的 mock 不带 chart，
 * 走 fail-open 分支，不在此覆盖范围内）：
 * - 默认 record.chart === record id
 * - record id 700 特例返回 chart 888，模拟「用别的（更简单的）谱面成绩冒充」
 */
function makeChartAwareMock() {
  const originalFetch = globalThis.fetch;
  const mockFetch = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.endsWith("/me")) {
      // 仅需房主一人，token "a"*32 -> 用户 100
      return new Response(JSON.stringify({ id: 100, name: "Alice", language: "zh-CN" }), { status: 200 });
    }
    if (/\/chart\/\d+$/.test(url)) {
      const id = Number(url.split("/").at(-1));
      return new Response(JSON.stringify({ id, name: `Chart-${id}` }), { status: 200 });
    }
    if (/\/record\/\d+$/.test(url)) {
      const id = Number(url.split("/").at(-1));
      const chart = id === 700 ? 888 : id; // 700 模拟用别的谱面成绩冒充
      return new Response(
        JSON.stringify({
          id,
          player: 100,
          chart,
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
    // 一言等其它请求：返回 404，欢迎流程会自行兜底
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return { originalFetch, mockFetch };
}

describe("Played 成绩谱面匹配校验（反作弊）", () => {
  const { originalFetch, mockFetch } = makeChartAwareMock();

  beforeAll(async () => {
    globalThis.fetch = mockFetch;
    // 清空记录缓存，确保 mock 的 chart 字段生效（避免历史缓存命中）
    await recordCache.clear();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("拒绝与房间当前谱面不匹配的成绩", async () => {
    const tempDir = await createTempDir("phira-record-mismatch");
    const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
    const port = running.address().port;
    const host = await Client.connect("127.0.0.1", port);

    try {
      await host.authenticate("a".repeat(32));
      await host.createRoom("room_rc_mismatch");
      await host.selectChart(555); // 房间谱面 = 555
      await host.requestStart(); // 仅房主一人，直接进入 Playing
      await waitFor(() => host.roomState()?.type === "Playing");

      // 成绩 700 对应 chart 888 ≠ 555 → 应被拒绝
      await expect(host.played(700)).rejects.toThrow();

      // 状态不应推进，仍在 Playing
      expect(host.roomState()?.type).toBe("Playing");
    } finally {
      await host.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });

  test("接受与房间当前谱面一致的成绩", async () => {
    const tempDir = await createTempDir("phira-record-match");
    const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
    const port = running.address().port;
    const host = await Client.connect("127.0.0.1", port);

    try {
      await host.authenticate("a".repeat(32));
      await host.createRoom("room_rc_match");
      await host.selectChart(555); // 房间谱面 = 555
      await host.requestStart();
      await waitFor(() => host.roomState()?.type === "Playing");

      // 成绩 555 对应 chart 555 == 555 → 接受，结算后退回 SelectChart
      await host.played(555);
      await waitFor(() => host.roomState()?.type === "SelectChart");
      expect(host.roomState()?.type).toBe("SelectChart");
    } finally {
      await host.close();
      await running.close();
      await cleanupTempDir(tempDir);
    }
  });
});
