import { Mutex } from "./mutex.js";
import type { RoomId } from "../common/roomId.js";
import type { ServerConfig } from "./types.js";
import type { Room } from "./room.js";
import type { Session } from "./session.js";
import type { User } from "./user.js";

export class ServerState {
  readonly mutex = new Mutex();
  readonly config: ServerConfig;

  readonly sessions = new Map<string, Session>();
  readonly users = new Map<number, User>();
  readonly rooms = new Map<RoomId, Room>();

  constructor(config: ServerConfig) {
    this.config = config;
  }
}

