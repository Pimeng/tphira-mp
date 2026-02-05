# Phira MP Typescript

Phira MP 的 Typescript 实现，目前正在逐步完善，还请多多包涵
> 注：本项目参考了 [Phira MP Rust](https://github.com/TeamFlos/Phira-MP) 网络协议实现，感谢 TeamFlos 团队的贡献

> [!TIP]
> 本项目由各种AI工具开发，存在一定的问题，见谅，如有更好的实现欢迎 PR<br>
> 不会写代码，轻喷（（（

## ☁️ 在雨云部署（推荐）

[![Deploy on RainYun](https://rainyun-apps.cn-nb1.rains3.com/materials/deploy-on-rainyun-en.svg)](https://app.rainyun.com/apps/rca/store/7497?ref=Pimeng_)

## 🚇 在 RailWay 上部署
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/b5IFPX?referralCode=GjgH_Y)

## 🇿 在 Zeabur 上部署

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/5CSUU4?referralCode=pimeng7143)

## 🐳 Docker 运行

镜像托管在 GHCR：

- `ghcr.io/pimeng/phira-mp-ts` <br>
- 镜像 -> `ghcr.1ms.run/pimeng/phira-mp-ts` <br>

建议优先使用镜像源而并非 ghcr.io

- 可选环境变量：
  - `LOG_LEVEL`：控制写入日志文件的最小等级（默认 `INFO`）
  - `CONSOLE_LOG_LEVEL`：控制输出到终端的最小等级（默认 `INFO`）

注意事项：
- 如果容器内运行时工作目录不是项目根目录，请设置 `PHIRA_MP_HOME=/app`（指向包含 `locales/` 与 `server_config.yml` 的目录），避免本地化与配置读取失败。

## 🔧 服务端配置（server_config.yml）

支持大写/小写两种键名（例如 `HOST` / `host`），支持使用环境变量配置，优先级：命令行>环境变量>配置文件

- SERVER_NAME(string): 当前服务器名字，会显示在欢迎信息中（默认 `Phira MP`）
- MONITORS(array): 观战用户ID列表（默认 `2`）
- HOST(string): 服务监听地址（默认 `::`）
- PORT(number): 游戏监听端口（默认 `12346`）
- HTTP_SERVICE(boolean): 是否启动 HTTP 服务（默认 `false`）
- HTTP_PORT(number): HTTP 服务监听端口（默认 `12347`）
- ROOM_MAX_USERS(number): 单房间最大玩家数（默认 `8`，最大 `64`）
- PHIRA_MP_LANG(string): 服务端默认语言（默认 `zh-CN`）
- ADMIN_TOKEN(string): 管理员接口鉴权 Token（默认 `replace_me`）
- ADMIN_DATA_PATH(string): 管理员数据持久化路径（JSON）（默认 `./admin_data.json`）
- ROOM_LIST_TIP(string): 登录后展示可用房间列表后追加的提示文案（可用于群宣传/查房间等，纯文本）（默认空）


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
- pnpm >= 10.26.0

<!-- ## 🖥️ 硬件要求

经过测试，本服务端可以跑在 0.5核 128MB 5Mbps 非常极限的情况下经过压测仍然不死

测试环境：
- 服务器：Debian12 fnOS 64位
- 服务端：Docker版本 0.1.2
- 性能分配： 1024权重 0.5核 128MB 内存
- 压测参数：单机器最大连接数2000，线程池2000，发包数 2000pps，10台机器同时压测

压测后最大峰值带宽为 4Mbps，内存仅占用98MB，CPU占用率10%不到，CPU总计4.02 s

![聊天截图](https://github.com/Pimeng/phira-mp-ts/raw/main/.github/resources/chat_.png)
![phira](https://github.com/Pimeng/phira-mp-ts/raw/main/.github/resources/phira_.png)

-->

## 🔭 本项目长期远景

- [x] 谱面录制功能
- [ ] 谱面回放播放客户端/网页端
- [x] 完善协议层，完整适配原版 Phira 客户端
- [ ] 完善服务端，添加更多功能
- [ ] 等待~~画饼~~添加

## 🔧 API接口

请参考 [此文档](api.md)

##  🌍 公共访问前端（需要自备API地址）

https://admin.phira.link/

## 🙏 致谢

- [Michaelwucoc](https://github.com/Michaelwucoc)：赞助了本项目，为本项目大力推动了进度

还有帮助我测试的朋友们：

- [Dmocken](https://github.com/Dmocken)
- [RainCore1115](https://github.com/RainCore1115)
- [RENaa_FD](https://github.com/lRENyaaa)

在这里大力的感谢你们！谢谢！没有你们就没有本项目的今天！

## 开源协议与版权声明 (License & Copyright)

### 1. 协议选择
本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 协议开源。

### 2. 开发者权利与义务
我们欢迎并支持社区成员利用本项目搭建服务器、进行二次开发甚至进行商业化运营，但你必须遵守以下准则：
* **必须开源：** 如果你修改了本项目代码并将其用于提供网络服务（如开启游戏私服），你必须根据 AGPL-3.0 协议的要求，向你的用户公开修改后的完整源代码。
* **注明改动：** 在你修改的代码文件中，必须保留原作者的版权信息，并明确标注你所做的改动及改动日期。
* **品牌归属：** 商业化行为不得暗示或宣称获得了原作者的官方背书。

### 3. 关于原作者声明
本项目是基于 [Phira MP Rust](https://github.com/TeamFlos/Phira-MP) 提供的网络协议规范进行的另一种编程语言的独立实现。
* 本项目在底层协议逻辑上与原仓库保持兼容。
* 内部架构、业务逻辑处理及性能优化部分由本项目作者原创开发。
* 感谢原作者在协议研究方面做出的先驱贡献。
