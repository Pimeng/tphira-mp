# API 使用说明

本项目内置一个轻量 HTTP 服务，提供房间列表与管理员 API。管理员 API 需要 `ADMIN_TOKEN` 鉴权。

> [!NOTE]
> 关于谱面分享站：
> 
> API/前端地址：http://183.66.27.19:40004
> 
> 如需上传Token，请添加Evidence https://rymc.ltd/e 询问相关事宜

## 启用与鉴权

### 启用 HTTP 服务

通过环境变量或配置文件启用：

- 环境变量：
  - `HTTP_SERVICE=true`
  - `HTTP_PORT=12347`（可选，默认 12347）
- 配置文件 `server_config.yml`：
  - `http_service: true`
  - `http_port: 12347`

### 设置 ADMIN_TOKEN

管理员 API 默认禁用；只有配置了 token 才可访问。

- 环境变量：`ADMIN_TOKEN=your_token`
- 配置文件：`ADMIN_TOKEN: "your_token"`

请求携带 token 的方式（三选一）：

- Header：`X-Admin-Token: your_token`
- Header：`Authorization: Bearer your_token`
- Query：`?token=your_token`

未配置 `ADMIN_TOKEN`：返回 `403 { "ok": false, "error": "admin-disabled" }`  
token 错误/缺失：返回 `401 { "ok": false, "error": "unauthorized" }`

### 临时管理员TOKEN（OTP方式）

当未配置 `ADMIN_TOKEN` 时，可以使用一次性验证码（OTP）方式获取临时管理员TOKEN。  
此外还支持 **CLI 直接批准** 模式：通过参数指示，跳过验证码并由服务器终端管理员人工批准发放临时 TOKEN（与 OTP 流程复用同一对接口）。

#### 1) 请求一次性验证码 / 提权批准

`POST /admin/otp/request`

可选 Body：

```json
{ "mode": "otp" }
```

或 CLI 批准模式：

```json
{ "mode": "cli" }
```

说明：
- 仅当未配置 `ADMIN_TOKEN` 时可用
- `mode` 可选 `"otp"`（默认）或 `"cli"`
  - `"otp"`：与原行为一致，服务器在终端打印验证码，前端再调 `/admin/otp/verify` 提交验证码换取临时 TOKEN
  - `"cli"`：服务器在终端打印一条 **CLI 提权申请**（包含请求 IP、`ssid`、短码），等待管理员在 CLI 输入 `approve <ssid>` 或 `deny <ssid>`；前端通过 `/admin/otp/verify` 携带 `mode: "cli"` 轮询批准结果
- 不传 `mode` 或传非 `cli`/`otp` 的值，按 `"otp"` 处理（保持向后兼容）
- 会话有效期：1 分钟（OTP 与 CLI 提权申请共用此时长）
- 验证码 / CLI 申请会输出到服务器终端（INFO 级别），不写入日志文件

返回示例（OTP 模式）：

```json
{
  "ok": true,
  "ssid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "expiresIn": 60000,
  "mode": "otp"
}
```

返回示例（CLI 模式）：

```json
{
  "ok": true,
  "ssid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "expiresIn": 60000,
  "mode": "cli"
}
```

终端输出示例（OTP 模式）：
```
[2026-02-11T10:30:00.000Z] [INFO] [OTP Request] 您正在尝试请求验证码登录管理员后台 API，本次请求的验证码是 abcd1234，会话ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx, 1分钟内有效
```

终端输出示例（CLI 模式）：
```
[2026-02-11T10:30:00.000Z] [INFO] [OTP CLI Request] 收到管理员提权申请，请求IP: 1.2.3.4，会话ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx（短码: xxxxxxxx），1分钟内有效。使用 'approve xxxxxxxx' 批准或 'deny xxxxxxxx' 拒绝
```

#### 2) 验证OTP / 查询 CLI 批准结果

`POST /admin/otp/verify`

