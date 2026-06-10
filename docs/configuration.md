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

配置文件使用 YAML 格式，键名统一使用全大写，并按 UTF-8 编码读取。

Configuration file uses YAML format with uppercase keys and is read as UTF-8.

示例配置文件 / Example configuration file:

```yaml
# 监听地址
HOST: "::"
# 监听端口
PORT: 12346

# 是否启用 HTTP 服务
HTTP_SERVICE: false
# HTTP 服务监听端口
HTTP_PORT: 12347

# 日志等级（DEBUG, INFO, MARK, WARN, ERROR），默认 INFO
LOG_LEVEL: INFO

# 真实 IP 头名称（用于反向代理场景），默认 X-Forwarded-For
# 可选值：X-Forwarded-For, X-Real-IP, CF-Connecting-IP 等
# 注：此处仅HTTP服务生效
REAL_IP_HEADER: X-Forwarded-For

# 是否启用 HAProxy PROXY Protocol 支持
# 注：用于 TCP 代理时正常获取真实 IP
HAPROXY_PROTOCOL: false

# 单间最大用户数
ROOM_MAX_USERS: 8

# 是否启用聊天，默认开启；关闭后玩家聊天会替换为安全提示
CHAT_ENABLED: true

# 是否启用回放录制功能，默认关闭
REPLAY_ENABLED: false

# 观战用户ID
MONITORS:
  - 2

# 测试账号 ID 列表：配置后，这些账号的日志不写入文件（除非 LOG_LEVEL=DEBUG）；不配置使用默认 [1739989]，配置空数组则所有人日志都写入文件。
TEST_ACCOUNT_IDS:
  - 1739989

# 服务器名称（欢迎信息会使用）
SERVER_NAME: Phira MP

# 管理员接口鉴权 token（HTTP /admin/*）
# ADMIN_TOKEN: "replace_me"

# 管理员数据持久化路径（JSON）
# ADMIN_DATA_PATH: "./admin_data.json"

# 登录后展示可用房间列表后追加的提示文案（可用于群宣传/查房间等，纯文本）
# ROOM_LIST_TIP: "欢迎加入交流群：123456；查房间：example.com"

# Phira API 端点地址（用于用户认证、获取谱面信息、获取成绩记录等）
# 默认: https://phira.5wyxi.com
PHIRA_API_ENDPOINT: "https://phira.5wyxi.com"

# Phira Replay 分享站配置（用于上传回放到分享站）
# SHARE_STATION:
#   # 分享站地址
#   URL: "http://127.0.0.1:40004"
#   # 服务器认证 token（用于自动上传等内部接口）
#   TOKEN: "your_share_station_token_here"
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
SERVER_NAME: "Phira MP"
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

日志等级，统一控制日志文件写入和终端输出的最小等级。

Log level, uniformly controls the minimum level for both log files and terminal output.

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

#### LOG_COMPRESS_AFTER_DAYS

历史日志保留多少天后自动 gzip 压缩。日志按天切分（`logs/YYYY-MM-DD.log`），重复率高，压缩可大幅降低占用。最近 N 天保持明文方便查看，更早的压缩为 `.log.gz`。当天正在写入的日志永不压缩。每日凌晨及服务启动时各执行一次。

How many days before rotated logs are gzip-compressed. Recent logs stay plaintext for easy reading; older ones become `.log.gz`. The currently active log is never touched. Runs at midnight and once on startup.

- 类型 / Type: `number`
- 默认值 / Default: `14`
- 特殊值 / Special: `0` 表示关闭压缩 / `0` disables compression
- 环境变量 / Environment: `LOG_COMPRESS_AFTER_DAYS`
- 支持热重载 / Hot-reloadable: 是 / Yes

#### LOG_MAX_TOTAL_MB

日志目录（含 `.log` 与 `.log.gz`）总占用上限（MB）。超过后从最旧的日志开始删除，直到回落到上限以下；当天正在写入的日志永不删除。用于防止长期运行把磁盘写满。

Total size cap (MB) for the logs directory (both `.log` and `.log.gz`). When exceeded, the oldest logs are deleted first until back under the cap; the active log is never deleted.

- 类型 / Type: `number`
- 默认值 / Default: `500`
- 特殊值 / Special: `0` 表示不限制 / `0` means unlimited
- 环境变量 / Environment: `LOG_MAX_TOTAL_MB`
- 支持热重载 / Hot-reloadable: 是 / Yes

示例 / Example:
```yaml
LOG_COMPRESS_AFTER_DAYS: 14
LOG_MAX_TOTAL_MB: 500
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

