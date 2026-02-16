// 日志记录辅助函数

import type { Logger } from "../utils/logger.js";
import type { Language } from "../utils/l10n.js";
import { tl } from "../utils/l10n.js";

// 导出通用终端日志函数（已迁移到 common）
export { debugLog, infoLog, warnLog, errorLog } from "../../common/console.js";

/**
 * 日志上下文信息
 */
export interface LogContext {
  userId?: number;
  roomId?: string;
  [key: string]: any;
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
  key: string,
  params: Record<string, string | number>,
  context?: LogContext
): void {
  logger.log("MARK", tl(lang, key, params), undefined, context);
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
  params: Record<string, string | number>,
  userId: number,
  context?: Omit<LogContext, "userId">
): void {
  logger.log("MARK", tl(lang, key, params), undefined, { ...context, userId });
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
  params?: Record<string, string | number>
): void {
  logger.info(tl(lang, key, params || {}));
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
  params?: Record<string, string | number>
): void {
  logger.warn(tl(lang, key, params || {}));
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
  params?: Record<string, string | number>
): void {
  logger.error(tl(lang, key, params || {}));
}