/**
 * 性能分析计时工具
 *
 * 通过全局 TimingCollector 收集关键路径的耗时数据，
 * 用于定位性能瓶颈。仅在测试环境中使用。
 */

type TimingEntry = {
  label: string;
  elapsedMs: number;
  timestamp: number;
};

type TimingGroup = {
  label: string;
  entries: TimingEntry[];
  /** 调用次数 */
  count: number;
  /** 总耗时 (ms) */
  totalMs: number;
  /** 最小耗时 (ms) */
  minMs: number;
  /** 最大耗时 (ms) */
  maxMs: number;
  /** 平均耗时 (ms) */
  avgMs: number;
};

class TimingCollector {
  private labels = new Map<string, TimingEntry[]>();
  private enabled = false;

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  reset(): void {
    this.labels.clear();
  }

  /** 记录一次耗时，返回一个停止函数 */
  start(label: string): () => void {
    if (!this.enabled) return () => {};
    const t0 = performance.now();
    return () => {
      const elapsed = performance.now() - t0;
      let arr = this.labels.get(label);
      if (!arr) {
        arr = [];
        this.labels.set(label, arr);
      }
      arr.push({ label, elapsedMs: elapsed, timestamp: Date.now() });
    };
  }

  /** 直接记录一次耗时 */
  record(label: string, elapsedMs: number): void {
    if (!this.enabled) return;
    let arr = this.labels.get(label);
    if (!arr) {
      arr = [];
      this.labels.set(label, arr);
    }
    arr.push({ label, elapsedMs, timestamp: Date.now() });
  }

  /** 获取分组统计，按 totalMs 降序排列 */
  summarize(): TimingGroup[] {
    const groups: TimingGroup[] = [];
    for (const [label, entries] of this.labels) {
      if (entries.length === 0) continue;
      let total = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const e of entries) {
        total += e.elapsedMs;
        if (e.elapsedMs < min) min = e.elapsedMs;
        if (e.elapsedMs > max) max = e.elapsedMs;
      }
      groups.push({
        label,
        entries,
        count: entries.length,
        totalMs: total,
        minMs: min === Infinity ? 0 : min,
        maxMs: max === -Infinity ? 0 : max,
        avgMs: entries.length > 0 ? total / entries.length : 0
      });
    }
    groups.sort((a, b) => b.totalMs - a.totalMs);
    return groups;
  }

  /** 打印报告 */
  printReport(): string {
    const groups = this.summarize();
    if (groups.length === 0) return "No timing data collected.";

    const lines: string[] = [];
    lines.push("=".repeat(90));
    lines.push("  Performance Timing Report");
    lines.push("=".repeat(90));
    lines.push(
      "  Label" +
        " ".repeat(45) +
        "Count" +
        " ".repeat(6) +
        "Total(ms)" +
        " ".repeat(3) +
        "Avg(ms)" +
        " ".repeat(5) +
        "Min(ms)" +
        " ".repeat(5) +
        "Max(ms)"
    );
    lines.push("-".repeat(90));

    for (const g of groups) {
      const label = g.label.length > 44 ? g.label.slice(0, 41) + "..." : g.label;
      lines.push(
        "  " +
          label.padEnd(44) +
          String(g.count).padStart(7) +
          g.totalMs.toFixed(2).padStart(10) +
          g.avgMs.toFixed(2).padStart(10) +
          g.minMs.toFixed(2).padStart(10) +
          g.maxMs.toFixed(2).padStart(10)
      );
    }
    lines.push("-".repeat(90));

    const totalAll = groups.reduce((s, g) => s + g.totalMs, 0);
    lines.push(`  TOTAL: ${totalAll.toFixed(2)}ms across ${groups.reduce((s, g) => s + g.count, 0)} samples`);
    lines.push("=".repeat(90));

    return lines.join("\n");
  }
}

/** 全局计时收集器实例 */
export const timing = new TimingCollector();