Body（OTP 模式）：

```json
{
  "ssid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "otp": "abcd1234"
}
```

Body（CLI 模式）：

```json
{
  "ssid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "mode": "cli"
}
```

说明：
- `mode` 默认 `"otp"`，必须与请求时使用的模式一致
- OTP 模式：验证成功后返回临时 TOKEN
- CLI 模式：根据当前批准状态返回不同结果，前端可定时轮询直到拿到 token 或被拒绝
  - 待批准：`202 { ok: false, error: "pending-approval", status: "pending" }`
  - 已拒绝：`403 { ok: false, error: "approval-denied", status: "denied" }`
  - 已批准：`200` 返回 token（与 OTP 模式一致），返回后会话即被销毁，`token` 仅可获取一次
  - 仅同 IP 可轮询（与请求时的 IP 必须一致），否则 `403 ip-mismatch`
- 临时TOKEN有效期 4 小时，绑定请求 IP，仅该 IP 可使用
- 若检测到不同IP使用同一TOKEN，该TOKEN会被封禁（但返回错误仍为"token-expired"）
- 临时TOKEN权限与永久管理员TOKEN完全一致

返回示例（验证 / 批准成功）：

```json
{
  "ok": true,
  "token": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "expiresAt": 1707649800000,
  "expiresIn": 14400000,
  "mode": "cli"
}
```

> `mode` 字段在 OTP 模式下被省略，CLI 模式下为 `"cli"`。

常见错误：
- 已配置永久TOKEN时：`403 { "ok": false, "error": "otp-disabled-when-token-configured" }`
- 参数不合法：`400 { "ok": false, "error": "bad-request" }`
- OTP无效或过期：`401 { "ok": false, "error": "invalid-or-expired-otp" }`
- CLI 会话无效或过期：`401 { "ok": false, "error": "invalid-or-expired-session" }`
- CLI 模式 IP 不匹配：`403 { "ok": false, "error": "ip-mismatch" }`
- CLI 模式批准被拒：`403 { "ok": false, "error": "approval-denied", "status": "denied" }`
- CLI 模式仍待批准：`202 { "ok": false, "error": "pending-approval", "status": "pending" }`
- TOKEN过期或IP不匹配：`401 { "ok": false, "error": "token-expired" }`

## 数据持久化（封禁相关）

封禁（服务器封禁 / 房间禁入）会自动落盘到 JSON 文件，启动时自动加载。

- 默认路径：`admin_data.json`（位于 `PHIRA_MP_HOME` 或工作目录）
- 覆盖路径：
  - 环境变量：`ADMIN_DATA_PATH=/path/to/admin_data.json`
  - 配置文件：`ADMIN_DATA_PATH: "/path/to/admin_data.json"`

### 比赛房间（一次性房间）

比赛房间（白名单/手动开始 + 结算后自动解散）是仅内存状态，重启失效。

## IP黑名单管理

服务器会自动对日志限流触发的IP进行封禁，防止日志洪水攻击。管理员可以通过API或CLI命令管理IP黑名单。

### 查看IP黑名单

`GET /admin/ip-blacklist`

返回示例：

```json
{
  "ok": true,
  "blacklist": [
    {
      "ip": "192.168.1.100",
      "expiresIn": 3600000
    }
  ]
}
```

### 移除IP黑名单

`POST /admin/ip-blacklist/remove`

Body：

```json
{ "ip": "192.168.1.100" }
```

成功：`200 { "ok": true }`

### 清空IP黑名单

`POST /admin/ip-blacklist/clear`

成功：`200 { "ok": true }`

### 查看当前日志速率

`GET /admin/log-rate`

返回示例：

```json
{
  "ok": true,
  "rate": {
    "logsPerSecond": 10.5,
    "threshold": 100
  }
}
```

## 公共接口

### 获取房间列表（无需鉴权）

`GET /room`

返回示例：

