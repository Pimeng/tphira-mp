import { roomIdToString } from "../../../common/roomId.js";
import type { RequestContext } from "./types.js";

/** /room 列表缓存 TTL（毫秒） */
const ROOM_LIST_CACHE_TTL_MS = 2000;

let roomListCache: { json: string; expiresAt: number } | null = null;

/**
 * 处理公共路由：无需鉴权的查询接口
 * 返回 true 表示已处理。
 */
export async function tryHandlePublicRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, res, url, state, write } = ctx;

  if (req.method === "GET" && url.pathname === "/room") {
    const now = Date.now();
    if (roomListCache && now < roomListCache.expiresAt) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      res.end(roomListCache.json);
      return true;
    }

    const rooms: Array<{
      roomid: string;
      cycle: boolean;
      lock: boolean;
      host: { name: string; id: string };
      state: "select_chart" | "waiting_for_ready" | "playing";
      chart: { name: string; id: string } | null;
      players: Array<{ name: string; id: number }>;
    }> = [];

    let total = 0;
    for (const [rid, room] of state.rooms) {
      const roomid = roomIdToString(rid);
      if (roomid.startsWith("_")) continue;

      const hostUser = state.users.get(room.hostId);
      const hostName = hostUser?.name ?? String(room.hostId);

      const players = room.userIds().map((id) => {
        const u = state.users.get(id);
        return { id, name: u?.name ?? String(id) };
      });
      total += players.length;

      const stateStr =
        room.state.type === "Playing"
          ? "playing"
          : room.state.type === "WaitForReady"
            ? "waiting_for_ready"
            : "select_chart";

      const chart = room.chart ? { name: room.chart.name, id: String(room.chart.id) } : null;

      rooms.push({
        roomid,
        cycle: room.cycle,
        lock: room.locked,
        host: { name: hostName, id: String(room.hostId) },
        state: stateStr,
        chart,
        players
      });
    }

    rooms.sort((a, b) => a.roomid.localeCompare(b.roomid));
    const result = { rooms, total };
    const json = JSON.stringify(result);
    roomListCache = { json, expiresAt: now + ROOM_LIST_CACHE_TTL_MS };
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.end(json);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/room-creation/config") {
    write(200, { ok: true, enabled: state.roomCreationEnabled });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/replay/config") {
    write(200, { ok: true, enabled: state.replayEnabled });
    return true;
  }

  return false;
}