#### CORS_ORIGINS

HTTP API 允许的跨域来源（CORS）列表。配置后，仅列表中的来源才能通过浏览器跨域访问 HTTP API。

List of allowed CORS origins for the HTTP API. When configured, only listed origins can access the HTTP API cross-origin from a browser.

- 类型 / Type: `array of strings`
- 默认值 / Default: 不设置或空数组 → 允许所有来源（`*`，向后兼容）/ unset or empty → allow all origins (`*`, backward compatible)
- 环境变量 / Environment: `CORS_ORIGINS`（逗号/空格/分号分隔）/ comma, space, or semicolon separated

示例 / Example:
```yaml
CORS_ORIGINS:
  - "https://admin.your-domain.com"
  - "http://localhost:5173"
```

注意 / Note:
- 生产环境强烈建议配置具体来源，避免任意站点跨域访问管理接口
- Strongly recommended to set explicit origins in production to prevent arbitrary sites from accessing admin endpoints

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

#### MAX_ROOMS

全服同时存在的房间数上限。达到上限后，玩家创建房间会收到 `rooms-limit-reached` 提示，已存在的房间不受影响。

Global cap on the number of rooms that can exist at once. When reached, creating a room returns the `rooms-limit-reached` notice; existing rooms are unaffected.

- 类型 / Type: `number`
- 默认值 / Default: 不限制 / unlimited（未设置或 `< 1`）
- 环境变量 / Environment: `MAX_ROOMS`

示例 / Example:
```yaml
MAX_ROOMS: 200
```

注意 / Note:
- 支持配置热重载，无需重启 / Supports hot reload, no restart needed
- 小内存机器建议设置，防止房间过多导致内存耗尽 / Recommended on low-memory hosts to prevent OOM

#### MAX_CONNECTIONS

全服同时在线的 TCP 连接数上限。达到上限后，新连接会在握手前被直接拒绝。

Global cap on concurrent TCP connections. When reached, new connections are rejected before handshake.

- 类型 / Type: `number`
- 默认值 / Default: 不限制 / unlimited（未设置或 `< 1`）
- 环境变量 / Environment: `MAX_CONNECTIONS`

示例 / Example:
```yaml
MAX_CONNECTIONS: 2000
```

注意 / Note:
- 支持配置热重载，无需重启 / Supports hot reload, no restart needed
- 与单 IP 限速互补：`MAX_CONNECTIONS` 控制全局总量，连接速率限制器控制单 IP 突发
- Complements per-IP rate limiting: `MAX_CONNECTIONS` caps the global total, the rate limiter caps per-IP bursts

#### HTTP_RATE_LIMIT_MAX_REQUESTS

每个 IP 在每个时间窗口内允许的最大 HTTP 请求数。超出后会返回 `429 Too Many Requests` 并在响应头中包含 `Retry-After`。

Maximum HTTP requests per IP per time window. Exceeding returns `429 Too Many Requests` with `Retry-After` header.

- 类型 / Type: `number`
- 默认值 / Default: `100`
- 环境变量 / Environment: `HTTP_RATE_LIMIT_MAX_REQUESTS`

示例 / Example:
```yaml
HTTP_RATE_LIMIT_MAX_REQUESTS: 200
```

#### HTTP_RATE_LIMIT_WINDOW_MS

HTTP 请求速率限制的时间窗口长度（毫秒）。

Time window length for HTTP request rate limiting (milliseconds).

- 类型 / Type: `number`
- 默认值 / Default: `60000`（1 分钟）
- 环境变量 / Environment: `HTTP_RATE_LIMIT_WINDOW_MS`

示例 / Example:
```yaml
HTTP_RATE_LIMIT_WINDOW_MS: 60000
```

注意 / Note:
- 限流对**所有 HTTP 端点**生效（包括公开接口和管理员接口）
- Applies to **all HTTP endpoints** (public and admin)
- 被限流的 IP 默认封禁 2 分钟（窗口时长的 2 倍）
- Banned IPs are blocked for 2 minutes by default (2x window duration)

#### REPLAY_ENABLED

是否启用回放录制功能。

Whether to enable replay recording.

- 类型 / Type: `boolean`
- 默认值 / Default: `false`
- 环境变量 / Environment: `REPLAY_ENABLED`

