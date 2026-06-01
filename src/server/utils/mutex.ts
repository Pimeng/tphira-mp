export class Mutex {
  private current: Promise<void> = Promise.resolve();
  private queueSize = 0;

  /**
   * 获取当前等待队列长度（用于监控死锁）
   */
  getQueueSize(): number {
    return this.queueSize;
  }

  /**
   * 在互斥锁保护下执行函数
   * @param fn 要执行的异步函数
   * @param timeoutMs 可选的超时时间（毫秒），默认不超时
   * @throws 当超时时会抛出 Error("mutex-timeout")
   */
  async runExclusive<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const t0 = Mutex._profilerStart?.();
    const prev = this.current;
    let release!: () => void;
    this.queueSize++;
    this.current = new Promise<void>((resolve) => {
      release = resolve;
    });

    await prev;
    Mutex._profilerAcquired?.(t0 ?? 0, this.queueSize);
    const tExec = Mutex._profilerStart?.();
    try {
      if (timeoutMs !== undefined && timeoutMs > 0) {
        // 使用 Promise.race 实现超时
        const timeoutPromise = new Promise<T>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error("mutex-timeout"));
          }, timeoutMs);
          // 确保 timer 不会阻止进程退出
          if (timer.unref) timer.unref();
        });
        return await Promise.race([fn(), timeoutPromise]);
      }
      return await fn();
    } finally {
      Mutex._profilerDone?.(tExec ?? 0);
      this.queueSize--;
      release();
    }
  }

  /** Profiler hooks — set by test/perf/timing.ts before running profiling tests */
  static _profilerStart: (() => number) | null = null;
  static _profilerAcquired: ((waitStart: number, queueLen: number) => void) | null = null;
  static _profilerDone: ((execStart: number) => void) | null = null;

  /**
   * 尝试立即获取锁，如果锁被占用则返回 undefined
   * @param fn 要执行的函数
   * @returns 函数返回值，或 undefined（如果无法立即获取锁）
   */
  tryRunExclusive<T>(fn: () => T): T | undefined {
    if (this.queueSize > 0) return undefined;
    // 同步执行，不进入队列
    return fn();
  }
}
