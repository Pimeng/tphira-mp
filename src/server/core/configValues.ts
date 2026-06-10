import type { ServerConfig } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBoolValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return undefined;
}

export function parseStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseOutboundProxyValue(value: unknown): string | false | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === false) return false;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "false") return false;
  return trimmed;
}

export function parsePortValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v <= 0 || v > 65535) return undefined;
  return v;
}

export function parseRoomMaxUsersValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1) return undefined;
  return Math.min(v, 64);
}

function parseReplayTtlDaysValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1) return undefined;
  return Math.min(v, 3650);
}

/** 解析正整数（>=1）；用于全服房间数 / 连接数上限等。非法值返回 undefined（视为不限制） */
function parsePositiveIntValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1) return undefined;
  return v;
}

/** 解析非负整数（>=0）；0 通常表示“关闭/不限制”，如日志压缩天数、日志容量上限。非法值返回 undefined */
function parseNonNegativeIntValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v < 0) return undefined;
  return v;
}

function parseStringListValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = value.filter((it): it is string => typeof it === "string" && it.trim().length > 0);
    return out.length > 0 ? out : undefined;
  }
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    const items = value
      .split(/[,\s;]+/g)
      .map((it) => it.trim())
      .filter((it) => it.length > 0);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

export function parseIntegerListValue(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const out = value.map((it) => Number(it)).filter((it) => Number.isInteger(it));
    return out.length > 0 ? out : undefined;
  }
  if (typeof value === "string") {
    if (!value) return undefined;
    const ids = value
      .split(/[,\s;，]+/g)
      .map((it) => Number(it.trim()))
      .filter((it) => Number.isInteger(it));
    return ids.length > 0 ? ids : undefined;
  }
  if (typeof value === "number" && Number.isInteger(value)) return [value];
  return undefined;
}

export function parseShareStationValue(value: unknown): ServerConfig["share_station"] {
  if (!isRecord(value)) return undefined;
  const url = parseStringValue(value.URL);
  const token = parseStringValue(value.TOKEN);
  return url && token ? { url, token } : undefined;
}

function parseRedisValue(value: unknown): ServerConfig["redis"] {
  if (!isRecord(value)) return undefined;
  const enabled = parseBoolValue(value.ENABLED);
  if (enabled === undefined) return undefined;
  const host = parseStringValue(value.HOST) ?? "127.0.0.1";
  const port = parsePortValue(value.PORT) ?? 6379;
  const password = parseStringValue(value.PASSWORD);
  const dbRaw = value.DB;
  let db = 0;
  if (dbRaw !== undefined && dbRaw !== null && dbRaw !== "") {
    const dbNum = Number(dbRaw);
    if (!Number.isInteger(dbNum) || dbNum < 0) return undefined;
    db = dbNum;
  }
  return { enabled, host, port, password, db };
}

/**
 * 配置字段的元数据。每条记录定义一个配置项的所有信息，
 * 让加载/合并/对比/分类等操作都能从这一张表派生。
 */
type ConfigField<K extends keyof ServerConfig = keyof ServerConfig> = {
  key: K;
  /** ENV 变量名，同时也是 yaml 文件中（全大写）的键名 */
  envName: string;
  /** 解析任意输入为目标类型；不合法时返回 undefined */
  parse: (value: unknown) => ServerConfig[K] | undefined;
  /** 该项变更需要重启服务才能生效 */
  startupOnly?: boolean;
  /** 自定义从环境变量读取的方式（用于 SHARE_STATION 这种由多个 ENV 合成、或 LANG 这种带兜底名的字段） */
  envInput?: () => unknown;
};

function field<K extends keyof ServerConfig>(f: ConfigField<K>): ConfigField {
  return f as ConfigField;
}

