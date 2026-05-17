import { roomIdToString } from "../../../common/roomId.js";
import { logRoomInfo } from "../../utils/logUtils.js";
import { buildAdminRoomsData } from "../../game/adminViews.js";
import { broadcastRoomAll, parseRoomIdOrWriteError } from "../httpHelpers.js";
import type { RequestContext } from "./types.js";

/**
 * 处理 admin 房间管理路由：/admin/rooms 列表、max_users、disband、chat
 */
export async function tryHandleAdminRoomRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, res, url, state, write, read } = ctx;

  if (req.method === "GET" && url.pathname === "/admin/rooms") {
    const rooms = buildAdminRoomsData(state);
    write(200, { ok: true, total_rooms: rooms.length, rooms });
    return true;
  }

  const mRoomMaxUsers = /^\/admin\/rooms\/(.+)\/max_users$/.exec(url.pathname);
  if (req.method === "POST" && mRoomMaxUsers) {
    const roomIdText = decodeURIComponent(mRoomMaxUsers[1]!);
    const rid = parseRoomIdOrWriteError(roomIdText, res);
    if (!rid) return true;
    const body = await read();
    const raw = (body ?? {}) as { maxUsers?: unknown };
    const maxUsers = Number(raw.maxUsers);
    if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 64) {
      write(400, { ok: false, error: "bad-max-users", message: ctx.t("cli-bad-max-users") });
      return true;
    }
    const updated = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(rid);
      if (!room) return null;
      room.maxUsers = maxUsers;
      return roomIdToString(room.id);
    });
    if (!updated) {
      write(404, { ok: false, error: "room-not-found", message: ctx.t("room-not-found") });
      return true;
    }
    write(200, { ok: true, roomid: updated, max_users: maxUsers });
    return true;
  }

  const mRoomDisband = /^\/admin\/rooms\/(.+)\/disband$/.exec(url.pathname);
  if (req.method === "POST" && mRoomDisband) {
    const roomIdText = decodeURIComponent(mRoomDisband[1]!);
    const rid = parseRoomIdOrWriteError(roomIdText, res);
    if (!rid) return true;

    const room = await state.mutex.runExclusive(async () => state.rooms.get(rid) ?? null);
    if (!room) {
      write(404, { ok: false, error: "room-not-found", message: ctx.t("room-not-found") });
      return true;
    }

    // 断开所有用户连接
    const allIds = room.allParticipantIds();
    const disconnectTasks: Promise<void>[] = [];
    for (const id of allIds) {
      const u = state.users.get(id);
      if (u?.session) {
        disconnectTasks.push(u.session.adminDisconnect({ preserveRoom: false }));
      }
    }
    await Promise.allSettled(disconnectTasks);

    // 删除房间
    await state.mutex.runExclusive(async () => {
      state.rooms.delete(rid);
    });

    // 结束回放录制
    if (state.replayEnabled && room.replayEligible) {
      await state.replayRecorder.endRoom(rid);
    }

    logRoomInfo(state.logger, state.serverLang, rid, "log-room-disbanded-by-admin");
    write(200, { ok: true, roomid: roomIdToString(rid) });
    return true;
  }

  const mRoomChat = /^\/admin\/rooms\/(.+)\/chat$/.exec(url.pathname);
  if (req.method === "POST" && mRoomChat) {
    const roomIdText = decodeURIComponent(mRoomChat[1]!);
    const rid = parseRoomIdOrWriteError(roomIdText, res);
    if (!rid) return true;

    const body = await read();
    const raw = (body ?? {}) as { message?: unknown };
    const message = typeof raw.message === "string" ? raw.message.trim() : "";
    if (!message) {
      write(400, { ok: false, error: "bad-message", message: ctx.t("cli-message-empty") });
      return true;
    }
    if (message.length > 200) {
      write(400, { ok: false, error: "message-too-long", message: ctx.t("cli-message-too-long", { max: 200 }) });
      return true;
    }

    const room = state.rooms.get(rid);

    if (!room) {
      write(404, { ok: false, error: "room-not-found", message: ctx.t("room-not-found") });
      return true;
    }

    room.addLog(message, Date.now());
    void broadcastRoomAll(state, rid, { type: "Message", message: { type: "Chat", user: 0, content: message } }).catch(() => {});
    logRoomInfo(state.logger, state.serverLang, rid, "log-admin-room-message", { message });
    write(200, { ok: true });
    return true;
  }

  return false;
}
