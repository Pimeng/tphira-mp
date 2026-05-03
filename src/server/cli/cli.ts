import * as readline from "node:readline";
import type { FluentVariable } from "@fluent/bundle";
import type { ServerState } from "../core/state.js";
import type { Logger } from "../utils/logger.js";
import { roomIdToString, type RoomId } from "../../common/roomId.js";
import type { ServerCommand } from "../../common/commands.js";
import { tl } from "../utils/l10n.js";
import { logRoomInfo } from "../utils/logUtils.js";
import { refreshRoomLive } from "../game/roomUtils.js";
import { abortPlayingUserAndCheckReady } from "../network/httpHelpers.js";
import {
  makePrinter,
  parseBoundedIntArg,
  parseRoomIdArg,
  parseToggleArg,
  parseUserIdArg,
  validateChatMessage
} from "./cliHelpers.js";

export type CliContext = {
  state: ServerState;
  logger: Logger;
  broadcastRoomAll: (roomId: RoomId, cmd: ServerCommand) => Promise<void>;
  pickRandomUserId: (ids: number[]) => number | null;
};

export function startCli(ctx: CliContext): () => void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ""
  });

  const { print, printError, printSuccess, printInfo } = makePrinter();
  // 每次调用都从 ctx.state 取最新的 serverLang——配置 reload 时它会被替换。
  const getLang = () => ctx.state.serverLang;
  const t = (key: string, args?: Record<string, FluentVariable>): string => tl(getLang(), key, args);

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) return;

    const parts = input.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    try {
      switch (cmd) {
        case "help":
          await handleHelp();
          break;
        case "list":
        case "rooms":
          await handleListRooms();
          break;
        case "users":
          await handleListUsers();
          break;
        case "user":
          await handleUserInfo(args);
          break;
        case "kick":
          await handleKick(args);
          break;
        case "ban":
          await handleBan(args);
          break;
        case "unban":
          await handleUnban(args);
          break;
        case "banlist":
          await handleBanList();
          break;
        case "banroom":
          await handleBanRoom(args);
          break;
        case "unbanroom":
          await handleUnbanRoom(args);
          break;
        case "broadcast":
        case "say":
          await handleBroadcast(args);
          break;
        case "roomsay":
          await handleRoomSay(args);
          break;
        case "maxusers":
          await handleMaxUsers(args);
          break;
        case "disband":
          await handleDisband(args);
          break;
        case "replay":
          await handleReplay(args);
          break;
        case "roomcreation":
          await handleRoomCreation(args);
          break;
        case "contest":
          await handleContest(args);
          break;
        case "ipblacklist":
          await handleIpBlacklist(args);
          break;
        case "stop":
        case "shutdown":
          printInfo(t("cli-stop-hint"));
          break;
        default:
          printError(t("cli-unknown-command", { cmd: cmd ?? "" }));
      }
    } catch (e) {
      printError(t("cli-command-failed", { reason: e instanceof Error ? e.message : String(e) }));
    }
  });

  const handleHelp = async () => {
    print(t("cli-help"));
  };

  const stateLabel = (type: string): string => {
    if (type === "Playing") return t("cli-room-state-playing");
    if (type === "WaitForReady") return t("cli-room-state-waiting");
    return t("cli-room-state-select");
  };

  const handleListRooms = async () => {
    const rooms = await ctx.state.mutex.runExclusive(async () => {
      return [...ctx.state.rooms.entries()].map(([rid, room]) => ({
        roomid: roomIdToString(rid),
        state: stateLabel(room.state.type),
        users: room.userIds().length,
        monitors: room.monitorIds().length,
        maxUsers: room.maxUsers,
        locked: room.locked ? t("cli-bool-yes") : t("cli-bool-no"),
        cycle: room.cycle ? t("cli-bool-yes") : t("cli-bool-no"),
        chart: room.chart?.name ?? t("cli-none"),
        contest: room.contest ? t("cli-bool-yes") : t("cli-bool-no")
      }));
    });

    if (rooms.length === 0) {
      printInfo(t("cli-no-rooms"));
      return;
    }

    print("");
    print(t("cli-rooms-total", { count: rooms.length }));
    for (const r of rooms) {
      print(t("cli-room-line", {
        id: r.roomid,
        state: r.state,
        users: r.users,
        maxUsers: r.maxUsers,
        monitors: r.monitors,
        chart: r.chart,
        locked: r.locked,
        cycle: r.cycle,
        contest: r.contest
      }));
    }
    print("");
  };

  const handleListUsers = async () => {
    const users = await ctx.state.mutex.runExclusive(async () => {
      return [...ctx.state.users.values()].map((u) => ({
        id: u.id,
        name: u.name,
        room: u.room ? roomIdToString(u.room.id) : null,
        monitor: u.monitor,
        connected: Boolean(u.session),
        banned: ctx.state.bannedUsers.has(u.id)
      }));
    });

    if (users.length === 0) {
      printInfo(t("cli-no-users"));
      return;
    }

    print("");
    print(t("cli-users-total", { count: users.length }));
    for (const u of users) {
      print(t("cli-user-line", {
        id: u.id,
        name: u.name,
        status: u.connected ? t("cli-user-status-online") : t("cli-user-status-offline"),
        role: u.monitor ? t("cli-user-role-monitor") : t("cli-user-role-player"),
        room: u.room ?? t("cli-none"),
        bannedTag: u.banned ? t("cli-user-banned-tag") : ""
      }));
    }
    print("");
  };

  const handleUserInfo = async (args: string[]) => {
    if (args.length === 0) {
      printError(t("cli-usage-user"));
      return;
    }
    const userId = parseUserIdArg(args[0], getLang(), printError);
    if (userId === null) return;

    const info = await ctx.state.mutex.runExclusive(async () => {
      const u = ctx.state.users.get(userId);
      if (!u) return null;
      return {
        id: u.id,
        name: u.name,
        room: u.room ? roomIdToString(u.room.id) : null,
        monitor: u.monitor,
        connected: Boolean(u.session),
        banned: ctx.state.bannedUsers.has(u.id),
        gameTime: u.gameTime,
        lang: u.lang.lang
      };
    });

    if (!info) {
      printError(t("cli-user-not-found", { id: userId }));
      return;
    }

    print("");
    print(t("cli-user-info-header"));
    print(t("cli-user-info-id", { id: info.id }));
    print(t("cli-user-info-name", { name: info.name }));
    print(t("cli-user-info-status", { status: info.connected ? t("cli-user-status-online") : t("cli-user-status-offline") }));
    print(t("cli-user-info-role", { role: info.monitor ? t("cli-user-role-monitor") : t("cli-user-role-player") }));
    print(t("cli-user-info-room", { room: info.room ?? t("cli-none") }));
    print(t("cli-user-info-banned", { banned: info.banned ? t("cli-yes") : t("cli-no") }));
    print(t("cli-user-info-game-time", { time: info.gameTime }));
    print(t("cli-user-info-language", { lang: info.lang }));
    print("");
  };

  const handleKick = async (args: string[]) => {
    if (args.length === 0) {
      printError(t("cli-usage-kick"));
      return;
    }

    const userId = parseUserIdArg(args[0], getLang(), printError);
    if (userId === null) return;

    const preserveRoom = args[1] === "true" || args[1] === "preserve";

    const session = await ctx.state.mutex.runExclusive(async () => ctx.state.users.get(userId)?.session ?? null);
    if (!session) {
      printError(t("cli-user-not-connected", { id: userId }));
      return;
    }

    const u = session.user;
    if (preserveRoom && u && u.room) {
      await abortPlayingUserAndCheckReady({
        state: ctx.state,
        user: u,
        room: u.room,
        broadcastRoomAll: ctx.broadcastRoomAll,
        pickRandomUserId: ctx.pickRandomUserId
      });
    }

    await session.adminDisconnect({ preserveRoom });
    printSuccess(t("cli-user-kicked", { id: userId }));
  };

  const handleBan = async (args: string[]) => {
    if (args.length === 0) {
      printError(t("cli-usage-ban"));
      return;
    }

    const userId = parseUserIdArg(args[0], getLang(), printError);
    if (userId === null) return;

    await ctx.state.mutex.runExclusive(async () => {
      ctx.state.bannedUsers.add(userId);
    });

    await ctx.state.saveAdminData();
    printSuccess(t("cli-user-banned", { id: userId }));
  };

  const handleUnban = async (args: string[]) => {
    if (args.length === 0) {
      printError(t("cli-usage-unban"));
      return;
    }

    const userId = parseUserIdArg(args[0], getLang(), printError);
    if (userId === null) return;

    await ctx.state.mutex.runExclusive(async () => {
      ctx.state.bannedUsers.delete(userId);
    });

    await ctx.state.saveAdminData();
    printSuccess(t("cli-user-unbanned", { id: userId }));
  };

  const handleBanList = async () => {
    const banned = await ctx.state.mutex.runExclusive(async () => {
      return [...ctx.state.bannedUsers];
    });

    if (banned.length === 0) {
      printInfo(t("cli-no-banned-users"));
      return;
    }

    print("");
    print(t("cli-banned-list-header", { count: banned.length }));
    for (const id of banned) print(`  ${id}`);
    print("");
  };

  const handleBanRoom = async (args: string[]) => {
    if (args.length < 2) {
      printError(t("cli-usage-banroom"));
      return;
    }

    const userId = parseUserIdArg(args[0], getLang(), printError);
    if (userId === null) return;

    const rid = parseRoomIdArg(args[1], getLang(), printError);
    if (!rid) return;

    await ctx.state.mutex.runExclusive(async () => {
      const set = ctx.state.bannedRoomUsers.get(rid) ?? new Set<number>();
      set.add(userId);
      ctx.state.bannedRoomUsers.set(rid, set);
    });

    await ctx.state.saveAdminData();
    printSuccess(t("cli-room-user-banned", { userId, room: args[1]! }));
  };

  const handleUnbanRoom = async (args: string[]) => {
    if (args.length < 2) {
      printError(t("cli-usage-unbanroom"));
      return;
    }

    const userId = parseUserIdArg(args[0], getLang(), printError);
    if (userId === null) return;

    const rid = parseRoomIdArg(args[1], getLang(), printError);
    if (!rid) return;

    await ctx.state.mutex.runExclusive(async () => {
      const set = ctx.state.bannedRoomUsers.get(rid);
      if (set) {
        set.delete(userId);
        if (set.size === 0) ctx.state.bannedRoomUsers.delete(rid);
      }
    });

    await ctx.state.saveAdminData();
    printSuccess(t("cli-room-user-unbanned", { userId, room: args[1]! }));
  };

  const handleBroadcast = async (args: string[]) => {
    if (args.length === 0) {
      printError(t("cli-usage-broadcast"));
      return;
    }

    const message = validateChatMessage(args.join(" "), getLang(), printError);
    if (message === null) return;

    const snapshot = await ctx.state.mutex.runExclusive(async () => {
      return [...ctx.state.rooms.keys()];
    });

    const tasks: Promise<void>[] = [];
    for (const roomId of snapshot) {
      tasks.push(ctx.broadcastRoomAll(roomId, { type: "Message", message: { type: "Chat", user: 0, content: message } }));
    }
    await Promise.allSettled(tasks);

    ctx.logger.info(t("log-admin-broadcast", { message, rooms: String(snapshot.length) }));
    printSuccess(t("cli-broadcast-sent", { count: snapshot.length }));
  };

  const handleRoomSay = async (args: string[]) => {
    if (args.length < 2) {
      printError(t("cli-usage-roomsay"));
      return;
    }

    const rid = parseRoomIdArg(args[0], getLang(), printError);
    if (!rid) return;

    const message = validateChatMessage(args.slice(1).join(" "), getLang(), printError);
    if (message === null) return;

    const roomExists = await ctx.state.mutex.runExclusive(async () => ctx.state.rooms.has(rid));
    if (!roomExists) {
      printError(t("cli-room-not-found-named", { room: args[0]! }));
      return;
    }

    await ctx.broadcastRoomAll(rid, { type: "Message", message: { type: "Chat", user: 0, content: message } });
    logRoomInfo(ctx.logger, getLang(), rid, "log-admin-room-message", { message });
    printSuccess(t("cli-room-message-sent", { room: args[0]! }));
  };

  const handleMaxUsers = async (args: string[]) => {
    if (args.length < 2) {
      printError(t("cli-usage-maxusers"));
      return;
    }

    const rid = parseRoomIdArg(args[0], getLang(), printError);
    if (!rid) return;

    const maxUsers = parseBoundedIntArg(args[1], 1, 64, "cli-bad-max-users", getLang(), printError);
    if (maxUsers === null) return;

    const updated = await ctx.state.mutex.runExclusive(async () => {
      const room = ctx.state.rooms.get(rid);
      if (!room) return null;
      room.maxUsers = maxUsers;
      return roomIdToString(room.id);
    });

    if (!updated) {
      printError(t("cli-room-not-found"));
      return;
    }

    printSuccess(t("cli-room-max-users-set", { room: updated, count: maxUsers }));
  };

  const handleDisband = async (args: string[]) => {
    if (args.length === 0) {
      printError(t("cli-usage-disband"));
      return;
    }

    const rid = parseRoomIdArg(args[0], getLang(), printError);
    if (!rid) return;

    const room = await ctx.state.mutex.runExclusive(async () => ctx.state.rooms.get(rid) ?? null);
    if (!room) {
      printError(t("cli-room-not-found"));
      return;
    }

    const allIds = [...room.userIds(), ...room.monitorIds()];
    const tasks: Promise<void>[] = [];
    for (const id of allIds) {
      const u = ctx.state.users.get(id);
      if (u) tasks.push(u.trySend({ type: "Message", message: { type: "Chat", user: 0, content: t("room-disbanded-by-admin") } }));
    }
    await Promise.allSettled(tasks);

    await ctx.state.mutex.runExclusive(async () => {
      ctx.state.rooms.delete(rid);
    });

    if (ctx.state.replayEnabled && room.replayEligible) {
      await ctx.state.replayRecorder.endRoom(rid);
    }

    logRoomInfo(ctx.logger, getLang(), rid, "log-room-disbanded-by-admin");
    printSuccess(t("cli-room-disbanded", { room: args[0]! }));
  };

  const handleReplay = async (args: string[]) => {
    const toggle = parseToggleArg(args[0]);
    if (toggle === null) {
      printError(t("cli-usage-replay"));
      return;
    }
    if (toggle === "status") {
      printInfo(t("cli-replay-status", { state: ctx.state.replayEnabled ? t("cli-state-on") : t("cli-state-off") }));
      return;
    }

    const enabled = toggle === "on";
    const snapshot = await ctx.state.mutex.runExclusive(async () => {
      ctx.state.replayEnabled = enabled;
      const roomIds = enabled ? [] : [...ctx.state.rooms.keys()];
      for (const room of ctx.state.rooms.values()) refreshRoomLive(room, enabled);
      return { enabled, roomIds };
    });

    if (!snapshot.enabled) {
      const tasks = snapshot.roomIds.map((rid) => ctx.state.replayRecorder.endRoom(rid));
      await Promise.allSettled(tasks);
    }

    printSuccess(enabled ? t("cli-replay-toggled-on") : t("cli-replay-toggled-off"));
  };

  const handleRoomCreation = async (args: string[]) => {
    const toggle = parseToggleArg(args[0]);
    if (toggle === null) {
      printError(t("cli-usage-roomcreation"));
      return;
    }
    if (toggle === "status") {
      printInfo(t("cli-room-creation-status", { state: ctx.state.roomCreationEnabled ? t("cli-state-on") : t("cli-state-off") }));
      return;
    }

    const enabled = toggle === "on";
    await ctx.state.mutex.runExclusive(async () => {
      ctx.state.roomCreationEnabled = enabled;
    });

    printSuccess(enabled ? t("cli-room-creation-toggled-on") : t("cli-room-creation-toggled-off"));
  };

  const handleContest = async (args: string[]) => {
    if (args.length < 2) {
      printError(t("cli-usage-contest"));
      return;
    }

    const rid = parseRoomIdArg(args[0], getLang(), printError);
    if (!rid) return;

    const subCmd = args[1]?.toLowerCase();

    if (subCmd === "enable") {
      const userIds = args.slice(2).map((id) => Number(id)).filter((n) => Number.isInteger(n));
      const ok = await ctx.state.mutex.runExclusive(async () => {
        const room = ctx.state.rooms.get(rid);
        if (!room) return false;
        const currentIds = [...room.userIds(), ...room.monitorIds()];
        const set = new Set<number>(userIds.length > 0 ? userIds : currentIds);
        for (const id of currentIds) set.add(id);
        room.contest = { whitelist: set, manualStart: true, autoDisband: true };
        return true;
      });

      if (!ok) {
        printError(t("cli-room-not-found"));
        return;
      }
      printSuccess(t("cli-contest-enabled", { room: args[0]! }));
    } else if (subCmd === "disable") {
      const ok = await ctx.state.mutex.runExclusive(async () => {
        const room = ctx.state.rooms.get(rid);
        if (!room) return false;
        room.contest = null;
        return true;
      });

      if (!ok) {
        printError(t("cli-room-not-found"));
        return;
      }
      printSuccess(t("cli-contest-disabled", { room: args[0]! }));
    } else if (subCmd === "whitelist") {
      const userIds = args.slice(2).map((id) => Number(id)).filter((n) => Number.isInteger(n));
      if (userIds.length === 0) {
        printError(t("cli-contest-no-user-id"));
        return;
      }

      const ok = await ctx.state.mutex.runExclusive(async () => {
        const room = ctx.state.rooms.get(rid);
        if (!room || !room.contest) return false;
        room.contest.whitelist = new Set<number>(userIds);
        const currentIds = [...room.userIds(), ...room.monitorIds()];
        for (const id of currentIds) room.contest.whitelist.add(id);
        return true;
      });

      if (!ok) {
        printError(t("cli-contest-not-enabled"));
        return;
      }
      printSuccess(t("cli-contest-whitelist-updated", { room: args[0]! }));
    } else if (subCmd === "start") {
      const force = args[2] === "force";

      const result = await ctx.state.mutex.runExclusive(async () => {
        const room = ctx.state.rooms.get(rid);
        if (!room || !room.contest) return { ok: false as const, error: "contest-room-not-found" };
        if (room.state.type !== "WaitForReady") return { ok: false as const, error: "room-not-waiting" };
        if (!room.chart) return { ok: false as const, error: "no-chart-selected" };
        const started = room.state.started;
        const allIds = [...room.userIds(), ...room.monitorIds()];
        const allReady = allIds.every((id) => started.has(id));
        if (!allReady && !force) return { ok: false as const, error: "not-all-ready" };
        return { ok: true as const, room };
      });

      if (!result.ok) {
        printError(t("cli-contest-cannot-start", { reason: result.error }));
        return;
      }

      const room = result.room;
      const users = room.userIds();
      const monitors = room.monitorIds();
      const sep = getLang().lang === "zh-CN" ? "、" : ", ";
      const usersText = users.join(sep);
      const monitorsText = monitors.join(sep);
      const monitorsSuffix = monitors.length > 0 ? t("log-room-game-start-monitors", { monitors: monitorsText }) : "";
      logRoomInfo(ctx.logger, getLang(), room.id, "log-room-game-start", { users: usersText, monitorsSuffix });
      await room.send((c) => ctx.broadcastRoomAll(room.id, c), { type: "StartPlaying" });
      room.resetGameTime((id) => ctx.state.users.get(id));
      if (ctx.state.replayEnabled && room.replayEligible) {
        const replayUsers = room.userIds().map((id) => ({ id, name: ctx.state.users.get(id)?.name ?? String(id) }));
        await ctx.state.replayRecorder.startRoom(room.id, room.chart!, replayUsers);
      }
      room.state = { type: "Playing", results: new Map(), aborted: new Set() };
      await room.onStateChange((c) => ctx.broadcastRoomAll(room.id, c));

      printSuccess(t("cli-contest-started", { room: args[0]! }));
    } else {
      printError(t("cli-contest-unknown-subcommand"));
    }
  };

  const handleIpBlacklist = async (args: string[]) => {
    if (args.length === 0) {
      printError(t("cli-usage-ipblacklist"));
      return;
    }

    const subCmd = args[0]?.toLowerCase();

    if (subCmd === "list") {
      const blacklist = ctx.logger.getBlacklistedIps();
      if (blacklist.length === 0) {
        printInfo(t("cli-blacklist-empty"));
        return;
      }

      print("");
      print(t("cli-blacklist-header", { count: blacklist.length }));
      for (const item of blacklist) {
        const expiresInMin = Math.ceil(item.expiresIn / 60000);
        print(t("cli-blacklist-line", { ip: item.ip, minutes: expiresInMin }));
      }
      print("");
    } else if (subCmd === "remove") {
      if (args.length < 2) {
        printError(t("cli-usage-ipblacklist-remove"));
        return;
      }
      const ip = args[1]!;
      ctx.logger.removeFromBlacklist(ip);
      printSuccess(t("cli-blacklist-removed", { ip }));
    } else if (subCmd === "clear") {
      ctx.logger.clearBlacklist();
      printSuccess(t("cli-blacklist-cleared"));
    } else {
      printError(t("cli-ipblacklist-unknown-subcommand"));
    }
  };

  return () => {
    rl.close();
  };
}
