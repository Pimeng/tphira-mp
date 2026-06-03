// 日志记录辅助函数

import type { FluentVariable } from "@fluent/bundle";
import type { RoomId } from "../../common/roomId.js";
import type { Logger, LogContext, LogLevel } from "../utils/logger.js";
import type { Language } from "../utils/l10n.js";
import { tl } from "../utils/l10n.js";

export type LogParams = Record<string, FluentVariable>;
export type RoomLogContext = Omit<LogContext, "roomId">;

function roomLogContext(roomId: RoomId | string, context?: RoomLogContext): LogContext {
  return { ...context, roomId: String(roomId) };
}

function logLocalized(
  logger: Logger,
  level: LogLevel,
  lang: Language,
  key: string,
  params?: LogParams,
  context?: LogContext
): void {
  logger.log(level, tl(lang, key, params ?? {}), undefined, context);
}

function logRoom(
  logger: Logger,
  level: LogLevel,
  lang: Language,
  roomId: RoomId | string,
  key: string,
  params?: LogParams,
  context?: RoomLogContext
): void {
  logLocalized(logger, level, lang, key, { ...(params ?? {}), room: String(roomId) }, roomLogContext(roomId, context));
}

export function logRoomInfo(
  logger: Logger,
  lang: Language,
  roomId: RoomId | string,
  key: string,
  params?: LogParams,
  context?: RoomLogContext
): void {
  logRoom(logger, "INFO", lang, roomId, key, params, context);
}

export function logRoomMark(
  logger: Logger,
  lang: Language,
  roomId: RoomId | string,
  key: string,
  params?: LogParams,
  context?: RoomLogContext
): void {
  logRoom(logger, "MARK", lang, roomId, key, params, context);
}

export function logRoomWarn(
  logger: Logger,
  lang: Language,
  roomId: RoomId | string,
  key: string,
  params?: LogParams,
  context?: RoomLogContext
): void {
  logRoom(logger, "WARN", lang, roomId, key, params, context);
}
