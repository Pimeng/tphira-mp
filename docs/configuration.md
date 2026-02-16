# 配置参考 / Configuration Reference

本文档详细说明 Phira MP 服务器的所有配置选项。

This document provides detailed information about all configuration options for the Phira MP server.

## 配置方式 / Configuration Methods

配置优先级（从高到低）：
1. 命令行参数
2. 环境变量
3. 配置文件 (`server_config.yml`)
4. 默认值

Configuration priority (highest to lowest):
1. Command-line arguments
2. Environment variables
3. Configuration file (`server_config.yml`)
4. Default values

## 配置文件格式 / Configuration File Format

配置文件使用 YAML 格式，支持大小写键名（推荐使用大写）。

Configuration file uses YAML format and supports both uppercase and lowercase keys (uppercase recommended).

示例配置文件 / Example configuration file:

```yaml
# 服务器基本配置 / Basic Server Configuration
SERVER_NAME: "Phira MP"
HOST: "::"
PORT: 12346

# HTTP 服务配置 / HTTP Service Configuration
HTTP_SERVICE: true
HTTP_PORT: 12347

# 日志配置 / Logging Configuration
LOG_LEVEL: INFO
CONSOLE_LOG_LEVEL: INFO

# 网络配置 / Network Configuration
REAL_IP_HEADER: "X-Forwarded-For"
HAPROXY_PROTOCOL: false

# 游戏配置 / Game Configuration
ROOM_MAX_USERS: 8
PHIRA_MP_LANG: "zh-CN"

# 观战配置 / Monitor Configuration
monitors:
  - 2

# 测试账号配置 / Test Account Configuration
test_account_ids:
  - 1739989

# 管理员配置 / Admin Configuration
ADMIN_TOKEN: "replace_me"
ADMIN_DATA_PATH: "./admin_data.json"

# 其他配置 / Other Configuration
ROOM_LIST_TIP: ""
```

## 配置选项详解 / Configuration Options

### 服务器基本配置 / Basic Server Configuration

#### SERVER_NAME

服务器名称，显示在欢迎消息中。

Server name displayed in welcome messages.

- 类型 / Type: `string`
- 默认值 / Default: `"Phira MP"`
- 环境变量 / Environment: `SERVER_NAME`
- 命令行 / CLI: `--server-name`

示例 / Example:
```yaml
SERVER_NAME: "My Phira Server"
```

#### HOST

服务器监听地址。

Server listening address.

- 类型 / Type: `string`
- 默认值 / Default: `"::"`（监听所有 IPv6 和 IPv4 地址）
- 环境变量 / Environment: `HOST`
- 命令行 / CLI: `--host`

常用值 / Common values:
- `"::"` - 监听所有地址（IPv6 和 IPv4）
- `"0.0.0.0"` - 监听所有 IPv4 地址
- `"127.0.0.1"` - 仅本地访问
- `"192.168.1.100"` - 指定 IP 地址

示例 / Example:
```yaml
HOST: "0.0.0.0"
```

#### PORT

游戏服务监听端口。

Game service listening port.

- 类型 / Type: `number`
- 默认值 / Default: `12346`
- 范围 / Range: `1-65535`
- 环境变量 / Environment: `PORT`
- 命令行 / CLI: `--port`

示例 / Example:
```yaml
PORT: 12346
```

### HTTP 服务配置 / HTTP Service Configuration

#### HTTP_SERVICE

是否启用 HTTP 服务（API 和 WebSocket）。

Whether to enable HTTP service (API and WebSocket).

- 类型 / Type: `boolean`
- 默认值 / Default: `false`
- 环境变量 / Environment: `HTTP_SERVICE`
- 命令行 / CLI: `--http-service`

示例 / Example:
```yaml
HTTP_SERVICE: true
```

#### HTTP_PORT

HTTP 服务监听端口。

HTTP service listening port.

- 类型 / Type: `number`
- 默认值 / Default: `12347`
- 范围 / Range: `1-65535`
- 环境变量 / Environment: `HTTP_PORT`
- 命令行 / CLI: `--http-port`

示例 / Example:
```yaml
HTTP_PORT: 12347
```

### 日志配置 / Logging Configuration

#### LOG_LEVEL

日志等级，控制写入日志文件的最小等级。

Log level, controls the minimum level written to log files.

- 类型 / Type: `string`
- 默认值 / Default: `"INFO"`
- 可选值 / Options: `"DEBUG"`, `"INFO"`, `"MARK"`, `"WARN"`, `"ERROR"`
- 环境变量 / Environment: `LOG_LEVEL`

