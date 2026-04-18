import http from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchWithTimeout } from "../src/common/http.js";

function listen(server: http.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to get server address"));
        return;
      }
      resolve(addr.port);
    });
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("outbound proxy", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("proxy=false 时强制直连，不走原生 fetch", async () => {
    const target = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`direct:${req.url}`);
    });
    const port = await listen(target);

    const nativeFetchSpy = vi.fn(async () => new Response("native", { status: 200 }));
    globalThis.fetch = nativeFetchSpy as typeof fetch;

    try {
      const res = await fetchWithTimeout(`http://127.0.0.1:${port}/health`, { proxy: false }, 2000);
      expect(await res.text()).toBe("direct:/health");
      expect(nativeFetchSpy).not.toHaveBeenCalled();
    } finally {
      await close(target);
    }
  });

  test("配置代理地址时，请求会经过 HTTP 代理", async () => {
    const target = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`target:${req.url}`);
    });
    const targetPort = await listen(target);

    let proxySeen = 0;
    const proxy = http.createServer((req, res) => {
      proxySeen += 1;
      const targetUrl = new URL(req.url ?? "");
      const upstream = http.request({
        host: targetUrl.hostname,
        port: targetUrl.port ? Number(targetUrl.port) : 80,
        method: req.method,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        headers: req.headers
      }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
        upstreamRes.pipe(res);
      });
      req.pipe(upstream);
      upstream.once("error", (error) => {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end(String(error));
      });
    });
    const proxyPort = await listen(proxy);

    try {
      const res = await fetchWithTimeout(`http://127.0.0.1:${targetPort}/via-proxy`, {
        proxy: `http://127.0.0.1:${proxyPort}`
      }, 2000);
      expect(await res.text()).toBe("target:/via-proxy");
      expect(proxySeen).toBe(1);
    } finally {
      await close(proxy);
      await close(target);
    }
  });
});
