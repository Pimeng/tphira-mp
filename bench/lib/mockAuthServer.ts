import http from "node:http";

export type MockAuthServer = {
  url: string;
  stop: () => Promise<void>;
};

function hashToken(token: string): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) - h + token.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

export function startMockAuthServer(port = 0): Promise<MockAuthServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/me" && req.method === "GET") {
        const auth = req.headers.authorization ?? "";
        const token = auth.replace(/^Bearer\s+/i, "").trim();
        const id = token ? hashToken(token) : 999999;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, name: `bench-user-${id}`, language: "zh-CN" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(port, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("mock-server-invalid-address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        stop: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });

    server.on("error", reject);
  });
}