示例 / Example:
```yaml
REPLAY_ENABLED: true
```

#### CHAT_ENABLED

是否启用玩家聊天。关闭后，玩家发送的聊天内容不会被转发，房间内会显示本地化提示 `chat-disabled-by-server`。

Whether to enable player chat. When disabled, player chat content is not forwarded and the room receives the localized `chat-disabled-by-server` notice.

- 类型 / Type: `boolean`
- 默认值 / Default: `true`
- 环境变量 / Environment: `CHAT_ENABLED`

示例 / Example:
```yaml
CHAT_ENABLED: false
```

#### REPLAY_BASE_DIR

回放录制文件的基础目录。

Base directory for replay recording files.

- 类型 / Type: `string`
- 默认值 / Default: `record`（位于工作目录下）
- 环境变量 / Environment: `REPLAY_BASE_DIR`

示例 / Example:
```yaml
REPLAY_BASE_DIR: "./record"
```

#### REPLAY_TTL_DAYS

回放文件保留天数。超过该天数的 `.phirarec` 文件会在每天凌晨自动清理。

Replay file retention in days. `.phirarec` files older than this are automatically cleaned up every midnight.

- 类型 / Type: `number`
- 默认值 / Default: `4`
- 范围 / Range: `1-3650`
- 环境变量 / Environment: `REPLAY_TTL_DAYS`

示例 / Example:
```yaml
REPLAY_TTL_DAYS: 7
```

注意 / Note:
- 支持配置热重载，修改后下一次清理即生效，无需重启
- Supports hot reload; takes effect on the next cleanup run without restart
- 磁盘空间紧张可调小，需要长期留存回放可调大
- Lower it when disk space is tight, raise it to retain replays longer

#### REPLAY_AUTO_UPLOAD

是否启用游戏结束后自动上传回放到分享站。

Whether to enable automatic replay upload to share station after game ends.

- 类型 / Type: `boolean`
- 默认值 / Default: `false`
- 环境变量 / Environment: `REPLAY_AUTO_UPLOAD`

示例 / Example:
```yaml
REPLAY_AUTO_UPLOAD: true
```

注意 / Note:
- 需要同时配置 `SHARE_STATION` 才能实际生效
- Requires `SHARE_STATION` to be configured to take effect
- 用户可通过 `/replay/auto-upload/config` 接口控制上传后是否显示
- Users can control visibility after upload via `/replay/auto-upload/config`

#### LANG

服务器默认语言，影响日志、CLI 控制台、HTTP 默认输出语言。

Server default language. Affects logs, CLI console, and default HTTP output language.

- 类型 / Type: `string`
- 默认值 / Default: `"zh-CN"`（按 ENV/系统区域协商；不识别时回退 / Negotiated against ENV and system locale, falls back when unknown）
- 可选值 / Options: `"zh-CN"`, `"en-US"`
- 环境变量 / Environment: `PHIRA_MP_LANG`（优先）或 `LANG` / `PHIRA_MP_LANG` (preferred) or `LANG`
- 优先级 / Priority: `PHIRA_MP_LANG` ENV > `LANG` ENV > 配置文件 / config file > 默认 / default
- 兼容 POSIX 形式（如 `en_US.UTF-8` 自动归一为 `en-US`）/ POSIX style accepted (e.g. `en_US.UTF-8` is normalized to `en-US`)

示例 / Example:
```yaml
LANG: en-US
```
```bash
export PHIRA_MP_LANG=en-US
```

### 观战配置 / Monitor Configuration

#### MONITORS

观战用户 ID 列表，这些用户可以以观战者身份加入任何房间。

Monitor user ID list, these users can join any room as monitors.

- 类型 / Type: `array of numbers`
- 默认值 / Default: `[2]`
- 环境变量 / Environment: `MONITORS`

示例 / Example:
```yaml
MONITORS:
  - 2
  - 100
  - 200
```

### 测试账号配置 / Test Account Configuration

#### TEST_ACCOUNT_IDS

测试账号 ID 列表，这些账号的日志不写入文件（除非 LOG_LEVEL=DEBUG）。

Test account ID list, logs from these accounts are not written to files (unless LOG_LEVEL=DEBUG).

- 类型 / Type: `array of numbers`
- 默认值 / Default: `[1739989]`
- 环境变量 / Environment: `TEST_ACCOUNT_IDS`

