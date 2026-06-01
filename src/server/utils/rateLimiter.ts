/**
 * 日志限流和IP黑名单系统
 * 按 IP 统计日志频率，超过阈值时将该 IP 加入临时黑名单
 */

type RateLimiterOptions = {
  /** 日志频率阈值（条/秒），超过此值触发限流 */
  logsPerSecondThreshold?: number;
  /** 黑名单持续时间（毫秒） */
  blacklistDurationMs?: number;
  /** 检查窗口大小（毫秒） */
  windowSizeMs?: number;
};

const RING_BUFFER_SIZE = 32;

type IpStats = {
  /** @deprecated 保留以兼容旧类型, 新代码使用 ringBuffer */
  timestamps: number[];
  /** Ring buffer write cursor (0..RING_BUFFER_SIZE-1) */
  ringCursor: number;
  ringBuffer: (number | undefined)[];
  blacklistedUntil: number;
  lastAccess: number;
};

export class RateLimiter {
  private readonly threshold: number;
  private readonly blacklistDuration: number;
  private readonly windowSize: number;

  /** 按 IP 统计日志频率 */
  private ipStats: Map<string, IpStats> = new Map();
  /** 最后一次清理过期 IP 的时间 */
  private lastCleanup = 0;
  /** 清理间隔（毫秒） */
  private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1小时
  /** IP 统计最大存活时间（毫秒） */
  private static readonly STALE_IP_TTL_MS = 24 * 60 * 60 * 1000; // 24小时

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
    const now = Date.now();

    // 定期清理过期的 IP 统计（每小时执行一次）
    if (now - this.lastCleanup > RateLimiter.CLEANUP_INTERVAL_MS) {
      this.cleanupStaleEntries(now);
    }

    let stats = this.ipStats.get(ip);
    if (!stats) {
      stats = { timestamps: [], ringCursor: 0, ringBuffer: new Array<(number | undefined)>(RING_BUFFER_SIZE), blacklistedUntil: 0, lastAccess: now };
      this.ipStats.set(ip, stats);
    }
    stats.lastAccess = now;

    // 检查IP是否在黑名单中
    if (now < stats.blacklistedUntil) {
      return false;
    }
    // 黑名单已过期，清理标记
    if (stats.blacklistedUntil > 0) {
      stats.blacklistedUntil = 0;
    }

    // 写入环形缓冲区（零分配）
    stats.ringBuffer[stats.ringCursor] = now;
    stats.ringCursor = (stats.ringCursor + 1) % RING_BUFFER_SIZE;

    // 计算窗口内的日志数量
    const windowStart = now - this.windowSize;
    let logsInWindow = 0;
    for (let i = 0; i < RING_BUFFER_SIZE; i++) {
      const ts = stats.ringBuffer[i];
      if (ts !== undefined && ts > windowStart) logsInWindow++;
    }

    // 检查是否超过阈值
    if (logsInWindow > this.threshold) {
      stats.blacklistedUntil = now + this.blacklistDuration;
      // 清零环形缓冲区释放跟踪
      stats.ringBuffer.fill(undefined);
      stats.ringCursor = 0;
      return false;
    }

    return true;
  }

  /**
   * 清理长时间未访问的 IP 统计条目，防止内存泄漏
   */
  private cleanupStaleEntries(now: number): void {
    this.lastCleanup = now;
    for (const [ip, stats] of this.ipStats.entries()) {
      if (now - stats.lastAccess > RateLimiter.STALE_IP_TTL_MS) {
        this.ipStats.delete(ip);
      }
    }
  }

  /**
   * 获取当前黑名单中的IP列表
   */
  getBlacklistedIps(): Array<{ ip: string; expiresIn: number }> {
    const now = Date.now();
    const result: Array<{ ip: string; expiresIn: number }> = [];

    for (const [ip, stats] of this.ipStats.entries()) {
      if (now < stats.blacklistedUntil) {
        result.push({
          ip,
          expiresIn: stats.blacklistedUntil - now
        });
      }
    }

    return result;
  }

  /**
   * 手动将IP从黑名单中移除
   */
  removeFromBlacklist(ip: string): void {
    const stats = this.ipStats.get(ip);
    if (stats) {
      stats.blacklistedUntil = 0;
      stats.ringBuffer.fill(undefined);
      stats.ringCursor = 0;
    }
  }

  /**
   * 清空所有黑名单
   */
  clearBlacklist(): void {
    this.ipStats.clear();
  }

  /**
   * 获取当前日志频率（条/秒）
   * 返回所有IP中的最高频率
   */
  getCurrentRate(): number {
    const now = Date.now();
    const windowStart = now - this.windowSize;
    let maxRate = 0;

    for (const stats of this.ipStats.values()) {
      let recentLogs = 0;
      for (let i = 0; i < RING_BUFFER_SIZE; i++) {
        const ts = stats.ringBuffer[i];
        if (ts !== undefined && ts > windowStart) recentLogs++;
      }
      const rate = (recentLogs / this.windowSize) * 1000;
      if (rate > maxRate) maxRate = rate;
    }

    return maxRate;
  }
}
