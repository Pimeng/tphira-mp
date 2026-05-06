import { readFile, writeFile } from "node:fs/promises";
import yaml from "js-yaml";
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
      write(400, { ok: false, error: "bad-enabled" });
      return true;
    }
    const enabled = Boolean(raw.enabled);
    await state.mutex.runExclusive(async () => {
      state.roomCreationEnabled = enabled;
    });

    write(200, { ok: true, enabled });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/replay/config") {
    const body = await read();
    const raw = (body ?? {}) as { enabled?: unknown };
    if (raw.enabled === undefined) {
      write(400, { ok: false, error: "bad-enabled" });
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

    // 持久化配置到文件
    try {
      const configPath = state.configPath;
      const configText = await readFile(configPath, "utf8").catch(() => "");
      const loadedConfig = yaml.load(configText);
      const configObj =
        typeof loadedConfig === "object" && loadedConfig !== null && !Array.isArray(loadedConfig)
          ? (loadedConfig as Record<string, unknown>)
          : {};
      delete configObj.replay_enabled;
      delete configObj.replayEnabled;
      configObj.REPLAY_ENABLED = enabled;
      const newText = yaml.dump(configObj, { lineWidth: -1 });
      await writeFile(configPath, newText, "utf8");
      state.logger.log("INFO", `Replay config persisted: REPLAY_ENABLED=${enabled}`);
    } catch (e) {
      state.logger.log("WARN", `Failed to persist replay config: ${e}`);
    }

    write(200, { ok: true, enabled: snapshot.enabled });
    return true;
  }

  return false;
}
