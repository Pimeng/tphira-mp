# 插件系统文档 / Plugin System Documentation

## 概述 / Overview

Phira MP 服务器支持插件系统，允许开发者扩展服务器功能而无需修改核心代码。插件支持热插拔，即删除插件文件后重启服务器，插件将不再加载。

The Phira MP server supports a plugin system that allows developers to extend server functionality without modifying core code. Plugins support hot-swapping - deleting the plugin file and restarting the server will unload the plugin.

## 插件目录 / Plugin Directory

插件应按照以下目录结构组织：

Plugins should be organized in the following directory structure:

```
plugins/
├── my-plugin/
│   └── main.js
├── another-plugin/
│   └── main.js
└── virtual-room/
    └── main.js
```

每个插件都应该有自己的文件夹，文件夹名称即为插件名，插件的入口文件必须命名为 `main.js`。服务器启动时会自动扫描 `plugins/` 目录下的所有子文件夹，并加载每个文件夹中的 `main.js` 文件。

Each plugin should have its own folder, with the folder name as the plugin name. The plugin's entry file must be named `main.js`. The server automatically scans all subfolders in the `plugins/` directory and loads the `main.js` file in each folder.

### 多模块插件 / Multi-Module Plugins

如果插件由多个模块组成，可以在插件目录下创建多个文件，然后在 `main.js` 中导入：

If the plugin consists of multiple modules, you can create multiple files in the plugin directory and import them in `main.js`:

```
plugins/
└── example/
    ├── main.js       # 插件入口 / Plugin entry
    ├── module1.js    # 功能模块1 / Feature module 1
    ├── module2.js    # 功能模块2 / Feature module 2
    └── utils.js      # 工具函数 / Utility functions
```

在 `main.js` 中使用相对路径导入其他模块：

Import other modules using relative paths in `main.js`:

```javascript
// plugins/example/main.js
import { feature1 } from "./module1.js";
import { feature2 } from "./module2.js";
import { helper } from "./utils.js";

const plugin = {
  metadata: {
    id: "example",
    name: "Example Plugin",
    version: "1.0.0",
    enabled: true
  },
  hooks: {
    async onInit(context) {
      feature1(context);
      feature2(context);
      context.logger.log("INFO", helper());
    }
  }
};

export default plugin;
```

```javascript
// plugins/example/module1.js
export function feature1(context) {
  context.logger.log("INFO", "Feature 1 initialized");
}
```

```javascript
// plugins/example/module2.js
export function feature2(context) {
  context.logger.log("INFO", "Feature 2 initialized");
}
```

```javascript
// plugins/example/utils.js
export function helper() {
  return "Helper function called";
}
```

## 插件结构 / Plugin Structure

一个标准的插件包含以下部分：

A standard plugin consists of the following parts:

```typescript
import type { Plugin, PluginContext } from "../pluginSystem.js";

const plugin: Plugin = {
  metadata: {
    id: "my-plugin",              // 插件唯一标识 / Plugin unique identifier
    name: "My Plugin",            // 插件名称 / Plugin name
    version: "1.0.0",             // 插件版本 / Plugin version
    description: "插件描述",       // 可选 / Optional
    author: "作者名",              // 可选 / Optional
    enabled: true                 // 是否启用，默认 true / Whether enabled, default true
  },
  hooks: {
    // 插件钩子实现 / Plugin hook implementations
  }
};

export default plugin;
```

## 插件钩子 / Plugin Hooks

插件可以实现以下生命周期钩子：

Plugins can implement the following lifecycle hooks:

### onInit(context: PluginContext)
插件初始化时调用，可以在这里进行初始化工作。

Called when the plugin is initialized, where initialization work can be done.

```typescript
async onInit(context: PluginContext) {
  context.logger.log("INFO", "Plugin initialized");
}
```

### onDestroy()
插件卸载时调用，用于清理资源。

Called when the plugin is unloaded, used for resource cleanup.

```typescript
async onDestroy() {
  // 清理工作 / Cleanup work
}
```

### onServerStart()
服务器启动后调用。

Called after the server starts.

