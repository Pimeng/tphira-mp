import { describe, it, expect } from "vitest";
import {
  parseBoolValue,
  parseStringValue,
  parseOutboundProxyValue,
  parsePortValue,
  parseRoomMaxUsersValue,
  parseIntegerListValue,
  parseShareStationValue,
  mergeConfig,
  buildConfigFromRecord,
  sameConfigValue,
  changedConfigKeys,
  keepStartupOnlyConfig,
  isRecord
} from "../../src/server/core/configValues.js";

describe("isRecord", () => {
  it("识别普通对象", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("拒绝 null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("拒绝数组", () => {
    expect(isRecord([])).toBe(false);
  });

  it("拒绝基本类型", () => {
    expect(isRecord("str")).toBe(false);
    expect(isRecord(123)).toBe(false);
  });
});

describe("parseBoolValue", () => {
  it("boolean 原样返回", () => {
    expect(parseBoolValue(true)).toBe(true);
    expect(parseBoolValue(false)).toBe(false);
  });

  it("数字 1/0", () => {
    expect(parseBoolValue(1)).toBe(true);
    expect(parseBoolValue(0)).toBe(false);
    expect(parseBoolValue(2)).toBeUndefined();
  });

  it("字符串 true/yes/on/1", () => {
    expect(parseBoolValue("true")).toBe(true);
    expect(parseBoolValue("yes")).toBe(true);
    expect(parseBoolValue("on")).toBe(true);
    expect(parseBoolValue("1")).toBe(true);
    expect(parseBoolValue("TRUE")).toBe(true);
    expect(parseBoolValue("  true  ")).toBe(true);
  });

  it("字符串 false/no/off/0", () => {
    expect(parseBoolValue("false")).toBe(false);
    expect(parseBoolValue("no")).toBe(false);
    expect(parseBoolValue("off")).toBe(false);
    expect(parseBoolValue("0")).toBe(false);
    expect(parseBoolValue("FALSE")).toBe(false);
  });

  it("无效值", () => {
    expect(parseBoolValue("maybe")).toBeUndefined();
    expect(parseBoolValue("")).toBeUndefined();
    expect(parseBoolValue(null)).toBeUndefined();
    expect(parseBoolValue(undefined)).toBeUndefined();
  });
});

describe("parseStringValue", () => {
  it("有效字符串", () => {
    expect(parseStringValue("hello")).toBe("hello");
    expect(parseStringValue("  hello  ")).toBe("hello");
  });

  it("空字符串", () => {
    expect(parseStringValue("")).toBeUndefined();
    expect(parseStringValue("   ")).toBeUndefined();
  });

  it("非字符串", () => {
    expect(parseStringValue(123)).toBeUndefined();
    expect(parseStringValue(null)).toBeUndefined();
  });
});

