/**
 * 服务器生命周期管理命令：维护模式开关与优雅关停。
 *
 * - maintenance on|off|status [message]：进入/退出维护模式（暂停新玩家加入，让当前对局收尾），
 *   并向所有房间广播通知。
 * - stop / shutdown：关停前先向所有房间广播通知，再触发优雅关闭，避免玩家无预警掉线。
 */
import { parseToggleArg, validateChatMessage } from "../cliHelpers.js";
import type { CommandCtx } from "./types.js";
import type { RoomId } from "../../../common/roomId.js";

/** 向所有房间广播一条系统聊天（user=0）。 */
async function broadcastAllRooms(
  ctx: CommandCtx,
  roomIds: RoomId[],
  content: string
): Promise<void> {
  await Promise.allSettled(
    roomIds.map((rid) =>
      ctx.broadcastRoomAll(rid, { type: "Message", message: { type: "Chat", user: 0, content } })
    )
  );
}

export async function handleMaintenance(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    logger,
    t,
    printer: { printError, printInfo, printSuccess }
  } = ctx;

  const toggle = parseToggleArg(args[0]);
  if (toggle === null) {
    printError(t("cli-usage-maintenance"));
    return;
  }
  if (toggle === "status") {
    printInfo(t("cli-maintenance-status", { state: state.maintenance ? t("cli-state-on") : t("cli-state-off") }));
    return;
  }

  const enabled = toggle === "on";
  // on 时其余参数作为自定义提示消息（可选）；复用聊天校验做长度/空白处理
  let customMessage: string | null = null;
  if (enabled && args.length > 1) {
    const validated = validateChatMessage(args.slice(1).join(" "), ctx.getLang(), printError);
    if (validated === null) return; // 校验失败已打印错误
    customMessage = validated;
  }

  const roomIds = await state.mutex.runExclusive(async () => {
    state.maintenance = enabled;
    state.maintenanceMessage = enabled ? customMessage : null;
    return [...state.rooms.keys()];
  });

  // 通知：on 时优先用自定义提示，否则用默认文案；off 用恢复文案
  const notice = enabled ? (customMessage ?? t("chat-maintenance-enabled")) : t("chat-maintenance-disabled");
  await broadcastAllRooms(ctx, roomIds, notice);

  logger.mark(enabled ? t("chat-maintenance-enabled") : t("chat-maintenance-disabled"));
  printSuccess(enabled ? t("chat-maintenance-enabled") : t("chat-maintenance-disabled"));
}

export async function handleStop(
  ctx: CommandCtx,
  requestShutdown?: () => void
): Promise<void> {
  const {
    state,
    logger,
    t,
    printer: { printInfo }
  } = ctx;

  if (!requestShutdown) {
    printInfo(t("cli-stop-hint"));
    return;
  }

  // 关停前进入维护模式（拦住关停窗口内的新加入）并广播通知，让玩家有预警而非被静默断开。
  const roomIds = await state.mutex.runExclusive(async () => {
    state.maintenance = true;
    return [...state.rooms.keys()];
  });
  if (roomIds.length > 0) {
    await broadcastAllRooms(ctx, roomIds, t("chat-server-stopping"));
  }

  logger.mark(t("chat-server-stopping"));
  printInfo(t("cli-stopping"));
  requestShutdown();
}
