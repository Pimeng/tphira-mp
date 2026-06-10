<img src=".github/resources/tsmp.png" alt="tphira-mp logo" align="right" width="30%">
<div align="center">
  <h1>Typescript Phira-MP</h1>
  <h3>Phira MP 的 <b>Typescript</b> 实现</h3>
  <h5><i>目前正在逐步完善，还请多多包涵</i></h5>
</div>

> [!NOTE]
> 本项目由各种AI工具开发，存在一定的问题，见谅，如有更好的实现欢迎 PR<br>
> 有好的提议欢迎提ISSUE！

## 本项目专属讨论区

https://bbs.07210700.xyz/c/7-category/7

欢迎前往注册并讨论！

## ☁️ 在雨云部署（推荐）

[![Deploy on RainYun](https://rainyun-apps.cn-nb1.rains3.com/materials/deploy-on-rainyun-en.svg)](https://app.rainyun.com/apps/rca/store/7497?ref=Pimeng_)

## 🚇 在 RailWay 上部署
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/b5IFPX?referralCode=GjgH_Y)

## 🇿 在 Zeabur 上部署

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/5CSUU4?referralCode=pimeng7143)

## 🐳 Docker 运行

镜像托管在 GHCR：

- `ghcr.io/pimeng/tphira-mp` <br>
- 镜像 -> `ghcr.1ms.run/pimeng/tphira-mp` <br>

建议优先使用镜像源而并非 ghcr.io

> [!WARNING]
> `PHIRA_MP_HOME` 决定运行时读写配置 / 本地化 / 日志 / 数据的根目录。容器内若工作目录不是项目根目录，建议设置 `PHIRA_MP_HOME=/app`，保证这些文件落在稳定且可写的位置。
> 即使该目录暂无 `locales/`，服务端也会优先在线拉取，失败时回退到嵌入二进制的本地化兜底；`server_config.yml` 缺失时会自动生成，因此离线也能启动。

## 📦 版本号说明

版本号采用三段式 `A.B.C`：

- **A** — 兼容的 Phira 客户端协议版本。变动通常意味着与旧版客户端不兼容。
- **B** — 服务端大版本，代表性能或使用体验的显著提升。
- **C** — 小修小补、小功能。

带 `-rc.N` 后缀的为**预发布版**（如 `1.11.1-rc.1`），供尝鲜与压测，不建议生产环境直接使用。确认稳定后才会发布去掉后缀的正式版。

Docker 镜像标签三档，按需选择：

| 标签 | 含义 |
| --- | --- |
| `:latest` | 最新正式版 |
| `:vA.B` | 跟随该系列的最新补丁（如 `:v1.11` 始终指向 1.11.x 的最新版） |
| `:vA.B.C` | 锁定到具体版本，最稳定可控 |

## 🔧 服务端配置

配置文件为 `server_config.yml`，键名统一使用全大写，支持使用环境变量配置。

**优先级：** 命令行 > 环境变量 > 配置文件

**完整配置文档请参考**：[这里](docs/configuration.md)


## 🔨 安装与构建

本项目使用 pnpm 作为包管理器，请先安装 pnpm 10.29.3 或以上版本
```bash
npm install -g pnpm
```

> 若依赖安装过慢/失败，请替换为国内源
> `npm install -g pnpm --registry=https://registry.npmmirror.com`

```bash
pnpm install
pnpm run build
```

> 若依赖安装过慢/失败，请替换为国内源
> `pnpm install --registry=https://registry.npmmirror.com`

## 🚀 启动服务端

开发模式（从源代码运行）：

```bash
pnpm run dev --port 12346
```

生产模式（先编译再运行）：

```bash
pnpm run build
pnpm start --port 12346
```

## 🛡️ 进程守护（生产环境强烈建议）

服务端内置了进程级异常兜底：单个未捕获的 Promise 拒绝（`unhandledRejection`）只会记录日志、不会退出；而 `uncaughtException` 会在记录日志后**优雅关闭并以非零码退出**，把"是否拉起"交给外部守护进程。因此生产环境请务必在守护进程下运行，崩溃后即可自动恢复：

- **Docker**：使用仓库根目录的 [`docker-compose.yml`](docker-compose.yml)（已带 `restart: unless-stopped`），或 `docker run --restart=unless-stopped ...`
- **systemd**：

  ```ini
  # /etc/systemd/system/phira-mp.service
  [Unit]
  Description=Phira MP Server
  After=network.target

  [Service]
  WorkingDirectory=/opt/phira-mp
  ExecStart=/usr/bin/node dist/server/main.js --port 12346
  Restart=always
  RestartSec=3

  [Install]
  WantedBy=multi-user.target
  ```

