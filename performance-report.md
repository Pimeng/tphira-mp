# 发布基准测试报告 / Release Benchmark Report

> 本次基准测试在 GitHub Actions 上运行，仅用于版本间对比，不代表绝对的生产环境容量保证。
> This benchmark was run on GitHub Actions and is intended for version-to-version comparison, not as an absolute production capacity guarantee.

## 基准测试参数 / Benchmark Parameters

| 基准测试 | 参数 |
|---|---|
| connect-bench | clients=5, rate=60, duration=60s |
| room-bench | rooms=50, playersPerRoom=200, duration=60s |
| gameplay-bench | rooms=50, playersPerRoom=200, hz=60, duration=60s |

## 结果摘要 / Results Summary

| 基准测试 | 关键指标 | 数值 |
|---|---|---|
| connect-bench | 成功连接 / 失败 | 5 / 0 |
| connect-bench | 平均连接延迟 | 0.60 ms |
| room-bench | 房间创建 / 失败 | 50 / 0 |
| room-bench | 加入成功 / 失败 | 550 / 14400 |
| gameplay-bench | 消息发送 / 失败 | 0 / 0 |
| gameplay-bench | 消息每秒 | 0.00 |

## 客户端进程指标 / Client Process Metrics

指标来自 **benchmark 客户端进程**（而非被测服务端）。
Metrics from the **benchmark client process** (not the server under test).

| 基准测试 | RSS 平均 | RSS 峰值 | HeapUsed 平均 | HeapUsed 峰值 | EL 延迟均值 | EL 延迟 P95 最大 |
|---|---|---|---|---|---|---|
| connect-bench | 67.9 MB | 74.8 MB | 7.8 MB | 8.8 MB | 15.48 ms | 16.21 ms |
| room-bench | 276.7 MB | 478.9 MB | 94.0 MB | 262.0 MB | 15.95 ms | 23.36 ms |
| gameplay-bench | 264.2 MB | 452.0 MB | 88.3 MB | 242.5 MB | 15.79 ms | 22.36 ms |

## 服务端进程指标 / Server Process Metrics

指标来自 **被测服务端进程**（通过外部读取 /proc 采样）。
Metrics from the **server process under test** (sampled externally via /proc).

> 服务端进程指标不可用。
> Server process metrics not available.

## 指标说明 / Metrics Reference

### 网络场景 / Network Scenarios

| 场景 | 网络参数 | 典型用途 |
|---|---|---|
| normal | 无限制 | 获取基准上限，用于版本间对比 |
| weak | delay 80ms ±30ms，丢包 0.5% | 模拟一般 WiFi 波动或轻度拥塞 |
| mobile | delay 150ms ±80ms，丢包 1% | 模拟 4G/5G 典型移动网络 |
| bad | delay 300ms ±150ms，丢包 3% | 模拟网络拥塞或信号极差环境 |

### 结果指标 / Result Metrics

| 指标 | 含义 | 关注要点 |
|---|---|---|
| 成功连接 / 失败 | TCP/WebSocket 握手成功与失败次数 | 失败率应接近 0%；weak 场景若显著上升，需检查握手超时 |
| 平均连接延迟 | 从发起连接到握手完成的平均耗时 | 对 RTT 敏感；mobile 场景通常比 normal 高 1~2 倍 RTT |
| 房间创建 / 失败 | 房间创建成功与失败次数 | 失败通常与连接断开或服务器内部错误有关 |
| 加入成功 / 失败 | 玩家加入房间成功与失败次数 | 高失败率可能意味着房间状态同步异常或超时阈值过短 |
| 消息发送 / 失败 | gameplay 阶段消息发送成功与失败次数 | 大量失败通常由连接断开导致；需区分丢包与断连 |
| 消息每秒 | 服务端实际接收的消息速率 | 受 netem 丢包影响；显著下降时需评估缓冲/重传策略 |

### 进程指标 / Process Metrics

| 指标 | 含义 | 关注要点 |
|---|---|---|
| RSS | 进程常驻内存（含 C++ 层、V8 堆外内存、缓冲区） | 峰值反映整体内存占用；multi-scenario 连续运行时注意累积效应 |
| HeapUsed | V8 堆内存使用量 | 若持续增长可能存在内存泄漏；benchmark 结束后应回落至基线 |
| EL 延迟均值 | 事件循环（Event Loop）延迟平均值，反映主线程繁忙程度 | 持续 > 50 ms 表示主线程阻塞风险，可能影响消息及时处理 |
| EL 延迟 P95 最大 | 所有采样中 P95 延迟的最大值 | 突发峰值指标；接近或超过 100 ms 需警惕瞬时拥塞 |
| CPU 平均 / 峰值 | 进程占用的单核 CPU 百分比 | 峰值持续接近 100% 意味着单核计算瓶颈 |
| 内存% | 进程 RSS 占系统总内存的比例 | 超过 80% 可能触发系统 OOM 或交换分区抖动 |

## 备注 / Notes

- **客户端进程指标**采集自 benchmark 运行进程本身（内存占用、事件循环延迟等）。
  **Client process metrics** are collected from the benchmark runner process itself.
- **服务端进程指标**通过在 Linux 上读取 /proc/<pid>/stat 与 /proc/<pid>/status 采集。
  **Server process metrics** are collected by reading /proc/<pid>/stat and /proc/<pid>/status on Linux.
- CPU 占用率以单核为基准（100% = 一个完整核心）。
  CPU percentage is relative to a single core (100% = one full core).
- 内存百分比为进程 RSS 占系统总内存的比例。
  Memory percentage is the process RSS as a percentage of total system memory.
- GitHub Actions 运行器性能存在波动，这些数据仅供版本间对比参考。
  GitHub Actions runner performance varies; use these numbers for version-to-version comparison only.
- **弱网场景解读建议 / Interpretation Guide**
  - 若 weak 场景下连接延迟增加超过 2 倍，说明握手阶段对 RTT 敏感，建议评估是否启用 TCP Fast Open 或缩短握手轮次。
  - 若 mobile 场景下房间创建或加入失败率显著上升，需检查超时阈值是否过于激进（如 < 3s）。
  - 若 bad 场景下消息吞吐下降超过 50%，建议评估消息合并（batching）、心跳补偿或前向纠错机制。
  - 事件循环延迟在 weak/mobile 场景下若出现数量级增长，通常意味着丢包触发了大量重传或超时回调堆积。
