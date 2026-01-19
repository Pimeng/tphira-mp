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

开发模式（不产物，直接运行 TS）：

```bash
pnpm run dev:server -- --port 12346
```

生产模式（先编译再运行）：

```bash
pnpm run build
pnpm start -- --port 12346
```

## 服务端配置（server_config.yml）

工作目录下可放置 `server_config.yml`，用于配置允许以“旁观/观战（monitor）”身份加入房间的用户 ID 列表。

示例：

```yml
monitors:
  - 10001
  - 10002
```

未提供该文件时默认值为：

```yml
monitors:
  - 2
```

## 协议要点（与 Rust 对齐）

- 连接建立时握手版本字节
  - 客户端：连接后先写 1 字节 version（当前为 1）
  - 服务端：连接后先读 1 字节 version
- 每个数据包：`len(varint-u32, 7bit continuation, <= 5字节) + payload`
  - 单包 payload 上限 2 MiB
- payload 使用自定义二进制序列化（小端）：
  - `String`：`uleb(len) + bytes`
  - `Vec<T>`：`uleb(len) + elements`
  - `HashMap<K,V>`：`uleb(len) + (K,V)...`
  - `Uuid`：`low(u64-le) + high(u64-le)`（与 Rust 的 `from_u64_pair/as_u64_pair` 逻辑一致）
  - `CompactPos`：`f16 bits`（两个 `u16-le`）
- 枚举序列化：`u8 tag + payload`，tag 顺序严格等同 Rust 源文件中的 variant 声明顺序

## 客户端库使用示例

```ts
import { Client } from "./dist/client/client.js";

const client = await Client.connect("127.0.0.1", 12346);
await client.authenticate("0123456789abcdef0123456789abcdef");

await client.createRoom("room1");
await client.selectChart(1);
await client.requestStart();
await client.ready();

console.log(client.takeMessages());
await client.close();
```

## 测试

```bash
pnpm test
```

- `test/protocol.test.ts`：协议 golden（含 f16 CompactPos 等关键点）
- `test/integration.test.ts`：端到端流程（使用 mock 的 `/me`、`/chart/{id}`、`/record/{id}`）

## 致谢

- [Phira MP（Rust 版）](https://github.com/TeamFlos/phira-mp)：项目本体，协议与核心逻辑参考
- [TRAE](https://www.trae.ai/)：本项目IDE，以及 SOLO 模式的提供
- GPT-5.2 模型