日志等级说明 / Log level descriptions:
- `DEBUG`: 详细调试信息，包含所有日志
- `INFO`: 一般信息，包含用户操作和房间状态
- `MARK`: 重要标记，如游戏开始/结束
- `WARN`: 警告信息，异常但不影响运行
- `ERROR`: 错误信息，需要关注的问题

示例 / Example:
```yaml
LOG_LEVEL: INFO
```

注意 / Note:
- 控制台输出等级可通过环境变量 `CONSOLE_LOG_LEVEL` 单独设置
- Console output level can be set separately via `CONSOLE_LOG_LEVEL` environment variable

#### CONSOLE_LOG_LEVEL

控制台输出日志等级，控制输出到终端的最小等级。

Console output log level, controls the minimum level output to terminal.

- 类型 / Type: `string`
- 默认值 / Default: `"INFO"`
- 可选值 / Options: `"DEBUG"`, `"INFO"`, `"MARK"`, `"WARN"`, `"ERROR"`
- 环境变量 / Environment: `CONSOLE_LOG_LEVEL`

示例 / Example:
```yaml
CONSOLE_LOG_LEVEL: WARN
```

### 网络配置 / Network Configuration

#### REAL_IP_HEADER

真实 IP 头名称，用于反向代理场景获取客户端真实 IP。

Real IP header name for getting client real IP in reverse proxy scenarios.

- 类型 / Type: `string`
- 默认值 / Default: `"X-Forwarded-For"`
- 环境变量 / Environment: `REAL_IP_HEADER`

常用值 / Common values:
- `"X-Forwarded-For"` - 标准代理头
- `"X-Real-IP"` - Nginx 常用
- `"CF-Connecting-IP"` - Cloudflare
- `"True-Client-IP"` - Akamai

示例 / Example:
```yaml
REAL_IP_HEADER: "X-Real-IP"
```

注意 / Note:
- 此配置仅对 HTTP 服务生效
- This configuration only affects HTTP service
- TCP 游戏服务请使用 `HAPROXY_PROTOCOL`
- For TCP game service, use `HAPROXY_PROTOCOL`

#### HAPROXY_PROTOCOL

是否启用 HAProxy PROXY Protocol 支持。

Whether to enable HAProxy PROXY Protocol support.

- 类型 / Type: `boolean`
- 默认值 / Default: `false`
- 环境变量 / Environment: `HAPROXY_PROTOCOL`

示例 / Example:
```yaml
HAPROXY_PROTOCOL: true
```

使用场景 / Use cases:
- TCP 代理（如 HAProxy）获取真实 IP
- Getting real IP through TCP proxy (like HAProxy)
- 支持 PROXY Protocol v1 和 v2
- Supports PROXY Protocol v1 and v2

### 游戏配置 / Game Configuration

#### ROOM_MAX_USERS

单个房间最大玩家数。

Maximum number of players per room.

- 类型 / Type: `number`
- 默认值 / Default: `8`
- 范围 / Range: `1-64`
- 环境变量 / Environment: `ROOM_MAX_USERS`

示例 / Example:
```yaml
ROOM_MAX_USERS: 16
```

注意 / Note:
- 可通过管理员 API 或 CLI 动态修改单个房间的最大人数
- Can dynamically modify max users for individual rooms via admin API or CLI
- 此配置仅影响新创建的房间
- This configuration only affects newly created rooms

#### PHIRA_MP_LANG

服务器默认语言。

Server default language.

- 类型 / Type: `string`
- 默认值 / Default: `"zh-CN"`
- 可选值 / Options: `"zh-CN"`, `"en-US"`
- 环境变量 / Environment: `PHIRA_MP_LANG`

示例 / Example:
```yaml
PHIRA_MP_LANG: "en-US"
```

### 观战配置 / Monitor Configuration

#### monitors

观战用户 ID 列表，这些用户可以以观战者身份加入任何房间。

Monitor user ID list, these users can join any room as monitors.

- 类型 / Type: `array of numbers`
- 默认值 / Default: `[2]`
- 环境变量 / Environment: 不支持 / Not supported

示例 / Example:
```yaml
monitors:
  - 2
  - 100
  - 200
```

### 测试账号配置 / Test Account Configuration

#### test_account_ids

测试账号 ID 列表，这些账号的日志不写入文件（除非 LOG_LEVEL=DEBUG）。

Test account ID list, logs from these accounts are not written to files (unless LOG_LEVEL=DEBUG).

- 类型 / Type: `array of numbers`
- 默认值 / Default: `[1739989]`
- 环境变量 / Environment: 不支持 / Not supported

示例 / Example:
```yaml
test_account_ids:
  - 1739989
  - 100
```

