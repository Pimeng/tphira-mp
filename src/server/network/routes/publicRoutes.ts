import { roomIdToString } from "../../../common/roomId.js";
import type { RequestContext } from "./types.js";

/**
 * 处理公共路由：无需鉴权的查询接口
 * 返回 true 表示已处理。
 */
export async function tryHandlePublicRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, url, state, write } = ctx;

  if (req.method === "GET" && url.pathname === "/room") {
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
        room.state.type === "Playing" ? "playing" : room.state.type === "WaitForReady" ? "waiting_for_ready" : "select_chart";

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
    write(200, { rooms, total });
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
