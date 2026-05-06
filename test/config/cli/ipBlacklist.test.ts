import { describe, expect, it } from "vitest";
import { useCliTestSuite } from "./_setup.js";

describe("CLI IP黑名单管理", () => {
  const refs = useCliTestSuite();

  it("应该能够获取黑名单列表", () => {
    const { logger } = refs.current();
    const blacklist = logger.getBlacklistedIps();
    expect(Array.isArray(blacklist)).toBe(true);
  });

  it("应该能够从黑名单移除IP", () => {
    const { logger } = refs.current();
    // 测试移除操作不会抛出错误
    expect(() => {
      logger.removeFromBlacklist("192.168.1.100");
      logger.removeFromBlacklist("10.0.0.1");
      logger.removeFromBlacklist("172.16.0.1");
    }).not.toThrow();
  });

  it("应该能够清空黑名单", () => {
    const { logger } = refs.current();
    // 测试清空操作不会抛出错误
    expect(() => {
      logger.clearBlacklist();
    }).not.toThrow();
  });

  it("应该能够获取当前日志频率", () => {
    const { logger } = refs.current();
    const rate = logger.getCurrentRate();
    expect(typeof rate).toBe("number");
    expect(rate).toBeGreaterThanOrEqual(0);
  });
});
