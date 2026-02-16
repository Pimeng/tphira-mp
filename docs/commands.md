# 服务器命令文档 / Server Commands Documentation

本文档列出了 Phira MP 服务器支持的所有控制台命令。这些命令可以直接在服务器运行时的控制台中输入。

This document lists all console commands supported by the Phira MP server. These commands can be entered directly in the server console while it's running.

## 基础命令 / Basic Commands

### help
显示所有可用命令的帮助信息。

Shows help information for all available commands.

**用法 / Usage:**
```
help
```

---

## 房间管理 / Room Management

### list / rooms
列出服务器上所有当前活跃的房间及其状态。

Lists all currently active rooms on the server and their status.

**用法 / Usage:**
```
list
rooms
```

**显示信息 / Information shown:**
- 房间ID / Room ID
- 状态（SelectChart/WaitForReady/Playing）
- 玩家数量/最大人数 / Player count/max
- 观战者数量 / Monitor count
- 当前谱面 / Current chart
- 锁定状态 / Lock status
- 循环模式 / Cycle mode
- 比赛模式 / Contest mode

---

### maxusers
动态修改指定房间的最大人数限制。

Dynamically change the maximum user limit for a specific room.

**用法 / Usage:**
```
maxusers <roomId> <count>
```

**参数 / Parameters:**
- `roomId`: 房间ID / Room ID
- `count`: 最大人数（1-64）/ Max users (1-64)

**示例 / Examples:**
```
maxusers room1 16
maxusers test_room 8
```

**注意 / Notes:**
- 仅影响后续加入校验，不会踢出已在房间内的玩家
- Only affects future join validation, won't kick existing players

---

### disband
立即解散指定房间，所有玩家和观战者会收到通知。

Immediately disband a specific room, all players and monitors will be notified.

**用法 / Usage:**
```
disband <roomId>
```

**参数 / Parameters:**
- `roomId`: 房间ID / Room ID

**示例 / Examples:**
```
disband room1
disband test_room
```

**注意 / Notes:**
- 房间内所有玩家和观战者会收到"房间已被管理员解散"的通知
- All players and monitors in the room will receive a "room disbanded by admin" notification
- 若房间启用了回放录制，会自动结束该房间的录制
- If replay recording is enabled, it will automatically end for this room
- 房间从服务器回收，后续无法加入
- Room is removed from server, cannot be joined afterwards
- 如果房间不存在会显示错误
- Error will be shown if room doesn't exist

---

## 用户管理 / User Management

### users
列出所有当前在线的用户。

Lists all currently online users.

**用法 / Usage:**
```
users
```

**显示信息 / Information shown:**
- 用户ID / User ID
- 用户名 / Username
- 在线/离线状态 / Online/Offline status
- 角色（玩家/观战）/ Role (Player/Monitor)
- 所在房间 / Current room
- 封禁状态 / Ban status

---

### user
查看指定用户的详细信息。

View detailed information about a specific user.

**用法 / Usage:**
```
user <userId>
```

**参数 / Parameters:**
- `userId`: 用户ID / User ID

**示例 / Examples:**
```
user 100
user 12345
```

**显示信息 / Information shown:**
- ID、名称、状态、角色、房间、封禁状态、游戏时间、语言
- ID, name, status, role, room, ban status, game time, language

---

### kick
立即断开指定用户的连接。

Immediately disconnect a specific user.

**用法 / Usage:**
```
kick <userId> [preserve]
```

**参数 / Parameters:**
- `userId`: 用户ID / User ID
- `preserve`: (可选) 设为 "true" 或 "preserve" 保留房间位置 / (Optional) Set to "true" or "preserve" to keep room slot

**示例 / Examples:**
```
kick 100
kick 100 preserve
kick 100 true
```

**注意 / Notes:**
- 使用 `preserve` 参数时，用户断线但不会退出房间
- With `preserve`, user disconnects but doesn't leave the room
- 对局中断线会标记为 Abort 并触发结算检查
- Disconnecting during play marks as Abort and triggers settlement check

---

## 封禁管理 / Ban Management

### ban
将用户加入服务器黑名单，禁止其连接服务器。

Add user to server blacklist, preventing them from connecting.

**用法 / Usage:**
```
ban <userId>
```

**参数 / Parameters:**
- `userId`: 用户ID / User ID

**示例 / Examples:**
```
ban 100
```

**注意 / Notes:**
- 如果用户在线，会立即断开连接
- If user is online, they will be disconnected immediately
- 封禁信息会自动保存到 `admin_data.json`
- Ban information is automatically saved to `admin_data.json`

---

### unban
将用户从服务器黑名单中移除。

Remove user from server blacklist.

**用法 / Usage:**
```
unban <userId>
```

**参数 / Parameters:**
- `userId`: 用户ID / User ID

**示例 / Examples:**
```
unban 100
```

---

### banlist
查看当前所有被封禁的用户列表。

View list of all currently banned users.

**用法 / Usage:**
```
banlist
```

---

