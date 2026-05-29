import { defineConfig } from "vitest/config";

/**
 * 内存泄漏测试专用配置
 *
 * 与主测试配置隔离，避免并行干扰。
 * 需要 node --expose-gc 才能强制 GC 并准确测量内存。
 */
export default defineConfig({
  resolve: {
    extensions: [".ts", ".js", ".mts", ".mjs"]
  },
  test: {
    environment: "node",
    include: ["test/memory-leak/**/*.test.ts"],
    // 内存测试必须串行，不能并行
    fileParallelism: false,
    sequence: {
      concurrent: false
    },
    // 内存测试需要较长时间（多轮循环 + 等待 dangling timeout）
    testTimeout: 180_000,
    hookTimeout: 30_000,
    // 使用单线程，避免线程池内存互相干扰
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
        isolate: true
      }
    }
  }
});
