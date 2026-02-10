import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter } from "../src/server/rateLimiter.js";

describe("RateLimiter", () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      logsPerSecondThreshold: 10,
      blacklistDurationMs: 1000, // 1秒用于测试
      windowSizeMs: 1000
    });
  });

  describe("shouldLogConnection", () => {
    it("允许低于阈值的日志输出", () => {
      for (let i = 0; i < 5; i++) {
        expect(rateLimiter.shouldLogConnection("192.168.1.100")).toBe(true);
      }
    });

    it("超过阈值时触发黑名单", () => {
      const ip = "192.168.1.100";
      // 记录11条日志，超过阈值10
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip);
      }

      // 第12条应该被拒绝
      expect(rateLimiter.shouldLogConnection(ip)).toBe(false);
    });

    it("超过阈值时将IP加入黑名单", () => {
      const ip = "192.168.1.100";
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip);
      }

      const blacklist = rateLimiter.getBlacklistedIps();
      expect(blacklist.length).toBe(1);
      expect(blacklist[0]?.ip).toBe(ip);
    });

    it("拒绝黑名单中的IP", () => {
      const ip = "192.168.1.100";
      // 触发限流
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip);
      }

      // 黑名单中的IP应该被拒绝
      expect(rateLimiter.shouldLogConnection(ip)).toBe(false);
    });

    it("不同IP共享全局频率限制", () => {
      const ip1 = "192.168.1.100";
      const ip2 = "192.168.1.101";

      // 触发ip1的限流（11条日志）
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip1);
      }

      // ip2也会被限流，因为全局时间窗口已满
      // 但ip2不在黑名单中，所以会被加入黑名单
      expect(rateLimiter.shouldLogConnection(ip2)).toBe(false);
      
      // 验证ip2被加入黑名单
      const blacklist = rateLimiter.getBlacklistedIps();
      expect(blacklist.some(item => item.ip === ip2)).toBe(true);
    });
  });

  describe("getBlacklistedIps", () => {
    it("初始时返回空列表", () => {
      expect(rateLimiter.getBlacklistedIps()).toEqual([]);
    });

    it("返回黑名单IP及过期时间", () => {
      const ip = "192.168.1.100";
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip);
      }

      const blacklist = rateLimiter.getBlacklistedIps();
      expect(blacklist.length).toBe(1);
      expect(blacklist[0]?.ip).toBe(ip);
      expect(blacklist[0]?.expiresIn).toBeGreaterThan(0);
      expect(blacklist[0]?.expiresIn).toBeLessThanOrEqual(1000);
    });

    it("自动清理过期的黑名单项", async () => {
      const ip = "192.168.1.100";
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip);
      }

      expect(rateLimiter.getBlacklistedIps().length).toBe(1);

      // 等待黑名单过期
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // 过期后应该被清理
      expect(rateLimiter.getBlacklistedIps().length).toBe(0);
    });
  });

  describe("removeFromBlacklist", () => {
    it("从黑名单中移除IP", () => {
      const ip = "192.168.1.100";
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip);
      }

      expect(rateLimiter.getBlacklistedIps().length).toBe(1);

      rateLimiter.removeFromBlacklist(ip);
      expect(rateLimiter.getBlacklistedIps().length).toBe(0);
    });

    it("移除后仍受全局频率限制", async () => {
      const ip = "192.168.1.100";
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip);
      }

      rateLimiter.removeFromBlacklist(ip);

      // 移除黑名单后，仍然受全局频率限制
      // 因为时间窗口内已经有11条日志
      expect(rateLimiter.shouldLogConnection(ip)).toBe(false);
      
      // 等待时间窗口过期
      await new Promise((resolve) => setTimeout(resolve, 1100));
      
      // 时间窗口过期后可以记录
      expect(rateLimiter.shouldLogConnection(ip)).toBe(true);
    });
  });

  describe("clearBlacklist", () => {
    it("清空所有黑名单IP", () => {
      const ip1 = "192.168.1.100";
      const ip2 = "192.168.1.101";

      // 触发限流，添加ip1到黑名单
      for (let i = 0; i < 11; i++) {
        rateLimiter.shouldLogConnection(ip1);
      }
      
      // ip2也会触发限流
      rateLimiter.shouldLogConnection(ip2);

      expect(rateLimiter.getBlacklistedIps().length).toBeGreaterThanOrEqual(1);

      rateLimiter.clearBlacklist();
      expect(rateLimiter.getBlacklistedIps().length).toBe(0);
    });
  });

  describe("getCurrentRate", () => {
    it("正确计算当前日志频率", () => {
      for (let i = 0; i < 5; i++) {
        rateLimiter.shouldLogConnection("192.168.1.100");
      }

      const rate = rateLimiter.getCurrentRate();
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(5);
    });

    it("无日志时返回0", () => {
      const rate = rateLimiter.getCurrentRate();
      expect(rate).toBe(0);
    });
  });

  describe("边界情况", () => {
    it("处理恰好达到阈值的日志", () => {
      const ip = "192.168.1.100";
      for (let i = 0; i < 10; i++) {
        expect(rateLimiter.shouldLogConnection(ip)).toBe(true);
      }

      // 第11条应该触发限流
      expect(rateLimiter.shouldLogConnection(ip)).toBe(false);
    });

    it("处理快速连续调用", () => {
      const ip = "192.168.1.100";
      const results = [];
      for (let i = 0; i < 15; i++) {
        results.push(rateLimiter.shouldLogConnection(ip));
      }

      // 前10条应该通过，后5条应该被拒绝
      expect(results.slice(0, 10).every((r) => r === true)).toBe(true);
      expect(results.slice(10).every((r) => r === false)).toBe(true);
    });

    it("处理未知IP", () => {
      expect(rateLimiter.shouldLogConnection("unknown")).toBe(true);
    });
  });
});
