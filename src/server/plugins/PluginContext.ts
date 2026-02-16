import type { PluginContext } from "./types.js";
import type { ServerState } from "../core/state.js";
import type { Logger } from "../utils/logger.js";
import { Room } from "../game/room.js";
import type { RoomId } from "../../common/roomId.js";
import type { ServerCommand } from "../../common/commands.js";

/**
 * 创建插件上下文
 */
export function createPluginContext(
  pluginId: string,
  state: ServerState,
  logger: Logger,
  timers: NodeJS.Timeout[]
): PluginContext {
  return {
    state,
    logger,
    
    createVirtualRoom: (id, options) => {
      const room = new Room({
        id,
        hostId: 0, // 虚拟房间没有真实房主
        maxUsers: options?.maxUsers ?? 64,
        replayEligible: false
      });
      state.rooms.set(id, room);
      return room;
    },
    
    broadcastToRoom: async (room, cmd) => {
      const ids = [...room.userIds(), ...room.monitorIds()];
      const tasks: Promise<void>[] = [];
      for (const id of ids) {
        const u = state.users.get(id);
        if (u) tasks.push(u.trySend(cmd));
      }
      await Promise.allSettled(tasks);
    },
    
    sendToUser: async (userId, cmd) => {
      const user = state.users.get(userId);
      if (user) await user.trySend(cmd);
    },
    
    getRoom: (id) => state.rooms.get(id),
    
    getUser: (id) => state.users.get(id),
    
    scheduleTask: (intervalMs, task) => {
      const timer = setInterval(() => {
        void Promise.resolve(task()).catch(e => {
          logger.log("ERROR", `Plugin ${pluginId} scheduled task error: ${e instanceof Error ? e.message : String(e)}`);
        });
      }, intervalMs);
      timers.push(timer);
      return () => {
        clearInterval(timer);
        const idx = timers.indexOf(timer);
        if (idx >= 0) timers.splice(idx, 1);
      };
    }
  };
}
