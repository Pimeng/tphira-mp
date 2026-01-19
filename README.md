# Phira MP（Node.js 版）

> [!TIP]
> 本项目由 TRAE SOLO 模式开发，存在一定的问题，见谅，如有更好的实现欢迎 PR。
> 目前为早期移植版本，仅实现了基础功能，后续会持续完善。
> 不会写代码，勿喷（（（

本项目基于 https://github.com/TeamFlos/phira-mp 中的实现，将同一套多人联机/观战服务按原逻辑迁移到 Node.js（TypeScript）版本，目标是保持协议与核心行为一致（握手、编解码、房间状态机、观战转发、认证流程等）。

## 环境要求

- Node.js >= 22

## 目录结构

- `src/common/`：协议层（二进制编解码、长度前缀 framing、Stream）
- `src/server/`：服务端（会话/用户/房间、断线处理、本地化、入口）
- `src/client/`：客户端库（连接、心跳、回调式调用、状态缓存）
- `locales/`：Fluent 本地化资源（与 Rust 版本一致）
- `test/`：协议 golden + 端到端集成测试（内置 mock 远端 HTTP）
- `RUST-SRC/`：Rust 参考实现（不做修改）

## 安装与构建

```bash
pnpm install
pnpm run build
```

## 启动服务端

开发模式（从源代码运行）：

```bash
pnpm run dev:server -- --port 12346
```

生产模式（先编译再运行）：

```bash
pnpm run build
pnpm start -- --port 12346
```

## 日志系统

- 输出位置：运行时会自动创建 `logs/` 文件夹，并按“运行设备本地日期”每天生成一个日志文件，例如 `logs/2026-01-19.log`。
- 输出范围：同一条日志会同时输出到终端与日志文件。
- 输出格式：`[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL] 文本信息`（面向人阅读）；终端会按等级着色（INFO 绿、MARK 灰）。
- 日志等级：
  - `MARK`：一般详细（例如：启动信息、连接/认证、房间事件、对局开始/结束、上传记录等）
  - `INFO`：比较详细（例如：触控帧/判定事件数量、聊天等）
  - `WARN`/`ERROR`：异常与错误
- 可选环境变量：
  - `LOG_LEVEL`：控制写入日志文件的最小等级（默认 `INFO`）
  - `CONSOLE_LOG_LEVEL`：控制输出到终端的最小等级（默认 `INFO`）

## 服务端配置（server_config.yml）

- server_name(string): 当前服务器名字，会显示在欢迎信息中
- monitors(array): 观战用户ID列表（默认 `2`）

未提供该文件时默认值为：

```yml
server_name: Phira MP
monitors:
  - 2
```

会解析为：

```json
{
  "server_name": "Phira MP",
  "monitors": [2]
}
```

## 测试

```bash
pnpm test
```

## 致谢

- [Phira MP（Rust 版）](https://github.com/TeamFlos/phira-mp)：项目本体，协议与核心逻辑参考
- [TRAE](https://www.trae.ai/)：本项目IDE，以及 SOLO 模式的提供
- GPT-5.2 模型