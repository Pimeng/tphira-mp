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

export type StartServerOptions = { port: number; config?: ServerConfig };

export type RunningServer = {
  server: net.Server;
  state: ServerState;
  close: () => Promise<void>;
  address: () => net.AddressInfo;
};

function loadConfig(): ServerConfig {
  try {
    const text = readFileSync("server_config.yml", "utf8");
    const v = yaml.load(text) as Partial<ServerConfig> | undefined;
    if (!v || !Array.isArray(v.monitors)) return { monitors: [2] };
    return { monitors: v.monitors.map((it) => Number(it)).filter((it) => Number.isInteger(it)) };
  } catch {
    return { monitors: [2] };
  }
}

const codec: StreamCodec<ServerCommand, ClientCommand> = {
  encodeSend: (payload) => encodePacket(payload, encodeServerCommand),
  decodeRecv: (payload) => decodePacket(payload, decodeClientCommand)
};

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const state = new ServerState(options.config ?? loadConfig());

  const server = net.createServer(async (socket) => {
    const id = newUuid();
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
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: options.port, host: "::" }, () => resolve());
  });

  return {
    server,
    state,
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