- **pm2**：`pm2 start dist/server/main.js --name phira-mp -- --port 12346`

## 🔍 测试

```bash
pnpm test
```

## 📈 性能测试

项目内置了压测工具，支持连接、房间、gameplay 三种场景，且自带 mock 认证服务器，无需真实 Phira API token 即可运行。

一键运行全部压测：

```bash
pnpm bench -- --duration 60
```

多用户并发场景（mock 认证自动为每个 token 分配独立用户）：

```bash
pnpm bench -- --tokens "a,b,c,d" --rooms 10 --players-per-room 4 --duration 60
```

单独运行某个压测：

```bash
pnpm run bench:connect -- --clients 300 --rate 50 --duration 60 --token test
pnpm run bench:room -- --rooms 50 --players-per-room 4 --duration 60 --tokens "a,b,c,d"
pnpm run bench:gameplay -- --rooms 10 --players-per-room 4 --hz 20 --duration 60 --tokens "a,b,c,d"
```

压测结束后，报告自动保存到 `bench-results/` 目录。

详细文档请参考 [性能测试指南](docs/performance-testing.md)。

## 🔧 编译为可执行文件（本地）

本项目使用 Node 的 SEA（Single Executable Applications）方式打包为**单个**可执行文件。本地化资源已嵌入二进制，配置文件在首次运行时自动生成，因此 `release/` 目录只有可执行文件本身。

```bash
pnpm install
pnpm run package:sea
```

输出目录：
- `release/phira-mp-server(.exe)`：可执行文件（本地化资源已嵌入其中）

**首次运行行为：**
- `server_config.yml`：在可执行文件同目录自动生成。优先从 GitHub 拉取完整带注释示例，拉取失败则生成一份精简（无注释）配置。
- 本地化文件：优先在线拉取到运行目录的 `locales/`，拉取失败则使用嵌入二进制的兜底版本，保证离线 / `raw.githubusercontent.com` 被墙时仍可正常运行。

### 自定义翻译（运行时覆盖）

无需重新打包即可改翻译：在运行目录的 `locales/` 下新建 `<语言>.ftl`（如 `zh-CN.ftl`），**只写要修改的键**，服务端启动时会逐键覆盖二进制自带翻译（覆盖而非整体替换，未列出的键仍走内置）。例如：

```ftl
chat-welcome = 欢迎光临 { $serverName }！
chat-disabled-by-server = 本服已关闭聊天
```

支持的语言：`en-US` `zh-CN` `zh-TW` `ja-JP` `ko-KR` `ru-RU`。启动日志会打印 `已应用 locales/<语言>.ftl 覆盖（N 个键）`。

> i18n 的唯一手工编辑源是 `locales/*.ftl`。唯一**提交入库**的生成产物是 `src/server/utils/embeddedLocales.ts`（嵌入二进制 / 打进 bundle 的离线兜底）；修改任意 `.ftl` 后运行 `pnpm gen:locales` 重新生成（`build` / `package:sea` 已自动包含）。
>
> `locales.json`（合并后的 release 资产）**不入库、也不写进 `locales/`**——它由 `pnpm gen:locales-json` 按需生成到构建目录（默认 `dist-bundle/`），CI / Dockerfile 在发布时各自从 ftl 生成并附带。

## 📋 环境要求

- Node.js >= 24
- pnpm >= 10.29.3

## 🏗️ 项目架构

本项目采用模块化架构，主要分为以下几个层次：