用途 / Purpose:
- 减少测试账号产生的日志噪音
- Reduce log noise from test accounts
- 方便开发和调试
- Facilitate development and debugging

### 管理员配置 / Admin Configuration

#### ADMIN_TOKEN

管理员接口鉴权 Token。

Admin interface authentication token.

- 类型 / Type: `string`
- 默认值 / Default: `"replace_me"`（建议修改）
- 环境变量 / Environment: `ADMIN_TOKEN`

示例 / Example:
```yaml
ADMIN_TOKEN: "your_secure_random_token_here"
```

安全建议 / Security recommendations:
- 使用强随机字符串（至少 32 字符）
- Use strong random string (at least 32 characters)
- 定期更换 Token
- Rotate token regularly
- 不要在代码中硬编码
- Don't hardcode in source code
- 使用环境变量存储
- Store in environment variables

生成安全 Token / Generate secure token:
```bash
# Linux/macOS
openssl rand -hex 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

未配置时的行为 / Behavior when not configured:
- 管理员 API 返回 403 错误
- Admin API returns 403 error
- 可使用 OTP 临时认证方式
- Can use OTP temporary authentication

#### ADMIN_DATA_PATH

管理员数据持久化路径（JSON 文件）。

Admin data persistence path (JSON file).

- 类型 / Type: `string`
- 默认值 / Default: `"./admin_data.json"`
- 环境变量 / Environment: `ADMIN_DATA_PATH`

示例 / Example:
```yaml
ADMIN_DATA_PATH: "/data/admin_data.json"
```

存储内容 / Stored content:
- 服务器级封禁用户列表
- Server-level banned users
- 房间级封禁用户列表
- Room-level banned users

### 其他配置 / Other Configuration

#### ROOM_LIST_TIP

登录后展示可用房间列表后追加的提示文案。

Tip text appended after displaying available room list on login.

- 类型 / Type: `string`
- 默认值 / Default: `""`（空字符串）
- 环境变量 / Environment: `ROOM_LIST_TIP`

示例 / Example:
```yaml
ROOM_LIST_TIP: "欢迎加入交流群：123456；查房间：example.com"
```

用途 / Purpose:
- 群宣传
- Community promotion
- 查房间网站链接
- Room list website link
- 服务器公告
- Server announcements

## 环境变量配置 / Environment Variable Configuration

所有配置项都可以通过环境变量设置，环境变量名与配置文件键名相同（推荐使用大写）。

All configuration options can be set via environment variables with the same name as config file keys (uppercase recommended).

示例 / Example:

```bash
# Linux/macOS
export SERVER_NAME="My Server"
export PORT=12346
export HTTP_SERVICE=true
export ADMIN_TOKEN="your_token"

# Windows (PowerShell)
$env:SERVER_NAME="My Server"
$env:PORT=12346
$env:HTTP_SERVICE="true"
$env:ADMIN_TOKEN="your_token"

# Windows (CMD)
set SERVER_NAME=My Server
set PORT=12346
set HTTP_SERVICE=true
set ADMIN_TOKEN=your_token
```

## 命令行参数 / Command-Line Arguments

部分配置支持命令行参数覆盖。

Some configurations support command-line argument override.

示例 / Example:

```bash
# 开发模式
pnpm run dev:server --port 12346 --host 0.0.0.0

