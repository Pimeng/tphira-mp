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

配置文件为 `server_config.yml`，支持大写/小写两种键名，支持使用环境变量配置。

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

## 🙏 致谢

- [Michaelwucoc](https://github.com/Michaelwucoc)：赞助了本项目，为本项目大力推动了进度
- [RENaa_FD](https://github.com/lRENyaaa)：赞助了本项目，为本项目大力推动了进度，并且和他交流了很多的代码经验！特别鸣谢！！

还有帮助我测试的朋友们：

- [Dmocken](https://github.com/Dmocken)
- [RainCore1115](https://github.com/RainCore1115)
- [RENaa_FD](https://github.com/lRENyaaa)

在这里大力的感谢你们！谢谢！没有你们就没有本项目的今天！
