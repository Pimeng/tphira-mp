# Phira 分布式联机服务器互通规范 (v1.0)

## 1. 总体架构图

* **边缘服务器 (Edge Servers)**：由各服主开发（Rust, Node.js 等），负责 TCP 连接、ULEB128 解包、BinaryData 编解码及逻辑转发。
* **状态层 (Redis)**：存储所有在线玩家、房间信息，作为唯一的事实来源。
* **消息总线 (Redis Pub/Sub)**：负责跨服务器的消息实时通知。

---

## 2. Redis 数据结构定义

所有 Key 使用 `mp:` 作为前缀，以防与其他业务冲突。

### 2.1 玩家会话 (Player Session)

* **Key**: `mp:player:{uid}:session`
* **Type**: Hash
* **Fields**:
* `server_id`: 字符串，标识玩家当前连接的物理服务器 ID。
* `room_id`: 字符串，玩家当前所在房间 ID，若不在房间内则为 `String(Null)`。
* `name`: 字符串，从 HTTP API 获取的用户名。
* `is_monitor`: 布尔值，是否为观战者。

### 2.2 房间信息 (Room Info)

* **Key**: `mp:room:{rid}:info`
* **Type**: Hash
* **Fields**:
* `host_id`: 整数，当前房主的 UID。
* `state`: 整数，对应 `RoomState`：`0: SelectChart`, `1: WaitingForReady`, `2: Playing`。
* `chart_id`: 整数，当前选中的谱面 ID。
* `is_locked`: 布尔值，房间是否锁定。
* `is_cycle`: 布尔值，是否开启循环模式。



### 2.3 房间成员 (Room Players)

* **Key**: `mp:room:{rid}:players`
* **Type**: Set
* **Content**: 存储该房间内所有玩家的 `uid`。

---

## 3. 跨服务器通讯协议 (Pub/Sub)

所有服务器必须订阅 `mp:events` 频道。消息统一采用 **JSON** 字符串格式，以便跨语言解析。

### 3.1 消息格式

```json
{
  "event": "EVENT_TYPE",
  "room_id": 1001,
  "data": { ... }
}
```

### 3.2 核心事件类型

| 事件类型 (Event) | 触发场景 | `data` 内容示例 |
| --- | --- | --- |
| `ROOM_CREATE` | 房间被某人创建 | `{ "uid": 123, "name": "PlayerName" }` |
| `ROOM_DELETE` | 房间被个服务端删除（此处的删除必须由创建房间的服务器发送，其他服务器不要删除） | `{ "uid": 123, "name": "PlayerName" }` |
| `PLAYER_JOIN` | 玩家成功通过 Lua 加入房间 | `{ "uid": 123, "name": "PlayerName", "is_monitor": false }` |
| `PLAYER_LEAVE` | 玩家退出或掉线 | `{ "uid": 123, "is_host_changed": true, "new_host": 456 }` |
| `STATE_CHANGE` | 房主切换状态 (如开始游戏) | `{ "new_state": 2, "chart_id": 789 }` |
| `SYNC_SCORE` | 玩家同步成绩ID | `{ "uid": 123, "record_id": "114514" }` |

---

## 4. 关键业务逻辑流

### 4.1 鉴权与心跳

1. **鉴权**：服务器收到 `Authenticate` 指令后，调用 `https://phira.5wyxi.com/me`。验证通过后，将用户信息写入 Redis Session。
2. **心跳**：服务器必须每 3 秒处理一次 `Ping`，并更新 Redis 中该玩家的 `last_seen` 时间戳。

### 4.2 原子性加入房间 (Lua 脚本)

为防止并发导致房间人数超限，必须使用 Lua 脚本处理 `JoinRoom`：

```lua
-- KEYS[1]: mp:room:{rid}:players
-- ARGV[1]: player_uid, ARGV[2]: max_players
local current_count = redis.call('SCARD', KEYS[1])
if current_count < tonumber(ARGV[2]) then
    redis.call('SADD', KEYS[1], ARGV[1])
    return 1 -- 成功
else
    return 0 -- 房间已满
end

```

### 4.3 广播机制

1. **发送端**：服务器 A 收到房主发送的 `SelectChart` 指令。
2. **处理**：服务器 A 更新 Redis 房间信息，并向 `mp:events` 发送 `STATE_CHANGE` JSON 消息。
3. **接收端**：所有服务器（包括 A 自己）收到该 JSON，检查本地是否有属于该房间的玩家连接。
4. **推送**：若有，则将 JSON 转换为 `BinaryData` 编码的 `ServerCommand::Message(SelectChart)` 发送给对应的 TCP 客户端。
5. **清理**：当服务器关闭的时候，向 Redis 发送清理自己的连接信息，房间信息，玩家信息，若有自己有房主、玩家存在的房间则按照具体情况清理（房主则移交房主权限，玩家则广播离开房间）

---

## 5. 开发实施核对表 (Checklist)

* [ ] **协议层**：是否实现了 ULEB128 变长整数解码？
* [ ] **协议层**：是否实现了 1 字节版本号握手？
* [ ] **Redis层**：所有服主是否统一了 Key 的前缀和 JSON 字段名？
* [ ] **逻辑层**：当 TCP 连接断开时，是否能够自动触发 `LeaveRoom` 逻辑清理 Redis？
* [ ] **监控层**：`Touches` 和 `Judges` 实时数据是否只走 Pub/Sub 而不写数据库（保证性能）？