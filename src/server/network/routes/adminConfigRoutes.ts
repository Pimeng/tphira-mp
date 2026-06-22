import { persistConfigValues } from "../../core/configPersist.js";
import { refreshRoomLive } from "../../game/roomUtils.js";
import type { RequestContext } from "./types.js";

/**
 * 处理 admin 配置类路由：/admin/replay/config（GET/POST）、/admin/room-creation/config（GET/POST）
 */
export async function tryHandleAdminConfigRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, url, state, write, read } = ctx;

  if (req.method === "GET" && url.pathname === "/admin/replay/config") {
    write(200, { ok: true, enabled: state.replayEnabled });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/room-creation/config") {
    write(200, { ok: true, enabled: state.roomCreationEnabled });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/room-creation/config") {
    const body = await read();
    const raw = (body ?? {}) as { enabled?: unknown };
    if (raw.enabled === undefined) {
      write(400, { ok: false, error: "bad-enabled", message: ctx.t("bad-enabled") });
      return true;
    }
    const enabled = Boolean(raw.enabled);
    await state.mutex.runExclusive(async () => {
      state.roomCreationEnabled = enabled;
    });

    // 持久化到配置文件（保留注释），重启后保持
    try {
      await persistConfigValues(state.configPath, { ROOM_CREATION_ENABLED: enabled });
      state.logger.info(`Room creation config persisted: ROOM_CREATION_ENABLED=${enabled}`);
    } catch (e) {
      state.logger.warn(`Failed to persist room creation config: ${e}`);
    }

    write(200, { ok: true, enabled });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/replay/config") {
    const body = await read();
    const raw = (body ?? {}) as { enabled?: unknown };
    if (raw.enabled === undefined) {
      write(400, { ok: false, error: "bad-enabled", message: ctx.t("bad-enabled") });
      return true;
    }
    const enabled = Boolean(raw.enabled);
    const snapshot = await state.mutex.runExclusive(async () => {
      state.replayEnabled = enabled;
      const roomIds = enabled ? [] : [...state.rooms.keys()];
      for (const room of state.rooms.values()) refreshRoomLive(room, enabled);
      return { enabled, roomIds };
    });

    if (!snapshot.enabled) {
      const tasks = snapshot.roomIds.map((rid) => state.replayRecorder.endRoom(rid));
      await Promise.allSettled(tasks);
    }

    // 持久化到配置文件（保留注释与格式：逐行原地更新目标键，不再整体 dump）
    try {
      await persistConfigValues(state.configPath, { REPLAY_ENABLED: enabled });
      state.logger.info(`Replay config persisted: REPLAY_ENABLED=${enabled}`);
    } catch (e) {
      state.logger.warn(`Failed to persist replay config: ${e}`);
    }

    write(200, { ok: true, enabled: snapshot.enabled });
    return true;
  }

  return false;
}
