# Phira MP 文档中心 / Documentation Hub

欢迎来到 Phira MP 服务器文档中心！这里包含了所有你需要了解的服务器功能和使用方法。

Welcome to the Phira MP server documentation hub! Here you'll find everything you need to know about server features and usage.

## 📖 文档导航 / Documentation Navigation

### 快速开始 / Quick Start

- [README](../README.md) - 项目介绍、安装和配置 / Project introduction, installation, and configuration
- [配置参考](./configuration.md) - 详细的配置选项说明 / Detailed configuration options
- [架构文档](./architecture.md) - 系统架构和核心组件 / System architecture and core components

### API 文档 / API Documentation

- [HTTP API](./api.md) - RESTful API 接口说明 / RESTful API reference
- [WebSocket API](./websocket.md) - WebSocket 实时推送接口 / WebSocket real-time push API

### 管理文档 / Administration

- [命令文档](./commands.md) - 服务器控制台命令 / Server console commands

## 🎯 按使用场景查找 / Find by Use Case

### 我想部署服务器 / I Want to Deploy a Server

1. 阅读 [README](../README.md) 了解基本配置
2. 查看 [配置参考](./configuration.md) 了解所有配置选项
3. 查看 [架构文档](./architecture.md) 的"部署建议"章节
4. 配置 `server_config.yml` 文件
5. 启动服务器并测试

### 我想管理服务器 / I Want to Manage the Server

1. 学习 [命令文档](./commands.md) 中的 CLI 命令
2. 阅读 [HTTP API](./api.md) 中的管理员接口
3. 使用 [WebSocket API](./websocket.md) 实时监控服务器状态

### 我想集成到我的应用 / I Want to Integrate with My Application

1. 阅读 [HTTP API](./api.md) 了解可用接口
2. 使用 [WebSocket API](./websocket.md) 实现实时功能
3. 查看 [架构文档](./architecture.md) 了解数据流

## 📚 文档详细说明 / Detailed Documentation

### [README.md](../README.md)
项目主文档，包含：
- 项目介绍和特性
- 安装和构建步骤
- 服务器配置说明
- 部署方式（Docker、Railway、Zeabur等）
- 环境要求

Main project documentation including project introduction, installation steps, server configuration, deployment methods, and environment requirements.

### [configuration.md](./configuration.md)
配置参考文档，包含：
- 所有配置选项详解
- 配置方式（文件、环境变量、命令行）
- 配置优先级
- 配置验证和错误处理
- 不同环境的配置示例
- 配置最佳实践

Configuration reference documentation including all config options, configuration methods, priority, validation, examples for different environments, and best practices.

### [architecture.md](./architecture.md)
系统架构文档，包含：
- 项目结构说明
- 核心组件介绍（8大核心组件）
- 数据流程图
- 并发控制机制
- 安全机制
- 性能优化策略
- 故障排查指南

System architecture documentation including project structure, core components (8 major components), data flow, concurrency control, security mechanisms, performance optimization, and troubleshooting.

### [api.md](./api.md)
HTTP API 文档，包含：
- 公共接口（房间列表、回放下载）
- 管理员接口（房间管理、用户管理、封禁管理）
- OTP 临时管理员认证
- 比赛房间管理
- IP 黑名单管理
- 完整的 curl 示例

HTTP API documentation including public endpoints, admin endpoints, OTP authentication, contest room management, IP blacklist management, and complete curl examples.

### [websocket.md](./websocket.md)
WebSocket API 文档，包含：
- 连接和认证
- 消息格式
- 房间状态订阅
- 房间日志推送
- 管理员全局监控
- 客户端示例（JavaScript、Python）

WebSocket API documentation including connection, authentication, message formats, room state subscription, room log push, admin monitoring, and client examples.

### [commands.md](./commands.md)
服务器命令文档，包含：
- 所有可用的 CLI 命令
- 命令参数说明
- 使用示例
- 常见场景的命令组合

Server commands documentation including all available CLI commands, parameter descriptions, usage examples, and common scenario command combinations.

## 🔍 常见问题 / FAQ

### 如何启用 HTTP 服务？
在 `server_config.yml` 中设置：
```yaml
HTTP_SERVICE: true
HTTP_PORT: 12347
```

详见 [配置参考](./configuration.md#http_service)

### 如何配置管理员权限？
方式1：配置永久 Token
```yaml
ADMIN_TOKEN: "your_secure_token"
```

方式2：使用 OTP 临时认证（不配置 ADMIN_TOKEN 时可用）
- 调用 `/admin/otp/request` 获取验证码
- 使用验证码调用 `/admin/otp/verify` 获取临时 Token

详见 [API 文档](./api.md#临时管理员token（otp方式）)

### 如何启用回放录制？
方式1：通过 CLI 命令
```
replay on
```

方式2：通过 HTTP API
```bash
curl -X POST -H "X-Admin-Token: your_token" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  http://localhost:12347/admin/replay/config
```

详见 [命令文档](./commands.md#replay) 和 [API 文档](./api.md#13-回放录制开关（默认关闭）)

### 如何创建比赛房间？
方式1：通过 CLI 命令
```bash
contest room1 enable 100 200 300
contest room1 start
```

方式2：通过 HTTP API
```bash
curl -X POST -H "X-Admin-Token: your_token" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "whitelist": [100, 200, 300]}' \
  http://localhost:12347/admin/contest/rooms/room1/config
```

详见 [命令文档](./commands.md#contest) 和 [API 文档](./api.md#比赛房间（一次性房间）)

### 如何监控服务器状态？
方式1：使用 WebSocket 管理员订阅
```javascript
const ws = new WebSocket('ws://localhost:12347/ws');
ws.send(JSON.stringify({
  type: 'admin_subscribe',
  token: 'your_admin_token'
}));
```

方式2：定期调用 HTTP API
```bash
curl -H "X-Admin-Token: your_token" \
  http://localhost:12347/admin/rooms
```

详见 [WebSocket 文档](./websocket.md#管理员-websocket-api)

## 🤝 贡献文档 / Contributing to Documentation

如果你发现文档有错误或需要改进，欢迎提交 PR 或 Issue！

If you find errors or areas for improvement in the documentation, feel free to submit a PR or Issue!

### 文档编写规范 / Documentation Guidelines

1. 使用中英双语（中文在前，英文在后）
   Use bilingual format (Chinese first, English second)

2. 提供完整的代码示例
   Provide complete code examples

3. 包含实际的使用场景
   Include real-world use cases

4. 保持格式一致性
   Maintain consistent formatting

5. 及时更新文档与代码同步
   Keep documentation in sync with code

## 📞 获取帮助 / Getting Help

- 查看文档：首先查阅相关文档
- 提交 Issue：在 GitHub 上提交问题
- 社区讨论：加入交流群讨论

Check documentation first, submit issues on GitHub, or join community discussions.

## 📝 更新日志 / Changelog

文档会随着项目更新而持续改进。主要更新：

- 2026-02: 添加配置参考、架构文档和文档中心
- 2026-02: 优化配置文档，添加 CONSOLE_LOG_LEVEL 配置
- 2026-02: 优化架构文档，添加核心组件详细说明
- 2026-02: 优化插件文档，添加多模块插件示例
- 2024-02: 添加配置参考、架构文档和文档中心
- 2024-01: 完善 API 文档和插件文档
- 2023-12: 初始文档创建

Documentation is continuously improved with project updates.

---

**提示 / Tip**: 建议按照"快速开始"部分的顺序阅读文档，这样可以更好地理解整个系统。

**Tip**: It's recommended to read the documentation in the order listed in the "Quick Start" section for better understanding of the entire system.
