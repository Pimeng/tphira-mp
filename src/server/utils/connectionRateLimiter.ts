/**
 * 连接速率限制器
 *
 * 使用滑动窗口算法限制每个 IP 的 TCP 连接速率，
 * 防止连接洪水攻击耗尽服务器资源。
 */

type WindowEntry = { count: number; resetAt: number };

export type ConnectionRateLimiterOptions = {
  /** 每个时间窗口内允许的最大连接数 */
  maxConnections: number;
  /** 时间窗口长度（毫秒） */
  windowMs: number;
  /** 封禁持续时间（毫秒），超出限制后拒绝连接 */
  banDurationMs?: number;
};

export class ConnectionRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly banned = new Map<string, number>();
  private maxConnections: number;
  private readonly windowMs: number;
  private readonly banDurationMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(opts: ConnectionRateLimiterOptions) {
    this.maxConnections = opts.maxConnections;
    this.windowMs = opts.windowMs;
    this.banDurationMs = opts.banDurationMs ?? opts.windowMs * 2;
  }

  /**
   * 运行时更新每窗口最大连接数（配置热重载时调用）。
   * 仅影响后续 check 的判定，不重置已有窗口/封禁状态。
   */
  setMaxConnections(maxConnections: number): void {
    this.maxConnections = maxConnections;
  }

  /**
   * 检查连接是否被允许。返回 true 表示允许，false 表示拒绝。
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
    if (entry.count > this.maxConnections) {
      this.banned.set(ip, now + this.banDurationMs);
      this.windows.delete(ip);
      return false;
    }

    return true;
  }

  /** 获取当前跟踪的 IP 数量（用于监控） */
  get size(): number {
    return this.windows.size + this.banned.size;
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
