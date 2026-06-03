import { parseRoomIdArg, parseUserIdArg } from "../cliHelpers.js";
import type { CommandCtx } from "./types.js";

export async function handleBan(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    getLang,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-ban"));
    return;
  }

  const userId = parseUserIdArg(args[0], getLang(), printError);
  if (userId === null) return;

  await state.mutex.runExclusive(async () => {
    state.bannedUsers.add(userId);
  });

  await state.saveAdminData();
  printSuccess(t("cli-user-banned", { id: userId }));
}

export async function handleUnban(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    getLang,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-unban"));
    return;
  }

  const userId = parseUserIdArg(args[0], getLang(), printError);
  if (userId === null) return;

  await state.mutex.runExclusive(async () => {
    state.bannedUsers.delete(userId);
  });

  await state.saveAdminData();
  printSuccess(t("cli-user-unbanned", { id: userId }));
}

export async function handleBanList(ctx: CommandCtx): Promise<void> {
  const {
    state,
    t,
    printer: { print, printInfo }
  } = ctx;
  const banned = await state.mutex.runExclusive(async () => {
    return [...state.bannedUsers];
  });

  if (banned.length === 0) {
    printInfo(t("cli-no-banned-users"));
    return;
  }

  print("");
  print(t("cli-banned-list-header", { count: banned.length }));
  for (const id of banned) print(`  ${id}`);
  print("");
}

export async function handleBanRoom(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    getLang,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length < 2) {
    printError(t("cli-usage-banroom"));
    return;
  }

  const userId = parseUserIdArg(args[0], getLang(), printError);
  if (userId === null) return;

  const rid = parseRoomIdArg(args[1], getLang(), printError);
  if (!rid) return;

  await state.mutex.runExclusive(async () => {
    const set = state.bannedRoomUsers.get(rid) ?? new Set<number>();
    set.add(userId);
    state.bannedRoomUsers.set(rid, set);
  });

  await state.saveAdminData();
  printSuccess(t("cli-room-user-banned", { userId, room: args[1]! }));
}

export async function handleUnbanRoom(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    getLang,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length < 2) {
    printError(t("cli-usage-unbanroom"));
    return;
  }

  const userId = parseUserIdArg(args[0], getLang(), printError);
  if (userId === null) return;

  const rid = parseRoomIdArg(args[1], getLang(), printError);
  if (!rid) return;

  await state.mutex.runExclusive(async () => {
    const set = state.bannedRoomUsers.get(rid);
    if (set) {
      set.delete(userId);
      if (set.size === 0) state.bannedRoomUsers.delete(rid);
    }
  });

  await state.saveAdminData();
  printSuccess(t("cli-room-user-unbanned", { userId, room: args[1]! }));
}
