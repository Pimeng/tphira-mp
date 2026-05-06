import { describe, it, expect } from "vitest";
import {
  validateSessionToken,
  validateChartId,
  validateTimestamp,
  validateUserId,
  validateRoomId,
  validateMessage,
  validateMaxUsers,
  validateUserIdArray,
  validateIp,
  validateAll,
  isValidInteger,
  isValidString,
  safeParseInt
} from "../../src/common/validation.js";
import { parseRoomId } from "../../src/common/roomId.js";

describe("validateSessionToken", () => {
  it("有效 token", () => {
    const result = validateSessionToken("abc123");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe("abc123");
  });

  it("带空格的 token 应 trim", () => {
    const result = validateSessionToken("  abc  ");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe("abc");
  });

  it("空字符串无效", () => {
    const result = validateSessionToken("");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("bad-token");
  });

  it("仅空格无效", () => {
    const result = validateSessionToken("   ");
    expect(result.valid).toBe(false);
  });

  it("非字符串无效", () => {
    expect(validateSessionToken(123).valid).toBe(false);
    expect(validateSessionToken(null).valid).toBe(false);
    expect(validateSessionToken(undefined).valid).toBe(false);
  });
});

describe("validateChartId", () => {
  it("有效 ID", () => {
    const result = validateChartId(42);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe(42);
  });

  it("负数无效", () => {
    expect(validateChartId(-1).valid).toBe(false);
  });

  it("非整数无效", () => {
    expect(validateChartId(1.5).valid).toBe(false);
  });

  it("字符串数字有效", () => {
    const result = validateChartId("42");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe(42);
  });
});

describe("validateTimestamp", () => {
  it("正整数有效", () => {
    const result = validateTimestamp(1234567890);
    expect(result.valid).toBe(true);
  });

  it("0 无效", () => {
    expect(validateTimestamp(0).valid).toBe(false);
  });

  it("负数无效", () => {
    expect(validateTimestamp(-1).valid).toBe(false);
  });

  it("非整数无效", () => {
    expect(validateTimestamp(1.5).valid).toBe(false);
  });
});

describe("validateUserId", () => {
  it("整数有效", () => {
    const result = validateUserId(100);
    expect(result.valid).toBe(true);
  });

  it("负整数也有效", () => {
    const result = validateUserId(-1);
    expect(result.valid).toBe(true);
  });

  it("非整数无效", () => {
    expect(validateUserId(1.5).valid).toBe(false);
  });
});

describe("validateRoomId", () => {
  it("有效房间 ID", () => {
    const result = validateRoomId("test_room");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toEqual(parseRoomId("test_room"));
  });

  it("非字符串无效", () => {
    expect(validateRoomId(123).valid).toBe(false);
  });

  it("无效格式", () => {
    expect(validateRoomId("").valid).toBe(false);
    expect(validateRoomId("room@123").valid).toBe(false);
  });
});

describe("validateMessage", () => {
  it("有效消息", () => {
    const result = validateMessage("hello");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe("hello");
  });

  it("超长消息", () => {
    const msg = "a".repeat(201);
    const result = validateMessage(msg);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("message-too-long");
  });

  it("恰好 200 字符", () => {
    const msg = "a".repeat(200);
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it("空消息无效", () => {
    expect(validateMessage("").valid).toBe(false);
  });

  it("仅空格无效", () => {
    expect(validateMessage("   ").valid).toBe(false);
  });

  it("自定义 maxLength", () => {
    expect(validateMessage("hello", 3).valid).toBe(false);
    expect(validateMessage("hi", 3).valid).toBe(true);
  });
});

describe("validateMaxUsers", () => {
  it("边界值 1", () => {
    const result = validateMaxUsers(1);
    expect(result.valid).toBe(true);
  });

  it("边界值 64", () => {
    const result = validateMaxUsers(64);
    expect(result.valid).toBe(true);
  });

  it("0 无效", () => {
    expect(validateMaxUsers(0).valid).toBe(false);
  });

  it("65 无效", () => {
    expect(validateMaxUsers(65).valid).toBe(false);
  });

  it("负数无效", () => {
    expect(validateMaxUsers(-1).valid).toBe(false);
  });

  it("非整数无效", () => {
    expect(validateMaxUsers(8.5).valid).toBe(false);
  });
});

describe("validateUserIdArray", () => {
  it("有效数组", () => {
    const result = validateUserIdArray([1, 2, 3]);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toEqual([1, 2, 3]);
  });

  it("过滤非整数", () => {
    const result = validateUserIdArray([1, "a", 2, undefined, 3]);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toEqual([1, 2, 3]);
  });

  it("空数组无效", () => {
    expect(validateUserIdArray([]).valid).toBe(false);
  });

  it("全过滤后为空无效", () => {
    expect(validateUserIdArray(["a", "b"]).valid).toBe(false);
  });

  it("非数组无效", () => {
    expect(validateUserIdArray("123").valid).toBe(false);
  });
});

describe("validateIp", () => {
  it("有效 IP", () => {
    const result = validateIp("192.168.1.1");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe("192.168.1.1");
  });

  it("空字符串无效", () => {
    expect(validateIp("").valid).toBe(false);
  });

  it("非字符串无效", () => {
    expect(validateIp(123).valid).toBe(false);
  });
});

describe("validateAll", () => {
  it("全部通过", () => {
    const result = validateAll(validateChartId(1), validateUserId(100));
    expect(result.valid).toBe(true);
  });

  it("第一个失败", () => {
    const result = validateAll(validateChartId(-1), validateUserId(100));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("bad-chart-id");
  });

  it("第二个失败", () => {
    const result = validateAll(validateChartId(1), validateUserId(1.5));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("bad-user-id");
  });
});

describe("isValidInteger", () => {
  it("基础验证", () => {
    expect(isValidInteger(42)).toBe(true);
    expect(isValidInteger("42")).toBe(true);
    expect(isValidInteger(1.5)).toBe(false);
    expect(isValidInteger("abc")).toBe(false);
  });

  it("带 min/max", () => {
    expect(isValidInteger(5, 1, 10)).toBe(true);
    expect(isValidInteger(0, 1, 10)).toBe(false);
    expect(isValidInteger(11, 1, 10)).toBe(false);
  });
});

describe("isValidString", () => {
  it("基础验证", () => {
    expect(isValidString("hello")).toBe(true);
    expect(isValidString("")).toBe(false);
    expect(isValidString("   ")).toBe(false);
    expect(isValidString(123)).toBe(false);
  });

  it("带 maxLength", () => {
    expect(isValidString("hello", 10)).toBe(true);
    expect(isValidString("hello", 3)).toBe(false);
  });
});

describe("safeParseInt", () => {
  it("有效整数", () => {
    expect(safeParseInt(42)).toBe(42);
    expect(safeParseInt("42")).toBe(42);
  });

  it("无效值返回 default", () => {
    expect(safeParseInt("abc")).toBe(0);
    expect(safeParseInt("abc", -1)).toBe(-1);
  });

  it("非整数返回 default", () => {
    expect(safeParseInt(1.5)).toBe(0);
  });
});