### banroom
禁止指定用户进入指定房间（房间级黑名单）。

Ban a specific user from entering a specific room (room-level blacklist).

**用法 / Usage:**
```
banroom <userId> <roomId>
```

**参数 / Parameters:**
- `userId`: 用户ID / User ID
- `roomId`: 房间ID / Room ID

**示例 / Examples:**
```
banroom 100 room1
banroom 12345 test_room
```

**注意 / Notes:**
- 封禁信息会自动保存到 `admin_data.json`
- Ban information is automatically saved to `admin_data.json`

---

### unbanroom
解除用户对指定房间的禁入限制。

Remove room-level ban for a specific user.

**用法 / Usage:**
```
unbanroom <userId> <roomId>
```

**参数 / Parameters:**
- `userId`: 用户ID / User ID
- `roomId`: 房间ID / Room ID

**示例 / Examples:**
```
unbanroom 100 room1
```

---

## 通信命令 / Communication Commands

### broadcast / say
向所有房间发送系统广播消息。

Send a system broadcast message to all rooms.

**用法 / Usage:**
```
broadcast <message>
say <message>
```

**参数 / Parameters:**
- `message`: 广播内容（最多200字符）/ Message content (max 200 characters)

**示例 / Examples:**
```
broadcast 服务器将在10分钟后重启维护
say Server will restart in 10 minutes for maintenance
```

**注意 / Notes:**
- 消息会以 user=0 的聊天消息形式发送
- Message is sent as a chat message with user=0
- 所有房间的所有玩家和观战者都会收到
- All players and monitors in all rooms will receive it

---

### roomsay
向指定房间发送系统消息。

Send a system message to a specific room.

**用法 / Usage:**
```
roomsay <roomId> <message>
```

**参数 / Parameters:**
- `roomId`: 房间ID / Room ID
- `message`: 消息内容（最多200字符）/ Message content (max 200 characters)

**示例 / Examples:**
```
roomsay room1 请注意游戏规则
roomsay test_room Please follow the game rules
```

**注意 / Notes:**
- 消息会以 user=0 的聊天消息形式发送
- Message is sent as a chat message with user=0
- 仅指定房间内的玩家和观战者会收到
- Only players and monitors in the specified room will receive it
- 如果房间不存在会显示错误
- Error will be shown if room doesn't exist

---

## 功能开关 / Feature Toggles

### replay
控制回放录制功能的开关。

Control replay recording feature toggle.

**用法 / Usage:**
```
replay <on|off|status>
```

**参数 / Parameters:**
- `on`: 开启回放录制 / Enable replay recording
- `off`: 关闭回放录制 / Disable replay recording
- `status`: 查看当前状态 / View current status

**示例 / Examples:**
```
replay on
replay off
replay status
```

**注意 / Notes:**
- 关闭时会停止所有正在录制的房间
- Disabling stops all currently recording rooms
- 开启后仅对新创建的房间生效
- Enabling only affects newly created rooms

---

### roomcreation
控制房间创建功能的开关。

Control room creation feature toggle.

**用法 / Usage:**
```
roomcreation <on|off|status>
```

**参数 / Parameters:**
- `on`: 允许创建房间 / Allow room creation
- `off`: 禁止创建房间 / Disable room creation
- `status`: 查看当前状态 / View current status

**示例 / Examples:**
```
roomcreation on
roomcreation off
roomcreation status
```

**注意 / Notes:**
- 禁用时玩家无法创建新房间，已存在的房间不受影响
- When disabled, players cannot create new rooms, existing rooms are unaffected

---

## 比赛房间管理 / Contest Room Management

### contest
管理比赛房间（白名单限制 + 手动开始 + 结算后自动解散）。

Manage contest rooms (whitelist restriction + manual start + auto-disband after settlement).

**用法 / Usage:**
```
contest <roomId> <subcommand> [args...]
```

### 子命令 / Subcommands:

#### enable
启用房间的比赛模式。

Enable contest mode for a room.

**用法 / Usage:**
```
contest <roomId> enable [userId1 userId2 ...]
```

**示例 / Examples:**
```
contest room1 enable
contest room1 enable 100 200 300
```

**注意 / Notes:**
- 如果不提供用户ID，会自动使用当前房间内所有用户
- If no user IDs provided, automatically uses all current room users
- 当前在房间内的用户会自动加入白名单
- Users currently in the room are automatically added to whitelist

---

#### disable
禁用房间的比赛模式，恢复为普通房间。

Disable contest mode for a room, reverting to normal room.

**用法 / Usage:**
```
contest <roomId> disable
```

**示例 / Examples:**
```
contest room1 disable
```

---

#### whitelist
更新比赛房间的白名单。

Update the whitelist for a contest room.

**用法 / Usage:**
```
contest <roomId> whitelist <userId1 userId2 ...>
```

**示例 / Examples:**
```
contest room1 whitelist 100 200 300 400
```

**注意 / Notes:**
- 当前在房间内的用户会自动补进白名单
- Users currently in the room are automatically added to whitelist

