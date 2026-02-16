/**
 * 日志限流和IP黑名单系统
 * 当日志输出频率过高时（>10条/s），暂停连接日志输出，并对源IP进行临时黑名单处理
 */

export type RateLimiterOptions = {
  /** 日志频率阈值（条/秒），超过此值触发限流 */
  logsPerSecondThreshold?: number;
  /** 黑名单持续时间（毫秒） */
  blacklistDurationMs?: number;
  /** 检查窗口大小（毫秒） */
  windowSizeMs?: number;
};

export class RateLimiter {
  private readonly threshold: number;
  private readonly blacklistDuration: number;
  private readonly windowSize: number;

  private logTimestamps: number[] = [];
  private blacklistedIps: Map<string, number> = new Map(); // IP -> 黑名单过期时间

  constructor(options: RateLimiterOptions = {}) {
    this.threshold = options.logsPerSecondThreshold ?? 10;
    this.blacklistDuration = options.blacklistDurationMs ?? 3600000; // 1小时
    this.windowSize = options.windowSizeMs ?? 1000; // 1秒
  }

  /**
   * 检查是否应该输出连接日志
   * @param ip 客户端IP地址
   * @returns true 表示应该输出，false 表示应该跳过
   */
  shouldLogConnection(ip: string): boolean {
    // 检查IP是否在黑名单中
    if (this.isBlacklisted(ip)) {
      return false;
    }

    // 记录当前日志时间戳
    const now = Date.now();
    this.logTimestamps.push(now);

    // 清理过期的时间戳（超过窗口时间的）
    const windowStart = now - this.windowSize;
    this.logTimestamps = this.logTimestamps.filter((ts) => ts > windowStart);

    // 检查是否超过阈值
    const logsInWindow = this.logTimestamps.length;
    if (logsInWindow > this.threshold) {
      // 触发限流：将该IP加入黑名单
      this.blacklistIp(ip);
      return false;
    }

    return true;
  }

  /**
   * 检查IP是否在黑名单中
   */
  private isBlacklisted(ip: string): boolean {
    const expireTime = this.blacklistedIps.get(ip);
    if (expireTime === undefined) return false;

    const now = Date.now();
    if (now >= expireTime) {
      // 黑名单已过期，移除
      this.blacklistedIps.delete(ip);
      return false;
    }

    return true;
  }

  /**
   * 将IP加入黑名单
   */
  private blacklistIp(ip: string): void {
    const expireTime = Date.now() + this.blacklistDuration;
    this.blacklistedIps.set(ip, expireTime);
  }

  /**
   * 获取当前黑名单中的IP列表
   */
  getBlacklistedIps(): Array<{ ip: string; expiresIn: number }> {
    const now = Date.now();
    const result: Array<{ ip: string; expiresIn: number }> = [];

    for (const [ip, expireTime] of this.blacklistedIps.entries()) {
      if (now < expireTime) {
        result.push({
          ip,
          expiresIn: expireTime - now
        });
      }
    }

    return result;
  }

  /**
   * 手动将IP从黑名单中移除
   */
  removeFromBlacklist(ip: string): void {
    this.blacklistedIps.delete(ip);
  }

  /**
   * 清空所有黑名单
   */
  clearBlacklist(): void {
    this.blacklistedIps.clear();
  }

  /**
   * 获取当前日志频率（条/秒）
   */
  getCurrentRate(): number {
    const now = Date.now();
    const windowStart = now - this.windowSize;
    const recentLogs = this.logTimestamps.filter((ts) => ts > windowStart);
    return (recentLogs.length / this.windowSize) * 1000;
  }
}