```typescript
async onServerStart() {
  // 服务器启动后的逻辑 / Logic after server starts
}
```

### onUserJoinRoom(user: User, room: Room)
用户加入房间后调用。

Called after a user joins a room.

```typescript
async onUserJoinRoom(user: User, room: Room) {
  context.logger.log("INFO", `${user.name} joined room ${room.id}`);
}
```

### onUserLeaveRoom(user: User, room: Room)
用户离开房间后调用。

Called after a user leaves a room.

```typescript
async onUserLeaveRoom(user: User, room: Room) {
  // 用户离开房间后的逻辑 / Logic after user leaves room
}
```

### onGameEnd(room: Room, results: Map<number, any>)
游戏结束后调用，可以获取游戏结果。

Called after a game ends, where game results can be obtained.

```typescript
async onGameEnd(room: Room, results: Map<number, any>) {
  // 处理游戏结果 / Process game results
}
```

### onBeforeCommand(user: User, command: ClientCommand)
命令处理前调用，可以拦截或修改命令。返回 `null` 将阻止命令执行。

Called before command processing, where commands can be intercepted or modified. Returning `null` will prevent command execution.

```typescript
async onBeforeCommand(user: User, command: ClientCommand) {
  if (command.type === "Chat") {
    // 可以修改或拦截聊天命令 / Can modify or intercept chat commands
    return command;
  }
  return command;
}
```

## 插件上下文 API / Plugin Context API

插件通过 `PluginContext` 访问服务器功能：

Plugins access server functionality through `PluginContext`:

### state: ServerState
访问服务器状态。

Access server state.

### logger: Logger
日志记录器。

Logger.

```typescript
context.logger.log("INFO", "Log message");
context.logger.log("ERROR", "Error message");
```

### createVirtualRoom(id: RoomId, options?)
创建虚拟房间。

Create a virtual room.

```typescript
const room = context.createVirtualRoom("_virtual_room", { maxUsers: 64 });
```

### broadcastToRoom(room: Room, cmd: ServerCommand)
向房间所有用户广播消息。

Broadcast message to all users in a room.

```typescript
await context.broadcastToRoom(room, {
  type: "Message",
  message: { type: "Chat", user: 0, content: "Hello!" }
});
```

### sendToUser(userId: number, cmd: ServerCommand)
向特定用户发送消息。

Send message to a specific user.

```typescript
await context.sendToUser(userId, {
  type: "Message",
  message: { type: "Chat", user: 0, content: "Private message" }
});
```

### getRoom(id: RoomId)
获取房间实例。

Get room instance.

```typescript
const room = context.getRoom("room_id");
```

### getUser(id: number)
获取用户实例。

Get user instance.

```typescript
const user = context.getUser(userId);
```

### scheduleTask(intervalMs: number, task: () => void)
注册定时任务，返回取消函数。

Register a scheduled task, returns a cancel function.

```typescript
const cancel = context.scheduleTask(5000, () => {
  // 每 5 秒执行一次 / Execute every 5 seconds
});

// 取消任务 / Cancel task
cancel();
```

## 示例：虚拟房间插件 / Example: Virtual Room Plugin

虚拟房间插件是一个完整的示例，展示了如何：

The virtual room plugin is a complete example showing how to:

- 创建虚拟房间 / Create virtual rooms
- 自动下发谱面和开始游戏 / Automatically send charts and start games
- 收集玩家成绩并保存为 JSON / Collect player scores and save as JSON

插件位于 `example-plugins/virtualRoom.js`，可以复制到 `plugins/virtual-room/main.js` 使用。

The plugin is located at `example-plugins/virtualRoom.js` and can be copied to `plugins/virtual-room/main.js` for use.

### 启用虚拟房间插件 / Enabling the Virtual Room Plugin

1. 创建插件目录：`mkdir plugins/virtual-room`
2. 复制插件文件：`cp example-plugins/virtualRoom.js plugins/virtual-room/main.js`
3. 编辑 `plugins/virtual-room/main.js`，将 `enabled: false` 改为 `enabled: true`
4. 重启服务器
5. 玩家可以加入房间 ID `_virtual_lobby` 进行游戏
6. 游戏结果将保存到 `data/virtual_room_results/` 目录

