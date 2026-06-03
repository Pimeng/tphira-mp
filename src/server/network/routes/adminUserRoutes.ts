import { roomIdToString } from "../../../common/roomId.js";
import {
  abortPlayingUserAndCheckReady,
  broadcastRoomAll,
  parseRoomIdOrWriteError,
  pickRandomUserId
} from "../httpHelpers.js";
import type { RequestContext } from "./types.js";

/**
 * 处理 admin 用户管理路由：
 * /admin/users/:id (GET)、/admin/users/:id/disconnect、/admin/users/:id/move
 * /admin/ban/user、/admin/ban/room
 */
export async function tryHandleAdminUserRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, res, url, state, write, read } = ctx;

  const mUser = /^\/admin\/users\/(\d+)$/.exec(url.pathname);
  if (req.method === "GET" && mUser) {
    const userId = Number(mUser[1]);
    const out = await state.mutex.runExclusive(async () => {
      const u = state.users.get(userId);
      if (!u)
        return { ok: false, error: "user-not-found", message: ctx.t("cli-user-not-found", { id: String(userId) }) };
      return {
        ok: true,
        user: {
          id: u.id,
          name: u.name,
          monitor: u.monitor,
          connected: Boolean(u.session),
          room: u.room ? roomIdToString(u.room.id) : null,
          banned: state.bannedUsers.has(u.id)
        }
      };
    });
    write(out.ok ? 200 : 404, out);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/ban/user") {
    const body = await read();
    const raw = (body ?? {}) as { userId?: unknown; banned?: unknown; disconnect?: unknown };
    const userId = Number(raw.userId);
    const banned = Boolean(raw.banned);
    const disconnect = Boolean(raw.disconnect);
    if (!Number.isInteger(userId)) {
      write(400, { ok: false, error: "bad-user-id", message: ctx.t("cli-bad-user-id") });
      return true;
    }

    // Update ban status
    await state.mutex.runExclusive(async () => {
      if (banned) state.bannedUsers.add(userId);
      else state.bannedUsers.delete(userId);
    });
    await state.saveAdminData();

    // If disconnect is requested, disconnect the user
    // Banned users will be blocked from operations when they try to perform them
    if (disconnect) {
      const sessionToDisconnect = await state.mutex.runExclusive(async () => state.users.get(userId)?.session ?? null);
      if (sessionToDisconnect) {
        const u = sessionToDisconnect.user;
        if (u && u.room) {
          await abortPlayingUserAndCheckReady({ state, user: u, room: u.room });
        }
        await sessionToDisconnect.adminDisconnect({ preserveRoom: true });
      }
    }

    write(200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/ban/room") {
    const body = await read();
    const raw = (body ?? {}) as { userId?: unknown; roomId?: unknown; banned?: unknown };
    const userId = Number(raw.userId);
    const roomIdText = typeof raw.roomId === "string" ? raw.roomId : String(raw.roomId ?? "");
    const rid = parseRoomIdOrWriteError(roomIdText, res);
    if (!rid) return true;
    const banned = Boolean(raw.banned);
    if (!Number.isInteger(userId)) {
      write(400, { ok: false, error: "bad-user-id", message: ctx.t("cli-bad-user-id") });
      return true;
    }
    await state.mutex.runExclusive(async () => {
      const set = state.bannedRoomUsers.get(rid) ?? new Set<number>();
      if (banned) set.add(userId);
      else set.delete(userId);
      if (set.size === 0) state.bannedRoomUsers.delete(rid);
      else state.bannedRoomUsers.set(rid, set);
    });
    await state.saveAdminData();
    write(200, { ok: true });
    return true;
  }

  const mDisconnect = /^\/admin\/users\/(\d+)\/disconnect$/.exec(url.pathname);
  if (req.method === "POST" && mDisconnect) {
    const userId = Number(mDisconnect[1]);
    await read();
    const target = await state.mutex.runExclusive(async () => state.users.get(userId)?.session ?? null);
    if (!target) {
      write(404, {
        ok: false,
        error: "user-not-connected",
        message: ctx.t("cli-user-not-connected", { id: String(userId) })
      });
      return true;
    }
    const u = target.user;
    if (u && u.room) {
      await abortPlayingUserAndCheckReady({ state, user: u, room: u.room });
    }
    await target.adminDisconnect({ preserveRoom: false });
    write(200, { ok: true });
    return true;
  }

  const mMove = /^\/admin\/users\/(\d+)\/move$/.exec(url.pathname);
  if (req.method === "POST" && mMove) {
    const userId = Number(mMove[1]);
    const body = await read();
    const raw = (body ?? {}) as { roomId?: unknown; monitor?: unknown };
    const roomIdText = typeof raw.roomId === "string" ? raw.roomId : String(raw.roomId ?? "");
    const rid = parseRoomIdOrWriteError(roomIdText, res);
    if (!rid) return true;
    const monitor = Boolean(raw.monitor);

    const u = await state.mutex.runExclusive(async () => state.users.get(userId) ?? null);
    if (!u) {
      write(404, { ok: false, error: "user-not-found", message: ctx.t("cli-user-not-found", { id: String(userId) }) });
      return true;
    }
    if (u.session) {
      write(400, { ok: false, error: "user-must-be-disconnected", message: ctx.t("user-must-be-disconnected") });
      return true;
    }
    const from = u.room;
    if (!from) {
      write(400, { ok: false, error: "user-not-in-room", message: ctx.t("user-not-in-room") });
      return true;
    }
    if (from.state.type !== "SelectChart") {
      write(400, { ok: false, error: "cannot-move-while-playing", message: ctx.t("cannot-move-while-playing") });
      return true;
    }
    const to = await state.mutex.runExclusive(async () => state.rooms.get(rid) ?? null);
    if (!to) {
      write(404, { ok: false, error: "room-not-found", message: ctx.t("room-not-found") });
      return true;
    }
    if (to.state.type !== "SelectChart") {
      write(400, { ok: false, error: "target-room-not-idle", message: ctx.t("target-room-not-idle") });
      return true;
    }
    try {
      to.validateJoin(u, monitor);
    } catch (e) {
      write(400, { ok: false, error: e instanceof Error ? e.message : String(e) });
      return true;
    }
    if (!to.addUser(u, monitor)) {
      write(400, { ok: false, error: "room-full", message: ctx.t("join-room-full") });
      return true;
    }

    const shouldDrop = await from.onUserLeave({
      user: u,
      usersById: (id) => state.users.get(id),
      broadcast: (cmd) => broadcastRoomAll(state, from.id, cmd),
      broadcastToMonitors: (cmd) => broadcastRoomAll(state, from.id, cmd),
      pickRandomUserId,
      lang: state.serverLang,
      logger: state.logger,
      wsService: state.wsService
    });
    if (shouldDrop) {
      await state.mutex.runExclusive(async () => {
        state.rooms.delete(from.id);
      });
    }

    u.monitor = monitor;
    await state.mutex.runExclusive(async () => {
      u.room = to;
    });

    write(200, { ok: true });
    return true;
  }

  return false;
}
