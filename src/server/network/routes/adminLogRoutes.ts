import { tl } from "../../utils/l10n.js";
import { broadcastRoomAll } from "../httpHelpers.js";
import { NOOP } from "../../../common/utils.js";
import type { RequestContext } from "./types.js";

/**
 * 处理 admin 广播 / IP 黑名单 / 日志频率相关路由：
 * /admin/broadcast、/admin/ip-blacklist*、/admin/log-rate
 */
export async function tryHandleAdminLogRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, url, state, write, read } = ctx;

  if (req.method === "POST" && url.pathname === "/admin/broadcast") {
    const body = await read();
    const raw = (body ?? {}) as { message?: unknown };
    const message = typeof raw.message === "string" ? raw.message.trim() : "";
    if (!message) {
      write(400, { ok: false, error: "bad-message" });
      return true;
    }
    if (message.length > 200) {
      write(400, { ok: false, error: "message-too-long" });
      return true;
    }

    const snapshot = await state.mutex.runExclusive(async () => {
      return [...state.rooms.keys()];
    });

    // 完全异步，不等待
    for (const roomId of snapshot) {
      const room = state.rooms.get(roomId);
      if (room) room.addLog(message, Date.now());
      void broadcastRoomAll(state, roomId, { type: "Message", message: { type: "Chat", user: 0, content: message } }).catch(NOOP);
    }

    state.logger.info(tl(state.serverLang, "log-admin-broadcast", { message, rooms: String(snapshot.length) }));
    write(200, { ok: true, rooms: snapshot.length });
    return true;
  }

  // IP 黑名单管理接口
  if (req.method === "GET" && url.pathname === "/admin/ip-blacklist") {
    const blacklist = state.logger.getBlacklistedIps();
    write(200, { ok: true, blacklist });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/ip-blacklist/remove") {
    const body = await read();
    const ip = typeof (body as any)?.ip === "string" ? String((body as any).ip).trim() : "";
    if (!ip) {
      write(400, { ok: false, error: "bad-ip" });
      return true;
    }
    state.logger.removeFromBlacklist(ip);
    write(200, { ok: true });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/ip-blacklist/clear") {
    state.logger.clearBlacklist();
    write(200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/log-rate") {
    const rate = state.logger.getCurrentRate();
    write(200, { ok: true, rate });
    return true;
  }

  return false;
}
