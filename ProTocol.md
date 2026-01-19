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

- `test/protocol.test.ts`：协议 golden（含 f16 CompactPos 等关键点）
- `test/integration.test.ts`：端到端流程（使用 mock 的 `/me`、`/chart/{id}`、`/record/{id}`）