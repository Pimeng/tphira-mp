import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // 将 .js 导入解析为 .ts 文件
      "../src/server/server.js": "../src/server/core/server.ts",
      "../src/server/state.js": "../src/server/core/state.ts",
      "../src/server/logger.js": "../src/server/utils/logger.ts",
      "../src/server/rateLimiter.js": "../src/server/utils/rateLimiter.ts",
      "../src/server/types.js": "../src/server/core/types.ts",
      "../src/server/room.js": "../src/server/game/room.ts",
      "../src/server/user.js": "../src/server/game/user.ts"
    },
    extensions: [".ts", ".js", ".mts", ".mjs"]
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // 启用并行测试以提高性能
    fileParallelism: true,
    // 每个测试文件内的测试串行运行（避免端口冲突）
    sequence: {
      concurrent: false
    },
    // 设置合理的超时时间
    testTimeout: 10000,
    hookTimeout: 10000,
    // 优化线程池 - 使用适中的线程数避免资源竞争
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

