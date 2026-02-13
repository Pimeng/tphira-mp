# WebSocket API 文档

## 概述

服务器提供 WebSocket 支持，用于实时推送房间状态更新和公屏消息。WebSocket 服务复用 HTTP 端口，通过 `/ws` 路径访问。

## 连接

```
ws://服务器地址:HTTP端口/ws
```

例如：`ws://localhost:12347/ws`

## 消息格式

所有消息均为 JSON 格式。

### 客户端发送的消息

#### 1. 订阅房间更新

```json
{
  "type": "subscribe",
  "roomId": "房间ID",
  "userId": 123  // 可选，用户ID
}
```

#### 2. 取消订阅

```json
{
  "type": "unsubscribe"
}
```

#### 3. 心跳

```json
{
  "type": "ping"
}
```

### 服务器推送的消息

#### 1. 订阅成功

```json
{
  "type": "subscribed",
  "roomId": "房间ID"
}
```

#### 2. 取消订阅成功

```json
{
  "type": "unsubscribed"
}
```

#### 3. 心跳响应

```json
{
  "type": "pong"
}
```

#### 4. 房间状态更新

```json
{
  "type": "room_update",
  "data": {
    "roomid": "房间ID",
    "state": "select_chart" | "waiting_for_ready" | "playing",
    "locked": false,
    "cycle": false,
    "live": false,
    "chart": {
      "name": "谱面名称",
      "id": 12345
    },
    "host": {
      "id": 123,
      "name": "房主名称"
    },
    "users": [
      {
        "id": 123,
        "name": "玩家名称",
        "is_ready": false
      }
    ],
    "monitors": [
      {
        "id": 456,
        "name": "观察者名称"
      }
    ]
  }
}
```

#### 5. 房间日志（INFO 级别）

```json
{
  "type": "room_log",
  "data": {
    "message": "日志消息内容",
    "timestamp": 1234567890000
  }
}
```

说明：
- 推送 INFO 级别的日志消息，包括玩家加入/离开、房主变更、游戏状态变化等
- 只推送与订阅房间相关的日志
- 日志消息为服务器端格式化后的文本

#### 6. 错误消息

```json
{
  "type": "error",
  "message": "错误描述"
}
```

可能的错误：
- `room-not-found`: 房间不存在
- `invalid-room-id`: 房间ID格式错误
- `invalid-message`: 消息格式错误
- `unauthorized`: 管理员权限验证失败

## 使用示例

### JavaScript/TypeScript

```typescript
const ws = new WebSocket('ws://localhost:12347/ws');

ws.onopen = () => {
  console.log('WebSocket 已连接');
  
  // 订阅房间
  ws.send(JSON.stringify({
    type: 'subscribe',
    roomId: 'test-room',
    userId: 123
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'subscribed':
      console.log('已订阅房间:', message.roomId);
      break;
      
    case 'room_update':
      console.log('房间状态更新:', message.data);
      // 更新UI显示房间状态
      break;
      
    case 'room_log':
      console.log('房间日志:', message.data.message);
      // 显示日志消息（玩家加入/离开等）
      break;
      
    case 'error':
      console.error('错误:', message.message);
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket 错误:', error);
};

ws.onclose = () => {
  console.log('WebSocket 已断开');
};

// 心跳保持连接
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 25000);
```

### Python

```python
import websocket
import json
import time
import threading

def on_message(ws, message):
    data = json.loads(message)
    msg_type = data.get('type')
    
    if msg_type == 'subscribed':
        print(f"已订阅房间: {data['roomId']}")
    elif msg_type == 'room_update':
        print(f"房间状态更新: {data['data']}")
    elif msg_type == 'room_log':
        print(f"房间日志: {data['data']['message']}")
    elif msg_type == 'error':
        print(f"错误: {data['message']}")

def on_error(ws, error):
    print(f"WebSocket 错误: {error}")

def on_close(ws, close_status_code, close_msg):
    print("WebSocket 已断开")

def on_open(ws):
    print("WebSocket 已连接")
    
    # 订阅房间
    ws.send(json.dumps({
        'type': 'subscribe',
        'roomId': 'test-room',
        'userId': 123
    }))
    
    # 心跳线程
    def heartbeat():
        while True:
            time.sleep(25)
            try:
                ws.send(json.dumps({'type': 'ping'}))
            except:
                break
    
    threading.Thread(target=heartbeat, daemon=True).start()

if __name__ == "__main__":
    ws = websocket.WebSocketApp(
        "ws://localhost:12347/ws",
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close
    )
    
    ws.run_forever()
```

## 注意事项

1. WebSocket 连接会自动进行心跳检测（服务器每30秒发送一次 ping）
2. 客户端应该响应服务器的 ping 帧，或定期发送 ping 消息保持连接
3. 订阅房间后，会立即收到一次当前房间状态
4. 房间状态变化时会自动推送更新
5. INFO 级别的日志会实时推送给所有订阅该房间的客户端（包括玩家加入/离开、房主变更等）
6. 一个 WebSocket 连接同时只能订阅一个房间，订阅新房间会自动取消之前的订阅

