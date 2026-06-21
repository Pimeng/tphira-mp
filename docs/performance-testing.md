# 性能测试指南

本文档说明如何对 tphira-mp 服务端进行性能压测。

## 前提条件

- Node.js >= 24
- pnpm >= 10.29.3

## 环境准备

```bash
pnpm install
pnpm run build
```

## 一键运行全部压测（推荐）

```bash
pnpm bench -- --duration 60
```

这会依次运行 connect-bench、room-bench 和 gameplay-bench，自动完成以下工作：

1. 启动本地 mock 认证服务器（每个 token 映射到独立用户，无需真实 Phira API）
2. 自动配置服务端指向 mock 认证服务器
3. 启动待测服务端（优先使用生产构建 `dist/server/main.js`）
4. 依次运行三个压测
5. 停止服务端和 mock 服务器
6. 统一保存结果到 `bench-results/`

参数说明：
- `--duration`：每个 bench 的持续时间，单位秒（默认 30）
- `--hz`：gameplay-bench 的每秒发送消息数（默认 20）
- `--host` / `--port`：服务端地址端口

### 多用户压测

`pnpm bench` 内置 mock 认证，任意字符串都可以作为 token。使用 `--tokens` 指定多个 token（逗号分隔），即可测试多用户并发场景：

```bash
pnpm bench -- --tokens "a,b,c,d" --duration 60
```

每个 token 会被 mock 服务器映射为不同的用户 ID，服务端会识别为不同用户，不会互相踢掉。

## 单独运行压测脚本

如果你需要单独运行某个压测，或需要真实 Phira API 认证：

### 1. 连接压测（connect-bench）

```bash
# 使用 mock 认证（无需真实 token）
pnpm run bench:connect -- --clients 300 --rate 50 --duration 60 --token test

# 使用真实 Phira API 认证
BENCH_TOKEN="your_real_token" pnpm run bench:connect -- --clients 300 --rate 50 --duration 60
```

参数说明：
- `--host`：服务端地址（默认 127.0.0.1）
- `--port`：服务端端口（默认 12346）
- `--clients`：目标并发客户端数（默认 10）
- `--rate`：每秒新建连接数（默认 10）
- `--duration`：压测持续时间，单位秒（默认 30）
- `--server-pid`：服务端进程 PID，用于采集服务端进程指标

### 2. 房间压测（room-bench）

```bash
pnpm run bench:room -- --rooms 50 --players-per-room 4 --duration 60 --tokens "a,b,c,d,e,f,g,h"
```

参数说明：
- `--rooms`：目标创建房间数（默认 5）
- `--players-per-room`：每个房间的玩家数（默认 2）
- `--monitors-per-room`：每个房间的观战者数（默认 0）
- `--rate`：每秒操作速率（默认 10）
- `--duration`：压测持续时间，单位秒（默认 30）
- `--server-pid`：服务端进程 PID，用于采集服务端进程指标

### 3. Gameplay 压测（gameplay-bench）

```bash
pnpm run bench:gameplay -- --rooms 10 --players-per-room 4 --hz 20 --duration 60 --tokens "a,b,c,d"
```

参数说明：
- `--rooms`：目标房间数（默认 5）
- `--players-per-room`：每个房间的玩家数（默认 2）
- `--monitors-per-room`：每个房间的观战者数（默认 0）
- `--hz`：每个客户端每秒发送消息数（默认 20）
- `--duration`：压测持续时间，单位秒（默认 30）
- `--server-pid`：服务端进程 PID，用于采集服务端进程指标

## 压测报告

所有压测脚本运行结束后，会在 `bench-results/` 目录下生成 JSON 报告：

```
bench-results/
  connect-bench-2026-05-17T18-06-30-114Z.json
  room-bench-2026-05-17T18-07-06-628Z.json
  gameplay-bench-2026-05-17T18-07-57-180Z.json
  server-process-metrics.json
  server.log
```

### 客户端进程指标（Client Process Metrics）

每个 bench JSON 报告包含以下字段：
- `benchType`：压测类型
- `params`：运行参数
- `startedAt` / `endedAt`：起止时间
- `summary`：统计摘要（连接数、延迟、成功率等）
- `errors`：错误汇总
- `metricsSamples`：**压测客户端进程**指标采样（每秒采集）
- `metricsSummary`：**压测客户端进程**指标汇总（RSS、堆内存、事件循环延迟等）

> **重要**：`metricsSamples` 和 `metricsSummary` 采集的是**压测客户端进程**的指标（即运行 `bench:connect`/`bench:room`/`bench:gameplay` 脚本自身的 Node.js 进程），**不是被压测的服务端指标**。观察服务端真实资源占用请参考 `server-process-metrics.json`。

### 服务端进程指标（Server Process Metrics）

Release benchmark 工作流会额外生成 `server-process-metrics.json`，包含**被压测服务端进程**的真实资源占用：

- `pid`：服务端进程 PID
- `startedAt` / `endedAt`：采集起止时间
- `samples`：每秒采样数组，包含 `rssBytes`、`cpuPercent`、`memoryPercent`、`uptimeSeconds`
- `summary`：汇总统计
  - `rssAvgBytes` / `rssMaxBytes` / `rssMinBytes`：RSS 内存
  - `cpuAvgPercent` / `cpuMaxPercent`：CPU 占用（相对单核）
  - `memoryPercentAvg` / `memoryPercentPeak`：进程 RSS 占系统总内存百分比

> **注意**：`vmSizeBytes` 也包含在采样中，但**不作为重点展示**，因为 Node/V8 的虚拟地址空间（VmSize）通常很大，不能代表真实物理内存占用。报告以 **RSS** 为准。

服务端进程指标在 Linux 下通过读取 `/proc/<pid>/stat` 和 `/proc/<pid>/status` 计算得出。非 Linux 环境可能无法计算 `cpuPercent` 和 `memoryPercent`，此时对应字段会缺失。

你也可以手动启动指标采集器：

```bash
pnpm tsx bench/server-metrics-recorder.ts --pid 12345 --output bench-results/server-process-metrics.json
```

采集器会在收到 `SIGINT` / `SIGTERM` 时自动保存已采集的样本并退出。

## GitHub Actions 自动压测

项目配置了 `.github/workflows/release-benchmark.yml`，在 Release 发布时自动运行压测并上传结果。

触发方式：
- **自动**：Release published 时自动触发
- **手动**：在 Actions 页面选择 `Release Benchmark` 工作流，点击 `Run workflow`

工作流使用内置 mock 认证服务器运行压测，**无需配置真实 Phira token**。如需使用真实 token，可在仓库 Settings > Secrets 中配置：
- `BENCH_TOKENS`：多个 token（逗号分隔）
- `BENCH_TOKEN`：单个 token（向后兼容）

Release benchmark 工作流会先执行 `pnpm run build`，然后使用生产构建 `node dist/server/main.js` 启动服务端，避免 `pnpm run dev` 在正常停止时产生 ELIFECYCLE 错误污染日志。

> **性能声明**：GitHub Actions runner 的性能不稳定，Release benchmark 报告仅用于版本间对比基线，不作为生产环境承载能力承诺。
>
> 推荐 Release 文案：
> ```
> This benchmark was run on GitHub Actions and is intended for version-to-version comparison, not as an absolute production capacity guarantee.
> ```
