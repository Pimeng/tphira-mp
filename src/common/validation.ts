/**
 * 运行时类型验证和守卫工具
 * 用于替代不安全的 `as` 类型断言，提供运行时类型安全检查
 */

import { parseRoomId, type RoomId } from "./roomId.js";

/** 验证结果类型 */
export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string };

// ========== 兼容 API（用于测试） ==========

/** 安全解析整数，无效时返回默认值 */
export function safeParseInt(value: unknown, defaultValue = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return defaultValue;
}

/** 验证是否为有效整数 */
export function isValidInteger(value: unknown, min?: number, max?: number): boolean {
  const num = safeParseInt(value, NaN);
  if (Number.isNaN(num)) return false;
  if (min !== undefined && num < min) return false;
  if (max !== undefined && num > max) return false;
  return true;
}

/** 验证是否为有效非空字符串 */
export function isValidString(value: unknown, maxLength?: number): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (maxLength !== undefined && trimmed.length > maxLength) return false;
  return true;
}

/** 验证会话 Token */
export function validateSessionToken(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") return { valid: false, error: "bad-token" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { valid: false, error: "bad-token" };
  return { valid: true, value: trimmed };
}

/** 验证谱面 ID */
export function validateChartId(value: unknown): ValidationResult<number> {
  const num: unknown = typeof value === "string" ? Number(value) : value;
  if (!isValidInteger(num) || (num as number) < 0) return { valid: false, error: "bad-chart-id" };
  return { valid: true, value: num as number };
}

/** 验证时间戳 */
export function validateTimestamp(value: unknown): ValidationResult<number> {
  const num: unknown = typeof value === "string" ? Number(value) : value;
  if (!isValidInteger(num) || (num as number) <= 0) return { valid: false, error: "bad-timestamp" };
  return { valid: true, value: num as number };
}

/** 验证用户 ID */
export function validateUserId(value: unknown): ValidationResult<number> {
  const num: unknown = typeof value === "string" ? Number(value) : value;
  if (!isValidInteger(num)) return { valid: false, error: "bad-user-id" };
  return { valid: true, value: num as number };
}

/** 验证房间 ID */
export function validateRoomId(value: unknown): ValidationResult<RoomId> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { valid: false, error: "bad-room-id" };
  }
  try {
    const roomId = parseRoomId(value.trim());
    return { valid: true, value: roomId };
  } catch {
    return { valid: false, error: "bad-room-id" };
  }
}

/** 验证消息 */
export function validateMessage(value: unknown, maxLength = 200): ValidationResult<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { valid: false, error: "bad-message" };
  }
  if (value.length > maxLength) return { valid: false, error: "message-too-long" };
  return { valid: true, value: value.trim() };
}

/** 验证最大用户数 */
export function validateMaxUsers(value: unknown): ValidationResult<number> {
  const num: unknown = typeof value === "string" ? Number(value) : value;
  if (!isValidInteger(num, 1, 64)) return { valid: false, error: "bad-max-users" };
  return { valid: true, value: num as number };
}

/** 验证用户 ID 数组 */
export function validateUserIdArray(value: unknown): ValidationResult<number[]> {
  if (!Array.isArray(value)) return { valid: false, error: "bad-user-ids" };
  const ids = value
    .map((it) => (typeof it === "string" ? Number(it) : it))
    .filter((it) => isValidInteger(it));
  if (ids.length === 0) return { valid: false, error: "bad-user-ids" };
  return { valid: true, value: ids as number[] };
}

/** 验证 IP 地址 */
export function validateIp(value: unknown): ValidationResult<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { valid: false, error: "bad-ip" };
  }
  return { valid: true, value: value.trim() };
}

/** 组合多个验证结果 */
export function validateAll(...results: ValidationResult<unknown>[]): ValidationResult<unknown> {
  for (const result of results) {
    if (!result.valid) return result;
  }
  return results[0] ?? { valid: true, value: undefined };
}
