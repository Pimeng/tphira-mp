import { logRoomInfo } from "../../utils/logUtils.js";
import { tl } from "../../utils/l10n.js";
import { broadcastRoomAll, parseRoomIdOrWriteError } from "../httpHelpers.js";
import type { RequestContext } from "./types.js";

/**
 * 处理 admin 比赛模式路由：
 * /admin/contest/rooms/:id/config、/whitelist、/start
 */
export async function tryHandleAdminContestRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, res, url, state, write, read } = ctx;

  const mContestConfig = /^\/admin\/contest\/rooms\/(.+)\/config$/.exec(url.pathname);
  if (req.method === "POST" && mContestConfig) {
    const roomIdText = decodeURIComponent(mContestConfig[1]!);
    const rid = parseRoomIdOrWriteError(roomIdText, res);
    if (!rid) return true;
    const body = await read();
    const raw = (body ?? {}) as { enabled?: unknown; whitelist?: unknown };
    const enabled = raw.enabled === undefined ? true : Boolean(raw.enabled);
    const whitelistArr = Array.isArray(raw.whitelist) ? raw.whitelist.map((it) => Number(it)).filter((n) => Number.isInteger(n)) : null;

    const ok = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(rid);
      if (!room) return false;
      if (!enabled) {
        room.contest = null;
        return true;
      }
      const currentIds = room.allParticipantIds();
      const set = new Set<number>(whitelistArr && whitelistArr.length > 0 ? whitelistArr : currentIds);
      for (const id of currentIds) set.add(id);
      room.contest = { whitelist: set, manualStart: true, autoDisband: true };
      return true;
    });

    write(ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: "room-not-found" });
    return true;
  }

  const mContestWhitelist = /^\/admin\/contest\/rooms\/(.+)\/whitelist$/.exec(url.pathname);
  if (req.method === "POST" && mContestWhitelist) {
    const roomIdText = decodeURIComponent(mContestWhitelist[1]!);
    const rid = parseRoomIdOrWriteError(roomIdText, res);
    if (!rid) return true;
    const body = await read();
    const raw = (body ?? {}) as { userIds?: unknown };
    const userIds = Array.isArray(raw.userIds) ? raw.userIds.map((it) => Number(it)).filter((n) => Number.isInteger(n)) : null;
    if (!userIds) {
      write(400, { ok: false, error: "bad-user-ids" });
      return true;
    }
    const ok = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(rid);
      if (!room || !room.contest) return false;
      room.contest.whitelist = new Set<number>(userIds);
      const currentIds = room.allParticipantIds();
      for (const id of currentIds) room.contest.whitelist.add(id);
      return true;
    });
    write(ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: "contest-room-not-found" });
    return true;
  }

  const mContestStart = /^\/admin\/contest\/rooms\/(.+)\/start$/.exec(url.pathname);
  if (req.method === "POST" && mContestStart) {
    const roomIdText = decodeURIComponent(mContestStart[1]!);
    const rid = parseRoomIdOrWriteError(roomIdText, res);
    if (!rid) return true;
    const body = await read();
    const raw = (body ?? {}) as { force?: unknown };
    const force = Boolean(raw.force);

    const result = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(rid);
      if (!room || !room.contest) return { ok: false as const, status: 404, error: "contest-room-not-found" };
      if (room.state.type !== "WaitForReady") return { ok: false as const, status: 400, error: "room-not-waiting" };
      if (!room.chart) return { ok: false as const, status: 400, error: "no-chart-selected" };
      const started = room.state.started;
      const allIds = room.allParticipantIds();
      const allReady = allIds.every((id) => started.has(id));
      if (!allReady && !force) return { ok: false as const, status: 400, error: "not-all-ready" };
      return { ok: true as const, room };
    });
    if (!result.ok) {
      write(result.status, { ok: false, error: result.error });
      return true;
    }
    const room = result.room;

    const users = room.userIds();
    const monitors = room.monitorIds();
    const sep = state.serverLang.lang === "zh-CN" ? "、" : ", ";
    const usersText = users.join(sep);
    const monitorsText = monitors.join(sep);
    const monitorsSuffix = monitors.length > 0 ? tl(state.serverLang, "log-room-game-start-monitors", { monitors: monitorsText }) : "";
    logRoomInfo(state.logger, state.serverLang, room.id, "log-room-game-start", { users: usersText, monitorsSuffix });
    await room.send((c) => broadcastRoomAll(state, room.id, c), { type: "StartPlaying" }, (id) => state.users.get(id), state.serverLang);
    room.resetGameTime((id) => state.users.get(id));
    if (state.replayEnabled && room.replayEligible) {
      const replayUsers = room.userIds().map((id) => ({ id, name: state.users.get(id)?.name ?? String(id) }));
      await state.replayRecorder.startRoom(room.id, room.chart!, replayUsers);
    }
    room.state = { type: "Playing", results: new Map(), aborted: new Set() };
    await room.onStateChange((c) => broadcastRoomAll(state, room.id, c));
    await room.notifyWebSocket(state);
    write(200, { ok: true });
    return true;
  }

  return false;
}
