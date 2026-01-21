import http from "node:http";
import type net from "node:net";
import { parseRoomId, roomIdToString, type RoomId } from "../common/roomId.js";
import type { ServerState } from "./state.js";
import { Language, tl } from "./l10n.js";
import type { ServerCommand } from "../common/commands.js";

export type HttpService = {
  server: http.Server;
  address: () => net.AddressInfo;
  close: () => Promise<void>;
};

export async function startHttpService(opts: { state: ServerState; host: string; port: number }): Promise<HttpService> {
  const { state } = opts;

  const server = http.createServer((req, res) => {
    void (async () => {
      const lang = req.headers["accept-language"] ? new Language(String(req.headers["accept-language"])) : state.serverLang;
      const url = new URL(req.url ?? "/", "http://localhost");
      const applyCors = () => {
        const reqHeaders = typeof req.headers["access-control-request-headers"] === "string" ? req.headers["access-control-request-headers"] : "";
        res.setHeader("access-control-allow-origin", "*");
        res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
        res.setHeader("access-control-allow-headers", reqHeaders || "content-type,x-admin-token,authorization");
        res.setHeader("access-control-max-age", "600");
      };
      applyCors();
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
      const writeJson = (status: number, body: unknown) => {
        const text = JSON.stringify(body);
        res.statusCode = status;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(text);
      };

      const readJson = async (): Promise<unknown> => {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          req.on("data", (c) => chunks.push(Buffer.from(c)));
          req.once("end", () => resolve());
          req.once("error", reject);
        });
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        if (!raw) return null;
        return JSON.parse(raw) as unknown;
      };

      const adminToken = state.config.admin_token?.trim() || "";
      const extractBearer = (v: string) => {
        const m = /^Bearer\s+(.+)$/i.exec(v.trim());
        return m ? m[1]!.trim() : v.trim();
      };
      const reqAdminToken =
        (typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : "") ||
        (typeof req.headers.authorization === "string" ? extractBearer(req.headers.authorization) : "") ||
        (url.searchParams.get("token") ?? "");
      const requireAdmin = () => {
        if (!adminToken) {
          writeJson(403, { ok: false, error: "admin-disabled" });
          return false;
        }
        if (!reqAdminToken || reqAdminToken !== adminToken) {
          writeJson(401, { ok: false, error: "unauthorized" });
          return false;
        }
        return true;
      };

      const broadcastRoomAll = async (roomId: RoomId, cmd: ServerCommand): Promise<void> => {
        const room = state.rooms.get(roomId);
        if (!room) return;
        const ids = [...room.userIds(), ...room.monitorIds()];
        const tasks: Promise<void>[] = [];
        for (const id of ids) {
          const u = state.users.get(id);
          if (u) tasks.push(u.trySend(cmd));
        }
        await Promise.allSettled(tasks);
      };
      const pickRandomUserId = (ids: number[]): number | null => ids[0] ?? null;

      if (req.method === "GET" && url.pathname === "/room") {
        const out = await state.mutex.runExclusive(async () => {
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
          return { rooms, total };
        });

        writeJson(200, out);
        return;
      }

      if (url.pathname.startsWith("/admin/")) {
        if (!requireAdmin()) return;

        if (req.method === "GET" && url.pathname === "/admin/rooms") {
          const out = await state.mutex.runExclusive(async () => {
            const rooms = [...state.rooms.entries()].map(([rid, room]) => {
              const roomid = roomIdToString(rid);
              const hostUser = state.users.get(room.hostId);
              const hostName = hostUser?.name ?? String(room.hostId);
              const stateStr =
                room.state.type === "Playing" ? "playing" : room.state.type === "WaitForReady" ? "waiting_for_ready" : "select_chart";
              const chart = room.chart ? { name: room.chart.name, id: room.chart.id } : null;
              const users = room.userIds().map((id) => {
                const u = state.users.get(id);
                return { id, name: u?.name ?? String(id), connected: Boolean(u?.session) };
              });
              const monitors = room.monitorIds().map((id) => {
                const u = state.users.get(id);
                return { id, name: u?.name ?? String(id), connected: Boolean(u?.session) };
              });
              return {
                roomid,
                max_users: room.maxUsers,
                live: room.live,
                locked: room.locked,
                cycle: room.cycle,
                host: { id: room.hostId, name: hostName },
                state: stateStr,
                chart,
                users,
                monitors
              };
            });
            rooms.sort((a, b) => a.roomid.localeCompare(b.roomid));
            return { ok: true, rooms };
          });
          writeJson(200, out);
          return;
        }

        const mUser = /^\/admin\/users\/(\d+)$/.exec(url.pathname);
        if (req.method === "GET" && mUser) {
          const userId = Number(mUser[1]);
          const out = await state.mutex.runExclusive(async () => {
            const u = state.users.get(userId);
            if (!u) return { ok: false, error: "user-not-found" };
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
          writeJson(out.ok ? 200 : 404, out);
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/ban/user") {
          const body = await readJson();
          const raw = (body ?? {}) as { userId?: unknown; banned?: unknown; disconnect?: unknown };
          const userId = Number(raw.userId);
          const banned = Boolean(raw.banned);
          const disconnect = Boolean(raw.disconnect);
          if (!Number.isInteger(userId)) {
            writeJson(400, { ok: false, error: "bad-user-id" });
            return;
          }
          const sessionToDisconnect = await state.mutex.runExclusive(async () => {
            if (banned) state.bannedUsers.add(userId);
            else state.bannedUsers.delete(userId);
            const u = state.users.get(userId);
            return disconnect ? u?.session ?? null : null;
          });
          await state.saveAdminData();
          if (sessionToDisconnect) {
            const u = sessionToDisconnect.user;
            const roomId = u?.room?.id ?? null;
            if (roomId && u && u.room && u.room.state.type === "Playing") {
              u.room.state.aborted.add(u.id);
              await broadcastRoomAll(roomId, { type: "Message", message: { type: "Abort", user: u.id } });
              await u.room.checkAllReady({
                usersById: (id) => state.users.get(id),
                broadcast: (cmd) => broadcastRoomAll(roomId, cmd),
                broadcastToMonitors: (cmd) => broadcastRoomAll(roomId, cmd),
                pickRandomUserId,
                lang: state.serverLang,
                logger: state.logger
              });
            }
            await sessionToDisconnect.adminDisconnect({ preserveRoom: true });
          }
          writeJson(200, { ok: true });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/ban/room") {
          const body = await readJson();
          const raw = (body ?? {}) as { userId?: unknown; roomId?: unknown; banned?: unknown };
          const userId = Number(raw.userId);
          const roomIdText = typeof raw.roomId === "string" ? raw.roomId : String(raw.roomId ?? "");
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdText);
          } catch {
            writeJson(400, { ok: false, error: "bad-room-id" });
            return;
          }
          const banned = Boolean(raw.banned);
          if (!Number.isInteger(userId)) {
            writeJson(400, { ok: false, error: "bad-user-id" });
            return;
          }
          await state.mutex.runExclusive(async () => {
            const set = state.bannedRoomUsers.get(rid) ?? new Set<number>();
            if (banned) set.add(userId);
            else set.delete(userId);
            if (set.size === 0) state.bannedRoomUsers.delete(rid);
            else state.bannedRoomUsers.set(rid, set);
          });
          await state.saveAdminData();
          writeJson(200, { ok: true });
          return;
        }

        const mDisconnect = /^\/admin\/users\/(\d+)\/disconnect$/.exec(url.pathname);
        if (req.method === "POST" && mDisconnect) {
          const userId = Number(mDisconnect[1]);
          const body = await readJson();
          const raw = (body ?? {}) as { preserveRoom?: unknown; markAborted?: unknown };
          const preserveRoom = raw.preserveRoom === undefined ? true : Boolean(raw.preserveRoom);
          const markAborted = raw.markAborted === undefined ? true : Boolean(raw.markAborted);
          const target = await state.mutex.runExclusive(async () => state.users.get(userId)?.session ?? null);
          if (!target) {
            writeJson(404, { ok: false, error: "user-not-connected" });
            return;
          }
          const u = target.user;
          const roomId = u?.room?.id ?? null;
          if (preserveRoom && markAborted && roomId && u && u.room && u.room.state.type === "Playing") {
            u.room.state.aborted.add(u.id);
            await broadcastRoomAll(roomId, { type: "Message", message: { type: "Abort", user: u.id } });
            await u.room.checkAllReady({
              usersById: (id) => state.users.get(id),
              broadcast: (cmd) => broadcastRoomAll(roomId, cmd),
              broadcastToMonitors: (cmd) => broadcastRoomAll(roomId, cmd),
              pickRandomUserId,
              lang: state.serverLang,
              logger: state.logger
            });
          }
          await target.adminDisconnect({ preserveRoom });
          writeJson(200, { ok: true });
          return;
        }

        const mMove = /^\/admin\/users\/(\d+)\/move$/.exec(url.pathname);
        if (req.method === "POST" && mMove) {
          const userId = Number(mMove[1]);
          const body = await readJson();
          const raw = (body ?? {}) as { roomId?: unknown; monitor?: unknown };
          const roomIdText = typeof raw.roomId === "string" ? raw.roomId : String(raw.roomId ?? "");
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdText);
          } catch {
            writeJson(400, { ok: false, error: "bad-room-id" });
            return;
          }
          const monitor = Boolean(raw.monitor);

          const u = await state.mutex.runExclusive(async () => state.users.get(userId) ?? null);
          if (!u) {
            writeJson(404, { ok: false, error: "user-not-found" });
            return;
          }
          if (u.session) {
            writeJson(400, { ok: false, error: "user-must-be-disconnected" });
            return;
          }
          const from = u.room;
          if (!from) {
            writeJson(400, { ok: false, error: "user-not-in-room" });
            return;
          }
          if (from.state.type !== "SelectChart") {
            writeJson(400, { ok: false, error: "cannot-move-while-playing" });
            return;
          }
          const to = await state.mutex.runExclusive(async () => state.rooms.get(rid) ?? null);
          if (!to) {
            writeJson(404, { ok: false, error: "room-not-found" });
            return;
          }
          if (to.state.type !== "SelectChart") {
            writeJson(400, { ok: false, error: "target-room-not-idle" });
            return;
          }
          try {
            to.validateJoin(u, monitor);
          } catch (e) {
            writeJson(400, { ok: false, error: e instanceof Error ? e.message : String(e) });
            return;
          }
          if (!to.addUser(u, monitor)) {
            writeJson(400, { ok: false, error: "room-full" });
            return;
          }

          const shouldDrop = await from.onUserLeave({
            user: u,
            usersById: (id) => state.users.get(id),
            broadcast: (cmd) => broadcastRoomAll(from.id, cmd),
            broadcastToMonitors: (cmd) => broadcastRoomAll(from.id, cmd),
            pickRandomUserId,
            lang: state.serverLang,
            logger: state.logger
          });
          if (shouldDrop) {
            await state.mutex.runExclusive(async () => {
              state.rooms.delete(from.id);
            });
          }

          u.monitor = monitor;
          if (monitor && !to.live) to.live = true;
          await state.mutex.runExclusive(async () => {
            u.room = to;
          });

          writeJson(200, { ok: true });
          return;
        }

        const mContestConfig = /^\/admin\/contest\/rooms\/(.+)\/config$/.exec(url.pathname);
        if (req.method === "POST" && mContestConfig) {
          const roomIdText = decodeURIComponent(mContestConfig[1]!);
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdText);
          } catch {
            writeJson(400, { ok: false, error: "bad-room-id" });
            return;
          }
          const body = await readJson();
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
            const currentIds = [...room.userIds(), ...room.monitorIds()];
            const set = new Set<number>(whitelistArr && whitelistArr.length > 0 ? whitelistArr : currentIds);
            for (const id of currentIds) set.add(id);
            room.contest = { whitelist: set, manualStart: true, autoDisband: true };
            return true;
          });

          writeJson(ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: "room-not-found" });
          return;
        }

        const mContestWhitelist = /^\/admin\/contest\/rooms\/(.+)\/whitelist$/.exec(url.pathname);
        if (req.method === "POST" && mContestWhitelist) {
          const roomIdText = decodeURIComponent(mContestWhitelist[1]!);
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdText);
          } catch {
            writeJson(400, { ok: false, error: "bad-room-id" });
            return;
          }
          const body = await readJson();
          const raw = (body ?? {}) as { userIds?: unknown };
          const userIds = Array.isArray(raw.userIds) ? raw.userIds.map((it) => Number(it)).filter((n) => Number.isInteger(n)) : null;
          if (!userIds) {
            writeJson(400, { ok: false, error: "bad-user-ids" });
            return;
          }
          const ok = await state.mutex.runExclusive(async () => {
            const room = state.rooms.get(rid);
            if (!room || !room.contest) return false;
            room.contest.whitelist = new Set<number>(userIds);
            const currentIds = [...room.userIds(), ...room.monitorIds()];
            for (const id of currentIds) room.contest.whitelist.add(id);
            return true;
          });
          writeJson(ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: "contest-room-not-found" });
          return;
        }

        const mContestStart = /^\/admin\/contest\/rooms\/(.+)\/start$/.exec(url.pathname);
        if (req.method === "POST" && mContestStart) {
          const roomIdText = decodeURIComponent(mContestStart[1]!);
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdText);
          } catch {
            writeJson(400, { ok: false, error: "bad-room-id" });
            return;
          }
          const body = await readJson();
          const raw = (body ?? {}) as { force?: unknown };
          const force = Boolean(raw.force);

          const result = await state.mutex.runExclusive(async () => {
            const room = state.rooms.get(rid);
            if (!room || !room.contest) return { ok: false as const, status: 404, error: "contest-room-not-found" };
            if (room.state.type !== "WaitForReady") return { ok: false as const, status: 400, error: "room-not-waiting" };
            if (!room.chart) return { ok: false as const, status: 400, error: "no-chart-selected" };
            const started = room.state.started;
            const allIds = [...room.userIds(), ...room.monitorIds()];
            const allReady = allIds.every((id) => started.has(id));
            if (!allReady && !force) return { ok: false as const, status: 400, error: "not-all-ready" };
            return { ok: true as const, room };
          });
          if (!result.ok) {
            writeJson(result.status, { ok: false, error: result.error });
            return;
          }
          const room = result.room;

          const users = room.userIds();
          const monitors = room.monitorIds();
          const sep = state.serverLang.lang === "zh-CN" ? "、" : ", ";
          const usersText = users.join(sep);
          const monitorsText = monitors.join(sep);
          const monitorsSuffix = monitors.length > 0 ? tl(state.serverLang, "log-room-game-start-monitors", { monitors: monitorsText }) : "";
          state.logger.info(tl(state.serverLang, "log-room-game-start", { room: room.id, users: usersText, monitorsSuffix }));
          await room.send((c) => broadcastRoomAll(room.id, c), { type: "StartPlaying" });
          room.resetGameTime((id) => state.users.get(id));
          room.state = { type: "Playing", results: new Map(), aborted: new Set() };
          await room.onStateChange((c) => broadcastRoomAll(room.id, c));
          writeJson(200, { ok: true });
          return;
        }

        writeJson(404, { ok: false, error: "not-found" });
        return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(tl(lang, "http-not-found"));
    })().catch(() => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const lang = req.headers["accept-language"] ? new Language(String(req.headers["accept-language"])) : state.serverLang;
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(tl(lang, "http-internal-error"));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: opts.host, port: opts.port }, () => resolve());
  });

  return {
    server,
    address: () => server.address() as net.AddressInfo,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };
}

