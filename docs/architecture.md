# 架构文档 / Architecture Documentation

本文档描述 Phira MP 服务器的整体架构和核心组件。

This document describes the overall architecture and core components of the Phira MP server.

## 项目结构 / Project Structure

```
src/
├── client/          # 客户端相关代码（测试用）
├── common/          # 公共模块（客户端和服务端共用）
│   ├── binary.ts    # 二进制数据处理（编码/解码）
│   ├── commands.ts  # 命令定义（客户端<->服务端通信协议）
│   ├── framing.ts   # 帧协议（消息分帧，支持最大2MB负载）
│   ├── http.ts      # HTTP 工具函数
│   ├── response.ts  # 响应处理
│   ├── roomId.ts    # 房间ID处理
│   ├── stream.ts    # 流处理
│   ├── utils.ts     # 通用工具函数
│   └── uuid.ts      # UUID生成
└── server/          # 服务端代码
    ├── auth/        # 认证模块（Token验证、OTP临时认证）
    ├── cli/         # 命令行接口
    ├── core/        # 核心模块（服务器状态、配置）
    ├── game/        # 游戏逻辑（房间、用户）
    ├── network/     # 网络服务（TCP、HTTP、WebSocket）
    ├── plugins/     # 插件系统
    ├── replay/      # 回放录制
    └── utils/       # 服务端工具（日志、限流、本地化）
```

## 核心组件 / Core Components

### 1. 服务器状态 (ServerState)

服务器的全局状态管理，包括房间列表、用户列表、封禁列表、配置信息和互斥锁。

**主要功能：**
- 管理所有房间和用户
- 处理封禁列表（服务器级和房间级）
- 管理临时管理员 Token（OTP）
- 持久化管理员数据到 JSON 文件
- 提供互斥锁保证线程安全

**关键属性：**
- `rooms`: Map<RoomId, Room> - 房间列表
- `users`: Map<number, User> - 用户列表
- `sessions`: Map<string, Session> - TCP会话列表
- `bannedUsers`: Set<number> - 服务器级封禁列表
- `bannedRoomUsers`: Map<RoomId, Set<number>> - 房间级封禁列表
- `tempAdminTokens`: Map<string, { ip, expiresAt, banned }> - 临时管理员 Token

### 2. 网络服务 (Network Services)

#### TCP 游戏服务
- 处理客户端连接和游戏协议
- 支持 HAProxy PROXY Protocol（可选）
- 支持帧协议（最大2MB负载）
- 心跳检测（3秒间隔，10秒超时断开）

#### HTTP 服务
- RESTful API 接口
- 回放下载服务（限速50KB/s）
- 支持管理员 Token 鉴权（永久或临时 OTP）
- IP 黑名单管理

#### WebSocket 服务
- 实时推送房间状态更新
- 实时推送房间日志（INFO级别）
- 管理员全局监控（增量更新）
- 心跳检测（30秒间隔）

### 3. 游戏逻辑 (Game Logic)

#### 房间状态机
```
SelectChart → WaitForReady → Playing → SelectChart
```

**状态说明：**
- `SelectChart`: 选择谱面阶段
- `WaitForReady`: 等待准备阶段
- `Playing`: 游戏进行中

**房间属性：**
- `maxUsers`: 最大玩家数（1-64）
- `live`: 是否为直播房间
- `locked`: 是否锁定（仅房主可操作）
- `cycle`: 是否循环模式（游戏结束后轮换房主）
- `replayEligible`: 是否 eligible for replay recording

#### 用户管理
- 基本信息（ID、名称、语言）
- 会话管理（TCP/WebSocket）
- 房间状态（玩家/观战者）
- 游戏时间追踪

### 4. 认证系统 (Authentication)

#### Phira 主站 Token 验证
- 客户端连接时验证
- 请求 `/me` API 确认用户身份

#### 管理员 Token 认证
- 永久 Token（配置文件 `ADMIN_TOKEN`）
- 临时 Token（OTP 方式，4小时有效期）
- IP 绑定（临时 Token）

#### OTP 临时认证
- 请求验证码（5分钟有效期）
- 验证验证码获取临时 Token
- IP 绑定和过期自动清理

### 5. 回放系统 (Replay System)

**功能：**
- 自动录制游戏过程
- 文件组织：`record/{userId}/{chartId}/{timestamp}.phirarec`
- 自动清理（4天后）
- 限速下载（50KB/s）

**文件格式：**
```
文件头（14字节）：
- 2字节：文件标识（0x504D）
- 4字节：谱面ID
- 4字节：用户ID
- 4字节：成绩ID

数据流：原生 Touches/Judges 命令编码
```

### 6. 插件系统 (Plugin System)