```json
{
  "rooms": [
    {
      "roomid": "room1",
      "cycle": false,
      "lock": false,
      "host": { "name": "Alice", "id": "100" },
      "state": "select_chart",
      "chart": { "name": "Chart-1", "id": "1" },
      "players": [{ "name": "Alice", "id": 100 }]
    }
  ],
  "total": 1
}
```

### 谱面回放接口（无需 ADMIN_TOKEN）

回放相关接口需要启用 HTTP 服务（见上文“启用 HTTP 服务”），但**不需要** `ADMIN_TOKEN`。

服务器会在对局开始时自动录制玩家上报的原始数据（touch frame、judgement event 等），并落盘到：

`record/{用户ID}/{谱面ID}/{时间戳}.phirarec`

并在每天 0 点清理超过 4 天的回放文件（按文件名时间戳判断）。

#### 1) 认证并获取回放列表

`POST /replay/auth`

Body：

```json
{ "token": "your_user_token" }
```

返回示例：

```json
{
  "ok": true,
  "userId": 100,
  "charts": [
    {
      "chartId": 1,
      "replays": [
        { "timestamp": 1730000000000, "recordId": 123 },
        { "timestamp": 1730000001000, "recordId": 0, "scoreId": 456, "downloadUrl": "http://share.station/download/replay/456" }
      ]
    }
  ],
  "sessionToken": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "expiresAt": 1730001800000
}
```

- `token`：Phira 主站 token（与客户端 TCP 鉴权相同），服务端会用它去请求 `/me` 以确定用户身份。
- `sessionToken`：临时 token，仅用于下载该用户自己的回放文件（默认 30 分钟有效）。
- 已上传到分享站的回放会包含 `scoreId` 和 `downloadUrl`，未上传的只包含 `recordId`。

#### 2) 下载回放文件

`GET /replay/download?sessionToken=...&chartId=...&timestamp=...`

- 本地文件：返回 `application/octet-stream` 的 `.phirarec` 文件（限速 50KB/s）
- 已上传文件：返回 `302` 重定向到分享站下载链接

- `sessionToken`：来自 `/replay/auth`，仅允许下载该 token 绑定用户的回放
- `chartId`：谱面 ID
- `timestamp`：回放文件名中的时间戳（毫秒）

#### 3) 删除回放文件

`POST /replay/delete`

Body：

```json
{ "sessionToken": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "chartId": 1, "timestamp": 1730000000000 }
```

成功：`200 { "ok": true }`

- 仅允许删除该 `sessionToken` 绑定用户自己的回放文件
- 删除后不可恢复；同一回放再次下载会返回 `404`

常见错误：

- 参数不合法：`400 { "ok": false, "error": "bad-request" }`
- `sessionToken` 无效/过期：`401 { "ok": false, "error": "unauthorized" }`
- 回放不存在：`404 { "ok": false, "error": "not-found" }`

#### 回放文件格式（.phirarec）

文件头固定 14 字节（小端）：

- 2 字节：文件标识（UInt16LE，固定为 `0x504D`）
- 4 字节：谱面 ID（UInt32LE）
- 4 字节：用户 ID（UInt32LE）
- 4 字节：成绩 ID（UInt32LE，若无成绩则为 0）

后续为原生数据流（服务端收到的 Touches/Judges 等命令会按现有协议编码写入）。

#### 4) 上传回放到分享站（使用用户TOKEN鉴权）

`POST /replay/upload`

将服务器上已存在的回放文件上传到Phira Replay分享站。

Body：

```json
{
  "token": "your_phira_user_token",
  "chartId": 1,
  "timestamp": 1730000000000
}
```

- `token`：Phira用户TOKEN，用于鉴权
- `chartId`：谱面ID
- `timestamp`：要上传的回放文件时间戳（来自 `/replay/auth` 返回的回放列表）

curl示例：

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"token":"your_phira_user_token","chartId":1,"timestamp":1730000000000}' \
  http://127.0.0.1:12347/replay/upload