---

#### start
手动开始比赛房间的对局。

Manually start the contest room game.

**用法 / Usage:**
```
contest <roomId> start [force]
```

**参数 / Parameters:**
- `force`: (可选) 强制开始，忽略未准备的玩家 / (Optional) Force start, ignore unready players

**示例 / Examples:**
```
contest room1 start
contest room1 start force
```

**注意 / Notes:**
- 房间必须处于 WaitForReady 状态
- Room must be in WaitForReady state
- 不使用 force 时，必须全员 ready 才能开始
- Without force, all players must be ready to start
- 对局结束后房间会自动解散
- Room automatically disbands after game ends

---

## IP黑名单管理 / IP Blacklist Management

### ipblacklist
管理因日志限流而被自动封禁的IP地址。

Manage IP addresses automatically banned due to log rate limiting.

**用法 / Usage:**
```
ipblacklist <list|remove|clear>
```

### 子命令 / Subcommands:

#### list
查看当前IP黑名单。

View current IP blacklist.

**用法 / Usage:**
```
ipblacklist list
```

---

#### remove
从黑名单中移除指定IP。

Remove a specific IP from blacklist.

**用法 / Usage:**
```
ipblacklist remove <ip>
```

**示例 / Examples:**
```
ipblacklist remove 192.168.1.100
ipblacklist remove 2001:db8::1
```

---

#### clear
清空所有IP黑名单。

Clear all IP blacklist entries.

**用法 / Usage:**
```
ipblacklist clear
```

---

## 服务器控制 / Server Control

### stop / shutdown
提示如何停止服务器。

Shows how to stop the server.

**用法 / Usage:**
```
stop
shutdown
```

**注意 / Notes:**
- 使用 Ctrl+C 来优雅地停止服务器
- Use Ctrl+C to gracefully stop the server
- 服务器会等待所有连接关闭后再退出
- Server will wait for all connections to close before exiting

---

## 命令示例场景 / Command Usage Scenarios

### 场景1：管理员日常巡查 / Scenario 1: Admin Daily Patrol
```bash
# 查看所有房间
list

# 查看所有在线用户
users

# 查看特定用户详情
user 12345

# 查看封禁列表
banlist
```

### 场景2：处理违规用户 / Scenario 2: Handle Rule Violator
```bash
# 查看用户信息
user 12345

# 踢出用户
kick 12345

# 如果需要封禁
ban 12345

# 查看封禁列表确认
banlist
```

### 场景3：举办比赛 / Scenario 3: Host a Contest
```bash
# 查看房间列表
list

# 启用比赛模式（指定参赛者）
contest room1 enable 100 200 300 400

# 更新白名单（如有需要）
contest room1 whitelist 100 200 300 400 500

# 等待玩家准备后手动开始
contest room1 start

# 或强制开始
contest room1 start force
```

### 场景4：服务器维护 / Scenario 4: Server Maintenance
```bash
# 发送维护通知
broadcast 服务器将在10分钟后重启维护，请尽快完成当前对局

# 向特定房间发送通知
roomsay room1 此房间将在5分钟后关闭

# 禁止创建新房间
roomcreation off

# 查看当前房间状态
list

# 等待所有对局结束后停止服务器（Ctrl+C）
```

### 场景5：调整房间设置 / Scenario 5: Adjust Room Settings
```bash
# 查看房间列表
list

# 调整房间最大人数
maxusers room1 16

# 解散房间
disband room1

# 关闭回放录制（节省磁盘空间）
replay off

# 查看回放状态
replay status
```

---

## 注意事项 / Important Notes

1. **命令大小写不敏感** / Commands are case-insensitive
   - `LIST`, `list`, `List` 都可以 / All work the same

2. **参数分隔** / Parameter separation
   - 使用空格分隔参数 / Use spaces to separate parameters
   - 广播消息中的空格会被保留 / Spaces in broadcast messages are preserved

3. **房间ID格式** / Room ID format
   - 房间ID区分大小写 / Room IDs are case-sensitive
   - 示例：`room1`, `test_room`, `比赛房间` / Examples: `room1`, `test_room`, `比赛房间`

4. **用户ID** / User ID
   - 必须是整数 / Must be an integer
   - 示例：`100`, `12345` / Examples: `100`, `12345`

5. **数据持久化** / Data persistence
   - 封禁信息会自动保存到 `admin_data.json`
   - Ban information is automatically saved to `admin_data.json`
   - 比赛房间配置仅在内存中，重启后失效
   - Contest room configuration is memory-only, lost on restart

6. **权限** / Permissions
   - 所有命令都需要服务器控制台访问权限
   - All commands require server console access
   - 与 HTTP API 的 ADMIN_TOKEN 独立
   - Independent from HTTP API's ADMIN_TOKEN

---

## 相关文档 / Related Documentation

- [API 使用说明](./api.md) - HTTP API 接口文档 / HTTP API documentation
- [README](./README.md) - 服务器安装和配置 / Server installation and configuration
