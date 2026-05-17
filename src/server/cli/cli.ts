import * as readline from "node:readline";
import type { FluentVariable } from "@fluent/bundle";
import type { ServerState } from "../core/state.js";
import type { Logger } from "../utils/logger.js";

import type { ServerCommand } from "../../common/commands.js";
import { tl } from "../utils/l10n.js";
import { makePrinter } from "./cliHelpers.js";
import type { CommandCtx } from "./commands/types.js";
import type { RoomId } from "../../common/roomId.js";
import {
  handleDisband,
  handleListRooms,
  handleMaxUsers,
  handleRoomSay
} from "./commands/rooms.js";
import { handleKick, handleListUsers, handleUserInfo } from "./commands/users.js";
import {
  handleBan,
  handleBanList,
  handleBanRoom,
  handleUnban,
  handleUnbanRoom
} from "./commands/bans.js";
import { handleBroadcast } from "./commands/broadcast.js";
import { handleReplay, handleRoomCreation } from "./commands/toggles.js";
import { handleContest } from "./commands/contest.js";
import { handleIpBlacklist } from "./commands/ipBlacklist.js";
import { handleApprove, handleDeny, handlePending } from "./commands/approval.js";

type CliContext = {
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

  const printer = makePrinter();
  const { print, printError, printInfo } = printer;
  // 每次调用都从 ctx.state 取最新的 serverLang——配置 reload 时它会被替换。
  const getLang = () => ctx.state.serverLang;
  const t = (key: string, args?: Record<string, FluentVariable>): string => tl(getLang(), key, args);

  const cmdCtx: CommandCtx = {
    state: ctx.state,
    logger: ctx.logger,
    broadcastRoomAll: ctx.broadcastRoomAll,
    pickRandomUserId: ctx.pickRandomUserId,
    printer,
    getLang,
    t
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
          print(t("cli-help"));
          break;
        case "list":
        case "rooms":
          await handleListRooms(cmdCtx);
          break;
        case "users":
          await handleListUsers(cmdCtx);
          break;
        case "user":
          await handleUserInfo(cmdCtx, args);
          break;
        case "kick":
          await handleKick(cmdCtx, args);
          break;
        case "ban":
          await handleBan(cmdCtx, args);
          break;
        case "unban":
          await handleUnban(cmdCtx, args);
          break;
        case "banlist":
          await handleBanList(cmdCtx);
          break;
        case "banroom":
          await handleBanRoom(cmdCtx, args);
          break;
        case "unbanroom":
          await handleUnbanRoom(cmdCtx, args);
          break;
        case "broadcast":
        case "say":
          await handleBroadcast(cmdCtx, args);
          break;
        case "roomsay":
          await handleRoomSay(cmdCtx, args);
          break;
        case "maxusers":
          await handleMaxUsers(cmdCtx, args);
          break;
        case "disband":
          await handleDisband(cmdCtx, args);
          break;
        case "replay":
          await handleReplay(cmdCtx, args);
          break;
        case "roomcreation":
          await handleRoomCreation(cmdCtx, args);
          break;
        case "contest":
          await handleContest(cmdCtx, args);
          break;
        case "ipblacklist":
          await handleIpBlacklist(cmdCtx, args);
          break;
        case "approve":
          await handleApprove(cmdCtx, args);
          break;
        case "deny":
        case "reject":
          await handleDeny(cmdCtx, args);
          break;
        case "pending":
          await handlePending(cmdCtx);
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

  return () => {
    rl.close();
  };
}