## 触发房间状态更新的事件

- 玩家加入/离开房间
- 房主选择谱面
- 游戏开始（进入等待准备状态）
- 玩家准备/取消准备
- 游戏正式开始（所有人准备完毕）
- 游戏结束
- 房间设置变更（锁定、循环模式等）
- 房主变更


## 管理员 WebSocket API

管理员可以通过 WebSocket 实时监控所有房间的详细状态。

### 管理员订阅

#### 订阅所有房间

```json
{
  "type": "admin_subscribe",
  "token": "管理员Token"
}
```

#### 取消订阅

```json
{
  "type": "admin_unsubscribe"
}
```

### 管理员消息响应

#### 订阅成功

```json
{
  "type": "admin_subscribed"
}
```

#### 取消订阅成功

```json
{
  "type": "admin_unsubscribed"
}
```

#### 房间状态更新（增量推送）

```json
{
  "type": "admin_update",
  "data": {
    "timestamp": 1234567890000,
    "changes": {
      "rooms": [
        {
          "roomid": "房间ID",
          "max_users": 8,
          "current_users": 3,
          "current_monitors": 1,
          "replay_eligible": true,
          "live": false,
          "locked": false,
          "cycle": false,
          "host": {
            "id": 123,
            "name": "房主名称",
            "connected": true
          },
          "state": {
            "type": "select_chart" | "waiting_for_ready" | "playing",
            "ready_users": [123, 456],
            "ready_count": 2,
            "results_count": 1,
            "aborted_count": 0,
            "finished_users": [123],
            "aborted_users": []
          },
          "chart": {
            "name": "谱面名称",
            "id": 12345
          },
          "contest": {
            "whitelist_count": 5,
            "whitelist": [123, 456, 789],
            "manual_start": true,
            "auto_disband": true
          },
          "users": [
            {
              "id": 123,
              "name": "玩家名称",
              "connected": true,
              "is_host": true,
              "game_time": 1234567890,
              "language": "zh-CN",
              "finished": false,
              "aborted": false,
              "record_id": null
            }
          ],
          "monitors": [
            {
              "id": 456,
              "name": "观察者名称",
              "connected": true,
              "language": "en-US"
            }
          ]
        }
      ],
      "total_rooms": 10
    }
  }
}
```

### 管理员数据说明

管理员 WebSocket 提供与 `/admin/rooms` API 一致的详细信息，包括：

- 房间基本信息（ID、最大人数、当前人数等）
- 房间状态（选择谱面、等待准备、游戏中）
- 房主信息（ID、名称、连接状态）
- 谱面信息
- 比赛模式配置
- 玩家详细信息（连接状态、游戏时间、语言、游玩状态等）
- 观察者详细信息

### 增量更新机制

为了优化性能，管理员 WebSocket 采用增量更新机制：

1. 首次订阅时，推送完整的房间列表
2. 后续只在房间状态发生变化时推送更新
3. 如果没有任何变化，不会推送重复数据
4. 每次推送都包含完整的房间列表（而非差异）

这样既保证了数据的完整性，又避免了不必要的网络传输。

### 管理员使用示例

```javascript
const ws = new WebSocket('ws://localhost:12347/ws');

ws.onopen = () => {
  console.log('WebSocket 已连接');
  
  // 使用管理员 Token 订阅
  ws.send(JSON.stringify({
    type: 'admin_subscribe',
    token: 'your-admin-token'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'admin_subscribed':
      console.log('管理员订阅成功');
      break;
      
    case 'admin_update':
      console.log('房间状态更新:', message.data);
      // 更新管理面板显示
      updateAdminDashboard(message.data.changes.rooms);
      break;
      
    case 'error':
      console.error('错误:', message.message);
      if (message.message === 'unauthorized') {
        console.error('管理员 Token 无效');
      }
      break;
  }
};

// 心跳保持连接
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 25000);
```

### 权限验证

- 管理员订阅需要提供有效的管理员 Token
- Token 验证失败会返回 `unauthorized` 错误
- 支持永久管理员 Token（配置文件中的 `admin_token`）
- 支持临时 Token（通过 OTP 验证获取，有效期 4 小时）
  - 临时 Token 绑定生成时的 IP 地址
  - 如果检测到 IP 不匹配，Token 会被自动封禁
  - 临时 Token 过期后会自动清理

### 使用场景

- 实时监控面板
- 房间管理工具
- 服务器状态监控
- 数据分析和统计
- 自动化管理脚本

### 性能考虑

- 管理员订阅会接收所有房间的更新
- 建议限制同时连接的管理员客户端数量
- 大量房间时，更新频率可能较高
- 可以在客户端实现节流（throttle）来控制更新频率
