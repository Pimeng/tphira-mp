// 管理员/订阅者视图的房间数据构造。供 HTTP /admin/rooms 与 WebSocket admin 推送共用。

import type { ServerState } from "../core/state.js";
import type { Room } from "./room.js";
import { roomIdToString, type RoomId } from "../../common/roomId.js";

export type AdminRoomState = {
  type: "select_chart" | "waiting_for_ready" | "playing";
  ready_users?: number[];
  ready_count?: number;
  results_count?: number;
  aborted_count?: number;
  finished_users?: number[];
  aborted_users?: number[];
};

export type AdminRoomData = {
  roomid: string;
  max_users: number;
  current_users: number;
  current_monitors: number;
  replay_eligible: boolean;
  live: boolean;
  locked: boolean;
  cycle: boolean;
  host: { id: number; name: string; connected: boolean };
  state: AdminRoomState;
  chart: { name: string; id: number } | null;
  contest: { whitelist_count: number; whitelist: number[]; manual_start: boolean; auto_disband: boolean } | null;
  users: Array<{
    id: number;
    name: string;
    connected: boolean;
    is_host: boolean;
    game_time: number;
    language: string;
    finished?: boolean;
    aborted?: boolean;
    record_id?: number | null;
  }>;
  monitors: Array<{
    id: number;
    name: string;
    connected: boolean;
    language: string;
  }>;
  recent_logs: Array<{ message: string; timestamp: number }>;
};

export type RoomUpdateData = {
  roomid: string;
  state: "select_chart" | "waiting_for_ready" | "playing";
  locked: boolean;
  cycle: boolean;
  live: boolean;
  chart: { name: string; id: number } | null;
  host: { id: number; name: string };
  users: Array<{ id: number; name: string; is_ready: boolean }>;
  monitors: Array<{ id: number; name: string }>;
  recent_logs: Array<{ message: string; timestamp: number }>;
};

function toStateString(room: Room): "select_chart" | "waiting_for_ready" | "playing" {
  if (room.state.type === "Playing") return "playing";
  if (room.state.type === "WaitForReady") return "waiting_for_ready";
  return "select_chart";
}

export function buildAdminRoomData(state: ServerState, rid: RoomId, room: Room): AdminRoomData {
  const roomid = roomIdToString(rid);
  const hostUser = state.users.get(room.hostId);
  const hostName = hostUser?.name ?? String(room.hostId);
  const hostConnected = Boolean(hostUser?.session);

  const stateDetails: AdminRoomState = { type: toStateString(room) };
  if (room.state.type === "WaitForReady") {
    stateDetails.ready_users = [...room.state.started];
    stateDetails.ready_count = room.state.started.size;
  } else if (room.state.type === "Playing") {
    stateDetails.results_count = room.state.results.size;
    stateDetails.aborted_count = room.state.aborted.size;
    stateDetails.finished_users = [...room.state.results.keys()];
    stateDetails.aborted_users = [...room.state.aborted];
  }

  const chart = room.chart ? { name: room.chart.name, id: room.chart.id } : null;

  const users = room.userIds().map((id) => {
    const u = state.users.get(id);
    const info: AdminRoomData["users"][number] = {
      id,
      name: u?.name ?? String(id),
      connected: Boolean(u?.session),
      is_host: id === room.hostId,
      game_time: u?.gameTime ?? Number.NEGATIVE_INFINITY,
      language: u?.lang.lang ?? "unknown"
    };
    if (room.state.type === "Playing") {
      const finished = room.state.results.has(id);
      const aborted = room.state.aborted.has(id);
      info.finished = finished || aborted;
      info.aborted = aborted;
      if (finished) info.record_id = room.state.results.get(id)?.id ?? null;
    }
    return info;
  });

  const monitors = room.monitorIds().map((id) => {
    const u = state.users.get(id);
    return {
      id,
      name: u?.name ?? String(id),
      connected: Boolean(u?.session),
      language: u?.lang.lang ?? "unknown"
    };
  });

  const contest = room.contest
    ? {
        whitelist_count: room.contest.whitelist.size,
        whitelist: [...room.contest.whitelist],
        manual_start: room.contest.manualStart,
        auto_disband: room.contest.autoDisband
      }
    : null;

  return {
    roomid,
    max_users: room.maxUsers,
    current_users: users.length,
    current_monitors: monitors.length,
    replay_eligible: room.replayEligible,
    live: room.live,
    locked: room.locked,
    cycle: room.cycle,
    host: { id: room.hostId, name: hostName, connected: hostConnected },
    state: stateDetails,
    chart,
    contest,
    users,
    monitors,
    recent_logs: room.getRecentLogs()
  };
}

export function buildAdminRoomsData(state: ServerState): AdminRoomData[] {
  const out: AdminRoomData[] = [];
  for (const [rid, room] of state.rooms) out.push(buildAdminRoomData(state, rid, room));
  out.sort((a, b) => a.roomid.localeCompare(b.roomid));
  return out;
}

export function buildRoomUpdateData(state: ServerState, rid: RoomId): RoomUpdateData | null {
  const room = state.rooms.get(rid);
  if (!room) return null;

  const hostUser = state.users.get(room.hostId);
  const hostName = hostUser?.name ?? String(room.hostId);

  const users = room.userIds().map((id) => {
    const u = state.users.get(id);
    const isReady = room.state.type === "WaitForReady" ? room.state.started.has(id) : false;
    return { id, name: u?.name ?? String(id), is_ready: isReady };
  });

  const monitors = room.monitorIds().map((id) => {
    const u = state.users.get(id);
    return { id, name: u?.name ?? String(id) };
  });

  return {
    roomid: roomIdToString(rid),
    state: toStateString(room),
    locked: room.locked,
    cycle: room.cycle,
    live: room.live,
    chart: room.chart ? { name: room.chart.name, id: room.chart.id } : null,
    host: { id: room.hostId, name: hostName },
    users,
    monitors,
    recent_logs: room.getRecentLogs()
  };
}