```

返回示例：

```json
{
  "ok": true,
  "userId": 100,
  "chartId": 1,
  "recordId": 123,
  "scoreId": 456,
  "message": "upload-success"
}
```

说明：

- 使用**用户TOKEN**鉴权（与 `/replay/auth` 相同），而非管理员TOKEN
- 只能上传该用户自己拥有的回放文件
- 接口会复用原有的文件读取逻辑（与下载接口相同），包括：
  - 使用 `replayFilePath` 构建安全路径，防止路径穿透攻击
  - 使用 `readReplayHeader` 验证文件头和用户权限
  - 验证文件实际存在且是有效文件
- 上传流程：
  1. 调用分享站 `POST /upload_direct` 接口上传文件
  2. 调用 `POST /show/{score_id}` 设置为显示（用户手动上传默认显示）
- **手动上传的 `show` 属性默认为 `true`（显示）**
- 原服务器上的文件不会被删除或修改

常见错误：

- 参数不合法：`400 { "ok": false, "error": "bad-request" }`
- TOKEN无效：`401 { "ok": false, "error": "unauthorized" }`
- 路径不合法（路径穿透）：`403 { "ok": false, "error": "path-not-allowed" }`
- 回放不存在或无权访问：`404 { "ok": false, "error": "not-found" }`
- 分享站未配置：`503 { "ok": false, "error": "share-station-not-configured" }`
- 上传失败：`500 { "ok": false, "error": "upload-failed" }`

#### 5) 自动上传配置接口（使用用户TOKEN鉴权）

允许用户配置游戏结束后是否自动将回放上传到分享站。

**注意**：需要服务器配置了 `SHARE_STATION` 才能正常工作。详见 [分享站配置](#分享站配置)。

##### 查询自动上传配置

`GET /replay/auto-upload/config?token=your_phira_user_token`

返回示例：

```json
{
  "ok": true,
  "userId": 100,
  "show": false,
  "shareStationConfigured": true,
  "autoUploadEnabled": true
}
```

- `show`：自动上传的文件是否显示（`false` 表示不显示，`true` 表示显示）
- `shareStationConfigured`：服务器是否配置了分享站
- `autoUploadEnabled`：服务器是否启用了自动上传（如果为 `false`，自动上传不会生效）

##### 修改自动上传配置

`POST /replay/auto-upload/config`

Body：

```json
{
  "token": "your_phira_user_token",
  "show": false
}
```

- `token`：Phira用户TOKEN，用于鉴权（**必需**）
- `show`：自动上传的文件是否显示（**可选**，不传递则保持原值）
  - `false`（默认）：自动上传的文件在分享站不显示
  - `true`：自动上传的文件在分享站显示

curl示例：

```bash
# 设置上传的文件不显示
curl -X POST -H "Content-Type: application/json" \
  -d '{"token":"your_phira_user_token","show":false}' \
  http://127.0.0.1:12347/replay/auto-upload/config

# 设置上传的文件显示
curl -X POST -H "Content-Type: application/json" \
  -d '{"token":"your_phira_user_token","show":true}' \
  http://127.0.0.1:12347/replay/auto-upload/config
