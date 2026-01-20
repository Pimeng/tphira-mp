# Phira MP Typescript

> [!TIP]
> 本项目由 TRAE SOLO 模式开发，存在一定的问题，见谅，如有更好的实现欢迎 PR<br>
> 目前为早期移植版本，后续会持续完善<br>
> 不会写代码，勿喷（（（<br>

本项目基于 https://github.com/TeamFlos/phira-mp 中的实现，将同一套多人联机/观战服务按原逻辑迁移到 Node.js（TypeScript）版本，目标是保持协议与核心行为一致（握手、编解码、房间状态机、观战转发、认证流程等）。

## 🐳 Docker 运行

镜像托管在 GHCR：

- `ghcr.io/Pimeng/phira-mp-ts`<br>
镜像 -> `ghcr.1ms.run/Pimeng/phira-mp-ts`<br>
建议优先使用镜像源而并非 ghcr.io

启动示例（使用环境变量生成配置文件）：

```bash
docker run --rm -p 12346:12346 -p 12347:12347 ^
  -e HOST="::" ^
  -e PORT=12346 ^
  -e HTTP_SERVICE=true ^
  -e HTTP_PORT=12347 ^
  -e ROOM_MAX_USERS=8 ^
  -e MONITORS="2" ^
  ghcr.1ms.run/Pimeng/phira-mp-ts:latest
```

也可以直接通过 `SERVER_CONFIG_YAML` 提供完整的 YAML 配置：

```bash
docker run --rm -p 12346:12346 -p 12347:12347 ^
  -e SERVER_CONFIG_YAML="HOST: \"::\"\nPORT: 12346\nHTTP_SERVICE: true\nHTTP_PORT: 12347\nROOM_MAX_USERS: 8\nmonitors:\n  - 2\n" ^
  ghcr.1ms.run/Pimeng/phira-mp-ts:latest
```

- 可选环境变量：
  - `LOG_LEVEL`：控制写入日志文件的最小等级（默认 `INFO`）
  - `CONSOLE_LOG_LEVEL`：控制输出到终端的最小等级（默认 `INFO`）

注意事项：
- 如果容器内运行时工作目录不是项目根目录，请设置 `PHIRA_MP_HOME=/app`（指向包含 `locales/` 与 `server_config.yml` 的目录），避免本地化与配置读取失败。


## 🔧 服务端配置（server_config.yml）

支持大写/小写两种键名（例如 `HOST` / `host`）

- SERVER_NAME(string): 当前服务器名字，会显示在欢迎信息中（默认 `Phira MP`）
- MONITORS(array): 观战用户ID列表（默认 `2`）
- HOST(string): TCP 服务监听地址（默认 `::`）
- PORT(number): TCP 服务监听端口（默认 `12346`）
- HTTP_SERVICE(boolean): 是否启动 HTTP 服务（默认 `false`）
- HTTP_PORT(number): HTTP 服务监听端口（默认 `12347`）
- ROOM_MAX_USERS(number): 单房间最大玩家数（默认 `8`，最大 `64`）

## 🔨 安装与构建

```bash
pnpm install
pnpm run build
```

## 🚀 启动服务端

开发模式（从源代码运行）：

```bash
pnpm run dev:server -- --port 12346
```

生产模式（先编译再运行）：

```bash
pnpm run build
pnpm start -- --port 12346
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
- pnpm >= 9.15

## 🖥️ 硬件要求

经过测试，本服务端可以跑在 0.5核 128MB 5Mbps 非常极限的情况下经过压测仍然不死

测试环境：

- 服务器：Debian12 fnOS 64位
- 服务端：Docker版本 0.1.2
- 性能分配： 1024权重 0.5核 128MB 内存
- 压测参数：单机器最大连接数2000，线程池2000，发包数 2000pps，10台机器同时压测

压测后最大峰值带宽为 4Mbps，内存仅占用98MB，CPU占用率10%不到，CPU总计4.02 s

![聊天截图](https://github.com/Pimeng/phira-mp-ts/raw/main/.github/resources/chat_.png)
![压测工具](https://github.com/Pimeng/phira-mp-ts/raw/main/.github/resources/压测工具_.png)
![phira](https://github.com/Pimeng/phira-mp-ts/raw/main/.github/resources/phira_.png)

## 📂 目录结构

- `src/common/`：协议层（二进制编解码、长度前缀 framing、Stream）
- `src/server/`：服务端（会话/用户/房间、断线处理、本地化、入口）
- `src/client/`：客户端库（连接、心跳、回调式调用、状态缓存）
- `locales/`：Fluent 本地化资源（与 Rust 版本一致）
- `test/`：协议 golden + 端到端集成测试（内置 mock 远端 HTTP）

## 🙏 致谢

- [Phira MP（Rust 版）](https://github.com/TeamFlos/phira-mp)：项目本体，协议与核心逻辑参考
- [TRAE](https://www.trae.ai/)：本项目IDE，以及 SOLO 模式的提供
- GPT-5.2 模型

还有帮助我测试的朋友们：

- [Dmocken](https://github.com/Dmocken)
- [RainCore1115](https://github.com/RainCore1115)
- [RENaa_FD](https://github.com/lRENyaaa)

感谢
