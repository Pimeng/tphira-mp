import * as readline from "node:readline";
import type { ServerState } from "./state.js";
import type { Logger } from "./logger.js";
import { parseRoomId, roomIdToString, type RoomId } from "../common/roomId.js";
import type { ServerCommand } from "../common/commands.js";
import { tl } from "./l10n.js";

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

  const print = (msg: string) => {
    process.stdout.write(`${msg}\n`);
  };

  const printError = (msg: string) => {
    process.stderr.write(`\x1b[31m${msg}\x1b[0m\n`);
  };

  const printSuccess = (msg: string) => {
    process.stdout.write(`\x1b[32m${msg}\x1b[0m\n`);
  };

  const printInfo = (msg: string) => {
    process.stdout.write(`\x1b[36m${msg}\x1b[0m\n`);
  };

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
        case "maxusers":
          await handleMaxUsers(args);
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
          printInfo("使用 Ctrl+C 停止服务器 / Use Ctrl+C to stop the server");
          break;
        default:
          printError(`未知命令: ${cmd}。输入 'help' 查看可用命令 / Unknown command: ${cmd}. Type 'help' for available commands`);
      }
    } catch (e) {
      printError(`命令执行失败 / Command failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const handleHelp = async () => {
    print("\n=== Phira MP 服务器命令 / Server Commands ===");
    print("help                          - 显示此帮助信息 / Show this help");
    print("list, rooms                   - 列出所有房间 / List all rooms");
    print("users                         - 列出所有在线用户 / List all online users");
    print("user <id>                     - 查看用户信息 / View user info");
    print("kick <userId> [preserve]      - 踢出用户 / Kick user (preserve=true to keep room slot)");
    print("ban <userId>                  - 封禁用户 / Ban user from server");
    print("unban <userId>                - 解封用户 / Unban user");
    print("banlist                       - 查看封禁列表 / View ban list");
    print("banroom <userId> <roomId>     - 禁止用户进入房间 / Ban user from room");
    print("unbanroom <userId> <roomId>   - 解除房间禁入 / Unban user from room");
    print("broadcast <message>           - 全服广播 / Broadcast message");
    print("say <message>                 - 全服广播（同broadcast） / Broadcast (alias)");
    print("maxusers <roomId> <count>     - 设置房间最大人数 / Set room max users");
    print("replay <on|off|status>        - 回放录制开关 / Replay recording toggle");
    print("roomcreation <on|off|status>  - 房间创建开关 / Room creation toggle");
    print("contest <roomId> <subcommand> - 比赛房间管理 / Contest room management");
    print("  contest <roomId> enable [userIds...]  - 启用比赛模式 / Enable contest mode");
    print("  contest <roomId> disable              - 禁用比赛模式 / Disable contest mode");
    print("  contest <roomId> whitelist <userIds...> - 设置白名单 / Set whitelist");
    print("  contest <roomId> start [force]        - 手动开始比赛 / Start contest");
    print("ipblacklist <list|remove|clear> - IP黑名单管理 / IP blacklist management\n");
  };

  const handleListRooms = async () => {
    const rooms = await ctx.state.mutex.runExclusive(async () => {
      return [...ctx.state.rooms.entries()].map(([rid, room]) => {
        const roomid = roomIdToString(rid);
        const users = room.userIds();
        const monitors = room.monitorIds();
        const stateStr =
          room.state.type === "Playing" ? "Playing" : room.state.type === "WaitForReady" ? "WaitForReady" : "SelectChart";
        return {
          roomid,
          state: stateStr,
          users: users.length,
          monitors: monitors.length,
          maxUsers: room.maxUsers,
          locked: room.locked,
          cycle: room.cycle,
          chart: room.chart?.name ?? "None",
          contest: room.contest ? "Yes" : "No"
        };
      });
    });

    if (rooms.length === 0) {
      printInfo("当前没有房间 / No rooms currently");
      return;
    }

    print(`\n房间总数 / Total rooms: ${rooms.length}`);
    for (const r of rooms) {
      print(
        `[${r.roomid}] ${r.state} | 玩家/Players: ${r.users}/${r.maxUsers} | 观战/Monitors: ${r.monitors} | ` +
          `谱面/Chart: ${r.chart} | 锁定/Locked: ${r.locked} | 循环/Cycle: ${r.cycle} | 比赛/Contest: ${r.contest}`
      );
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
      printInfo("当前没有在线用户 / No users online");
      return;
    }

    print(`\n在线用户总数 / Total users: ${users.length}`);
    for (const u of users) {
      const status = u.connected ? "在线/Online" : "离线/Offline";
      const role = u.monitor ? "观战/Monitor" : "玩家/Player";
      const banned = u.banned ? " [已封禁/BANNED]" : "";
      print(`[${u.id}] ${u.name} | ${status} | ${role} | 房间/Room: ${u.room ?? "None"}${banned}`);
    }
    print("");
  };

  const handleUserInfo = async (args: string[]) => {
    if (args.length === 0) {
      printError("用法 / Usage: user <userId>");
      return;
    }

    const userId = Number(args[0]);
    if (!Number.isInteger(userId)) {
      printError("无效的用户ID / Invalid user ID");
      return;
    }

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
      printError(`用户不存在 / User not found: ${userId}`);
      return;
    }

    print(`\n用户信息 / User Info:`);
    print(`  ID: ${info.id}`);
    print(`  名称/Name: ${info.name}`);
    print(`  状态/Status: ${info.connected ? "在线/Online" : "离线/Offline"}`);
    print(`  角色/Role: ${info.monitor ? "观战/Monitor" : "玩家/Player"}`);
    print(`  房间/Room: ${info.room ?? "None"}`);
    print(`  封禁/Banned: ${info.banned ? "是/Yes" : "否/No"}`);
    print(`  游戏时间/Game Time: ${info.gameTime}`);
    print(`  语言/Language: ${info.lang}\n`);
  };

  const handleKick = async (args: string[]) => {
    if (args.length === 0) {
      printError("用法 / Usage: kick <userId> [preserve]");
      return;
    }

    const userId = Number(args[0]);
    if (!Number.isInteger(userId)) {
      printError("无效的用户ID / Invalid user ID");
      return;
    }

    const preserveRoom = args[1] === "true" || args[1] === "preserve";

    const session = await ctx.state.mutex.runExclusive(async () => ctx.state.users.get(userId)?.session ?? null);
    if (!session) {
      printError(`用户未连接 / User not connected: ${userId}`);
      return;
    }

    const u = session.user;
    const roomId = u?.room?.id ?? null;
    if (preserveRoom && roomId && u && u.room && u.room.state.type === "Playing") {
      u.room.state.aborted.add(u.id);
      await ctx.broadcastRoomAll(roomId, { type: "Message", message: { type: "Abort", user: u.id } });
      await u.room.checkAllReady({
        usersById: (id) => ctx.state.users.get(id),
        broadcast: (cmd) => ctx.broadcastRoomAll(roomId, cmd),
        broadcastToMonitors: (cmd) => ctx.broadcastRoomAll(roomId, cmd),
        pickRandomUserId: ctx.pickRandomUserId,
        lang: ctx.state.serverLang,
        logger: ctx.logger
      });
    }

    await session.adminDisconnect({ preserveRoom });
    printSuccess(`已踢出用户 / Kicked user: ${userId}`);
  };

  const handleBan = async (args: string[]) => {
    if (args.length === 0) {
      printError("用法 / Usage: ban <userId>");
      return;
    }

    const userId = Number(args[0]);
    if (!Number.isInteger(userId)) {
      printError("无效的用户ID / Invalid user ID");
      return;
    }

    const sessionToDisconnect = await ctx.state.mutex.runExclusive(async () => {
      ctx.state.bannedUsers.add(userId);
      const u = ctx.state.users.get(userId);
      return u?.session ?? null;
    });

    await ctx.state.saveAdminData();

    if (sessionToDisconnect) {
      const u = sessionToDisconnect.user;
      const roomId = u?.room?.id ?? null;
      if (roomId && u && u.room && u.room.state.type === "Playing") {
        u.room.state.aborted.add(u.id);
        await ctx.broadcastRoomAll(roomId, { type: "Message", message: { type: "Abort", user: u.id } });
        await u.room.checkAllReady({
          usersById: (id) => ctx.state.users.get(id),
          broadcast: (cmd) => ctx.broadcastRoomAll(roomId, cmd),
          broadcastToMonitors: (cmd) => ctx.broadcastRoomAll(roomId, cmd),
          pickRandomUserId: ctx.pickRandomUserId,
          lang: ctx.state.serverLang,
          logger: ctx.logger
        });
      }
      await sessionToDisconnect.adminDisconnect({ preserveRoom: true });
    }

    printSuccess(`已封禁用户 / Banned user: ${userId}`);
  };

  const handleUnban = async (args: string[]) => {
    if (args.length === 0) {
      printError("用法 / Usage: unban <userId>");
      return;
    }

    const userId = Number(args[0]);
    if (!Number.isInteger(userId)) {
      printError("无效的用户ID / Invalid user ID");
      return;
    }

    await ctx.state.mutex.runExclusive(async () => {
      ctx.state.bannedUsers.delete(userId);
    });

    await ctx.state.saveAdminData();
    printSuccess(`已解封用户 / Unbanned user: ${userId}`);
  };

  const handleBanList = async () => {
    const banned = await ctx.state.mutex.runExclusive(async () => {
      return [...ctx.state.bannedUsers];
    });

    if (banned.length === 0) {
      printInfo("当前没有被封禁的用户 / No banned users");
      return;
    }

    print(`\n封禁用户列表 / Banned users (${banned.length}):`);
    for (const id of banned) {
      print(`  ${id}`);
    }
    print("");
  };

  const handleBanRoom = async (args: string[]) => {
    if (args.length < 2) {
      printError("用法 / Usage: banroom <userId> <roomId>");
      return;
    }

    const userId = Number(args[0]);
    if (!Number.isInteger(userId)) {
      printError("无效的用户ID / Invalid user ID");
      return;
    }

    let rid: RoomId;
    try {
      rid = parseRoomId(args[1]!);
    } catch {
      printError("无效的房间ID / Invalid room ID");
      return;
    }

    await ctx.state.mutex.runExclusive(async () => {
      const set = ctx.state.bannedRoomUsers.get(rid) ?? new Set<number>();
      set.add(userId);
      ctx.state.bannedRoomUsers.set(rid, set);
    });

    await ctx.state.saveAdminData();
    printSuccess(`已禁止用户 ${userId} 进入房间 ${args[1]} / Banned user ${userId} from room ${args[1]}`);
  };

  const handleUnbanRoom = async (args: string[]) => {
    if (args.length < 2) {
      printError("用法 / Usage: unbanroom <userId> <roomId>");
      return;
    }

    const userId = Number(args[0]);
    if (!Number.isInteger(userId)) {
      printError("无效的用户ID / Invalid user ID");
      return;
    }

    let rid: RoomId;
    try {
      rid = parseRoomId(args[1]!);
    } catch {
      printError("无效的房间ID / Invalid room ID");
      return;
    }

    await ctx.state.mutex.runExclusive(async () => {
      const set = ctx.state.bannedRoomUsers.get(rid);
      if (set) {
        set.delete(userId);
        if (set.size === 0) ctx.state.bannedRoomUsers.delete(rid);
      }
    });

    await ctx.state.saveAdminData();
    printSuccess(`已解除用户 ${userId} 对房间 ${args[1]} 的禁入 / Unbanned user ${userId} from room ${args[1]}`);
  };

  const handleBroadcast = async (args: string[]) => {
    if (args.length === 0) {
      printError("用法 / Usage: broadcast <message>");
      return;
    }

    const message = args.join(" ");
    if (message.length > 200) {
      printError("消息过长（最多200字符） / Message too long (max 200 characters)");
      return;
    }

    const snapshot = await ctx.state.mutex.runExclusive(async () => {
      return [...ctx.state.rooms.keys()];
    });

    const tasks: Promise<void>[] = [];
    for (const roomId of snapshot) {
      tasks.push(ctx.broadcastRoomAll(roomId, { type: "Message", message: { type: "Chat", user: 0, content: message } }));
    }
    await Promise.allSettled(tasks);

    ctx.logger.info(tl(ctx.state.serverLang, "log-admin-broadcast", { message, rooms: String(snapshot.length) }));
    printSuccess(`已向 ${snapshot.length} 个房间广播消息 / Broadcast to ${snapshot.length} rooms`);
  };

  const handleMaxUsers = async (args: string[]) => {
    if (args.length < 2) {
      printError("用法 / Usage: maxusers <roomId> <count>");
      return;
    }

    let rid: RoomId;
    try {
      rid = parseRoomId(args[0]!);
    } catch {
      printError("无效的房间ID / Invalid room ID");
      return;
    }

    const maxUsers = Number(args[1]);
    if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 64) {
      printError("无效的人数（1-64） / Invalid count (1-64)");
      return;
    }

    const updated = await ctx.state.mutex.runExclusive(async () => {
      const room = ctx.state.rooms.get(rid);
      if (!room) return null;
      room.maxUsers = maxUsers;
      return roomIdToString(room.id);
    });

    if (!updated) {
      printError("房间不存在 / Room not found");
      return;
    }

    printSuccess(`已设置房间 ${updated} 最大人数为 ${maxUsers} / Set room ${updated} max users to ${maxUsers}`);
  };

  const handleReplay = async (args: string[]) => {
    if (args.length === 0 || args[0] === "status") {
      const enabled = ctx.state.replayEnabled;
      printInfo(`回放录制状态 / Replay recording: ${enabled ? "开启/Enabled" : "关闭/Disabled"}`);
      return;
    }

    const action = args[0]?.toLowerCase();
    if (action !== "on" && action !== "off") {
      printError("用法 / Usage: replay <on|off|status>");
      return;
    }

    const enabled = action === "on";
    const snapshot = await ctx.state.mutex.runExclusive(async () => {
      ctx.state.replayEnabled = enabled;
      const roomIds = enabled ? [] : [...ctx.state.rooms.keys()];
      if (!enabled) {
        for (const room of ctx.state.rooms.values()) room.live = false;
      }
      return { enabled, roomIds };
    });

    if (!snapshot.enabled) {
      const tasks = snapshot.roomIds.map((rid) => ctx.state.replayRecorder.endRoom(rid));
      await Promise.allSettled(tasks);
    }

    printSuccess(`回放录制已${enabled ? "开启" : "关闭"} / Replay recording ${enabled ? "enabled" : "disabled"}`);
  };

  const handleRoomCreation = async (args: string[]) => {
    if (args.length === 0 || args[0] === "status") {
      const enabled = ctx.state.roomCreationEnabled;
      printInfo(`房间创建状态 / Room creation: ${enabled ? "开启/Enabled" : "关闭/Disabled"}`);
      return;
    }

    const action = args[0]?.toLowerCase();
    if (action !== "on" && action !== "off") {
      printError("用法 / Usage: roomcreation <on|off|status>");
      return;
    }

    const enabled = action === "on";
    await ctx.state.mutex.runExclusive(async () => {
      ctx.state.roomCreationEnabled = enabled;
    });

    printSuccess(`房间创建已${enabled ? "开启" : "关闭"} / Room creation ${enabled ? "enabled" : "disabled"}`);
  };

  const handleContest = async (args: string[]) => {
    if (args.length < 2) {
      printError("用法 / Usage: contest <roomId> <enable|disable|whitelist|start>");
      return;
    }

    let rid: RoomId;
    try {
      rid = parseRoomId(args[0]!);
    } catch {
      printError("无效的房间ID / Invalid room ID");
      return;
    }

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
        printError("房间不存在 / Room not found");
        return;
      }
      printSuccess(`已启用房间 ${args[0]} 的比赛模式 / Enabled contest mode for room ${args[0]}`);
    } else if (subCmd === "disable") {
      const ok = await ctx.state.mutex.runExclusive(async () => {
        const room = ctx.state.rooms.get(rid);
        if (!room) return false;
        room.contest = null;
        return true;
      });

      if (!ok) {
        printError("房间不存在 / Room not found");
        return;
      }
      printSuccess(`已禁用房间 ${args[0]} 的比赛模式 / Disabled contest mode for room ${args[0]}`);
    } else if (subCmd === "whitelist") {
      const userIds = args.slice(2).map((id) => Number(id)).filter((n) => Number.isInteger(n));
      if (userIds.length === 0) {
        printError("请提供至少一个用户ID / Please provide at least one user ID");
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
        printError("房间不存在或未启用比赛模式 / Room not found or contest mode not enabled");
        return;
      }
      printSuccess(`已更新房间 ${args[0]} 的白名单 / Updated whitelist for room ${args[0]}`);
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
        printError(`无法开始比赛 / Cannot start contest: ${result.error}`);
        return;
      }

      const room = result.room;
      const users = room.userIds();
      const monitors = room.monitorIds();
      const sep = ctx.state.serverLang.lang === "zh-CN" ? "、" : ", ";
      const usersText = users.join(sep);
      const monitorsText = monitors.join(sep);
      const monitorsSuffix = monitors.length > 0 ? tl(ctx.state.serverLang, "log-room-game-start-monitors", { monitors: monitorsText }) : "";
      ctx.logger.info(tl(ctx.state.serverLang, "log-room-game-start", { room: room.id, users: usersText, monitorsSuffix }));
      await room.send((c) => ctx.broadcastRoomAll(room.id, c), { type: "StartPlaying" });
      room.resetGameTime((id) => ctx.state.users.get(id));
      if (ctx.state.replayEnabled && room.replayEligible) await ctx.state.replayRecorder.startRoom(room.id, room.chart!.id, room.userIds());
      room.state = { type: "Playing", results: new Map(), aborted: new Set() };
      await room.onStateChange((c) => ctx.broadcastRoomAll(room.id, c));

      printSuccess(`已开始房间 ${args[0]} 的比赛 / Started contest for room ${args[0]}`);
    } else {
      printError("未知子命令 / Unknown subcommand. Use: enable, disable, whitelist, start");
    }
  };

  const handleIpBlacklist = async (args: string[]) => {
    if (args.length === 0) {
      printError("用法 / Usage: ipblacklist <list|remove|clear>");
      return;
    }

    const subCmd = args[0]?.toLowerCase();

    if (subCmd === "list") {
      const blacklist = ctx.logger.getBlacklistedIps();
      if (blacklist.length === 0) {
        printInfo("IP黑名单为空 / IP blacklist is empty");
        return;
      }

      print(`\nIP黑名单 / IP Blacklist (${blacklist.length}):`);
      for (const item of blacklist) {
        const expiresInMin = Math.ceil(item.expiresIn / 60000);
        print(`  ${item.ip} (过期/expires in ${expiresInMin} 分钟/minutes)`);
      }
      print("");
    } else if (subCmd === "remove") {
      if (args.length < 2) {
        printError("用法 / Usage: ipblacklist remove <ip>");
        return;
      }

      const ip = args[1]!;
      ctx.logger.removeFromBlacklist(ip);
      printSuccess(`已从黑名单移除 / Removed from blacklist: ${ip}`);
    } else if (subCmd === "clear") {
      ctx.logger.clearBlacklist();
      printSuccess("已清空IP黑名单 / Cleared IP blacklist");
    } else {
      printError("未知子命令 / Unknown subcommand. Use: list, remove, clear");
    }
  };

  return () => {
    rl.close();
  };
}
