import { validateChatMessage } from "../cliHelpers.js";
import type { CommandCtx } from "./types.js";

export async function handleBroadcast(ctx: CommandCtx, args: string[]): Promise<void> {
  const { state, logger, broadcastRoomAll, getLang, t, printer: { printError, printSuccess } } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-broadcast"));
    return;
  }

  const message = validateChatMessage(args.join(" "), getLang(), printError);
  if (message === null) return;

  const snapshot = await state.mutex.runExclusive(async () => {
    return [...state.rooms.keys()];
  });

  const tasks: Promise<void>[] = [];
  for (const roomId of snapshot) {
    tasks.push(broadcastRoomAll(roomId, { type: "Message", message: { type: "Chat", user: 0, content: message } }));
  }
  await Promise.allSettled(tasks);

  logger.info(t("log-admin-broadcast", { message, rooms: String(snapshot.length) }));
  printSuccess(t("cli-broadcast-sent", { count: snapshot.length }));
}