```

返回示例：

```json
{
  "ok": true,
  "userId": 100,
  "show": false,
  "shareStationConfigured": true,
  "autoUploadEnabled": true
}
```

说明：

- 使用**用户TOKEN**鉴权（与 `/replay/auth` 相同），而非管理员TOKEN
- 自动上传会在游戏结束后**延迟30秒**执行
- 自动上传的文件 `show` 属性默认为 `false`（不显示），与手动上传不同
- 自动上传由服务器全局配置 `replay_auto_upload` 控制，用户无法单独禁用
- 如果服务器未配置分享站，回放将保留在本地，不会自动上传
- 上传成功后本地文件会被删除，只保留元数据，下载时返回分享站下载链接

##### 调用的Phira Replay API

自动上传功能会调用以下Phira Replay & Chart API：

1. **上传回放文件（内部接口）**
   - 端点：`POST /upload_direct`
   - 功能：供其他服务器自动上传 `.phirarec` 文件，自动从外部API拉取对应谱面文件和曲绘
   - 认证：使用服务器配置的 `SHARE_STATION.TOKEN` (Bearer Token)
   - 特点：通过此接口上传的记录 `is_visible` 默认为 0，不会在主页列表显示

2. **设置回放可见性**
   - 显示端点：`POST /show/{score_id}` (将 `is_visible` 设为 1)
   - 隐藏端点：`POST /hide/{score_id}` (将 `is_visible` 设为 0)
   - 功能：控制回放是否在主页列表中显示

根据用户 `show` 配置：
- `show: false`（默认）：使用 `/upload_direct` 上传，回放默认隐藏
- `show: true`：使用 `/upload_direct` 上传后，再调用 `/show/{score_id}` 设置为显示

常见错误：

- 缺少token：`400 { "ok": false, "error": "bad-token" }`
- 缺少参数：`400 { "ok": false, "error": "bad-request" }`
- TOKEN无效：`401 { "ok": false, "error": "unauthorized" }`

### 分享站配置

要启用分享站功能，需要在 `server_config.yml` 中配置：

```yaml
SHARE_STATION:
  # 分享站地址
  URL: "http://183.66.27.19:40004"
  # 服务器认证 token（用于自动上传等内部接口）
  TOKEN: "your_share_station_token_here"