示例 / Example:
```yaml
TEST_ACCOUNT_IDS:
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
- 默认值 / Default: `undefined`（未配置，管理员 API 默认禁用）
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

#### ALLOW_TOKEN_IN_QUERY

是否允许从 URL 查询参数（`?token=`）中提取管理员 Token。默认关闭，仅支持请求头方式传递 Token。

Whether to allow extracting the admin token from the URL query parameter (`?token=`). Disabled by default; only header-based token passing is supported.

- 类型 / Type: `boolean`
- 默认值 / Default: `false`
- 环境变量 / Environment: `ALLOW_TOKEN_IN_QUERY`

示例 / Example:
```yaml
ALLOW_TOKEN_IN_QUERY: false
```

安全警告 / Security warning:
- 启用后 Token 会出现在服务器日志、代理日志、浏览器历史中，存在泄露风险
- When enabled, the token appears in server logs, proxy logs, and browser history, risking leakage
- 仅当管理脚本无法自定义请求头时才建议启用
- Only enable it when your admin client cannot send custom request headers

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

#### PHIRA_API_ENDPOINT

Phira API 端点地址，用于用户认证、获取谱面信息等。

Phira API endpoint for user authentication and chart info retrieval.

- 类型 / Type: `string`
- 默认值 / Default: `"https://phira.5wyxi.com"`
- 环境变量 / Environment: `PHIRA_API_ENDPOINT`

示例 / Example:
```yaml
PHIRA_API_ENDPOINT: "https://phira.5wyxi.com"
```

#### OUTBOUND_PROXY

服务端出站网络请求的代理配置。

Proxy configuration for outbound server network requests.

- 类型 / Type: `string | boolean`
- 默认值 / Default: 保持当前环境里的默认代理行为 / Follow default environment proxy behavior
- 环境变量 / Environment: `OUTBOUND_PROXY`

支持的值 / Supported values:
- `false` / `False`: 强制直连，不走代理 / Force direct connection, bypass proxy
- `"http://..."` / `"socks://..."`: 强制使用指定代理 / Force connection through specified proxy

示例 / Example:
```yaml
OUTBOUND_PROXY: false
# 或是 / or
OUTBOUND_PROXY: "http://127.0.0.1:7890"
```

#### SHARE_STATION

Phira Replay 分享站配置，用于上传回放到分享站。

Phira Replay share station configuration for uploading replays.

- 类型 / Type: `object`
- 默认值 / Default: `undefined`（未配置）
- 环境变量 / Environment: `SHARE_STATION_URL`, `SHARE_STATION_TOKEN`

子配置项 / Sub-options:
- `URL` (string): 分享站地址，例如 `"http://127.0.0.1:40004"`
- `TOKEN` (string): 服务器认证 token，用于自动上传等内部接口

示例 / Example:
```yaml
SHARE_STATION:
  URL: "http://127.0.0.1:40004"
  TOKEN: "your_share_station_token_here"
```

注意 / Note:
- 需要同时配置 `URL` 和 `TOKEN` 才能正常工作
- Both `URL` and `TOKEN` must be configured to work properly

#### HITOKOTO_API_URL

一言 API 地址，用于欢迎消息中的随机句子。

Hitokoto (one-liner) API endpoint, used for the random sentence in welcome messages.

- 类型 / Type: `string`
- 默认值 / Default: `"https://v1.hitokoto.cn/"`
- 环境变量 / Environment: `HITOKOTO_API_URL`

示例 / Example:
```yaml
HITOKOTO_API_URL: "https://v1.hitokoto.cn/"
```

#### REDIS

Redis 缓存配置。启用后，所有本地缓存（谱面缓存、一言缓存等）将迁移到 Redis，不再使用本地内存和磁盘缓存。

Redis cache configuration. When enabled, all local caches (chart cache, hitokoto cache, etc.) are migrated to Redis instead of local memory/disk.

- 类型 / Type: `object`
- 默认值 / Default: `undefined`（未配置，不启用 Redis）/ unset (Redis disabled)
- 环境变量 / Environment: `REDIS_ENABLED`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`
- 该项变更需要重启服务才能生效 / Changing this requires a server restart to take effect

子配置项 / Sub-options:
- `ENABLED` (boolean): 是否启用 Redis 缓存，默认 `false`
- `HOST` (string): Redis 服务器地址，默认 `"127.0.0.1"`
- `PORT` (number): Redis 服务器端口，默认 `6379`
- `PASSWORD` (string): Redis 认证密码（可选）
- `DB` (number): Redis 数据库号，默认 `0`

