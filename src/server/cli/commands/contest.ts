import { logRoomInfo } from "../../utils/logUtils.js";
import { parseRoomIdArg } from "../cliHelpers.js";
import type { CommandCtx } from "./types.js";

export async function handleContest(ctx: CommandCtx, args: string[]): Promise<void> {
  const { state, logger, broadcastRoomAll, getLang, t, printer: { printError, printSuccess } } = ctx;
  if (args.length < 2) {
    printError(t("cli-usage-contest"));
    return;
  }

  const rid = parseRoomIdArg(args[0], getLang(), printError);
  if (!rid) return;

  const subCmd = args[1]?.toLowerCase();

  if (subCmd === "enable") {
    const userIds = args.slice(2).map((id) => Number(id)).filter((n) => Number.isInteger(n));
    const ok = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(rid);
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
    return;
  }

  if (subCmd === "disable") {
    const ok = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(rid);
      if (!room) return false;
      room.contest = null;
      return true;
    });

    if (!ok) {
      printError(t("cli-room-not-found"));
      return;
    }
    printSuccess(t("cli-contest-disabled", { room: args[0]! }));
    return;
  }

  if (subCmd === "whitelist") {
    const userIds = args.slice(2).map((id) => Number(id)).filter((n) => Number.isInteger(n));
    if (userIds.length === 0) {
      printError(t("cli-contest-no-user-id"));
      return;
    }

    const ok = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(rid);
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
    return;
  }

  if (subCmd === "start") {
    const force = args[2] === "force";

    const result = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(rid);
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
    logRoomInfo(logger, getLang(), room.id, "log-room-game-start", { users: usersText, monitorsSuffix });
    await room.send((c) => broadcastRoomAll(room.id, c), { type: "StartPlaying" }, (id) => state.users.get(id));
    room.resetGameTime((id) => state.users.get(id));
    if (state.replayEnabled && room.replayEligible) {
      const replayUsers = room.userIds().map((id) => ({ id, name: state.users.get(id)?.name ?? String(id) }));
      await state.replayRecorder.startRoom(room.id, room.chart!, replayUsers);
    }
    room.state = { type: "Playing", results: new Map(), aborted: new Set() };
    await room.onStateChange((c) => broadcastRoomAll(room.id, c));

    printSuccess(t("cli-contest-started", { room: args[0]! }));
    return;
  }

  printError(t("cli-contest-unknown-subcommand"));
}