```
src/
├── server/
│   ├── main.ts          # 服务器入口，CLI 参数解析
│   ├── core/            # 核心层
│   │   ├── server.ts    # 服务器生命周期管理
│   │   ├── state.ts     # 全局状态管理（用户、房间、会话）
│   │   ├── types.ts     # TypeScript 类型定义
│   │   ├── configValues.ts  # 配置解析与合并
│   │   └── version.ts   # 版本信息
│   ├── network/         # 网络层
│   │   ├── session.ts   # TCP 会话管理（认证、命令路由）
│   │   ├── httpService.ts   # HTTP/WebSocket 服务
│   │   ├── websocketService.ts  # WebSocket 实时推送
│   │   ├── proxyProtocol.ts   # HAProxy PROXY Protocol 支持
│   │   └── httpHelpers.ts     # HTTP 工具函数
│   ├── game/            # 游戏逻辑层
│   │   ├── room.ts      # 房间状态机与游戏流程
│   │   ├── user.ts      # 用户模型
│   │   └── roomUtils.ts # 房间工具函数
│   ├── replay/          # 回放录制层
│   │   ├── replayRecorder.ts  # 回放录制引擎
│   │   ├── replayStorage.ts   # 回放文件存储
│   │   ├── replayFormat.ts    # 回放格式定义
│   │   ├── replayCleanup.ts   # 过期回放清理
│   │   └── autoUpload.ts      # 自动上传逻辑
│   ├── cli/             # 命令行管理界面
│   │   ├── cli.ts       # CLI 主程序
│   │   └── cliHelpers.ts    # CLI 辅助函数
│   └── utils/           # 工具模块
│       ├── logger.ts    # 日志系统（限流、黑名单）
│       ├── l10n.ts      # 国际化/本地化
│       ├── cache.ts     # 谱面缓存
│       ├── mutex.ts     # 互斥锁
│       ├── rateLimiter.ts   # 日志限流器
│       └── appPaths.ts  # 应用路径管理
├── common/              # 共享代码（服务端/客户端共用）
│   ├── binary.ts        # 二进制读写工具
│   ├── commands.ts      # 协议命令定义与编解码
│   ├── stream.ts        # TCP 流管理（批量发送、优先级）
│   ├── framing.ts       # 帧编码（解决粘包）
│   ├── http.ts          # HTTP 请求工具
│   ├── uuid.ts          # UUID 生成与转换
│   └── roomId.ts        # 房间 ID 解析
└── client/              # 客户端代码
    └── client.ts        # 客户端实现
```

### 核心设计要点

- **配置热重载**：支持运行时修改配置（部分配置需重启生效）
- **批量发送优化**：低优先级消息延迟 5ms 批量发送，提高吞吐量
- **观战数据缓冲**：触摸/判定数据 50ms 聚合窗口，减少网络冲击
- **断线重连**：10 秒 dangling 窗口，保留房间和状态
- **回放录制**：独立录制引擎，支持自动上传到分享站
- **HAProxy 支持**：通过 PROXY Protocol 获取真实客户端 IP

## 🔭 本项目长期远景

- [x] 谱面录制功能
- [x] 完善协议层，完整适配原版 Phira 客户端
- [ ] 谱面回放播放客户端/网页端
- [ ] 完善服务端，添加更多功能
- [ ] 等待~~画饼~~添加

## 📚 文档 / Documentation

完整的文档请访问 [文档中心](docs/index.md)

##  🌍 公共访问前端（需要自备API地址）

https://t.phira.link/

## 🔧 开发指南

### 项目结构约定

- `src/server/` - 服务端代码，使用 ESM 模块
- `src/common/` - 共享代码，服务端和客户端共用
- `test/` - 测试文件，使用 Vitest 测试框架
- `docs/` - 文档目录
- `locales/` - 本地化 ftl 源（`<语言>.ftl`，唯一手工编辑源；运行时也可放局部 ftl 覆盖）

### 添加新命令

1. 在 `src/common/commands.ts` 中定义命令类型（ClientCommand/ServerCommand）
2. 实现对应的 encode/decode 函数
3. 在 `src/server/network/session.ts` 的 `process()` 方法中处理命令
4. 如有需要，在 `src/server/game/room.ts` 中实现房间级逻辑

### 配置文件

配置文件为 `server_config.yml`，示例见 `server_config.example.yml`。
支持使用环境变量覆盖配置（键名统一使用全大写）。

**优先级：** 命令行 > 环境变量 > 配置文件

### 运行测试

```bash
pnpm test           # 运行所有测试
pnpm test:watch     # 监视模式运行测试
```

### 调试模式

设置环境变量 `LOG_LEVEL=DEBUG` 可开启详细日志：

```bash
# Windows PowerShell
$env:LOG_LEVEL="DEBUG"; pnpm run dev

# Linux/macOS
LOG_LEVEL=DEBUG pnpm run dev
```

## 🙏 致谢

- [Michaelwucoc](https://github.com/Michaelwucoc)：赞助了本项目，为本项目大力推动了进度
- [RENaa_FD](https://github.com/lRENyaaa)：赞助了本项目，为本项目大力推动了进度，并且和他交流了很多的代码经验！特别鸣谢！！

还有帮助我测试的朋友们：

- [Dmocken](https://github.com/Dmocken)
- [RainCore1115](https://github.com/RainCore1115)

在这里大力的感谢你们！谢谢！没有你们就没有本项目的今天！