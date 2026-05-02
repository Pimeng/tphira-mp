// 日志记录辅助函数

import type { FluentVariable } from "@fluent/bundle";
import type { RoomId } from "../../common/roomId.js";
import type { Logger, LogContext, LogLevel } from "../utils/logger.js";
import type { Language } from "../utils/l10n.js";
import { tl } from "../utils/l10n.js";

// 导出通用终端日志函数（已迁移到 common）
export { debugLog, infoLog, warnLog, errorLog } from "../../common/console.js";

export type LogParams = Record<string, FluentVariable>;
export type RoomLogContext = Omit<LogContext, "roomId">;

function roomLogContext(roomId: RoomId | string, context?: RoomLogContext): LogContext {
  return { ...context, roomId: String(roomId) };
}

export function logLocalized(
  logger: Logger,
  level: LogLevel,
  lang: Language,
  key: string,
  params?: LogParams,
  context?: LogContext
): void {
  logger.log(level, tl(lang, key, params ?? {}), undefined, context);
}

export function logRoom(
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

/**
 * 记录房间相关操作
 * @param logger 日志记录器
 * @param lang 语言
 * @param key 本地化键
 * @param params 本地化参数
 * @param context 日志上下文
 */
export function logRoomAction(
  logger: Logger,
  lang: Language,
  roomId: RoomId | string,
  key: string,
  params?: LogParams,
  context?: RoomLogContext
): void {
  logRoomMark(logger, lang, roomId, key, params, context);
}

/**
 * 记录用户相关操作
 * @param logger 日志记录器
 * @param lang 语言
 * @param key 本地化键
 * @param params 本地化参数
 * @param userId 用户 ID
 * @param context 额外的日志上下文
 */
export function logUserAction(
  logger: Logger,
  lang: Language,
  key: string,
  params: LogParams,
  userId: number,
  context?: Omit<LogContext, "userId">
): void {
  logLocalized(logger, "MARK", lang, key, params, { ...context, userId });
}

/**
 * 记录信息级别日志
 * @param logger 日志记录器
 * @param lang 语言
 * @param key 本地化键
 * @param params 本地化参数
 */
export function logInfo(
  logger: Logger,
  lang: Language,
  key: string,
  params?: LogParams,
  context?: LogContext
): void {
  logLocalized(logger, "INFO", lang, key, params, context);
}

/**
 * 记录警告级别日志
 * @param logger 日志记录器
 * @param lang 语言
 * @param key 本地化键
 * @param params 本地化参数
 */
export function logWarning(
  logger: Logger,
  lang: Language,
  key: string,
  params?: LogParams,
  context?: LogContext
): void {
  logLocalized(logger, "WARN", lang, key, params, context);
}

/**
 * 记录错误级别日志
 * @param logger 日志记录器
 * @param lang 语言
 * @param key 本地化键
 * @param params 本地化参数
 */
export function logError(
  logger: Logger,
  lang: Language,
  key: string,
  params?: LogParams,
  context?: LogContext
): void {
  logLocalized(logger, "ERROR", lang, key, params, context);
}