```

或使用环境变量：
- `SHARE_STATION_URL`
- `SHARE_STATION_TOKEN`

## 管理员接口

下面所有接口都需要 `ADMIN_TOKEN` 鉴权。

### 1) 查询现在房间所有情况

`GET /admin/rooms`

返回示例（字段会随房间状态变化）：

```json
{
  "ok": true,
  "total_rooms": 2,
  "rooms": [
    {
      "roomid": "room1",
      "max_users": 8,
      "live": false,
      "locked": false,
      "cycle": false,
      "host": { "id": 100, "name": "Alice" },
      "state": {
        "type": "select_chart"
      },
      "chart": { "id": 1, "name": "Chart-1" },
      "users": [
        {
          "id": 100,
          "name": "Alice",
          "connected": true,
          "is_host": true,
          "game_time": -Infinity,
          "language": "zh-CN"
        }
      ],
      "monitors": [],
      "recent_logs": [
        { "message": "Alice 创建了房间", "timestamp": 1730000000000 },
        { "message": "管理员通知：请注意游戏规则", "timestamp": 1730000005000 }
      ]
    },
    {
      "roomid": "room2",
      "max_users": 8,
      "live": false,
      "locked": false,
      "cycle": false,
      "host": { "id": 200, "name": "Bob" },
      "state": {
        "type": "playing",
        "results_count": 1,
        "aborted_count": 0,
        "finished_users": [100],
        "aborted_users": []
      },
      "chart": { "id": 2, "name": "Chart-2" },
      "users": [
        {
          "id": 100,
          "name": "Alice",
          "connected": true,
          "is_host": false,
          "game_time": 1000,
          "language": "zh-CN",
          "finished": true,
          "aborted": false,
          "record_id": 123
        },
        {
          "id": 200,
          "name": "Bob",
          "connected": true,
          "is_host": true,
          "game_time": 1000,
          "language": "zh-CN",
          "finished": false,
          "aborted": false
        }
      ],
      "monitors": [],
      "recent_logs": [
        { "message": "Bob 创建了房间", "timestamp": 1730000010000 },
        { "message": "Bob 选择了谱面 Chart-2", "timestamp": 1730000015000 },
        { "message": "游戏开始，参与玩家：100、200", "timestamp": 1730000020000 },
        { "message": "Alice: 大家好", "timestamp": 1730000025000 }
      ]
    }
  ]
}
```

说明：

- `total_rooms`：当前房间总数
- `recent_logs`：房间最近 50 条日志/公屏消息，按时间顺序排列，包含：
  - **玩家聊天消息**
  - **系统事件消息**（与 Phira 客户端公屏显示的消息一致）：
    - 创建房间、加入/离开房间
    - 房主变更
    - 房间锁定/解锁
    - 房间循环模式切换（普通模式/循环模式）
    - 选择谱面
    - 请求开始游戏、玩家准备/取消准备
    - 游戏开始、游戏结束
    - 玩家完成游玩（上传成绩）、放弃游戏
  - 管理员通过 `/admin/broadcast` 或 `/admin/rooms/:roomId/chat` 发送的公屏消息
  - 游戏结算摘要
- 房间进行中（`state.type === "playing"`）时，每个玩家会包含以下额外字段：
  - `finished`：玩家是否已完成游玩（上传成绩或中止）
  - `aborted`：玩家是否中止了游玩
  - `record_id`：若玩家已上传成绩，此字段为成绩ID；否则不存在

### 1.1) 动态修改指定房间最大人数

`POST /admin/rooms/:roomId/max_users`

Body：

```json
{ "maxUsers": 8 }
```

成功：

```json
{ "ok": true, "roomid": "room1", "max_users": 8 }
```

说明：

- 仅影响该房间后续加入校验与房间列表过滤；不会踢出已在房间内的玩家
- `maxUsers` 限制范围：`1..64`

常见错误：

- 房间号不合法：`400 { "ok": false, "error": "bad-room-id" }`
- `maxUsers` 不合法：`400 { "ok": false, "error": "bad-max-users" }`
- 房间不存在：`404 { "ok": false, "error": "room-not-found" }`

### 1.2) 解散房间

`POST /admin/rooms/:roomId/disband`

说明：

- 立即解散指定房间，所有玩家和观战者会收到"房间已被管理员解散"的通知
- 若房间启用了回放录制，会自动结束该房间的录制
- 房间从服务器回收，后续无法加入

成功：

```json
{ "ok": true, "roomid": "room1" }
```

常见错误：

- 房间号不合法：`400 { "ok": false, "error": "bad-room-id" }`
- 房间不存在：`404 { "ok": false, "error": "room-not-found" }`

### 1.3) 回放录制开关（默认关闭）

查询当前状态：

`GET /admin/replay/config`

返回示例：

```json
{ "ok": true, "enabled": false }
```

开启/关闭：

`POST /admin/replay/config`

Body：

```json
{ "enabled": true }
```

成功：

```json
{ "ok": true, "enabled": true }
```

说明：

- `enabled=false` 会停止当前所有房间的录制（若有正在录制的文件，会关闭文件句柄并停止继续写入）
- `enabled=true` 仅对**开启后创建的房间**生效（已存在的房间/已在对局中的房间不会因此开始录制）

常见错误：

- Body 缺少 `enabled`：`400 { "ok": false, "error": "bad-enabled" }`

### 1.4) 房间创建开关（默认开启）

查询当前状态：

`GET /admin/room-creation/config`

返回示例：

```json
{ "ok": true, "enabled": true }
```

开启/关闭：

`POST /admin/room-creation/config`

Body：

```json
{ "enabled": false }
```

成功：

```json
{ "ok": true, "enabled": false }
```

说明：

- `enabled=false` 会禁止所有玩家创建新房间（已存在的房间不受影响）
- `enabled=true` 恢复允许创建房间
- 当房间创建被禁用时，玩家尝试创建房间会收到错误提示

常见错误：

- Body 缺少 `enabled`：`400 { "ok": false, "error": "bad-enabled" }`

### 2) 查询任意玩家在哪个房间

`GET /admin/users/:id`

返回示例：

```json
{
  "ok": true,
  "user": {
    "id": 100,
    "name": "Alice",
    "monitor": false,
    "connected": true,
    "room": "room1",
    "banned": false
  }
}
```

用户不存在：`404 { "ok": false, "error": "user-not-found" }`

### 3) 给某个玩家 ID 拉进黑名单（不得进入服务器）

`POST /admin/ban/user`

Body：

```json
{ "userId": 100, "banned": true, "disconnect": true }
```

- `banned=true`：封禁；`banned=false`：解封
- `disconnect=true`：若该玩家在线，会立刻断线
  - 对局中断线会尽量保持房间其他玩家流程正常（会发送 Abort 并触发结算检查）

返回：`200 { "ok": true }`

### 4) 禁止某玩家进入某个房间（房间级黑名单）

`POST /admin/ban/room`

Body：

```json
{ "userId": 100, "roomId": "room1", "banned": true }
```

返回：`200 { "ok": true }`

### 5) 立刻断线任意玩家（可选保留其房间位置）

> 相当于踢出玩家

`POST /admin/users/:id/disconnect`

默认会直接强制踢出房间并触发结算检查

返回：`200 { "ok": true }`  
玩家不在线：`404 { "ok": false, "error": "user-not-connected" }`

### 6) 转移玩家所在房间（用于管理员纠偏）

`POST /admin/users/:id/move`

Body：

```json
{ "roomId": "room2", "monitor": false }
```

限制（避免客户端/服务端状态不同步）：

- 玩家必须处于断线状态（`connected=false`）
- 源房间与目标房间都必须处于 `SelectChart`（非对局中）

成功：`200 { "ok": true }`

### 7) 全服广播通知

`POST /admin/broadcast`

Body：

```json
{ "message": "服务器将在10分钟后重启维护" }
```

说明：

- 向当前所有房间发送一条系统通知（以 user=0 的聊天消息形式）
- 消息长度限制：1-200 字符
- 返回发送的房间数量

成功：

```json
{ "ok": true, "rooms": 5 }
```

常见错误：

- 消息为空：`400 { "ok": false, "error": "bad-message" }`
- 消息过长：`400 { "ok": false, "error": "message-too-long" }`

### 7.1) 向指定房间发送消息

`POST /admin/rooms/:roomId/chat`

Body：

```json
{ "message": "管理员通知：请注意游戏规则" }
```

说明：

- 向指定房间发送一条系统通知（以 user=0 的聊天消息形式）
- 消息长度限制：1-200 字符
- 仅该房间内的玩家和观战者会收到消息

成功：

```json
{ "ok": true }
```

常见错误：

- 房间号不合法：`400 { "ok": false, "error": "bad-room-id" }`
- 消息为空：`400 { "ok": false, "error": "bad-message" }`
- 消息过长：`400 { "ok": false, "error": "message-too-long" }`
- 房间不存在：`404 { "ok": false, "error": "room-not-found" }`

## 比赛房间（一次性房间）

比赛房间用于“白名单限制 + 手动开始 + 结算后自动解散”。此模式仅影响被设置的房间，不影响其他房间。

### 启用/关闭比赛模式

`POST /admin/contest/rooms/:roomId/config`

Body：

```json
{ "enabled": true, "whitelist": [100, 200] }
```

- `enabled=true`：启用比赛模式（手动开始 + 结算后解散）
- `enabled=false`：关闭比赛模式（恢复普通房间）
- `whitelist` 为空时会默认取“当前房间内所有用户/观战者”为白名单

### 更新白名单

`POST /admin/contest/rooms/:roomId/whitelist`

Body：

```json
{ "userIds": [100, 200] }
```

会自动把“当前已经在房间内的用户/观战者”补进白名单，避免误踢。

### 手动开始比赛

房主发起 `RequestStart` 后房间进入 `WaitingForReady`，玩家可准备/下载谱面。比赛房间不会自动开始，必须调用：

`POST /admin/contest/rooms/:roomId/start`

Body：

```json
{ "force": false }
```

- `force=false`（默认）：必须全员 ready 才允许开始
- `force=true`：忽略未 ready 的玩家，直接开始

### 结算输出与解散

比赛房间在对局结束时会输出一条日志（包含谱面与成绩 JSON），并立即强制解散该房间（所有玩家退出房间，房间从服务器回收）。

## curl 示例

### 使用永久ADMIN_TOKEN

以 `room1` 为例：

```bash
export ADMIN_TOKEN=your_token
export HOST=http://127.0.0.1:12347

