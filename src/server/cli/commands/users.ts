import { roomIdToString } from "../../../common/roomId.js";
import { abortPlayingUserAndCheckReady } from "../../network/httpHelpers.js";
import { parseUserIdArg } from "../cliHelpers.js";
import type { CommandCtx } from "./types.js";

export async function handleListUsers(ctx: CommandCtx): Promise<void> {
  const {
    state,
    t,
    printer: { print, printInfo }
  } = ctx;
  const users = await state.mutex.runExclusive(async () => {
    return [...state.users.values()].map((u) => ({
      id: u.id,
      name: u.name,
      room: u.room ? roomIdToString(u.room.id) : null,
      monitor: u.monitor,
      connected: Boolean(u.session),
      banned: state.bannedUsers.has(u.id)
    }));
  });

  if (users.length === 0) {
    printInfo(t("cli-no-users"));
    return;
  }

  print("");
  print(t("cli-users-total", { count: users.length }));
  for (const u of users) {
    print(
      t("cli-user-line", {
        id: u.id,
        name: u.name,
        status: u.connected ? t("cli-user-status-online") : t("cli-user-status-offline"),
        role: u.monitor ? t("cli-user-role-monitor") : t("cli-user-role-player"),
        room: u.room ?? t("cli-none"),
        bannedTag: u.banned ? t("cli-user-banned-tag") : ""
      })
    );
  }
  print("");
}

export async function handleUserInfo(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    getLang,
    t,
    printer: { print, printError }
  } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-user"));
    return;
  }
  const userId = parseUserIdArg(args[0], getLang(), printError);
  if (userId === null) return;

  const info = await state.mutex.runExclusive(async () => {
    const u = state.users.get(userId);
    if (!u) return null;
    return {
      id: u.id,
      name: u.name,
      room: u.room ? roomIdToString(u.room.id) : null,
      monitor: u.monitor,
      connected: Boolean(u.session),
      banned: state.bannedUsers.has(u.id),
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
  print(
    t("cli-user-info-status", { status: info.connected ? t("cli-user-status-online") : t("cli-user-status-offline") })
  );
  print(t("cli-user-info-role", { role: info.monitor ? t("cli-user-role-monitor") : t("cli-user-role-player") }));
  print(t("cli-user-info-room", { room: info.room ?? t("cli-none") }));
  print(t("cli-user-info-banned", { banned: info.banned ? t("cli-yes") : t("cli-no") }));
  print(t("cli-user-info-game-time", { time: info.gameTime }));
  print(t("cli-user-info-language", { lang: info.lang }));
  print("");
}

export async function handleKick(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    getLang,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-kick"));
    return;
  }

  const userId = parseUserIdArg(args[0], getLang(), printError);
  if (userId === null) return;

  const preserveRoom = args[1] === "true" || args[1] === "preserve";

  const session = await state.mutex.runExclusive(async () => state.users.get(userId)?.session ?? null);
  if (!session) {
    printError(t("cli-user-not-connected", { id: userId }));
    return;
  }

  const u = session.user;
  if (preserveRoom && u && u.room) {
    await abortPlayingUserAndCheckReady({
      state,
      user: u,
      room: u.room
    });
  }

  await session.adminDisconnect({ preserveRoom });
  printSuccess(t("cli-user-kicked", { id: userId }));
}