**功能：**
- 插件加载/卸载
- 生命周期管理
- 钩子触发机制

**可用钩子：**
- `onInit`: 插件初始化
- `onDestroy`: 插件销毁
- `onServerStart`: 服务器启动后
- `onUserJoinRoom`: 用户加入房间
- `onUserLeaveRoom`: 用户离开房间
- `onGameEnd`: 游戏结束
- `onBeforeCommand`: 命令执行前（可拦截）

**插件目录结构：**
```
plugins/
├── plugin-name/
│   ├── main.js       # 插件入口
│   ├── module1.js    # 功能模块1（可选）
│   └── utils.js      # 工具函数（可选）
```

### 7. 命令行接口 (CLI)

支持房间管理、用户管理、封禁管理等命令。

**常用命令：**
- `list` / `rooms`: 列出所有房间
- `users`: 列出所有用户
- `ban <userId>`: 封禁用户
- `unban <userId>`: 解封用户
- `maxusers <roomId> <count>`: 修改房间最大人数
- `disband <roomId>`: 解散房间
- `broadcast <message>`: 全服广播
- `replay on/off/status`: 回放录制开关
- `contest <roomId> enable/disable/whitelist/start`: 比赛房间管理

### 8. 日志系统 (Logging System)

**功能：**
- 多级别日志（DEBUG, INFO, MARK, WARN, ERROR）
- 日志限流（防止洪水攻击）
- IP 黑名单（自动封禁）
- 按日期滚动（`YYYY-MM-DD.log`）
- 测试账号过滤（非 DEBUG 模式不写入文件）
- WebSocket 实时推送（INFO 级别）

**日志格式：**
```
[2026-02-16 10:30:00.000] [INFO] 用户 "xxx" 加入房间 "room1"
```

### 9. 本地化 (Localization)

支持多语言（zh-CN, en-US）。

**使用 Fluent 格式：**
- 本地化文件：`locales/{lang}.ftl`
- 服务器语言：`PHIRA_MP_LANG` 配置
- 每个用户独立语言设置

## 数据流 / Data Flow

### 客户端连接流程
```
1. TCP 连接建立
2. HAProxy PROXY Protocol 解析（可选）
3. 协议握手（版本检查）
4. 认证（Phira Token）
5. 创建 Session 和 User 对象
6. 加入房间或创建新房间
```

### 游戏流程
```
1. 房主选择谱面（SelectChart）
2. 房主发起开始（RequestStart）
3. 进入 WaitForReady 状态
4. 玩家准备（Ready）
5. 全员准备完毕，开始游戏
6. 玩家上传 Touches/Judges
7. 游戏结束，上传成绩
8. 结算并解散房间（或循环模式）
```

### WebSocket 推送流程
```
1. 客户端订阅房间
2. 立即推送当前状态
3. 状态变化时推送更新
4. INFO 级别日志实时推送
5. 管理员订阅接收所有房间更新
```

## 安全机制 / Security Mechanisms

### 认证
- Token 验证（永久/临时）
- OTP 认证（IP 绑定）
- 用户身份验证（Phira 主站）

### 限流
- 日志限流（防止洪水攻击）
- IP 黑名单（自动封禁）
- 连接限流（心跳超时断开）

### 权限控制
- 服务器级封禁
- 房间级封禁
- 房主权限验证
- 观战者权限验证

### 数据验证
- 命令参数校验
- 状态校验
- 房间状态机校验

## 性能优化 / Performance Optimization

### 异步处理
- 所有 I/O 操作异步化
- 非阻塞日志写入
- 并行 WebSocket 推送

### 内存管理
- 定期清理过期数据
- 临时 Token 自动清理
- 回放文件自动清理

### 网络优化
- 限速（回放下载 50KB/s）
- 心跳检测（3秒/30秒）
- 增量���新（管理员 WebSocket）

## 部署建议 / Deployment Recommendations

### 反向代理
- 使用 Nginx/Caddy 作为反向代理
- 配置 `REAL_IP_HEADER` 获取真实 IP
- 启用 HTTPS（HTTP 服务）

### TCP 代理
- 使用 HAProxy 获取真实 IP
- 启用 `HAPROXY_PROTOCOL`
- 配置健康检查

### 监控和备份
- 监控日志文件大小
- 定期备份 `admin_data.json`
- 监控 WebSocket 连接数
- 监控房间数量和玩家数量

## 相关文档 / Related Documentation

- [API 文档](./api.md) - HTTP API 接口
- [命令文档](./commands.md) - CLI 命令参考
- [插件文档](./plugins.md) - 插件开发指南
- [WebSocket 文档](./websocket.md) - WebSocket API
- [配置参考](./configuration.md) - 配置选项