curl -H "X-Admin-Token: $ADMIN_TOKEN" "$HOST/admin/rooms"

curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":100,"banned":true,"disconnect":true}' \
  "$HOST/admin/ban/user"

curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":true,"whitelist":[100,200]}' \
  "$HOST/admin/contest/rooms/room1/config"

curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"force":false}' \
  "$HOST/admin/contest/rooms/room1/start"

curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"服务器将在10分钟后重启维护"}' \
  "$HOST/admin/broadcast"

curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"管理员通知：请注意游戏规则"}' \
  "$HOST/admin/rooms/room1/chat"

curl -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  "$HOST/admin/room-creation/config"

# 解散房间
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" \
  "$HOST/admin/rooms/room1/disband"
```

### 使用临时TOKEN（OTP方式）

当未配置永久ADMIN_TOKEN时：

```bash
export HOST=http://127.0.0.1:12347

# 1. 请求OTP（查看服务器终端获取验证码）
curl -X POST "$HOST/admin/otp/request"
# 返回: {"ok":true,"ssid":"xxx-xxx-xxx","expiresIn":60000,"mode":"otp"}

# 2. 使用SSID和OTP获取临时TOKEN
curl -X POST -H "Content-Type: application/json" \
  -d '{"ssid":"xxx-xxx-xxx","otp":"abcd1234"}' \
  "$HOST/admin/otp/verify"