describe("parseOutboundProxyValue", () => {
  it("false 字面量", () => {
    expect(parseOutboundProxyValue(false)).toBe(false);
  });

  it("字符串 false", () => {
    expect(parseOutboundProxyValue("false")).toBe(false);
    expect(parseOutboundProxyValue("FALSE")).toBe(false);
  });

  it("有效代理地址", () => {
    expect(parseOutboundProxyValue("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("空字符串", () => {
    expect(parseOutboundProxyValue("")).toBeUndefined();
  });

  it("null/undefined", () => {
    expect(parseOutboundProxyValue(null)).toBeUndefined();
    expect(parseOutboundProxyValue(undefined)).toBeUndefined();
  });
});

describe("parsePortValue", () => {
  it("边界值", () => {
    expect(parsePortValue(1)).toBe(1);
    expect(parsePortValue(65535)).toBe(65535);
  });

  it("0 无效", () => {
    expect(parsePortValue(0)).toBeUndefined();
  });

  it("65536 无效", () => {
    expect(parsePortValue(65536)).toBeUndefined();
  });

  it("负数无效", () => {
    expect(parsePortValue(-1)).toBeUndefined();
  });

  it("空字符串/undefined/null", () => {
    expect(parsePortValue("")).toBeUndefined();
    expect(parsePortValue(undefined)).toBeUndefined();
    expect(parsePortValue(null)).toBeUndefined();
  });

  it("字符串数字", () => {
    expect(parsePortValue("8080")).toBe(8080);
  });
});

describe("parseRoomMaxUsersValue", () => {
  it("边界值", () => {
    expect(parseRoomMaxUsersValue(1)).toBe(1);
    expect(parseRoomMaxUsersValue(64)).toBe(64);
  });

  it("超过 64 被截断", () => {
    expect(parseRoomMaxUsersValue(100)).toBe(64);
    expect(parseRoomMaxUsersValue(128)).toBe(64);
  });

  it("0 无效", () => {
    expect(parseRoomMaxUsersValue(0)).toBeUndefined();
  });

  it("负数无效", () => {
    expect(parseRoomMaxUsersValue(-1)).toBeUndefined();
  });

  it("非整数无效", () => {
    expect(parseRoomMaxUsersValue(8.5)).toBeUndefined();
  });
});

describe("parseIntegerListValue", () => {
  it("数组输入", () => {
    expect(parseIntegerListValue([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseIntegerListValue([1, "2", 3.5])).toEqual([1, 2]);
  });

  it("空数组", () => {
    expect(parseIntegerListValue([])).toBeUndefined();
  });

  it("字符串逗号分隔", () => {
    expect(parseIntegerListValue("1,2,3")).toEqual([1, 2, 3]);
  });

  it("字符串空格分隔", () => {
    expect(parseIntegerListValue("1 2 3")).toEqual([1, 2, 3]);
  });

  it("字符串分号分隔", () => {
    expect(parseIntegerListValue("1;2;3")).toEqual([1, 2, 3]);
  });

  it("混合分隔符", () => {
    expect(parseIntegerListValue("1, 2; 3")).toEqual([1, 2, 3]);
  });

  it("空字符串", () => {
    expect(parseIntegerListValue("")).toBeUndefined();
  });

  it("单数字", () => {
    expect(parseIntegerListValue(42)).toEqual([42]);
  });

  it("无效输入", () => {
    expect(parseIntegerListValue("abc")).toBeUndefined();
    expect(parseIntegerListValue({})).toBeUndefined();
  });
});

describe("parseShareStationValue", () => {
  it("完整配置", () => {
    const result = parseShareStationValue({ URL: "http://example.com", TOKEN: "token" });
    expect(result).toEqual({ url: "http://example.com", token: "token" });
  });

  it("缺少 URL", () => {
    expect(parseShareStationValue({ TOKEN: "token" })).toBeUndefined();
  });

  it("缺少 TOKEN", () => {
    expect(parseShareStationValue({ URL: "http://example.com" })).toBeUndefined();
  });

  it("空字符串视为缺失", () => {
    expect(parseShareStationValue({ URL: "", TOKEN: "" })).toBeUndefined();
  });

  it("非对象", () => {
    expect(parseShareStationValue("string")).toBeUndefined();
    expect(parseShareStationValue(null)).toBeUndefined();
  });
});

describe("buildConfigFromRecord", () => {
  it("从记录构建配置", () => {
    const config = buildConfigFromRecord({
      MONITORS: "1,2",
      SERVER_NAME: "Test",
      PORT: "12345"
    });
    expect(config.monitors).toEqual([1, 2]);
    expect(config.server_name).toBe("Test");
    expect(config.port).toBe(12345);
  });

  it("默认值 monitors", () => {
    const config = buildConfigFromRecord({});
    expect(config.monitors).toEqual([2]);
  });

  it("忽略未知键", () => {
    const config = buildConfigFromRecord({ UNKNOWN_KEY: "value" } as any);
    expect(config.monitors).toEqual([2]);
  });
});

describe("mergeConfig", () => {
  it("override 覆盖 base", () => {
    const base = buildConfigFromRecord({ MONITORS: "1", SERVER_NAME: "Base" });
    const merged = mergeConfig(base, { server_name: "Override" });
    expect(merged.server_name).toBe("Override");
    expect(merged.monitors).toEqual([1]);
  });

  it("test_account_ids 默认兜底", () => {
    const base = buildConfigFromRecord({});
    const merged = mergeConfig(base, {});
    expect(merged.test_account_ids).toEqual([1739989]);
  });

  it("base 中未覆盖的保留", () => {
    const base = buildConfigFromRecord({ MONITORS: "1", SERVER_NAME: "Base" });
    const merged = mergeConfig(base, {});
    expect(merged.server_name).toBe("Base");
  });
});

describe("sameConfigValue", () => {
  it("基本比较", () => {
    expect(sameConfigValue(1, 1)).toBe(true);
    expect(sameConfigValue(1, 2)).toBe(false);
    expect(sameConfigValue("a", "a")).toBe(true);
    expect(sameConfigValue([1, 2], [1, 2])).toBe(true);
    expect(sameConfigValue([1, 2], [2, 1])).toBe(false);
  });
});

describe("changedConfigKeys", () => {
  it("检测变更", () => {
    const prev = buildConfigFromRecord({ MONITORS: "1", SERVER_NAME: "Old" });
    const next = buildConfigFromRecord({ MONITORS: "1,2", SERVER_NAME: "Old" });
    const keys = changedConfigKeys(prev, next);
    expect(keys).toContain("MONITORS");
    expect(keys).not.toContain("SERVER_NAME");
  });
});

describe("keepStartupOnlyConfig", () => {
  it("startupOnly 字段变更需要重启", () => {
    const prev = buildConfigFromRecord({ HOST: "0.0.0.0", PORT: "12345" });
    const next = buildConfigFromRecord({ HOST: "127.0.0.1", PORT: "12345" });
    const { config, restartRequiredKeys } = keepStartupOnlyConfig(prev, next);
    expect(restartRequiredKeys).toContain("HOST");
    expect(restartRequiredKeys).not.toContain("PORT");
    expect(config.host).toBe("0.0.0.0");
  });
});

describe("CONNECTION_RATE_LIMIT 配置接线", () => {
  it("从 yaml/env 记录解析为正整数", () => {
    expect(buildConfigFromRecord({ CONNECTION_RATE_LIMIT: "50" }).connection_rate_limit).toBe(50);
    expect(buildConfigFromRecord({ CONNECTION_RATE_LIMIT: 80 }).connection_rate_limit).toBe(80);
  });

  it("非正整数视为未设置（回退默认 30）", () => {
    expect(buildConfigFromRecord({ CONNECTION_RATE_LIMIT: 0 }).connection_rate_limit).toBeUndefined();
    expect(buildConfigFromRecord({ CONNECTION_RATE_LIMIT: -5 }).connection_rate_limit).toBeUndefined();
  });

  it("可热重载：变更被检测且不要求重启", () => {
    const prev = buildConfigFromRecord({ CONNECTION_RATE_LIMIT: "30" });
    const next = buildConfigFromRecord({ CONNECTION_RATE_LIMIT: "60" });
    expect(changedConfigKeys(prev, next)).toContain("CONNECTION_RATE_LIMIT");
    const { config, restartRequiredKeys } = keepStartupOnlyConfig(prev, next);
    expect(restartRequiredKeys).not.toContain("CONNECTION_RATE_LIMIT");
    expect(config.connection_rate_limit).toBe(60);
  });
});

describe("ROOM_CREATION_ENABLED 配置接线", () => {
  it("从 yaml/env 记录解析为布尔", () => {
    expect(buildConfigFromRecord({ ROOM_CREATION_ENABLED: false }).room_creation_enabled).toBe(false);
    expect(buildConfigFromRecord({ ROOM_CREATION_ENABLED: "off" }).room_creation_enabled).toBe(false);
    expect(buildConfigFromRecord({ ROOM_CREATION_ENABLED: "on" }).room_creation_enabled).toBe(true);
  });

  it("缺省时为 undefined（由 state 默认放行建房）", () => {
    expect(buildConfigFromRecord({}).room_creation_enabled).toBeUndefined();
  });

  it("可热重载：变更被检测且不要求重启", () => {
    const prev = buildConfigFromRecord({ ROOM_CREATION_ENABLED: true });
    const next = buildConfigFromRecord({ ROOM_CREATION_ENABLED: false });
    expect(changedConfigKeys(prev, next)).toContain("ROOM_CREATION_ENABLED");
    const { config, restartRequiredKeys } = keepStartupOnlyConfig(prev, next);
    expect(restartRequiredKeys).not.toContain("ROOM_CREATION_ENABLED");
    expect(config.room_creation_enabled).toBe(false);
  });
});

describe("PLAYING_RECONNECT_GRACE 配置接线", () => {
  it("从 yaml/env 记录解析为非负整数秒（上限 120）", () => {
    expect(buildConfigFromRecord({ PLAYING_RECONNECT_GRACE: "30" }).playing_reconnect_grace).toBe(30);
    expect(buildConfigFromRecord({ PLAYING_RECONNECT_GRACE: 0 }).playing_reconnect_grace).toBe(0);
    expect(buildConfigFromRecord({ PLAYING_RECONNECT_GRACE: 999 }).playing_reconnect_grace).toBe(120);
  });

  it("非法值视为未设置（回退默认）", () => {
    expect(buildConfigFromRecord({ PLAYING_RECONNECT_GRACE: -5 }).playing_reconnect_grace).toBeUndefined();
    expect(buildConfigFromRecord({ PLAYING_RECONNECT_GRACE: "abc" }).playing_reconnect_grace).toBeUndefined();
  });

  it("可热重载：变更被检测且不要求重启", () => {
    const prev = buildConfigFromRecord({ PLAYING_RECONNECT_GRACE: "15" });
    const next = buildConfigFromRecord({ PLAYING_RECONNECT_GRACE: "0" });
    expect(changedConfigKeys(prev, next)).toContain("PLAYING_RECONNECT_GRACE");
    const { config, restartRequiredKeys } = keepStartupOnlyConfig(prev, next);
    expect(restartRequiredKeys).not.toContain("PLAYING_RECONNECT_GRACE");
    expect(config.playing_reconnect_grace).toBe(0);
  });
});
