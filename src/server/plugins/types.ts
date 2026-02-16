import type { ServerState } from "../core/state.js";
import type { Logger } from "../utils/logger.js";
import type { Room } from "../game/room.js";
import type { User } from "../game/user.js";
import type { RoomId } from "../../common/roomId.js";
import type { ServerCommand, ClientCommand } from "../../common/commands.js";
import type { RecordData } from "../core/types.js";

/**
 * 插件元数据
 */
export interface PluginMetadata {
  /** 插件唯一标识 */
  id: string;
  
  /** 插件名称 */
  name: string;
  
  /** 插件版本 */
  version: string;
  
  /** 插件描述 */
  description?: string;
  
  /** 插件作者 */
  author?: string;
  
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 插件上下文
 */
export interface PluginContext {
  /** 服务器状态 */
  state: ServerState;
  
  /** 日志记录器 */
  logger: Logger;
  
  /** 创建虚拟房间 */
  createVirtualRoom: (id: RoomId, options?: { maxUsers?: number }) => Room;
  
  /** 向房间广播消息 */
  broadcastToRoom: (room: Room, cmd: ServerCommand) => Promise<void>;
  
  /** 向用户发送消息 */
  sendToUser: (userId: number, cmd: ServerCommand) => Promise<void>;
  
  /** 获取房间 */
  getRoom: (id: RoomId) => Room | undefined;
  
  /** 获取用户 */
  getUser: (id: number) => User | undefined;
  
  /** 调度定时任务 */
  scheduleTask: (intervalMs: number, task: () => void | Promise<void>) => () => void;
}

/**
 * 插件钩子
 */
export interface PluginHooks {
  /** 插件初始化 */
  onInit?: (context: PluginContext) => void | Promise<void>;
  
  /** 插件销毁 */
  onDestroy?: () => void | Promise<void>;
  
  /** 服务器启动 */
  onServerStart?: () => void | Promise<void>;
  
  /** 用户加入房间 */
  onUserJoinRoom?: (user: User, room: Room) => void | Promise<void>;
  
  /** 用户离开房间 */
  onUserLeaveRoom?: (user: User, room: Room) => void | Promise<void>;
  
  /** 游戏结束 */
  onGameEnd?: (room: Room, results: Map<number, RecordData>) => void | Promise<void>;
  
  /** 命令执行前（可以拦截命令，返回 null 表示拦截） */
  onBeforeCommand?: (user: User, command: ClientCommand) => ClientCommand | null | Promise<ClientCommand | null>;
}

/**
 * 插件定义
 */
export interface Plugin {
  /** 插件元数据 */
  metadata: PluginMetadata;
  
  /** 插件钩子 */
  hooks: PluginHooks;
}
