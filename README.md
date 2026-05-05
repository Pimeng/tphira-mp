<h1 align="center">🔷Phira MP Typescript</h1>

Phira MP 的 Typescript 实现，目前正在逐步完善，还请多多包涵

> [!NOTE]
> 本项目由各种AI工具开发，存在一定的问题，见谅，如有更好的实现欢迎 PR<br>
> 有好的提议欢迎提ISSUE！

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
> 如果容器内运行时工作目录不是项目根目录，请设置 `PHIRA_MP_HOME=/app`（指向包含 `locales/` 与 `server_config.yml` 的目录），避免本地化与配置读取失败。

## 🔧 服务端配置

配置文件为 `server_config.yml`，键名统一使用全大写，支持使用环境变量配置。

**优先级：** 命令行 > 环境变量 > 配置文件

**完整配置文档请参考**：[这里](docs/configuration.md)


## 🔨 安装与构建

本项目使用 pnpm 作为包管理器，请先安装 pnpm 10.26.0 或以上版本
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
pnpm run dev:server --port 12346
```

生产模式（先编译再运行）：

```bash
pnpm run build
pnpm start --port 12346
```

## 🔍 测试

```bash
pnpm test
```

## 🔧 编译为可执行文件（本地）

本项目使用 Node 的 SEA（Single Executable Applications）方式打包为单个可执行文件，并将运行所需的资源（`locales/`、配置文件）一并放进 `release/` 目录。

```bash
pnpm install
pnpm run package:sea
```

输出目录：
- `release/phira-mp-server(.exe)`：可执行文件
- `release/locales/`：本地化资源
- `release/server_config.yml`：配置文件（可修改）

## 📋 环境要求

- Node.js >= 22
- pnpm >= 10.26.0

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
- `locales/` - 本地化字符串（运行时需要）

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
$env:LOG_LEVEL="DEBUG"; pnpm run dev:server

# Linux/macOS
LOG_LEVEL=DEBUG pnpm run dev:server
```

## 🙏 致谢

- [Michaelwucoc](https://github.com/Michaelwucoc)：赞助了本项目，为本项目大力推动了进度
- [RENaa_FD](https://github.com/lRENyaaa)：赞助了本项目，为本项目大力推动了进度，并且和他交流了很多的代码经验！特别鸣谢！！

还有帮助我测试的朋友们：

- [Dmocken](https://github.com/Dmocken)
- [RainCore1115](https://github.com/RainCore1115)
- [RENaa_FD](https://github.com/lRENyaaa)

在这里大力的感谢你们！谢谢！没有你们就没有本项目的今天！
