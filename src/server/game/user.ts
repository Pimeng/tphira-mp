import { Language } from "../utils/l10n.js";
import type { ServerState } from "../core/state.js";
import type { Room } from "../game/room.js";
import type { Session } from "../network/session.js";
import type { ServerCommand, UserInfo } from "../../common/commands.js";

export class User {
  readonly id: number;
  readonly name: string;
  readonly lang: Language;
  readonly server: ServerState;

  session: Session | null = null;
  room: Room | null = null;

  monitor = false;
  gameTime = Number.NEGATIVE_INFINITY;

  private dangleToken: object | null = null;

  constructor(opts: { id: number; name: string; language: string; server: ServerState }) {
    this.id = opts.id;
    this.name = opts.name;
    this.lang = new Language(opts.language);
    this.server = opts.server;
  }

  toInfo(): UserInfo {
    return { id: this.id, name: this.name, monitor: this.monitor };
  }

  canMonitor(): boolean {
    return this.server.config.monitors.includes(this.id);
  }

  setSession(session: Session | null): void {
    this.session = session;
    this.dangleToken = null;
  }

  async trySend(cmd: ServerCommand): Promise<void> {
    const session = this.session;
    if (!session) return;
    await session.trySend(cmd);
  }

  markDangle(): object {
    const token = {};
    this.dangleToken = token;
    return token;
  }

  isStillDangling(token: object): boolean {
    return this.dangleToken === token;
  }
}

