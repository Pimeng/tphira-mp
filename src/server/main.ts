import { parseArgs } from "node:util";
import { startServer } from "./server.js";
import { Language, tl } from "./l10n.js";

function parseBool(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

function parsePort(value: string): number | null {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return port;
}

function parseRoomMaxUsers(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, 64);
}

function parseMonitors(value: string): number[] | null {
  const ids = value
    .split(",")
    .map((it) => Number(it.trim()))
    .filter((it) => Number.isInteger(it));
  if (ids.length === 0) return null;
  return ids;
}

async function main(): Promise<void> {
  const lang = new Language(process.env.PHIRA_MP_LANG?.trim() || process.env.LANG?.trim() || "");
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      host: { type: "string" },
      port: { type: "string", short: "p" },
      httpService: { type: "string" },
      httpPort: { type: "string" },
      roomMaxUsers: { type: "string" },
      serverName: { type: "string" },
      monitors: { type: "string" }
    },
    allowPositionals: true
  });

  const host = values.host?.trim() || undefined;

  let port: number | undefined;
  if (values.port !== undefined) {
    const p = parsePort(values.port);
    if (p === null) throw new Error(tl(lang, "cli-invalid-port"));
    port = p;
  }

  let http_service: boolean | undefined;
  if (values.httpService !== undefined) {
    const v = parseBool(values.httpService);
    if (v === null) throw new Error(tl(lang, "cli-invalid-http-service"));
    http_service = v;
  }

  let http_port: number | undefined;
  if (values.httpPort !== undefined) {
    const p = parsePort(values.httpPort);
    if (p === null) throw new Error(tl(lang, "cli-invalid-http-port"));
    http_port = p;
  }

  let room_max_users: number | undefined;
  if (values.roomMaxUsers !== undefined) {
    const n = parseRoomMaxUsers(values.roomMaxUsers);
    if (n === null) throw new Error(tl(lang, "cli-invalid-room-max-users"));
    room_max_users = n;
  }

  const server_name = values.serverName?.trim() || undefined;

  let monitors: number[] | undefined;
  if (values.monitors !== undefined) {
    const ids = parseMonitors(values.monitors);
    if (ids === null) throw new Error(tl(lang, "cli-invalid-monitors"));
    monitors = ids;
  }

  const running = await startServer({
    host,
    port,
    config: {
      ...(http_service !== undefined ? { http_service } : {}),
      ...(http_port !== undefined ? { http_port } : {}),
      ...(room_max_users !== undefined ? { room_max_users } : {}),
      ...(server_name !== undefined ? { server_name } : {}),
      ...(monitors !== undefined ? { monitors } : {})
    }
  });

  const stop = async () => {
    try {
      await running.close();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
