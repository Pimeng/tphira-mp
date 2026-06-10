# 服务端 GUI / Server GUI

类似 Minecraft 服务端 GUI 的管理面板：启动服务器时自动弹出独立程序窗口，提供实时性能监控、房间 / 玩家数据和可执行命令的日志控制台。

A Minecraft-server-style admin panel: a standalone GUI window opens with the server, with live performance charts, room / player data, and an interactive log console.

## GUI 窗口模式（推荐）

配置 `GUI: true`（或启动参数 `--gui`）后，服务器启动时自动弹出独立的 GUI 程序窗口：

```yaml
GUI: true
```

```bash
# 或使用启动参数
node dist/server/main.js --gui
```

- 窗口基于系统已安装的 Edge / Chrome 应用模式（无地址栏、无标签页、独立任务栏图标），零额外依赖；
- 启用 GUI 时自动开启 HTTP 服务，无需单独配置 `HTTP_SERVICE`；
- **自动登录**：服务器每次启动生成一个本机专用令牌（仅接受来自回环地址 127.0.0.1 / ::1 的请求），通过 URL 片段传入窗口，无需输入 `ADMIN_TOKEN`；
- 关闭窗口不会停止服务器；在控制台输入 `stop` 或按 Ctrl+C 才会关闭服务器；
- 找不到可用浏览器时（如无桌面环境），日志会输出一条带登录令牌的本机访问地址，可手动打开。

> 浏览器探测顺序：Edge → Chrome →（Linux 另试 Chromium）→ 系统默认浏览器。

## 远程浏览器访问

GUI 同时也是普通网页，可从其他机器访问（适合服务器跑在 VPS 上的场景）：

```yaml
HTTP_SERVICE: true
HTTP_PORT: 12347
ADMIN_TOKEN: "你的管理员令牌"
```

浏览器访问：

```
http://服务器地址:12347/gui
```

页面本身公开（不包含任何敏感数据），所有数据接口均需要管理员令牌。首次打开输入 `ADMIN_TOKEN`（或 OTP / CLI 提权获得的临时令牌）即可进入，令牌保存在浏览器本地。

> 未配置 `ADMIN_TOKEN` 时，可使用 [临时管理员 TOKEN](./api.md#临时管理员tokenotp方式) 登录。注意：临时令牌与请求 IP 绑定。

## 功能

### 性能监控

- **内存曲线**：进程 RSS 实时曲线，附 V8 堆使用 / 总量与系统总内存；
- **CPU 曲线**：进程 CPU 占用率（整机口径 = 占满所有核心为 100%）；
- 历史数据保留约 10 分钟（每 2 秒采样一次），打开页面即回填整条曲线；
- 业务计数器：在线玩家、活跃房间、活跃会话、WebSocket 连接数。

### 房间 / 玩家

- 房间列表实时推送（基于 WebSocket `admin_subscribe`，状态变化即更新）；
- 每个房间显示状态（选谱中 / 准备中 / 游戏中）、锁定 / 循环 / 直播标记、人数；
- 点击房间展开房主、谱面、玩家（房主高亮、离线划线、游戏中显示 ✓ 完成 / × 中止）与观战者；
- 玩家页签展示**全部在线玩家**（含未进房间的大厅玩家），标注所在房间 / 大厅、观战权限、封禁与离线状态。

### 控制台

- 标题栏支持深浅色主题切换（☀/☾ 按钮）；未手动选择时跟随系统深浅色偏好，选择保存在浏览器本地；
- 与服务器终端一致的实时日志流（按等级着色，等级过滤跟随 `LOG_LEVEL` 配置）；
- 底部命令输入框支持全部 [CLI 命令](./commands.md)（`help`、`list`、`kick`、`ban`、`broadcast`、`stop` 等），↑/↓ 翻阅历史命令；
- 命令输出直接回显在控制台中；每次执行同时写入一条 INFO 审计日志；
- 断线自动重连，重连期间标题栏状态点变红。

## 技术说明

- 单文件页面（HTML/CSS/JS 内嵌），零外部资源依赖，离线环境与 SEA 单文件打包均可用；
- 数据通道：
  - `GET /admin/metrics`（2 秒轮询 + `?history=1` 首次回填），见 [API 文档](./api.md#监控指标--metrics)；
  - WebSocket `console_subscribe` / `admin_subscribe` 实时推送，见 [WebSocket API](./websocket.md)；
  - `POST /admin/console/command` 执行命令，见 [API 文档](./api.md#gui-控制台接口)。
- 鉴权失败 / 令牌过期会自动退回登录页；管理员接口的失败重试限制与 IP 封禁策略同样适用于 GUI。
- 窗口模式的本机令牌为每次启动随机生成的 UUID，只在服务器运行期间有效，且仅接受回环地址请求；通过 URL 片段（`#token=`）传递——片段不进入 HTTP 请求，也不会被记录到任何日志。
