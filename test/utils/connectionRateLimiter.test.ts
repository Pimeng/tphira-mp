import { describe, it, expect } from "vitest";
import { ConnectionRateLimiter } from "../../src/server/utils/connectionRateLimiter.js";

describe("ConnectionRateLimiter", () => {
  it("超过 maxConnections 后拒绝并封禁该 IP", () => {
    const limiter = new ConnectionRateLimiter({ maxConnections: 2, windowMs: 10_000, banDurationMs: 30_000 });
    const ip = "1.2.3.4";
    expect(limiter.check(ip)).toBe(true); // 第 1 次
    expect(limiter.check(ip)).toBe(true); // 第 2 次（恰好达上限）
    expect(limiter.check(ip)).toBe(false); // 第 3 次：超限，拒绝并封禁
    expect(limiter.check(ip)).toBe(false); // 封禁窗口内继续拒绝
  });

  it("不同 IP 相互独立", () => {
    const limiter = new ConnectionRateLimiter({ maxConnections: 1, windowMs: 10_000 });
    expect(limiter.check("1.1.1.1")).toBe(true);
    expect(limiter.check("1.1.1.1")).toBe(false);
    // 另一个 IP 不受影响
    expect(limiter.check("2.2.2.2")).toBe(true);
  });

  it("setMaxConnections 热更新阈值：调高后同窗口内放行更多", () => {
    const limiter = new ConnectionRateLimiter({ maxConnections: 1, windowMs: 10_000 });
    const ip = "9.9.9.9";
    expect(limiter.check(ip)).toBe(true); // 在旧阈值(1)下用满
    limiter.setMaxConnections(5); // 配置热重载抬高阈值
    expect(limiter.check(ip)).toBe(true); // 新阈值下继续放行
    expect(limiter.check(ip)).toBe(true);
  });
});