1. Create plugin directory: `mkdir plugins/virtual-room`
2. Copy plugin file: `cp example-plugins/virtualRoom.js plugins/virtual-room/main.js`
3. Edit `plugins/virtual-room/main.js`, change `enabled: false` to `enabled: true`
4. Restart server
5. Players can join room ID `_virtual_lobby` to play
6. Game results will be saved to `data/virtual_room_results/` directory

### 虚拟房间工作流程 / Virtual Room Workflow

1. 玩家加入虚拟房间（房间 ID 以 `_virtual_` 开头）
2. 插件自动下发默认谱面
3. 3 秒后自动开始游戏
4. 玩家完成游戏后，成绩自动保存为 JSON 文件

1. Player joins virtual room (room ID starts with `_virtual_`)
2. Plugin automatically sends default chart
3. Game automatically starts after 3 seconds
4. Player's score is automatically saved as JSON file after completing the game

### 结果文件格式 / Result File Format

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "roomId": "_virtual_lobby",
  "chartId": 1,
  "chartName": "Default Chart",
  "players": [
    {
      "userId": 12345,
      "userName": "Player1",
      "score": 950000,
      "accuracy": 0.98,
      "perfect": 500,
      "good": 10,
      "bad": 2,
      "miss": 0,
      "maxCombo": 512,
      "fullCombo": true,
      "std": 0.05,
      "stdScore": 95000
    }
  ]
}
```

## 开发建议 / Development Best Practices

1. **错误处理**：插件中的错误不会导致服务器崩溃，但会记录到日志中
   **Error Handling**: Errors in plugins won't crash the server but will be logged

2. **异步操作**：所有钩子都支持异步操作
   **Async Operations**: All hooks support async operations

3. **资源清理**：在 `onDestroy` 中清理所有资源（定时器、文件句柄等）
   **Resource Cleanup**: Clean up all resources (timers, file handles, etc.) in `onDestroy`

4. **日志记录**：使用 `context.logger` 记录重要事件
   **Logging**: Use `context.logger` to log important events

5. **测试**：在开发环境中充分测试插件再部署到生产环境
   **Testing**: Thoroughly test plugins in development environment before deploying to production

6. **模块化**：对于复杂插件，建议拆分为多个模块文件，在 `main.js` 中导入
   **Modularization**: For complex plugins, split into multiple module files and import in `main.js`

7. **相对路径**：在插件内部导入其他模块时，使用相对路径（如 `./module.js`）
   **Relative Paths**: Use relative paths (e.g., `./module.js`) when importing other modules within the plugin

## 热插拔 / Hot Swapping

- **添加插件**：在 `plugins/` 目录下创建插件文件夹（如 `plugins/my-plugin/`），将插件代码保存为 `main.js`，重启服务器
  **Add Plugin**: Create plugin folder in `plugins/` directory (e.g., `plugins/my-plugin/`), save plugin code as `main.js`, restart server

- **删除插件**：从 `plugins/` 目录删除插件文件夹，重启服务器
  **Remove Plugin**: Delete plugin folder from `plugins/` directory, restart server

- **禁用插件**：将插件的 `enabled` 设置为 `false`，重启服务器
  **Disable Plugin**: Set plugin's `enabled` to `false`, restart server

## 注意事项 / Important Notes

1. 插件在服务器启动时加载，运行时无法动态加载/卸载
   Plugins are loaded when the server starts, cannot be dynamically loaded/unloaded at runtime

2. 插件错误不会影响服务器核心功能
   Plugin errors won't affect server core functionality

3. 插件之间的执行顺序不保证
   Plugin execution order is not guaranteed

4. 避免在插件中执行耗时操作，以免阻塞服务器
   Avoid executing time-consuming operations in plugins to prevent blocking the server

5. 虚拟房间 ID 建议以 `_` 开头，避免与普通房间冲突
   Virtual room IDs should start with `_` to avoid conflicts with regular rooms
