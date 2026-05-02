import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".js", ".mts", ".mjs"]
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // 启用并行测试以提高性能（测试现在使用独立的临时目录）
    fileParallelism: true,
    // 每个测试文件内的测试串行运行（避免端口冲突）
    sequence: {
      concurrent: false
    },
    // 设置合理的超时时间
    testTimeout: 10000,
    hookTimeout: 10000,
    // 优化线程池 - 使用适中的线程数
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 2,
        maxThreads: 16,
        isolate: true
      }
    }
  }
});