# 返回: {"ok":true,"token":"yyy-yyy-yyy","expiresAt":1707649800000,"expiresIn":14400000}

# 3. 使用临时TOKEN访问管理员API（与永久TOKEN用法相同）
export TEMP_TOKEN=yyy-yyy-yyy
curl -H "X-Admin-Token: $TEMP_TOKEN" "$HOST/admin/rooms"
```

### 使用临时TOKEN（CLI 直接批准方式）

让前端跳过验证码，由服务器终端管理员直接批准：

```bash
export HOST=http://127.0.0.1:12347

# 1. 请求 CLI 批准（在服务器终端会出现 [OTP CLI Request] 日志，包含 ssid 和短码）
curl -X POST -H "Content-Type: application/json" \
  -d '{"mode":"cli"}' \
  "$HOST/admin/otp/request"
# 返回: {"ok":true,"ssid":"xxx-xxx-xxx","expiresIn":60000,"mode":"cli"}

# 2. 服务器终端管理员执行：
#    approve xxx-xxx-x       （前缀短码即可）
#    或 deny xxx-xxx-x

# 3. 前端轮询（建议 1~2 秒一次，1 分钟内有效）
curl -X POST -H "Content-Type: application/json" \
  -d '{"ssid":"xxx-xxx-xxx","mode":"cli"}' \
  "$HOST/admin/otp/verify"
# 待批准: HTTP 202 {"ok":false,"error":"pending-approval","status":"pending"}
# 已拒绝: HTTP 403 {"ok":false,"error":"approval-denied","status":"denied"}
# 已批准: HTTP 200 {"ok":true,"token":"yyy-yyy-yyy","expiresAt":...,"expiresIn":14400000,"mode":"cli"}

# 4. 拿到 token 后用法与 OTP 方式相同
export TEMP_TOKEN=yyy-yyy-yyy
curl -H "X-Admin-Token: $TEMP_TOKEN" "$HOST/admin/rooms"
```
