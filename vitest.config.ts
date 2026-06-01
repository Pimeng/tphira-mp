import os from "node:os";
import { defineConfig } from "vitest/config";

const cpuCount = os.availableParallelism?.() ?? os.cpus().length;

export default defineConfig({
  resolve: {
    extensions: [".ts", ".js", ".mts", ".mjs"]
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
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
