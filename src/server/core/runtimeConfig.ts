import type { ScalarConfigValue } from "./configPersist.js";
import {
  KNOWN_CONFIG_ENV_NAMES,
  STARTUP_ONLY_CONFIG_ENV_NAMES,
  parseBoolValue,
  parseLogLevelValue,
  parseNonNegativeIntValue,
  parsePlayingGraceValue,
  parsePositiveIntValue,
  parseReplayTtlDaysValue,
  parseRoomMaxUsersValue
} from "./configValues.js";
import type { ServerConfig } from "./types.js";

const KNOWN_ENV_SET = new Set(KNOWN_CONFIG_ENV_NAMES);
const STARTUP_ONLY_ENV_SET = new Set(STARTUP_ONLY_CONFIG_ENV_NAMES);

function parseRuntimeRoomListTip(value: unknown): string | undefined {
  if (value === null) return "";
  if (typeof value !== "string") return undefined;
  return value.trim();
}

type RuntimeDescriptor = {
  envName: string;
  key: keyof ServerConfig;
  parse: (value: unknown) => ScalarConfigValue | undefined;
  current: (config: ServerConfig) => ScalarConfigValue;
  normalize?: (value: ScalarConfigValue) => ServerConfig[keyof ServerConfig] | undefined;
};

const RUNTIME_CONFIG_DESCRIPTORS: ReadonlyArray<RuntimeDescriptor> = [
  {
    envName: "ROOM_CREATION_ENABLED",
    key: "room_creation_enabled",
    parse: parseBoolValue,
    current: (config) => config.room_creation_enabled ?? true
  },
  {
    envName: "REPLAY_ENABLED",
    key: "replay_enabled",
    parse: parseBoolValue,
    current: (config) => config.replay_enabled ?? false
  },
  {
    envName: "ROOM_MAX_USERS",
    key: "room_max_users",
    parse: parseRoomMaxUsersValue,
    current: (config) => config.room_max_users ?? 8
  },
  {
    envName: "PLAYING_RECONNECT_GRACE",
    key: "playing_reconnect_grace",
    parse: parsePlayingGraceValue,
    current: (config) => config.playing_reconnect_grace ?? 5
  },
  {
    envName: "MAX_ROOMS",
    key: "max_rooms",
    parse: parseNonNegativeIntValue,
    current: (config) => config.max_rooms ?? 0,
    normalize: (value) => {
      const normalized = Number(value);
      return normalized > 0 ? normalized : undefined;
    }
  },
  {
    envName: "MAX_CONNECTIONS",
    key: "max_connections",
    parse: parseNonNegativeIntValue,
    current: (config) => config.max_connections ?? 0,
    normalize: (value) => {
      const normalized = Number(value);
      return normalized > 0 ? normalized : undefined;
    }
  },
  {
    envName: "CONNECTION_RATE_LIMIT",
    key: "connection_rate_limit",
    parse: parsePositiveIntValue,
    current: (config) => config.connection_rate_limit ?? 30
  },
  {
    envName: "COMMAND_RATE_LIMIT",
    key: "command_rate_limit",
    parse: parseBoolValue,
    current: (config) => config.command_rate_limit ?? true
  },
  {
    envName: "HTTP_RATE_LIMIT_MAX_REQUESTS",
    key: "http_rate_limit_max_requests",
    parse: parsePositiveIntValue,
    current: (config) => config.http_rate_limit_max_requests ?? 100
  },
  {
    envName: "HTTP_RATE_LIMIT_WINDOW_MS",
    key: "http_rate_limit_window_ms",
    parse: parsePositiveIntValue,
    current: (config) => config.http_rate_limit_window_ms ?? 60_000
  },
  {
    envName: "CHAT_ENABLED",
    key: "chat_enabled",
    parse: parseBoolValue,
    current: (config) => config.chat_enabled ?? true
  },
  {
    envName: "REPLAY_TTL_DAYS",
    key: "replay_ttl_days",
    parse: parseReplayTtlDaysValue,
    current: (config) => config.replay_ttl_days ?? 4
  },
  {
    envName: "ROOM_LIST_TIP",
    key: "room_list_tip",
    parse: parseRuntimeRoomListTip,
    current: (config) => config.room_list_tip ?? "",
    normalize: (value) => {
      const normalized = String(value).trim();
      return normalized.length > 0 ? normalized : undefined;
    }
  },
  {
    envName: "LOG_LEVEL",
    key: "log_level",
    parse: parseLogLevelValue,
    current: (config) => config.log_level ?? "INFO"
  },
  {
    envName: "LOG_COMPRESS_AFTER_DAYS",
    key: "log_compress_after_days",
    parse: parseNonNegativeIntValue,
    current: (config) => config.log_compress_after_days ?? 14
  },
  {
    envName: "LOG_MAX_TOTAL_MB",
    key: "log_max_total_mb",
    parse: parseNonNegativeIntValue,
    current: (config) => config.log_max_total_mb ?? 500
  }
];

