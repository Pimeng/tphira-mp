import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Mutex } from "./mutex.js";
import type { RoomId } from "../common/roomId.js";
import { parseRoomId, roomIdToString } from "../common/roomId.js";
import type { ServerConfig } from "./types.js";
import type { Room } from "./room.js";
import type { Session } from "./session.js";
import type { User } from "./user.js";
import type { Logger } from "./logger.js";
import { Language } from "./l10n.js";
import { ReplayRecorder } from "./replayRecorder.js";
import { defaultReplayBaseDir } from "./replayStorage.js";

type AdminDataFile = { version: 1; bannedUsers: number[]; bannedRoomUsers: Record<string, number[]> };

export class ServerState {
  readonly mutex = new Mutex();
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly serverName: string;
  readonly serverLang: Language;
  readonly adminDataPath: string;
  replayEnabled: boolean;
  roomCreationEnabled: boolean;

  readonly sessions = new Map<string, Session>();
  readonly users = new Map<number, User>();
  readonly rooms = new Map<RoomId, Room>();

  readonly bannedUsers = new Set<number>();
  readonly bannedRoomUsers = new Map<RoomId, Set<number>>();
  readonly contestRooms = new Map<RoomId, { whitelist: Set<number> }>();

  readonly replayRecorder: ReplayRecorder;

  constructor(config: ServerConfig, logger: Logger, serverName: string, adminDataPath: string) {
    this.config = config;
    this.logger = logger;
    this.serverName = serverName;
    this.serverLang = new Language(process.env.PHIRA_MP_LANG?.trim() || process.env.LANG?.trim() || "");
    this.adminDataPath = adminDataPath;
    this.replayEnabled = Boolean(config.replay_enabled);
    this.roomCreationEnabled = true;
    this.replayRecorder = new ReplayRecorder(defaultReplayBaseDir());
  }

  private snapshotAdminData(): AdminDataFile {
    const bannedUsers = [...this.bannedUsers].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
    const bannedRoomUsers: Record<string, number[]> = {};
    const entries = [...this.bannedRoomUsers.entries()].map(([rid, set]) => [roomIdToString(rid), [...set]] as const);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [rid, users] of entries) {
      const ids = users.filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
      if (ids.length > 0) bannedRoomUsers[rid] = ids;
    }
    return { version: 1, bannedUsers, bannedRoomUsers };
  }

  private applyAdminDataFile(data: AdminDataFile): void {
    this.bannedUsers.clear();
    for (const id of data.bannedUsers) {
      if (Number.isInteger(id)) this.bannedUsers.add(id);
    }
    this.bannedRoomUsers.clear();
    for (const [ridText, ids] of Object.entries(data.bannedRoomUsers ?? {})) {
      try {
        const rid = parseRoomId(ridText);
        const set = new Set<number>();
        for (const id of ids ?? []) if (Number.isInteger(id)) set.add(id);
        if (set.size > 0) this.bannedRoomUsers.set(rid, set);
      } catch {
      }
    }
  }

  async loadAdminData(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      try {
        const text = await readFile(this.adminDataPath, "utf8");
        const raw = JSON.parse(text) as Partial<AdminDataFile>;
        if (raw.version !== 1) return;
        const bannedUsers = Array.isArray(raw.bannedUsers) ? raw.bannedUsers : [];
        const bannedRoomUsers = raw.bannedRoomUsers && typeof raw.bannedRoomUsers === "object" ? (raw.bannedRoomUsers as Record<string, number[]>) : {};
        this.applyAdminDataFile({ version: 1, bannedUsers: bannedUsers as number[], bannedRoomUsers });
      } catch {
      }
    });
  }

  async saveAdminData(): Promise<void> {
    const data = await this.mutex.runExclusive(async () => this.snapshotAdminData());
    const dir = dirname(this.adminDataPath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.adminDataPath}.tmp`;
    const text = JSON.stringify(data, null, 2);
    await writeFile(tmp, text, "utf8");
    try {
      await rename(tmp, this.adminDataPath);
    } catch {
      try {
        await unlink(this.adminDataPath);
      } catch {
      }
      await rename(tmp, this.adminDataPath);
    }
  }
}
