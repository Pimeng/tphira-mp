import os from "node:os";
import { configDefaults, defineConfig } from "vitest/config";

const cpuCount = os.availableParallelism?.() ?? os.cpus().length;

export default defineConfig({
  resolve: {
    extensions: [".ts", ".js", ".mts", ".mjs"]
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // perf/** 是零断言的手动 profiling 脚本（永不失败，只打印耗时）；
    // memory-leak/** 需要 --expose-gc 与串行配置，由 vitest.config.memory.ts + `pnpm test:memory` 单独运行。
    // 两者都不应进入常规 `vitest run` 套件。
    exclude: [...configDefaults.exclude, "test/perf/**", "test/memory-leak/**"],
    setupFiles: ["./test/setup.ts"],
    fileParallelism: true,
    sequence: { concurrent: false },
    testTimeout: 15000,
    hookTimeout: 15000,
    retry: 1,
    clearMocks: true,
    restoreMocks: true,
    env: { NODE_ENV: "test" },
    logHeapUsage: true,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 2,
        maxThreads: Math.min(cpuCount, 32),
        isolate: true
      }
    }
  }
});
