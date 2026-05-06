import type { FluentVariable } from "@fluent/bundle";
import type { ServerState } from "../../core/state.js";
import type { Logger } from "../../utils/logger.js";
import type { ServerCommand } from "../../../common/commands.js";
import type { RoomId } from "../../../common/roomId.js";
import type { Language } from "../../utils/l10n.js";
import type { Printer } from "../cliHelpers.js";

/** CLI 命令处理器共享上下文 */
export type CommandCtx = {
  state: ServerState;
  logger: Logger;
  broadcastRoomAll: (roomId: RoomId, cmd: ServerCommand) => Promise<void>;
  pickRandomUserId: (ids: number[]) => number | null;
  printer: Printer;
  getLang: () => Language;
  t: (key: string, args?: Record<string, FluentVariable>) => string;
};
