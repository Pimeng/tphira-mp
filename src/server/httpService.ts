import http from "node:http";
import type net from "node:net";
import { roomIdToString } from "../common/roomId.js";
import type { ServerState } from "./state.js";

export type HttpService = {
  server: http.Server;
  address: () => net.AddressInfo;
  close: () => Promise<void>;
};

export async function startHttpService(opts: { state: ServerState; host: string; port: number }): Promise<HttpService> {
  const { state } = opts;

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/room") {
        const rooms = await state.mutex.runExclusive(async () => {
          const ids: string[] = [];
          for (const id of state.rooms.keys()) {
            const s = roomIdToString(id);
            if (s.startsWith("_")) continue;
            ids.push(s);
          }
          ids.sort();
          return ids;
        });

        const body = JSON.stringify({ rooms });
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(body);
        return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("not found");
    })().catch(() => {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("internal error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: opts.host, port: opts.port }, () => resolve());
  });

  return {
    server,
    address: () => server.address() as net.AddressInfo,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };
}