const RUNTIME_DESCRIPTOR_MAP = new Map(RUNTIME_CONFIG_DESCRIPTORS.map((descriptor) => [descriptor.envName, descriptor]));

export const RUNTIME_CONFIG_ENV_NAMES = Object.freeze(RUNTIME_CONFIG_DESCRIPTORS.map((descriptor) => descriptor.envName));

export type RuntimeConfigPatchResult =
  | {
      ok: true;
      keys: string[];
      persistPatch: Record<string, ScalarConfigValue>;
      configPatch: Partial<ServerConfig>;
    }
  | {
      ok: false;
      invalidKeys: string[];
      startupOnlyKeys: string[];
      unsupportedKeys: string[];
      empty: boolean;
    };

export function buildRuntimeConfigSnapshot(config: ServerConfig): Record<string, ScalarConfigValue> {
  const snapshot: Record<string, ScalarConfigValue> = {};
  for (const descriptor of RUNTIME_CONFIG_DESCRIPTORS) {
    snapshot[descriptor.envName] = descriptor.current(config);
  }
  return snapshot;
}

export function pickRuntimeConfigSnapshot(
  config: ServerConfig,
  keys: readonly string[]
): Record<string, ScalarConfigValue> {
  const snapshot = buildRuntimeConfigSnapshot(config);
  const selected: Record<string, ScalarConfigValue> = {};
  for (const key of keys) {
    const envName = key.trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(snapshot, envName)) continue;
    selected[envName] = snapshot[envName]!;
  }
  return selected;
}

export function parseRuntimeConfigPatch(raw: unknown): RuntimeConfigPatchResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, invalidKeys: [], startupOnlyKeys: [], unsupportedKeys: [], empty: true };
  }

  const persistPatch: Record<string, ScalarConfigValue> = {};
  const configPatch: Partial<ServerConfig> = {};
  const invalidKeys: string[] = [];
  const startupOnlyKeys: string[] = [];
  const unsupportedKeys: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const envName = rawKey.trim().toUpperCase();
    const descriptor = RUNTIME_DESCRIPTOR_MAP.get(envName);
    if (!descriptor) {
      if (STARTUP_ONLY_ENV_SET.has(envName)) startupOnlyKeys.push(envName);
      else if (KNOWN_ENV_SET.has(envName)) unsupportedKeys.push(envName);
      else unsupportedKeys.push(envName);
      continue;
    }

    const parsed = descriptor.parse(rawValue);
    if (parsed === undefined) {
      invalidKeys.push(envName);
      continue;
    }

    persistPatch[envName] = parsed;
    const normalized = descriptor.normalize ? descriptor.normalize(parsed) : (parsed as ServerConfig[keyof ServerConfig]);
    (configPatch as Record<string, unknown>)[descriptor.key] = normalized;
  }

  const keys = Object.keys(persistPatch);
  if (keys.length === 0) {
    return { ok: false, invalidKeys, startupOnlyKeys, unsupportedKeys, empty: true };
  }

  return {
    ok: true,
    keys,
    persistPatch,
    configPatch
  };
}
