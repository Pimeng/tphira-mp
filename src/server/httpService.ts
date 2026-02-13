import http from "node:http";
import type net from "node:net";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { parseRoomId, roomIdToString, type RoomId } from "../common/roomId.js";
import { newUuid } from "../common/uuid.js";
import type { ServerState } from "./state.js";
import { Language, tl } from "./l10n.js";
import type { ServerCommand } from "../common/commands.js";
import { defaultReplayBaseDir, deleteReplayForUser, listReplaysForUser, readReplayHeader, replayFilePath } from "./replayStorage.js";
import { startWebSocketService, type WebSocketService } from "./websocketService.js";

export type HttpService = {
  server: http.Server;
  ws: WebSocketService;
  address: () => net.AddressInfo;
  close: () => Promise<void>;
};

export async function startHttpService(opts: { state: ServerState; host: string; port: number }): Promise<HttpService> {
  const { state } = opts;

  const ADMIN_MAX_FAILED_ATTEMPTS_PER_IP = 5;
  const adminFailedAttemptsByIp = new Map<string, number>();
  const adminBannedIps = new Set<string>();

  const REPLAY_SESSION_TTL_MS = 30 * 60 * 1000;
  const replaySessions = new Map<string, { userId: number; expiresAt: number }>();

  // 临时管理员TOKEN管理常量
  const TEMP_TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4小时
  const OTP_TTL_MS = 5 * 60 * 1000; // 验证码5分钟有效
  const otpSessions = new Map<string, { otp: string; expiresAt: number }>();

  // OTP验证尝试限制
  const OTP_MAX_ATTEMPTS = 3;
  const otpAttemptsByIp = new Map<string, number>();
  const otpAttemptsBySsid = new Map<string, number>();
  const otpBannedIps = new Set<string>();
  const otpBannedSsids = new Set<string>();

  const server = http.createServer((req, res) => {
    void (async () => {
      const lang = req.headers["accept-language"] ? new Language(String(req.headers["accept-language"])) : state.serverLang;
      const url = new URL(req.url ?? "/", "http://localhost");
      const getClientIp = (): string => {
        // 使用配置的真实 IP 头名称
        const headerName = (state.config.real_ip_header || "X-Forwarded-For").toLowerCase();
        const headerValue = typeof req.headers[headerName] === "string" ? req.headers[headerName] : "";
        const first = headerValue ? headerValue.split(",")[0]?.trim() : "";
        const raw = first || req.socket.remoteAddress || "";
        return raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
      };
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

      const fetchWithTimeout = async (input: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(input, { ...init, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
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
      
      // 清理过期的临时TOKEN和OTP
      const cleanupExpired = () => {
        const now = Date.now();
        for (const [token, data] of state.tempAdminTokens) {
          if (now > data.expiresAt) state.tempAdminTokens.delete(token);
        }
        for (const [ssid, data] of otpSessions) {
          if (now > data.expiresAt) otpSessions.delete(ssid);
        }
      };

      const requireAdmin = () => {
        const ip = getClientIp();
        
        // 调试输出
        const debugInfo = {
          ip,
          reqAdminToken: reqAdminToken ? `${reqAdminToken.slice(0, 8)}...` : '(empty)',
          adminToken: adminToken ? `${adminToken.slice(0, 8)}...` : '(empty)',
          tempTokensCount: state.tempAdminTokens.size,
          hasTempToken: reqAdminToken ? state.tempAdminTokens.has(reqAdminToken) : false
        };
        process.stdout.write(`\x1b[33m[${new Date().toISOString()}] [DEBUG] requireAdmin called: ${JSON.stringify(debugInfo)}\x1b[0m\n`);
        
        if (adminBannedIps.has(ip)) {
          writeJson(401, { ok: false, error: "unauthorized" });
          return false;
        }
        
        // 检查临时TOKEN
        cleanupExpired();
        if (reqAdminToken) {
          const tempTokenData = state.tempAdminTokens.get(reqAdminToken);
          if (tempTokenData) {
            process.stdout.write(`\x1b[33m[${new Date().toISOString()}] [DEBUG] Found temp token, checking validity\x1b[0m\n`);
            if (tempTokenData.banned) {
              process.stdout.write(`\x1b[33m[${new Date().toISOString()}] [DEBUG] Temp token is banned\x1b[0m\n`);
              writeJson(401, { ok: false, error: "token-expired" });
              return false;
            }
            if (Date.now() > tempTokenData.expiresAt) {
              process.stdout.write(`\x1b[33m[${new Date().toISOString()}] [DEBUG] Temp token expired\x1b[0m\n`);
              state.tempAdminTokens.delete(reqAdminToken);
              writeJson(401, { ok: false, error: "token-expired" });
              return false;
            }
            // 验证IP是否匹配
            if (tempTokenData.ip !== ip) {
              process.stdout.write(`\x1b[33m[${new Date().toISOString()}] [DEBUG] IP mismatch: token IP=${tempTokenData.ip}, request IP=${ip}\x1b[0m\n`);
              // IP不匹配，封禁该TOKEN但不显式告知
              tempTokenData.banned = true;
              writeJson(401, { ok: false, error: "token-expired" });
              return false;
            }
            // 临时TOKEN验证通过，直接返回
            process.stdout.write(`\x1b[32m[${new Date().toISOString()}] [DEBUG] Temp token validated successfully\x1b[0m\n`);
            return true;
          } else {
            process.stdout.write(`\x1b[33m[${new Date().toISOString()}] [DEBUG] Temp token not found in map\x1b[0m\n`);
          }
        }
        
        // 检查永久管理员TOKEN
        process.stdout.write(`\x1b[33m[${new Date().toISOString()}] [DEBUG] Checking permanent admin token\x1b[0m\n`);
        if (!adminToken) {
          process.stdout.write(`\x1b[31m[${new Date().toISOString()}] [DEBUG] No permanent admin token configured, returning admin-disabled\x1b[0m\n`);
          writeJson(403, { ok: false, error: "admin-disabled" });
          return false;
        }
        if (!reqAdminToken || reqAdminToken !== adminToken) {
          const next = (adminFailedAttemptsByIp.get(ip) ?? 0) + 1;
          adminFailedAttemptsByIp.set(ip, next);
          if (next >= ADMIN_MAX_FAILED_ATTEMPTS_PER_IP) {
            adminBannedIps.add(ip);
          }
          writeJson(401, { ok: false, error: "unauthorized" });
          return false;
        }
        adminFailedAttemptsByIp.delete(ip);
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

      if (req.method === "POST" && url.pathname === "/replay/auth") {
        const body = await readJson();
        const token = typeof (body as any)?.token === "string" ? String((body as any).token).trim() : "";
        if (!token) {
          writeJson(400, { ok: false, error: "bad-token" });
          return;
        }

        for (const [k, v] of replaySessions) {
          if (Date.now() > v.expiresAt) replaySessions.delete(k);
        }

        const me = await fetchWithTimeout("https://phira.5wyxi.com/me", {
          headers: { Authorization: `Bearer ${token}` }
        }, 8000).then(async (r) => {
          if (!r.ok) throw new Error("auth-failed");
          return (await r.json()) as { id: number };
        }).catch(() => null);

        if (!me || !Number.isInteger(me.id)) {
          writeJson(401, { ok: false, error: "unauthorized" });
          return;
        }

        const baseDir = defaultReplayBaseDir();
        const listed = await listReplaysForUser(baseDir, me.id);
        const charts = [...listed.entries()].map(([chartId, replays]) => ({
          chartId,
          replays: replays.map((r) => ({ timestamp: r.timestamp, recordId: r.recordId }))
        }));
        charts.sort((a, b) => a.chartId - b.chartId);

        const sessionToken = newUuid();
        const expiresAt = Date.now() + REPLAY_SESSION_TTL_MS;
        replaySessions.set(sessionToken, { userId: me.id, expiresAt });

        writeJson(200, { ok: true, userId: me.id, charts, sessionToken, expiresAt });
        return;
      }

      if (req.method === "GET" && url.pathname === "/replay/download") {
        const sessionToken = (url.searchParams.get("sessionToken") ?? "").trim();
        const chartId = Number(url.searchParams.get("chartId") ?? "");
        const timestamp = Number(url.searchParams.get("timestamp") ?? "");
        if (!sessionToken || !Number.isInteger(chartId) || !Number.isInteger(timestamp) || chartId < 0 || timestamp <= 0) {
          writeJson(400, { ok: false, error: "bad-request" });
          return;
        }

        for (const [k, v] of replaySessions) {
          if (Date.now() > v.expiresAt) replaySessions.delete(k);
        }

        const sess = replaySessions.get(sessionToken);
        if (!sess || Date.now() > sess.expiresAt) {
          writeJson(401, { ok: false, error: "unauthorized" });
          return;
        }

        const baseDir = defaultReplayBaseDir();
        const filePath = replayFilePath(baseDir, sess.userId, chartId, timestamp);
        const header = await readReplayHeader(filePath).catch(() => null);
        if (!header || header.userId !== sess.userId || header.chartId !== chartId) {
          writeJson(404, { ok: false, error: "not-found" });
          return;
        }

        const info = await stat(filePath).catch(() => null);
        if (!info || !info.isFile()) {
          writeJson(404, { ok: false, error: "not-found" });
          return;
        }

        res.statusCode = 200;
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-disposition", `attachment; filename="${timestamp}.phirarec"`);
        res.setHeader("content-length", String(info.size));

        const bytesPerSec = 50 * 1024;
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const stream = createReadStream(filePath, { highWaterMark: 4096 });
        try {
          for await (const chunk of stream) {
            if (!res.write(chunk)) await once(res, "drain");
            const delayMs = Math.ceil((chunk.length / bytesPerSec) * 1000);
            if (delayMs > 0) await sleep(delayMs);
          }
          res.end();
        } catch {
          stream.destroy();
          res.end();
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/replay/delete") {
        const body = await readJson();
        const sessionToken = typeof (body as any)?.sessionToken === "string" ? String((body as any).sessionToken).trim() : "";
        const chartId = Number((body as any)?.chartId ?? "");
        const timestamp = Number((body as any)?.timestamp ?? "");
        if (!sessionToken || !Number.isInteger(chartId) || !Number.isInteger(timestamp) || chartId < 0 || timestamp <= 0) {
          writeJson(400, { ok: false, error: "bad-request" });
          return;
        }

        for (const [k, v] of replaySessions) {
          if (Date.now() > v.expiresAt) replaySessions.delete(k);
        }

        const sess = replaySessions.get(sessionToken);
        if (!sess || Date.now() > sess.expiresAt) {
          writeJson(401, { ok: false, error: "unauthorized" });
          return;
        }

        const baseDir = defaultReplayBaseDir();
        const filePath = replayFilePath(baseDir, sess.userId, chartId, timestamp);
        const header = await readReplayHeader(filePath).catch(() => null);
        if (!header || header.userId !== sess.userId || header.chartId !== chartId) {
          writeJson(404, { ok: false, error: "not-found" });
          return;
        }

        const deleted = await deleteReplayForUser(baseDir, sess.userId, chartId, timestamp);
        if (!deleted) {
          writeJson(404, { ok: false, error: "not-found" });
          return;
        }

        writeJson(200, { ok: true });
        return;
      }

      // OTP请求端点（仅当未配置管理员TOKEN时可用）
      if (req.method === "POST" && url.pathname === "/admin/otp/request") {
        const adminToken = state.config.admin_token?.trim() || "";
        if (adminToken) {
          writeJson(403, { ok: false, error: "otp-disabled-when-token-configured" });
          return;
        }

        cleanupExpired();
        const ssid = newUuid();
        const otp = newUuid().slice(0, 8); // 8位验证码
        const expiresAt = Date.now() + OTP_TTL_MS;
        otpSessions.set(ssid, { otp, expiresAt });

        // 输出到终端（INFO级别，强制输出，不写入文件）
        const message = `[OTP Request] 您正在尝试请求验证码登录管理员后台/API，本次请求的验证码是 ${otp}，会话ID: ${ssid}, 5分钟内有效`;
        process.stdout.write(`\x1b[32m[${new Date().toISOString()}] [INFO] ${message}\x1b[0m\n`);

        writeJson(200, { ok: true, ssid, expiresIn: OTP_TTL_MS });
        return;
      }

      // 验证OTP并获取临时TOKEN
      if (req.method === "POST" && url.pathname === "/admin/otp/verify") {
        const adminToken = state.config.admin_token?.trim() || "";
        if (adminToken) {
          writeJson(403, { ok: false, error: "otp-disabled-when-token-configured" });
          return;
        }

        const body = await readJson();
        const raw = (body ?? {}) as { ssid?: unknown; otp?: unknown };
        const ssid = typeof raw.ssid === "string" ? raw.ssid.trim() : "";
        const otp = typeof raw.otp === "string" ? raw.otp.trim() : "";

        if (!ssid || !otp) {
          writeJson(400, { ok: false, error: "bad-request" });
          return;
        }

        const ip = getClientIp();

        // 检查IP和SSID是否已被封禁
        if (otpBannedIps.has(ip)) {
          writeJson(403, { ok: false, error: "ip-banned-too-many-attempts" });
          return;
        }
        if (otpBannedSsids.has(ssid)) {
          writeJson(403, { ok: false, error: "ssid-banned-too-many-attempts" });
          return;
        }

        cleanupExpired();
        const otpData = otpSessions.get(ssid);
        if (!otpData || Date.now() > otpData.expiresAt) {
          writeJson(401, { ok: false, error: "invalid-or-expired-otp" });
          return;
        }

        if (otpData.otp !== otp) {
          // 记录失败尝试
          const ipAttempts = (otpAttemptsByIp.get(ip) || 0) + 1;
          const ssidAttempts = (otpAttemptsBySsid.get(ssid) || 0) + 1;
          
          otpAttemptsByIp.set(ip, ipAttempts);
          otpAttemptsBySsid.set(ssid, ssidAttempts);

          // 检查是否超过最大尝试次数
          if (ipAttempts >= OTP_MAX_ATTEMPTS) {
            otpBannedIps.add(ip);
            const message = `[OTP] IP ${ip} 因OTP验证失败次数过多（${ipAttempts}次）已被封禁`;
            process.stdout.write(`\x1b[31m[${new Date().toISOString()}] [WARN] ${message}\x1b[0m\n`);
          }
          if (ssidAttempts >= OTP_MAX_ATTEMPTS) {
            otpBannedSsids.add(ssid);
            otpSessions.delete(ssid); // 删除被封禁的会话
            const message = `[OTP] 会话 ${ssid} 因OTP验证失败次数过多（${ssidAttempts}次）已被封禁`;
            process.stdout.write(`\x1b[31m[${new Date().toISOString()}] [WARN] ${message}\x1b[0m\n`);
          }

          writeJson(401, { ok: false, error: "invalid-or-expired-otp" });
          return;
        }

        // 验证成功，清除尝试记录
        otpAttemptsByIp.delete(ip);
        otpAttemptsBySsid.delete(ssid);

        // 验证成功，生成临时TOKEN
        const tempToken = newUuid();
        const expiresAt = Date.now() + TEMP_TOKEN_TTL_MS;
        state.tempAdminTokens.set(tempToken, { ip, expiresAt, banned: false });
        otpSessions.delete(ssid); // 删除已使用的OTP

        // 输出到终端
        const message = `[OTP] 临时管理员TOKEN已生成，生成者/使用IP: ${ip}，临时Token: ${tempToken.slice(0, 8)}..., 此Token将在4小时内有效`;
        process.stdout.write(`\x1b[32m[${new Date().toISOString()}] [INFO] ${message}\x1b[0m\n`);

        writeJson(200, { ok: true, token: tempToken, expiresAt, expiresIn: TEMP_TOKEN_TTL_MS });
        return;
      }

      if (url.pathname.startsWith("/admin/")) {
        if (!requireAdmin()) return;

        if (req.method === "GET" && url.pathname === "/admin/replay/config") {
          writeJson(200, { ok: true, enabled: state.replayEnabled });
          return;
        }

        if (req.method === "GET" && url.pathname === "/admin/room-creation/config") {
          writeJson(200, { ok: true, enabled: state.roomCreationEnabled });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/room-creation/config") {
          const body = await readJson();
          const raw = (body ?? {}) as { enabled?: unknown };
          if (raw.enabled === undefined) {
            writeJson(400, { ok: false, error: "bad-enabled" });
            return;
          }
          const enabled = Boolean(raw.enabled);
          await state.mutex.runExclusive(async () => {
            state.roomCreationEnabled = enabled;
          });

          writeJson(200, { ok: true, enabled });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/replay/config") {
          const body = await readJson();
          const raw = (body ?? {}) as { enabled?: unknown };
          if (raw.enabled === undefined) {
            writeJson(400, { ok: false, error: "bad-enabled" });
            return;
          }
          const enabled = Boolean(raw.enabled);
          const snapshot = await state.mutex.runExclusive(async () => {
            state.replayEnabled = enabled;
            const roomIds = enabled ? [] : [...state.rooms.keys()];
            if (!enabled) {
              for (const room of state.rooms.values()) room.live = false;
            }
            return { enabled, roomIds };
          });

          if (!snapshot.enabled) {
            const tasks = snapshot.roomIds.map((rid) => state.replayRecorder.endRoom(rid));
            await Promise.allSettled(tasks);
          }

          writeJson(200, { ok: true, enabled: snapshot.enabled });
          return;
        }

        if (req.method === "GET" && url.pathname === "/admin/rooms") {
          const out = await state.mutex.runExclusive(async () => {
            const rooms = [...state.rooms.entries()].map(([rid, room]) => {
              const roomid = roomIdToString(rid);
              const hostUser = state.users.get(room.hostId);
              const hostName = hostUser?.name ?? String(room.hostId);
              const hostConnected = Boolean(hostUser?.session);
              
              // 状态详细信息
              const stateStr =
                room.state.type === "Playing" ? "playing" : room.state.type === "WaitForReady" ? "waiting_for_ready" : "select_chart";
              
              let stateDetails: any = { type: stateStr };
              if (room.state.type === "WaitForReady") {
                stateDetails.ready_users = Array.from(room.state.started);
                stateDetails.ready_count = room.state.started.size;
              } else if (room.state.type === "Playing") {
                stateDetails.results_count = room.state.results.size;
                stateDetails.aborted_count = room.state.aborted.size;
                stateDetails.finished_users = Array.from(room.state.results.keys());
                stateDetails.aborted_users = Array.from(room.state.aborted);
              }
              
              // 谱面信息
              const chart = room.chart ? { 
                name: room.chart.name, 
                id: room.chart.id
              } : null;
              
              // 用户详细信息
              const users = room.userIds().map((id) => {
                const u = state.users.get(id);
                const userInfo: any = { 
                  id, 
                  name: u?.name ?? String(id), 
                  connected: Boolean(u?.session),
                  is_host: id === room.hostId,
                  game_time: u?.gameTime ?? Number.NEGATIVE_INFINITY,
                  language: u?.lang.lang ?? "unknown"
                };
                
                // 如果房间在进行中，添加玩家的游玩状态和成绩ID
                if (room.state.type === "Playing") {
                  const isFinished = room.state.results.has(id);
                  const isAborted = room.state.aborted.has(id);
                  userInfo.finished = isFinished || isAborted;
                  userInfo.aborted = isAborted;
                  if (isFinished) {
                    const record = room.state.results.get(id);
                    userInfo.record_id = record?.id ?? null;
                  }
                }
                
                return userInfo;
              });
              
              // 观察者详细信息
              const monitors = room.monitorIds().map((id) => {
                const u = state.users.get(id);
                return { 
                  id, 
                  name: u?.name ?? String(id), 
                  connected: Boolean(u?.session),
                  language: u?.lang.lang ?? "unknown"
                };
              });
              
              // 比赛模式信息
              const contest = room.contest ? {
                whitelist_count: room.contest.whitelist.size,
                whitelist: Array.from(room.contest.whitelist),
                manual_start: room.contest.manualStart,
                auto_disband: room.contest.autoDisband
              } : null;
              
              return {
                roomid,
                max_users: room.maxUsers,
                current_users: users.length,
                current_monitors: monitors.length,
                replay_eligible: room.replayEligible,
                live: room.live,
                locked: room.locked,
                cycle: room.cycle,
                host: { 
                  id: room.hostId, 
                  name: hostName,
                  connected: hostConnected
                },
                state: stateDetails,
                chart,
                contest,
                users,
                monitors
              };
            });
            rooms.sort((a, b) => a.roomid.localeCompare(b.roomid));
            return { ok: true, total_rooms: rooms.length, rooms };
          });
          writeJson(200, out);
          return;
        }

        const mRoomMaxUsers = /^\/admin\/rooms\/(.+)\/max_users$/.exec(url.pathname);
        if (req.method === "POST" && mRoomMaxUsers) {
          const roomIdText = decodeURIComponent(mRoomMaxUsers[1]!);
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdText);
          } catch {
            writeJson(400, { ok: false, error: "bad-room-id" });
            return;
          }
          const body = await readJson();
          const raw = (body ?? {}) as { maxUsers?: unknown };
          const maxUsers = Number(raw.maxUsers);
          if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 64) {
            writeJson(400, { ok: false, error: "bad-max-users" });
            return;
          }
          const updated = await state.mutex.runExclusive(async () => {
            const room = state.rooms.get(rid);
            if (!room) return null;
            room.maxUsers = maxUsers;
            return roomIdToString(room.id);
          });
          if (!updated) {
            writeJson(404, { ok: false, error: "room-not-found" });
            return;
          }
          writeJson(200, { ok: true, roomid: updated, max_users: maxUsers });
          return;
        }

        const mRoomDisband = /^\/admin\/rooms\/(.+)\/disband$/.exec(url.pathname);
        if (req.method === "POST" && mRoomDisband) {
          const roomIdText = decodeURIComponent(mRoomDisband[1]!);
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdText);
          } catch {
            writeJson(400, { ok: false, error: "bad-room-id" });
            return;
          }

          const room = await state.mutex.runExclusive(async () => state.rooms.get(rid) ?? null);
          if (!room) {
            writeJson(404, { ok: false, error: "room-not-found" });
            return;
          }

          // 断开所有用户连接
          const allIds = [...room.userIds(), ...room.monitorIds()];
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

          state.logger.info(tl(state.serverLang, "log-room-disbanded-by-admin", { room: roomIdToString(rid) }));
          writeJson(200, { ok: true, roomid: roomIdToString(rid) });
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
                  logger: state.logger,
                  wsService: state.wsService
                });
              }
              await sessionToDisconnect.adminDisconnect({ preserveRoom: true });
            }
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
          await readJson();
          const target = await state.mutex.runExclusive(async () => state.users.get(userId)?.session ?? null);
          if (!target) {
            writeJson(404, { ok: false, error: "user-not-connected" });
            return;
          }
          const u = target.user;
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
              logger: state.logger,
              wsService: state.wsService
            });
          }
          await target.adminDisconnect({ preserveRoom: false });
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
          if (state.replayEnabled && room.replayEligible) await state.replayRecorder.startRoom(room.id, room.chart!.id, room.userIds());
          room.state = { type: "Playing", results: new Map(), aborted: new Set() };
          await room.onStateChange((c) => broadcastRoomAll(room.id, c));
          await room.notifyWebSocket(state);
          writeJson(200, { ok: true });
          return;
        }

        // 全服广播接口
        if (req.method === "POST" && url.pathname === "/admin/broadcast") {
          const body = await readJson();
          const raw = (body ?? {}) as { message?: unknown };
          const message = typeof raw.message === "string" ? raw.message.trim() : "";
          if (!message) {
            writeJson(400, { ok: false, error: "bad-message" });
            return;
          }
          if (message.length > 200) {
            writeJson(400, { ok: false, error: "message-too-long" });
            return;
          }

          const snapshot = await state.mutex.runExclusive(async () => {
            return [...state.rooms.keys()];
          });

          const tasks: Promise<void>[] = [];
          for (const roomId of snapshot) {
            tasks.push(broadcastRoomAll(roomId, { type: "Message", message: { type: "Chat", user: 0, content: message } }));
          }
          await Promise.allSettled(tasks);

          state.logger.info(tl(state.serverLang, "log-admin-broadcast", { message, rooms: String(snapshot.length) }));
          writeJson(200, { ok: true, rooms: snapshot.length });
          return;
        }

        // 向指定房间发送消息接口
        const mRoomChat = /^\/admin\/rooms\/(.+)\/chat$/.exec(url.pathname);
        if (req.method === "POST" && mRoomChat) {
          const roomIdText = decodeURIComponent(mRoomChat[1]!);
          let rid: RoomId;
          try {
            rid = parseRoomId(roomIdText);
          } catch {
            writeJson(400, { ok: false, error: "bad-room-id" });
            return;
          }

          const body = await readJson();
          const raw = (body ?? {}) as { message?: unknown };
          const message = typeof raw.message === "string" ? raw.message.trim() : "";
          if (!message) {
            writeJson(400, { ok: false, error: "bad-message" });
            return;
          }
          if (message.length > 200) {
            writeJson(400, { ok: false, error: "message-too-long" });
            return;
          }

          const roomExists = await state.mutex.runExclusive(async () => {
            return state.rooms.has(rid);
          });

          if (!roomExists) {
            writeJson(404, { ok: false, error: "room-not-found" });
            return;
          }

          await broadcastRoomAll(rid, { type: "Message", message: { type: "Chat", user: 0, content: message } });
          state.logger.info(tl(state.serverLang, "log-admin-room-message", { room: roomIdText, message }));
          writeJson(200, { ok: true });
          return;
        }

        // IP黑名单管理接口
        if (req.method === "GET" && url.pathname === "/admin/ip-blacklist") {
          const blacklist = state.logger.getBlacklistedIps();
          writeJson(200, { ok: true, blacklist });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/ip-blacklist/remove") {
          const body = await readJson();
          const ip = typeof (body as any)?.ip === "string" ? String((body as any).ip).trim() : "";
          if (!ip) {
            writeJson(400, { ok: false, error: "bad-ip" });
            return;
          }
          state.logger.removeFromBlacklist(ip);
          writeJson(200, { ok: true });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/ip-blacklist/clear") {
          state.logger.clearBlacklist();
          writeJson(200, { ok: true });
          return;
        }

        if (req.method === "GET" && url.pathname === "/admin/log-rate") {
          const rate = state.logger.getCurrentRate();
          writeJson(200, { ok: true, rate });
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

  // 启动 WebSocket 服务
  const ws = startWebSocketService({ httpServer: server, state });

  return {
    server,
    ws,
    address: () => server.address() as net.AddressInfo,
    close: async () => {
      await ws.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };
}

