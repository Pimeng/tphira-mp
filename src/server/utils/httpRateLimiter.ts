/**
 * HTTP 请求速率限制器
 *
 * 使用滑动窗口算法限制每个 IP 的 HTTP 请求速率，
 * 防止 API 滥用和暴力扫描。
 */

type WindowEntry = { count: number; resetAt: number };

export type HttpRateLimiterOptions = {
  /** 每个时间窗口内允许的最大请求数 */
  maxRequests: number;
  /** 时间窗口长度（毫秒） */
  windowMs: number;
  /** 超出限制后的封禁持续时间（毫秒），默认 windowMs * 2 */
  banDurationMs?: number;
};

export class HttpRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly banned = new Map<string, number>();
  private maxRequests: number;
  private windowMs: number;
  private banDurationMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(opts: HttpRateLimiterOptions) {
    this.maxRequests = opts.maxRequests;
    this.windowMs = opts.windowMs;
    this.banDurationMs = opts.banDurationMs ?? opts.windowMs * 2;
  }

  /**
   * 运行时更新限流参数（配置热重载时调用）。
   *
   * 当窗口长度变化时，旧窗口的 resetAt 已不再可靠，因此直接清空当前窗口/封禁状态，
   * 让后续请求按新策略重新计数。
   */
  updateOptions(opts: HttpRateLimiterOptions): void {
    this.maxRequests = opts.maxRequests;
    this.windowMs = opts.windowMs;
    this.banDurationMs = opts.banDurationMs ?? opts.windowMs * 2;
    this.windows.clear();
    this.banned.clear();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 检查请求是否被允许。返回 true 表示允许，false 表示拒绝。
   */
  check(ip: string): boolean {
    const now = Date.now();

    const bannedUntil = this.banned.get(ip);
    if (bannedUntil !== undefined) {
      if (now < bannedUntil) return false;
      this.banned.delete(ip);
    }

    const entry = this.windows.get(ip);
    if (!entry || now >= entry.resetAt) {
      this.windows.set(ip, { count: 1, resetAt: now + this.windowMs });
      this.scheduleCleanup();
      return true;
    }

    entry.count++;
    if (entry.count > this.maxRequests) {
      this.banned.set(ip, now + this.banDurationMs);
      this.windows.delete(ip);
      return false;
    }

    return true;
  }

  /** 获取当前被跟踪的 IP 数量（用于监控） */
  get trackedCount(): number {
    return this.windows.size + this.banned.size;
  }

  /** 获取当前被封禁的 IP 列表及剩余封禁时间 */
  getBannedIps(): Array<{ ip: string; remainingMs: number }> {
    const now = Date.now();
    const result: Array<{ ip: string; remainingMs: number }> = [];
    for (const [ip, until] of this.banned) {
      const remaining = until - now;
      if (remaining > 0) {
        result.push({ ip, remainingMs: remaining });
      }
    }
    return result;
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.windows) {
      if (now >= entry.resetAt) this.windows.delete(ip);
    }
    for (const [ip, until] of this.banned) {
      if (now >= until) this.banned.delete(ip);
    }
    if (this.windows.size === 0 && this.banned.size === 0 && this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
