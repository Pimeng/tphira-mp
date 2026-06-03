import { refreshRoomLive } from "../../game/roomUtils.js";
import { parseToggleArg } from "../cliHelpers.js";
import type { CommandCtx } from "./types.js";

export async function handleReplay(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    t,
    printer: { printError, printInfo, printSuccess }
  } = ctx;
  const toggle = parseToggleArg(args[0]);
  if (toggle === null) {
    printError(t("cli-usage-replay"));
    return;
  }
  if (toggle === "status") {
    printInfo(t("cli-replay-status", { state: state.replayEnabled ? t("cli-state-on") : t("cli-state-off") }));
    return;
  }

  const enabled = toggle === "on";
  const snapshot = await state.mutex.runExclusive(async () => {
    state.replayEnabled = enabled;
    const roomIds = enabled ? [] : [...state.rooms.keys()];
    for (const room of state.rooms.values()) refreshRoomLive(room, enabled);
    return { enabled, roomIds };
  });

  if (!snapshot.enabled) {
    const tasks = snapshot.roomIds.map((rid) => state.replayRecorder.endRoom(rid));
    await Promise.allSettled(tasks);
  }

  printSuccess(enabled ? t("cli-replay-toggled-on") : t("cli-replay-toggled-off"));
}

export async function handleRoomCreation(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    t,
    printer: { printError, printInfo, printSuccess }
  } = ctx;
  const toggle = parseToggleArg(args[0]);
  if (toggle === null) {
    printError(t("cli-usage-roomcreation"));
    return;
  }
  if (toggle === "status") {
    printInfo(
      t("cli-room-creation-status", { state: state.roomCreationEnabled ? t("cli-state-on") : t("cli-state-off") })
    );
    return;
  }

  const enabled = toggle === "on";
  await state.mutex.runExclusive(async () => {
    state.roomCreationEnabled = enabled;
  });

  printSuccess(enabled ? t("cli-room-creation-toggled-on") : t("cli-room-creation-toggled-off"));
}