# 生产模式
node dist/server/main.js --port 12346 --http-service --http-port 12347
```

支持的参数 / Supported arguments:
- `--port <number>` - 游戏端口
- `--host <string>` - 监听地址
- `--http-service` - 启用 HTTP 服务
- `--http-port <number>` - HTTP 端口
- `--server-name <string>` - 服务器名称
- `--room-max-users <number>` - 房间最大人数
- `--monitors <ids>` - 观战用户ID列表（逗号分隔）

## Docker 环境变量 / Docker Environment Variables

Docker 部署时的特殊环境变量。

Special environment variables for Docker deployment.

### PHIRA_MP_HOME

指定包含 `locales/` 和 `server_config.yml` 的目录。

Specify directory containing `locales/` and `server_config.yml`.

- 类型 / Type: `string`
- 默认值 / Default: 当前工作目录 / Current working directory
- 环境变量 / Environment: `PHIRA_MP_HOME`

示例 / Example:
```bash
docker run -e PHIRA_MP_HOME=/app ghcr.io/pimeng/tphira-mp
```

### LOG_LEVEL / CONSOLE_LOG_LEVEL

Docker 容器中的日志配置。

Log configuration in Docker container.

- `LOG_LEVEL`: 写入日志文件的最小等级
- `CONSOLE_LOG_LEVEL`: 输出到终端的最小等级

示例 / Example:
```bash
docker run -e LOG_LEVEL=INFO -e CONSOLE_LOG_LEVEL=WARN ghcr.io/pimeng/tphira-mp
```

## 配置验证 / Configuration Validation

服务器启动时会验证配置的有效性。

Server validates configuration on startup.

常见错误 / Common errors:

1. 端口被占用
   - 错误 / Error: `EADDRINUSE`
   - 解决 / Solution: 更换端口或停止占用端口的程序

2. 权限不足
   - 错误 / Error: `EACCES`
   - 解决 / Solution: 使用管理员权限或更换端口（>1024）

3. 配置文件格式错误
   - 错误 / Error: `YAMLException`
   - 解决 / Solution: 检查 YAML 语法

4. 无效的配置值
   - 错误 / Error: `Invalid configuration`
   - 解决 / Solution: 检查配置值范围和类型

## 配置最佳实践 / Configuration Best Practices

### 1. 安全性 / Security

- 使用强随机 `ADMIN_TOKEN`
- 不要在代码仓库中提交敏感配置
- 使用环境变量存储敏感信息
- 定期更换管理员 Token

Use strong random `ADMIN_TOKEN`, don't commit sensitive configs to repository, store sensitive info in environment variables, and rotate admin token regularly.

### 2. 性能 / Performance

- 根据服务器性能调整 `ROOM_MAX_USERS`
- 生产环境使用 `LOG_LEVEL=INFO` 或更高
- 启用反向代理时配置 `REAL_IP_HEADER`

Adjust `ROOM_MAX_USERS` based on server performance, use `LOG_LEVEL=INFO` or higher in production, and configure `REAL_IP_HEADER` when using reverse proxy.

### 3. 可维护性 / Maintainability

- 使用配置文件而非环境变量（便于版本控制）
- 添加注释说明配置用途
- 保留默认配置文件作为参考

Use config file instead of environment variables (easier version control), add comments explaining config purpose, and keep default config file as reference.

### 4. 监控 / Monitoring

- 启用 HTTP 服务以便监控
- 配置适当的日志等级
- 定期检查日志文件大小

Enable HTTP service for monitoring, configure appropriate log level, and regularly check log file size.

## 配置示例 / Configuration Examples

### 开发环境 / Development Environment

```yaml
SERVER_NAME: "Dev Server"
HOST: "127.0.0.1"
PORT: 12346
HTTP_SERVICE: true
HTTP_PORT: 12347
LOG_LEVEL: DEBUG
CONSOLE_LOG_LEVEL: DEBUG
ROOM_MAX_USERS: 4
ADMIN_TOKEN: "dev_token_not_secure"
```

### 生产环境 / Production Environment

```yaml
SERVER_NAME: "Phira MP Production"
HOST: "::"
PORT: 12346
HTTP_SERVICE: true
HTTP_PORT: 12347
LOG_LEVEL: INFO
CONSOLE_LOG_LEVEL: INFO
REAL_IP_HEADER: "X-Forwarded-For"
ROOM_MAX_USERS: 8
ADMIN_TOKEN: "use_environment_variable"
ADMIN_DATA_PATH: "/data/admin_data.json"
ROOM_LIST_TIP: "欢迎！加入群：123456"
```

### 高性能环境 / High-Performance Environment

```yaml
SERVER_NAME: "Phira MP High Performance"
HOST: "::"
PORT: 12346
HTTP_SERVICE: true
HTTP_PORT: 12347
LOG_LEVEL: WARN
CONSOLE_LOG_LEVEL: WARN
ROOM_MAX_USERS: 16
test_account_ids:
  - 1739989
```

### Docker 环境 / Docker Environment

```yaml
SERVER_NAME: "Phira MP Docker"
HOST: "0.0.0.0"
PORT: 12346
HTTP_SERVICE: true
HTTP_PORT: 12347
LOG_LEVEL: INFO
CONSOLE_LOG_LEVEL: INFO
ADMIN_DATA_PATH: "/data/admin_data.json"
```

配合 Docker Compose:
```yaml
version: '3'
services:
  phira-mp:
    image: ghcr.io/pimeng/tphira-mp
    ports:
      - "12346:12346"
      - "12347:12347"
    environment:
      - SERVER_NAME=Phira MP Docker
      - HTTP_SERVICE=true
      - ADMIN_TOKEN=${ADMIN_TOKEN}
    volumes:
      - ./data:/data
      - ./server_config.yml:/app/server_config.yml
```

## 相关文档 / Related Documentation

- [README](../README.md) - 项目介绍和快速开始
- [架构文档](./architecture.md) - 系统架构说明
- [API 文档](./api.md) - HTTP API 接口
- [命令文档](./commands.md) - CLI 命令参考
