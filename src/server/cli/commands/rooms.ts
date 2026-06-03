import { roomIdToString } from "../../../common/roomId.js";
import { logRoomInfo } from "../../utils/logUtils.js";
import { parseBoundedIntArg, parseRoomIdArg, validateChatMessage } from "../cliHelpers.js";
import type { CommandCtx } from "./types.js";

function stateLabel(ctx: CommandCtx, type: string): string {
  if (type === "Playing") return ctx.t("cli-room-state-playing");
  if (type === "WaitForReady") return ctx.t("cli-room-state-waiting");
  return ctx.t("cli-room-state-select");
}

export async function handleListRooms(ctx: CommandCtx): Promise<void> {
  const {
    state,
    t,
    printer: { print, printInfo }
  } = ctx;
  const rooms = await state.mutex.runExclusive(async () => {
    return [...state.rooms.entries()].map(([rid, room]) => ({
      roomid: roomIdToString(rid),
      state: stateLabel(ctx, room.state.type),
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
    print(
      t("cli-room-line", {
        id: r.roomid,
        state: r.state,
        users: r.users,
        maxUsers: r.maxUsers,
        monitors: r.monitors,
        chart: r.chart,
        locked: r.locked,
        cycle: r.cycle,
        contest: r.contest
      })
    );
  }
  print("");
}

export async function handleMaxUsers(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    getLang,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length < 2) {
    printError(t("cli-usage-maxusers"));
    return;
  }

  const rid = parseRoomIdArg(args[0], getLang(), printError);
  if (!rid) return;

  const maxUsers = parseBoundedIntArg(args[1], 1, 64, "cli-bad-max-users", getLang(), printError);
  if (maxUsers === null) return;

  const updated = await state.mutex.runExclusive(async () => {
    const room = state.rooms.get(rid);
    if (!room) return null;
    room.maxUsers = maxUsers;
    return roomIdToString(room.id);
  });

  if (!updated) {
    printError(t("cli-room-not-found"));
    return;
  }

  printSuccess(t("cli-room-max-users-set", { room: updated, count: maxUsers }));
}

export async function handleDisband(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    logger,
    getLang,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-disband"));
    return;
  }

  const rid = parseRoomIdArg(args[0], getLang(), printError);
  if (!rid) return;

  const room = await state.mutex.runExclusive(async () => state.rooms.get(rid) ?? null);
  if (!room) {
    printError(t("cli-room-not-found"));
    return;
  }

  const allIds = room.allParticipantIds();
  const tasks: Promise<void>[] = [];
  for (const id of allIds) {
    const u = state.users.get(id);
    if (u)
      tasks.push(
        u.trySend({ type: "Message", message: { type: "Chat", user: 0, content: t("room-disbanded-by-admin") } })
      );
  }
  await Promise.allSettled(tasks);

  await state.mutex.runExclusive(async () => {
    state.rooms.delete(rid);
  });

  if (state.replayEnabled && room.replayEligible) {
    await state.replayRecorder.endRoom(rid);
  }

  logRoomInfo(logger, getLang(), rid, "log-room-disbanded-by-admin");
  printSuccess(t("cli-room-disbanded", { room: args[0]! }));
}

export async function handleRoomSay(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    logger,
    broadcastRoomAll,
    getLang,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length < 2) {
    printError(t("cli-usage-roomsay"));
    return;
  }

  const rid = parseRoomIdArg(args[0], getLang(), printError);
  if (!rid) return;

  const message = validateChatMessage(args.slice(1).join(" "), getLang(), printError);
  if (message === null) return;

  const roomExists = await state.mutex.runExclusive(async () => state.rooms.has(rid));
  if (!roomExists) {
    printError(t("cli-room-not-found-named", { room: args[0]! }));
    return;
  }

  await broadcastRoomAll(rid, { type: "Message", message: { type: "Chat", user: 0, content: message } });
  logRoomInfo(logger, getLang(), rid, "log-admin-room-message", { message });
  printSuccess(t("cli-room-message-sent", { room: args[0]! }));
}
