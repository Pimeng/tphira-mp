import net from "node:net";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { newUuid } from "../common/uuid.js";
import { decodePacket, encodePacket } from "../common/binary.js";
import { decodeClientCommand, encodeServerCommand } from "../common/commands.js";
import { Stream } from "../common/stream.js";
import type { StreamCodec } from "../common/stream.js";
import type { ClientCommand, ServerCommand } from "../common/commands.js";
import { ServerState } from "./state.js";
import type { ServerConfig } from "./types.js";
import { Session } from "./session.js";
import { Logger } from "./logger.js";
import { getAppPaths } from "./appPaths.js";
import { readAppVersion } from "./version.js";
import { startHttpService, type HttpService } from "./httpService.js";

export type StartServerOptions = { host?: string; port?: number; config?: ServerConfig };

export type RunningServer = {
  server: net.Server;
  http?: HttpService;
  state: ServerState;
  logger: Logger;
  close: () => Promise<void>;
  address: () => net.AddressInfo;
};

function loadConfig(): ServerConfig {
  try {
    const { configPath } = getAppPaths();
    const text = readFileSync(configPath, "utf8");
    const raw = (yaml.load(text) ?? {}) as Record<string, unknown>;

    const read = <T>(keys: readonly string[]): T | undefined => {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) return raw[k] as T;
      }
      return undefined;
    };

    const monitorsRaw = read<unknown>(["monitors", "MONITORS"]);
    const monitors = Array.isArray(monitorsRaw) ? monitorsRaw.map((it) => Number(it)).filter((it) => Number.isInteger(it)) : [2];

    const serverNameRaw = read<unknown>(["server_name", "SERVER_NAME"]);
    const server_name = typeof serverNameRaw === "string" && serverNameRaw.trim().length > 0 ? serverNameRaw.trim() : undefined;

    const hostRaw = read<unknown>(["host", "HOST"]);
    const host = typeof hostRaw === "string" && hostRaw.trim().length > 0 ? hostRaw.trim() : undefined;

    const portRaw = read<unknown>(["port", "PORT"]);
    const port = typeof portRaw === "number" ? portRaw : Number(portRaw);
    const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;

    const httpServiceRaw = read<unknown>(["http_service", "HTTP_SERVICE"]);
    const http_service = typeof httpServiceRaw === "boolean" ? httpServiceRaw : undefined;

    const httpPortRaw = read<unknown>(["http_port", "HTTP_PORT"]);
    const http_port = typeof httpPortRaw === "number" ? httpPortRaw : Number(httpPortRaw);
    const safeHttpPort = Number.isInteger(http_port) && http_port > 0 && http_port <= 65535 ? http_port : undefined;

    const roomMaxUsersRaw = read<unknown>(["room_max_users", "ROOM_MAX_USERS"]);
    const roomMaxUsers = typeof roomMaxUsersRaw === "number" ? roomMaxUsersRaw : Number(roomMaxUsersRaw);
    const room_max_users = Number.isInteger(roomMaxUsers) && roomMaxUsers >= 1 ? Math.min(roomMaxUsers, 64) : undefined;

    return { monitors, server_name, host, port: safePort, http_service, http_port: safeHttpPort, room_max_users };
  } catch {
    return { monitors: [2] };
  }
}

const codec: StreamCodec<ServerCommand, ClientCommand> = {
  encodeSend: (payload) => encodePacket(payload, encodeServerCommand),
  decodeRecv: (payload) => decodePacket(payload, decodeClientCommand)
};

function formatListenHostPort(host: string, port: number): string {
  if (host.includes(":")) return `[${host}]:${port}`;
  return `${host}:${port}`;
}

function formatNodeVersion(v: string): string {
  return v.startsWith("v") ? v.slice(1) : v;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const paths = getAppPaths();
  const logger = new Logger({ logsDir: paths.logsDir });
  const cfg = options.config ?? loadConfig();
  const serverName = process.env.SERVER_NAME?.trim() || cfg.server_name || "Phira MP";
  const state = new ServerState(cfg, logger, serverName);

  const version = readAppVersion();
  const listenHost = options.host ?? cfg.host ?? "::";
  const listenPort = options.port ?? cfg.port ?? 12346;

  const server = net.createServer(async (socket) => {
    const id = newUuid();
    logger.mark(`收到新连接，连接ID：${id}，来源：${socket.remoteAddress ?? "unknown"}:${socket.remotePort ?? "unknown"}`);
    const session = new Session({ id, socket, state });
    state.sessions.set(id, session);

    const stream = await Stream.create<ServerCommand, ClientCommand>({
      socket,
      codec,
      handler: async (cmd) => {
        await session.onCommand(cmd);
      }
    });

    session.bindStream(stream);
    logger.mark(`连接握手完成，连接ID：${id}，协议版本：“${stream.version}”`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: listenPort, host: listenHost }, () => resolve());
  });

  const httpService = cfg.http_service === true ? await startHttpService({ state, host: listenHost, port: cfg.http_port ?? 12347 }) : null;

  const addr = server.address() as net.AddressInfo;
  logger.mark(`服务端版本 ${version}`);
  logger.mark(`当前运行环境 ${process.platform}_${process.arch} node${formatNodeVersion(process.version)}`);
  logger.mark(`服务端运行在 ${formatListenHostPort(addr.address, addr.port)}`);
  if (httpService) {
    const httpAddr = httpService.address();
    logger.mark(`HTTP 服务运行在 ${formatListenHostPort(httpAddr.address, httpAddr.port)}`);
  }
  logger.mark(`服务器名称 ${serverName}`);

  return {
    server,
    http: httpService ?? undefined,
    state,
    logger,
    address: () => server.address() as net.AddressInfo,
    close: async () => {
      try {
        if (httpService) await httpService.close();
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        logger.mark("服务端已停止");
      } finally {
        logger.close();
      }
    }
  };
}