const CONFIG_FIELDS: ReadonlyArray<ConfigField> = [
  field({ key: "monitors", envName: "MONITORS", parse: parseIntegerListValue }),
  field({ key: "test_account_ids", envName: "TEST_ACCOUNT_IDS", parse: parseIntegerListValue }),
  field({ key: "server_name", envName: "SERVER_NAME", parse: parseStringValue }),
  field({ key: "host", envName: "HOST", parse: parseStringValue, startupOnly: true }),
  field({ key: "port", envName: "PORT", parse: parsePortValue, startupOnly: true }),
  field({ key: "http_service", envName: "HTTP_SERVICE", parse: parseBoolValue, startupOnly: true }),
  field({ key: "http_port", envName: "HTTP_PORT", parse: parsePortValue, startupOnly: true }),
  field({ key: "gui", envName: "GUI", parse: parseBoolValue, startupOnly: true }),
  field({ key: "room_max_users", envName: "ROOM_MAX_USERS", parse: parseRoomMaxUsersValue }),
  field({ key: "max_rooms", envName: "MAX_ROOMS", parse: parsePositiveIntValue }),
  field({ key: "max_connections", envName: "MAX_CONNECTIONS", parse: parsePositiveIntValue }),
  field({ key: "http_rate_limit_max_requests", envName: "HTTP_RATE_LIMIT_MAX_REQUESTS", parse: parsePositiveIntValue }),
  field({ key: "http_rate_limit_window_ms", envName: "HTTP_RATE_LIMIT_WINDOW_MS", parse: parsePositiveIntValue }),
  field({ key: "chat_enabled", envName: "CHAT_ENABLED", parse: parseBoolValue }),
  field({ key: "replay_enabled", envName: "REPLAY_ENABLED", parse: parseBoolValue }),
  field({ key: "replay_base_dir", envName: "REPLAY_BASE_DIR", parse: parseStringValue }),
  field({ key: "replay_ttl_days", envName: "REPLAY_TTL_DAYS", parse: parseReplayTtlDaysValue }),
  field({ key: "replay_auto_upload", envName: "REPLAY_AUTO_UPLOAD", parse: parseBoolValue }),
  field({ key: "admin_token", envName: "ADMIN_TOKEN", parse: parseStringValue }),
  field({ key: "admin_data_path", envName: "ADMIN_DATA_PATH", parse: parseStringValue, startupOnly: true }),
  field({ key: "room_list_tip", envName: "ROOM_LIST_TIP", parse: parseStringValue }),
  field({ key: "log_level", envName: "LOG_LEVEL", parse: parseStringValue }),
  field({ key: "log_compress_after_days", envName: "LOG_COMPRESS_AFTER_DAYS", parse: parseNonNegativeIntValue }),
  field({ key: "log_max_total_mb", envName: "LOG_MAX_TOTAL_MB", parse: parseNonNegativeIntValue }),
  field({ key: "real_ip_header", envName: "REAL_IP_HEADER", parse: parseStringValue }),
  field({ key: "cors_origins", envName: "CORS_ORIGINS", parse: parseStringListValue }),
  field({ key: "haproxy_protocol", envName: "HAPROXY_PROTOCOL", parse: parseBoolValue }),
  field({
    key: "lang",
    envName: "LANG",
    parse: parseStringValue,
    // PHIRA_MP_LANG 优先，避免被系统 LANG（如 en_US.UTF-8）误读；
    // 用 || 而非 ?? —— 显式 PHIRA_MP_LANG="" 视同未设置，回退到 LANG。
    envInput: () => process.env.PHIRA_MP_LANG || process.env.LANG
  }),
  field({ key: "phira_api_endpoint", envName: "PHIRA_API_ENDPOINT", parse: parseStringValue }),
  field({ key: "outbound_proxy", envName: "OUTBOUND_PROXY", parse: parseOutboundProxyValue }),
  field({
    key: "share_station",
    envName: "SHARE_STATION",
    parse: parseShareStationValue,
    envInput: () => ({ URL: process.env.SHARE_STATION_URL, TOKEN: process.env.SHARE_STATION_TOKEN })
  }),
  field({
    key: "redis",
    envName: "REDIS",
    parse: parseRedisValue,
    startupOnly: true,
    envInput: () => ({
      ENABLED: process.env.REDIS_ENABLED,
      HOST: process.env.REDIS_HOST,
      PORT: process.env.REDIS_PORT,
      PASSWORD: process.env.REDIS_PASSWORD,
      DB: process.env.REDIS_DB
    })
  }),
  field({ key: "hitokoto_api_url", envName: "HITOKOTO_API_URL", parse: parseStringValue }),
  field({ key: "allow_token_in_query", envName: "ALLOW_TOKEN_IN_QUERY", parse: parseBoolValue })
];

/**
 * 从环境变量解析配置。
 */
export function loadEnvConfig(): Partial<ServerConfig> {
  const out: Partial<ServerConfig> = {};
  for (const field of CONFIG_FIELDS) {
    const raw = field.envInput ? field.envInput() : process.env[field.envName];
    const parsed = field.parse(raw);
    if (parsed !== undefined) (out as Record<string, unknown>)[field.key] = parsed;
  }
  return out;
}

/**
 * 合并配置：override 覆盖 base，缺失项用 base 兜底。test_account_ids 有默认值 [1739989]。
 */
export function mergeConfig(base: ServerConfig, override: Partial<ServerConfig>): ServerConfig {
  const merged: Partial<ServerConfig> = {};
  for (const field of CONFIG_FIELDS) {
    const value = (override as Record<string, unknown>)[field.key] ?? (base as Record<string, unknown>)[field.key];
    if (value !== undefined) (merged as Record<string, unknown>)[field.key] = value;
  }
  return {
    ...merged,
    monitors: merged.monitors ?? [2],
    test_account_ids: merged.test_account_ids ?? [1739989],
    hitokoto_api_url: merged.hitokoto_api_url
  } as ServerConfig;
}

/**
 * 从已解析的对象构建 ServerConfig（适用于 yaml/json 来源）。
 */
export function buildConfigFromRecord(raw: unknown): ServerConfig {
  const record = isRecord(raw) ? raw : {};
  const out: Partial<ServerConfig> = {};
  for (const field of CONFIG_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field.envName)) continue;
    const parsed = field.parse(record[field.envName]);
    if (parsed !== undefined) (out as Record<string, unknown>)[field.key] = parsed;
  }
  return {
    ...out,
    monitors: out.monitors ?? [2],
    hitokoto_api_url: out.hitokoto_api_url
  } as ServerConfig;
}

export function sameConfigValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function changedConfigKeys(prev: ServerConfig, next: ServerConfig): string[] {
  const out: string[] = [];
  for (const field of CONFIG_FIELDS) {
    if (!sameConfigValue(prev[field.key], next[field.key])) out.push(field.envName);
  }
  return out;
}

/**
 * 把 next 中所有 startupOnly 字段还原为 prev 的值；返回需要重启才能生效的字段名列表。
 */
export function keepStartupOnlyConfig(
  prev: ServerConfig,
  next: ServerConfig
): { config: ServerConfig; restartRequiredKeys: string[] } {
  const config: ServerConfig = { ...next };
  const restartRequiredKeys: string[] = [];
  for (const field of CONFIG_FIELDS) {
    if (!field.startupOnly) continue;
    if (!sameConfigValue(prev[field.key], next[field.key])) {
      (config as Record<string, unknown>)[field.key] = (prev as Record<string, unknown>)[field.key];
      restartRequiredKeys.push(field.envName);
    }
  }
  return { config, restartRequiredKeys };
}