示例 / Example:
```yaml
REDIS:
  ENABLED: false
  HOST: "127.0.0.1"
  PORT: 6379
  # PASSWORD: "your_redis_password"
  DB: 0
```

## 环境变量配置 / Environment Variable Configuration

所有配置项均可通过环境变量设置，环境变量名与配置文件键名相同，均为全大写。语言项 `LANG` 在 ENV 中可用 `PHIRA_MP_LANG` 作为更明确的别名（优先于系统 `LANG`）。

All configuration options can be set via environment variables with the same uppercase name as config file keys. For the language option `LANG`, the more specific alias `PHIRA_MP_LANG` is also accepted (preferred over the system `LANG`).

示例 / Example:

```bash
# Linux/macOS
export SERVER_NAME="My Server"
export PORT=12346
export HTTP_SERVICE=true
export ADMIN_TOKEN="your_token"
export MONITORS="2,100,200"

# Windows (PowerShell)
$env:SERVER_NAME="My Server"
$env:PORT=12346
$env:HTTP_SERVICE="true"
$env:ADMIN_TOKEN="your_token"
$env:MONITORS="2,100,200"

# Windows (CMD)
set SERVER_NAME=My Server
set PORT=12346
set HTTP_SERVICE=true
set ADMIN_TOKEN=your_token
set MONITORS=2,100,200
```

## 命令行参数 / Command-Line Arguments

部分配置支持命令行参数覆盖。

Some configurations support command-line argument override.

示例 / Example:

```bash
# 开发模式
pnpm run dev --port 12346 --host 0.0.0.0

# 生产模式
node dist/server/main.js --port 12346 --httpService true --httpPort 12347
```

支持的参数 / Supported arguments:
- `-p, --port <number>` - 游戏端口
- `--host <string>` - 监听地址
- `--httpService <boolean>` - 启用 HTTP 服务（`true` / `false`）
- `--httpPort <number>` - HTTP 端口
- `--serverName <string>` - 服务器名称
- `--roomMaxUsers <number>` - 房间最大人数
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

### LOG_LEVEL

Docker 容器中的日志配置。

Log configuration in Docker container.

- `LOG_LEVEL`: 统一控制日志文件与终端输出的最小等级

示例 / Example:
```bash
docker run -e LOG_LEVEL=INFO ghcr.io/pimeng/tphira-mp
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

配置文件 / Configuration file:
```yaml
SERVER_NAME: "Dev Server"
HOST: "127.0.0.1"
PORT: 12346
HTTP_SERVICE: true
HTTP_PORT: 12347
LOG_LEVEL: DEBUG
ROOM_MAX_USERS: 4
ADMIN_TOKEN: "dev_token_not_secure"
```

环境变量 / Environment variables:
```bash
export LOG_LEVEL=DEBUG
export PHIRA_MP_LANG=en-US
```

### 生产环境 / Production Environment

配置文件 / Configuration file:
```yaml
SERVER_NAME: "Phira MP Production"
HOST: "::"
PORT: 12346
HTTP_SERVICE: true
HTTP_PORT: 12347
LOG_LEVEL: INFO
REAL_IP_HEADER: "X-Forwarded-For"
ROOM_MAX_USERS: 8
ADMIN_DATA_PATH: "/data/admin_data.json"
ROOM_LIST_TIP: "欢迎！加入群：123456"
```

环境变量 / Environment variables:
```bash
export ADMIN_TOKEN="your_secure_token_here"
export LOG_LEVEL=INFO
```

### 高性能环境 / High-Performance Environment

配置文件 / Configuration file:
```yaml
SERVER_NAME: "Phira MP High Performance"
HOST: "::"
PORT: 12346
HTTP_SERVICE: true
HTTP_PORT: 12347
LOG_LEVEL: WARN
ROOM_MAX_USERS: 16
TEST_ACCOUNT_IDS:
  - 1739989
```

环境变量 / Environment variables:
```bash
export LOG_LEVEL=WARN
```

### Docker 环境 / Docker Environment

配置文件 / Configuration file:
```yaml
SERVER_NAME: "Phira MP Docker"
HOST: "0.0.0.0"
PORT: 12346
HTTP_SERVICE: true
HTTP_PORT: 12347
LOG_LEVEL: INFO
ADMIN_DATA_PATH: "/data/admin_data.json"
```

环境变量 / Environment variables:
```bash
export LOG_LEVEL=INFO
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
