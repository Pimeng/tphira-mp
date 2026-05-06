/**
 * 运行时类型验证和守卫工具
 * 用于替代不安全的 `as` 类型断言，提供运行时类型安全检查
 */

import { parseRoomId, type RoomId } from "./roomId.js";

/** 验证结果类型 */
export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string };

// ========== 基础类型守卫 ==========

/** 验证值是否为非空对象 */
export function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 验证值是否为字符串 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** 验证值是否为非空字符串 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 验证值是否为整数 */
export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** 验证值是否为正整数 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 验证值是否为布尔值 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** 验证值是否为数组 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** 验证值是否为指定类型的数组 */
export function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

// ========== 安全属性访问 ==========

/** 安全地获取对象的字符串属性 */
export function getString(obj: unknown, key: string): string | undefined {
  if (!isNonNullObject(obj)) return undefined;
  const value = obj[key];
  return isString(value) ? value : undefined;
}

/** 安全地获取对象的整数属性 */
export function getInteger(obj: unknown, key: string): number | undefined {
  if (!isNonNullObject(obj)) return undefined;
  const value = obj[key];
  return isInteger(value) ? value : undefined;
}

/** 安全地获取对象的布尔属性 */
export function getBoolean(obj: unknown, key: string): boolean | undefined {
  if (!isNonNullObject(obj)) return undefined;
  const value = obj[key];
  return isBoolean(value) ? value : undefined;
}

/** 验证对象是否包含必需的字段 */
export function hasRequiredFields(
  obj: unknown,
  fields: Record<string, (value: unknown) => boolean>
): boolean {
  if (!isNonNullObject(obj)) return false;
  for (const [key, validator] of Object.entries(fields)) {
    if (!(key in obj) || !validator(obj[key])) {
      return false;
    }
  }
  return true;
}

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
