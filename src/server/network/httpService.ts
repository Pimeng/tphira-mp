import http from "node:http";
import type net from "node:net";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat, readFile, writeFile, rm } from "node:fs/promises";
import { roomIdToString, type RoomId } from "../../common/roomId.js";
import { newUuid } from "../../common/uuid.js";
import {
  getClientIp,
  applyCors,
  writeJson,
  readJson,
  extractAdminToken,
  handleOptionsRequest,
  fetchWithRetry
} from "../../common/http.js";
import { OTP_TTL_MS, TEMP_TOKEN_TTL_MS, type ServerState } from "../core/state.js";
import { Language, tl } from "../utils/l10n.js";

import { deleteReplayForUser, listReplaysForUser, readReplayHeader, replayFilePath } from "../replay/replayStorage.js";
import { createAutoUploadHandler } from "../replay/autoUpload.js";
import { uploadToShareStation, setReplayVisibility } from "../utils/shareStation.js";
import { startWebSocketService, type WebSocketService } from "../network/websocketService.js";
import { logRoomInfo } from "../utils/logUtils.js";
import { refreshRoomLive } from "../game/roomUtils.js";
import { buildAdminRoomsData } from "../game/adminViews.js";
import {
  abortPlayingUserAndCheckReady,
  broadcastRoomAll,
  cleanupExpiringMaps,
  parseRoomIdOrWriteError,
  pickRandomUserId,
  verifyUserTokenViaApi
} from "./httpHelpers.js";
import yaml from "js-yaml";

export type HttpService = {
  server: http.Server;
  ws: WebSocketService;
  address: () => net.AddressInfo;
  close: () => Promise<void>;
  /** 处理游戏结束时的自动上传任务 */
  handleGameEndAutoUpload: (userId: number, chartId: number, timestamp: number, recordId: number) => void;
};

export async function startHttpService(opts: { state: ServerState; host: string; port: number }): Promise<HttpService> {
  const { state } = opts;

  const ADMIN_MAX_FAILED_ATTEMPTS_PER_IP = 5;
  const adminFailedAttemptsByIp = new Map<string, number>();
  const adminBannedIps = new Set<string>();

  const REPLAY_SESSION_TTL_MS = 30 * 60 * 1000;
  const replaySessions = new Map<string, { userId: number; expiresAt: number }>();

  // 临时管理员TOKEN管理常量
  const otpSessions = new Map<string, { otp: string; expiresAt: number }>();

  // OTP验证尝试限制
  const OTP_MAX_ATTEMPTS = 3;
  const otpAttemptsByIp = new Map<string, number>();
  const otpAttemptsBySsid = new Map<string, number>();
  const otpBannedIps = new Set<string>();

  /**
   * 验证用户TOKEN并获取用户ID
   */
  const verifyUserToken = (token: string): Promise<number | null> => verifyUserTokenViaApi(state, token);

  const otpBannedSsids = new Set<string>();

  const server = http.createServer((req, res) => {
    void (async () => {
      const lang = req.headers["accept-language"] ? new Language(String(req.headers["accept-language"])) : state.serverLang;
      const url = new URL(req.url ?? "/", "http://localhost");
      
      const clientIp = getClientIp(req, state.config.real_ip_header || "X-Forwarded-For");
      
      applyCors(res, req);
      
      if (req.method === "OPTIONS") {
        handleOptionsRequest(res);
        return;
      }

      // 本地包装函数，简化调用
      const write = (status: number, body: unknown) => writeJson(res, status, body);
      const read = () => readJson(req);

      const adminToken = state.config.admin_token?.trim() || "";
      const reqAdminToken = extractAdminToken(req, url);
      
      // 清理过期的临时TOKEN和OTP
      const cleanupExpired = () => cleanupExpiringMaps(state.tempAdminTokens, otpSessions, state.cliApprovalSessions);

      const requireAdmin = () => {
        // 调试输出
        const debugInfo = {
          ip: clientIp,
          reqAdminToken: reqAdminToken ? `${reqAdminToken.slice(0, 8)}...` : '(empty)',
          adminToken: adminToken ? `${adminToken.slice(0, 8)}...` : '(empty)',
          tempTokensCount: state.tempAdminTokens.size,
          hasTempToken: reqAdminToken ? state.tempAdminTokens.has(reqAdminToken) : false
        };
        state.logger.debug(`requireAdmin called: ${JSON.stringify(debugInfo)}`);
        
        if (adminBannedIps.has(clientIp)) {
          write(401, { ok: false, error: "unauthorized" });
          return false;
        }
        
        // 检查临时TOKEN
        cleanupExpired();
        if (reqAdminToken) {
          const tempTokenData = state.tempAdminTokens.get(reqAdminToken);
          if (tempTokenData) {
            state.logger.debug("Found temp token, checking validity");
            if (tempTokenData.banned) {
              state.logger.debug("Temp token is banned");
              write(401, { ok: false, error: "token-expired" });
              return false;
            }
            if (Date.now() > tempTokenData.expiresAt) {
              state.logger.debug("Temp token expired");
              state.tempAdminTokens.delete(reqAdminToken);
              write(401, { ok: false, error: "token-expired" });
              return false;
            }
            // 验证IP是否匹配
            if (tempTokenData.ip !== clientIp) {
              state.logger.debug(`IP mismatch: token IP=${tempTokenData.ip}, request IP=${clientIp}`);
              // IP不匹配，封禁该TOKEN但不显式告知
              tempTokenData.banned = true;
              write(401, { ok: false, error: "token-expired" });
              return false;
            }
            // 临时TOKEN验证通过，直接返回
            state.logger.debug("Temp token validated successfully");
            return true;
          } else {
            state.logger.debug("Temp token not found in map");
          }
        }
        
        // 检查永久管理员TOKEN
        state.logger.debug("Checking permanent admin token");
        if (!adminToken) {
          state.logger.debug("No permanent admin token configured, returning admin-disabled");
          write(403, { ok: false, error: "admin-disabled" });
          return false;
        }
        if (!reqAdminToken || reqAdminToken !== adminToken) {
          const next = (adminFailedAttemptsByIp.get(clientIp) ?? 0) + 1;
          adminFailedAttemptsByIp.set(clientIp, next);
          if (next >= ADMIN_MAX_FAILED_ATTEMPTS_PER_IP) {
            adminBannedIps.add(clientIp);
          }
          write(401, { ok: false, error: "unauthorized" });
          return false;
        }
        adminFailedAttemptsByIp.delete(clientIp);
        return true;
      };

      if (req.method === "GET" && url.pathname === "/room") {
        // 优化：不使用 mutex，直接读取
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
        return;
      }

      if (req.method === "GET" && url.pathname === "/room-creation/config") {
        write(200, { ok: true, enabled: state.roomCreationEnabled });
        return;
      }

      if (req.method === "POST" && url.pathname === "/replay/auth") {
        const body = await read();
        const token = typeof (body as any)?.token === "string" ? String((body as any).token).trim() : "";
        if (!token) {
          write(400, { ok: false, error: "bad-token" });
          return;
        }

        cleanupExpiringMaps(replaySessions);

        const phiraApiEndpoint = state.config.phira_api_endpoint || "https://phira.5wyxi.com";
        const me = await fetchWithRetry(`${phiraApiEndpoint}/me`, {
          headers: { Authorization: `Bearer ${token}` },
          proxy: state.config.outbound_proxy
        }, 8000).then(async (r) => {
          if (!r.ok) throw new Error("auth-failed");
          return (await r.json()) as { id: number };
        }).catch(() => null);

        if (!me || !Number.isInteger(me.id)) {
          write(401, { ok: false, error: "unauthorized" });
          return;
        }

        const baseDir = state.replayRecorder.baseDir;
        const listed = await listReplaysForUser(baseDir, me.id);
        const charts: Array<{
          chartId: number;
          replays: Array<{ timestamp: number; recordId: number; scoreId?: number; downloadUrl?: string }>;
        }> = [...listed.entries()].map(([chartId, replays]) => ({
          chartId,
          replays: replays.map((r) => ({ timestamp: r.timestamp, recordId: r.recordId }))
        }));

        // 合并已上传回放的元数据
        const userMeta = state.uploadedReplayMeta.get(me.id);
        if (userMeta) {
          for (const [chartId, metaList] of userMeta.entries()) {
            let chartEntry = charts.find((c) => c.chartId === chartId);
            if (!chartEntry) {
              chartEntry = { chartId, replays: [] };
              charts.push(chartEntry);
            }
            for (const meta of metaList) {
              const shareStation = state.shareStation;
              if (shareStation) {
                chartEntry.replays.push({
                  timestamp: meta.timestamp,
                  recordId: 0,
                  scoreId: meta.scoreId,
                  downloadUrl: `${shareStation.url}/download/replay/${meta.scoreId}`
                });
              }
            }
          }
        }

        // 对每个 chart 的 replays 按时间倒序排列
        for (const chart of charts) {
          chart.replays.sort((a, b) => b.timestamp - a.timestamp);
        }
        charts.sort((a, b) => a.chartId - b.chartId);

        const sessionToken = newUuid();
        const expiresAt = Date.now() + REPLAY_SESSION_TTL_MS;
        replaySessions.set(sessionToken, { userId: me.id, expiresAt });

        write(200, { ok: true, userId: me.id, charts, sessionToken, expiresAt });
        return;
      }

      if (req.method === "GET" && url.pathname === "/replay/download") {
        const sessionToken = (url.searchParams.get("sessionToken") ?? "").trim();
        const chartId = Number(url.searchParams.get("chartId") ?? "");
        const timestamp = Number(url.searchParams.get("timestamp") ?? "");
        if (!sessionToken || !Number.isInteger(chartId) || !Number.isInteger(timestamp) || chartId < 0 || timestamp <= 0) {
          write(400, { ok: false, error: "bad-request" });
          return;
        }

        cleanupExpiringMaps(replaySessions);

        const sess = replaySessions.get(sessionToken);
        if (!sess || Date.now() > sess.expiresAt) {
          write(401, { ok: false, error: "unauthorized" });
          return;
        }

        const baseDir = state.replayRecorder.baseDir;
        const filePath = replayFilePath(baseDir, sess.userId, chartId, timestamp);
        const info = await stat(filePath).catch(() => null);

        // 本地文件存在，直接返回文件流
        if (info && info.isFile()) {
          const header = await readReplayHeader(filePath).catch(() => null);
          if (!header || header.userId !== sess.userId || header.chartId !== chartId) {
            write(404, { ok: false, error: "not-found" });
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

        // 本地文件不存在，检查已上传的元数据
        const userMeta = state.uploadedReplayMeta.get(sess.userId);
        const chartMeta = userMeta?.get(chartId);
        const meta = chartMeta?.find((m) => m.timestamp === timestamp);
        if (meta && state.shareStation) {
          // 重定向到分享站下载链接
          const downloadUrl = `${state.shareStation.url}/download/replay/${meta.scoreId}`;
          res.statusCode = 302;
          res.setHeader("Location", downloadUrl);
          res.end();
          return;
        }

        write(404, { ok: false, error: "not-found" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/replay/delete") {
        const body = await read();
        const sessionToken = typeof (body as any)?.sessionToken === "string" ? String((body as any)?.sessionToken).trim() : "";
        const chartId = Number((body as any)?.chartId ?? "");
        const timestamp = Number((body as any)?.timestamp ?? "");
        if (!sessionToken || !Number.isInteger(chartId) || !Number.isInteger(timestamp) || chartId < 0 || timestamp <= 0) {
          write(400, { ok: false, error: "bad-request" });
          return;
        }

        cleanupExpiringMaps(replaySessions);

        const sess = replaySessions.get(sessionToken);
        if (!sess || Date.now() > sess.expiresAt) {
          write(401, { ok: false, error: "unauthorized" });
          return;
        }

        // 先尝试删除本地文件
        const baseDir = state.replayRecorder.baseDir;
        const filePath = replayFilePath(baseDir, sess.userId, chartId, timestamp);
        const info = await stat(filePath).catch(() => null);
        if (info?.isFile()) {
          const header = await readReplayHeader(filePath).catch(() => null);
          if (header && header.userId === sess.userId && header.chartId === chartId) {
            const deleted = await deleteReplayForUser(baseDir, sess.userId, chartId, timestamp);
            if (deleted) {
              write(200, { ok: true });
              return;
            }
          }
        }

        // 本地文件不存在，尝试从元数据中删除
        const userMeta = state.uploadedReplayMeta.get(sess.userId);
        if (userMeta) {
          const chartMeta = userMeta.get(chartId);
          if (chartMeta) {
            const idx = chartMeta.findIndex((m) => m.timestamp === timestamp);
            if (idx >= 0) {
              chartMeta.splice(idx, 1);
              if (chartMeta.length === 0) {
                userMeta.delete(chartId);
              }
              if (userMeta.size === 0) {
                state.uploadedReplayMeta.delete(sess.userId);
              }
              write(200, { ok: true });
              return;
            }
          }
        }

        write(404, { ok: false, error: "not-found" });
        return;
      }

      // 4) 上传回放到分享站（使用用户TOKEN鉴权）
      if (req.method === "POST" && url.pathname === "/replay/upload") {
        const body = await read();
        const token = typeof (body as any)?.token === "string" ? String((body as any).token).trim() : "";
        const chartId = Number((body as any)?.chartId ?? "");
        const timestamp = Number((body as any)?.timestamp ?? "");

        if (!token || !Number.isInteger(chartId) || !Number.isInteger(timestamp) || chartId < 0 || timestamp <= 0) {
          write(400, { ok: false, error: "bad-request" });
          return;
        }

        // 验证用户TOKEN
        const userId = await verifyUserToken(token);
        if (userId === null) {
          write(401, { ok: false, error: "unauthorized" });
          return;
        }

        // 检查分享站是否配置
        if (!state.shareStationConfigured) {
          write(503, { ok: false, error: "share-station-not-configured" });
          return;
        }

        // 获取回放文件路径
        const baseDir = state.replayRecorder.baseDir;
        const filePath = replayFilePath(baseDir, userId, chartId, timestamp);

        // 验证文件头和权限
        const header = await readReplayHeader(filePath).catch(() => null);
        if (!header || header.userId !== userId || header.chartId !== chartId) {
          write(404, { ok: false, error: "not-found" });
          return;
        }

        // 检查文件是否存在
        const fileInfo = await stat(filePath).catch(() => null);
        if (!fileInfo || !fileInfo.isFile()) {
          write(404, { ok: false, error: "not-found" });
          return;
        }

        // 读取文件内容
        let fileBuffer: Buffer;
        try {
          fileBuffer = await readFile(filePath);
        } catch {
          write(500, { ok: false, error: "upload-failed" });
          return;
        }

        // 上传到分享站
        const uploadResult = await uploadToShareStation({
          fileBuffer,
          filename: `${timestamp}.phirarec`,
          chartName: header.chartName,
          username: header.userName,
          shareStation: state.shareStation!,
          outboundProxy: state.config.outbound_proxy
        });

        if (!uploadResult.success) {
          write(500, { ok: false, error: uploadResult.message || "upload-failed" });
          return;
        }

        // 存储元数据
        if (uploadResult.scoreId) {
          let userMeta = state.uploadedReplayMeta.get(userId);
          if (!userMeta) {
            userMeta = new Map();
            state.uploadedReplayMeta.set(userId, userMeta);
          }
          let chartMeta = userMeta.get(chartId);
          if (!chartMeta) {
            chartMeta = [];
            userMeta.set(chartId, chartMeta);
          }
          chartMeta.push({ scoreId: uploadResult.scoreId, chartId, timestamp });

          // 手动上传默认设置为显示
          await setReplayVisibility(uploadResult.scoreId, true, {
            shareStation: state.shareStation!,
            outboundProxy: state.config.outbound_proxy
          });

          // 上传成功后删除本地文件
          try {
            await rm(filePath);
          } catch (err) {
            state.logger.warn(`Failed to delete local replay file after manual upload for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        write(200, {
          ok: true,
          userId,
          chartId,
          recordId: header.recordId || 0,
          scoreId: uploadResult.scoreId,
          message: "upload-success"
        });
        return;
      }

      // 5) 自动上传配置接口（使用用户TOKEN鉴权）

      // 查询自动上传配置
      if (req.method === "GET" && url.pathname === "/replay/auto-upload/config") {
        const token = (url.searchParams.get("token") ?? "").trim();
        if (!token) {
          write(400, { ok: false, error: "bad-token" });
          return;
        }

        // 验证用户TOKEN
        const userId = await verifyUserToken(token);
        if (userId === null) {
          write(401, { ok: false, error: "unauthorized" });
          return;
        }

        // 获取或创建用户配置（show 默认 false）
        let config = state.autoUploadConfigs.get(userId);
        if (!config) {
          config = { show: false };
          state.autoUploadConfigs.set(userId, config);
        }

        write(200, {
          ok: true,
          userId,
          show: config.show,
          shareStationConfigured: state.shareStationConfigured,
          autoUploadEnabled: Boolean(state.config.replay_auto_upload)
        });
        return;
      }

      // 修改自动上传配置（仅控制显示状态）
      if (req.method === "POST" && url.pathname === "/replay/auto-upload/config") {
        const body = await read();
        const token = typeof (body as any)?.token === "string" ? String((body as any).token).trim() : "";
        const show = (body as any)?.show;

        if (!token) {
          write(400, { ok: false, error: "bad-token" });
          return;
        }

        // 验证用户TOKEN
        const userId = await verifyUserToken(token);
        if (userId === null) {
          write(401, { ok: false, error: "unauthorized" });
          return;
        }

        // 获取或创建用户配置（show 默认 false）
        let config = state.autoUploadConfigs.get(userId);
        if (!config) {
          config = { show: false };
        }

        // 更新配置
        if (typeof show === 'boolean') {
          config.show = show;
        }

        state.autoUploadConfigs.set(userId, config);

        write(200, {
          ok: true,
          userId,
          show: config.show,
          shareStationConfigured: state.shareStationConfigured,
          autoUploadEnabled: Boolean(state.config.replay_auto_upload)
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/replay/config") {
        write(200, { ok: true, enabled: state.replayEnabled });
        return;
      }

      // OTP请求端点（仅当未配置管理员TOKEN时可用）
      if (req.method === "POST" && url.pathname === "/admin/otp/request") {
        const adminToken = state.config.admin_token?.trim() || "";
        if (adminToken) {
          write(403, { ok: false, error: "otp-disabled-when-token-configured" });
          return;
        }

        // 读取可选 body 以获取 mode 参数
        let mode = "otp";
        try {
          const body = await read();
          const raw = (body ?? {}) as { mode?: unknown };
          if (typeof raw.mode === "string") {
            const m = raw.mode.trim().toLowerCase();
            if (m === "cli" || m === "otp") mode = m;
          }
        } catch {
          // body 读取失败时按默认 otp 处理
        }

        cleanupExpired();
        const ssid = newUuid();
        const expiresAt = Date.now() + OTP_TTL_MS;

        if (mode === "cli") {
          // CLI 批准模式：在终端打印提权请求并等待管理员处理
          state.cliApprovalSessions.set(ssid, {
            ip: clientIp,
            expiresAt,
            status: "pending",
            requestedAt: Date.now()
          });

          const shortSsid = ssid.slice(0, 8);
          const message = `[OTP CLI Request] 收到管理员提权申请，请求IP: ${clientIp}，会话ID: ${ssid}（短码: ${shortSsid}），1分钟内有效。使用 'approve ${shortSsid}' 批准或 'deny ${shortSsid}' 拒绝`;
          process.stdout.write(`\x1b[33m[${new Date().toISOString()}] [INFO] ${message}\x1b[0m\n`);

          write(200, { ok: true, ssid, expiresIn: OTP_TTL_MS, mode: "cli" });
          return;
        }

        // 默认 OTP 模式
        const otp = newUuid().slice(0, 8); // 8位验证码
        otpSessions.set(ssid, { otp, expiresAt });

        // 输出到终端（INFO级别，强制输出，不写入文件）
        const message = `[OTP Request] 您正在尝试请求验证码登录管理员后台 API，本次请求的验证码是 ${otp}，会话ID: ${ssid}, 1分钟内有效`;
        process.stdout.write(`\x1b[32m[${new Date().toISOString()}] [INFO] ${message}\x1b[0m\n`);

        write(200, { ok: true, ssid, expiresIn: OTP_TTL_MS, mode: "otp" });
        return;
      }

      // 验证OTP并获取临时TOKEN
      if (req.method === "POST" && url.pathname === "/admin/otp/verify") {
        const adminToken = state.config.admin_token?.trim() || "";
        if (adminToken) {
          write(403, { ok: false, error: "otp-disabled-when-token-configured" });
          return;
        }

        const body = await read();
        const raw = (body ?? {}) as { ssid?: unknown; otp?: unknown; mode?: unknown };
        const ssid = typeof raw.ssid === "string" ? raw.ssid.trim() : "";
        let mode = "otp";
        if (typeof raw.mode === "string") {
          const m = raw.mode.trim().toLowerCase();
          if (m === "cli" || m === "otp") mode = m;
        }

        if (!ssid) {
          write(400, { ok: false, error: "bad-request" });
          return;
        }

        cleanupExpired();

        // CLI 批准模式：检查批准状态并返回 token（如果已批准）
        if (mode === "cli") {
          const session = state.cliApprovalSessions.get(ssid);
          if (!session || Date.now() > session.expiresAt) {
            state.cliApprovalSessions.delete(ssid);
            write(401, { ok: false, error: "invalid-or-expired-session" });
            return;
          }
          // 仅允许同 IP 轮询
          if (session.ip !== clientIp) {
            write(403, { ok: false, error: "ip-mismatch" });
            return;
          }
          if (session.status === "pending") {
            write(202, { ok: false, error: "pending-approval", status: "pending" });
            return;
          }
          if (session.status === "denied") {
            state.cliApprovalSessions.delete(ssid);
            write(403, { ok: false, error: "approval-denied", status: "denied" });
            return;
          }
          // approved
          const token = session.token;
          const tokenExpiresAt = session.tokenExpiresAt;
          if (!token || !tokenExpiresAt) {
            // 状态异常，清理后报错
            state.cliApprovalSessions.delete(ssid);
            write(500, { ok: false, error: "token-not-issued" });
            return;
          }
          // 一次性会话：取出后立即清理
          state.cliApprovalSessions.delete(ssid);
          write(200, {
            ok: true,
            token,
            expiresAt: tokenExpiresAt,
            expiresIn: Math.max(0, tokenExpiresAt - Date.now()),
            mode: "cli"
          });
          return;
        }

        // 默认 OTP 验证模式
        const otp = typeof raw.otp === "string" ? raw.otp.trim() : "";
        if (!otp) {
          write(400, { ok: false, error: "bad-request" });
          return;
        }

        // 检查IP和SSID是否已被封禁
        if (otpBannedIps.has(clientIp)) {
          write(403, { ok: false, error: "ip-banned-too-many-attempts" });
          return;
        }
        if (otpBannedSsids.has(ssid)) {
          write(403, { ok: false, error: "ssid-banned-too-many-attempts" });
          return;
        }

        const otpData = otpSessions.get(ssid);
        if (!otpData || Date.now() > otpData.expiresAt) {
          write(401, { ok: false, error: "invalid-or-expired-otp" });
          return;
        }

        if (otpData.otp !== otp) {
          // 记录失败尝试
          const ipAttempts = (otpAttemptsByIp.get(clientIp) || 0) + 1;
          const ssidAttempts = (otpAttemptsBySsid.get(ssid) || 0) + 1;

          otpAttemptsByIp.set(clientIp, ipAttempts);
          otpAttemptsBySsid.set(ssid, ssidAttempts);

          // 检查是否超过最大尝试次数
          if (ipAttempts >= OTP_MAX_ATTEMPTS) {
            otpBannedIps.add(clientIp);
            const message = `[OTP] IP ${clientIp} 因OTP验证失败次数过多（${ipAttempts}次）已被封禁`;
            process.stdout.write(`\x1b[31m[${new Date().toISOString()}] [WARN] ${message}\x1b[0m\n`);
          }
          if (ssidAttempts >= OTP_MAX_ATTEMPTS) {
            otpBannedSsids.add(ssid);
            otpSessions.delete(ssid); // 删除被封禁的会话
            const message = `[OTP] 会话 ${ssid} 因OTP验证失败次数过多（${ssidAttempts}次）已被封禁`;
            process.stdout.write(`\x1b[31m[${new Date().toISOString()}] [WARN] ${message}\x1b[0m\n`);
          }

          write(401, { ok: false, error: "invalid-or-expired-otp" });
          return;
        }

        // 验证成功，清除尝试记录
        otpAttemptsByIp.delete(clientIp);
        otpAttemptsBySsid.delete(ssid);

        // 验证成功，生成临时TOKEN
        const tempToken = newUuid();
        const expiresAt = Date.now() + TEMP_TOKEN_TTL_MS;
        state.tempAdminTokens.set(tempToken, { ip: clientIp, expiresAt, banned: false });
        otpSessions.delete(ssid); // 删除已使用的OTP

        // 输出到终端
        const message = `[OTP] 临时管理员TOKEN已生成，生成时使用IP: ${clientIp}，临时Token: ${tempToken.slice(0, 8)}..., 此Token将在4小时内有效`;
        process.stdout.write(`\x1b[32m[${new Date().toISOString()}] [INFO] ${message}\x1b[0m\n`);

        write(200, { ok: true, token: tempToken, expiresAt, expiresIn: TEMP_TOKEN_TTL_MS });
        return;
      }

      if (url.pathname.startsWith("/admin/")) {
        if (!requireAdmin()) return;

        if (req.method === "GET" && url.pathname === "/admin/replay/config") {
          write(200, { ok: true, enabled: state.replayEnabled });
          return;
        }

        if (req.method === "GET" && url.pathname === "/admin/room-creation/config") {
          write(200, { ok: true, enabled: state.roomCreationEnabled });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/room-creation/config") {
          const body = await read();
          const raw = (body ?? {}) as { enabled?: unknown };
          if (raw.enabled === undefined) {
            write(400, { ok: false, error: "bad-enabled" });
            return;
          }
          const enabled = Boolean(raw.enabled);
          await state.mutex.runExclusive(async () => {
            state.roomCreationEnabled = enabled;
          });

          write(200, { ok: true, enabled });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/replay/config") {
          const body = await read();
          const raw = (body ?? {}) as { enabled?: unknown };
          if (raw.enabled === undefined) {
            write(400, { ok: false, error: "bad-enabled" });
            return;
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
          return;
        }

        if (req.method === "GET" && url.pathname === "/admin/rooms") {
          const rooms = buildAdminRoomsData(state);
          write(200, { ok: true, total_rooms: rooms.length, rooms });
          return;
        }

        const mRoomMaxUsers = /^\/admin\/rooms\/(.+)\/max_users$/.exec(url.pathname);
        if (req.method === "POST" && mRoomMaxUsers) {
          const roomIdText = decodeURIComponent(mRoomMaxUsers[1]!);
          const rid = parseRoomIdOrWriteError(roomIdText, res);
          if (!rid) return;
          const body = await read();
          const raw = (body ?? {}) as { maxUsers?: unknown };
          const maxUsers = Number(raw.maxUsers);
          if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 64) {
            write(400, { ok: false, error: "bad-max-users" });
            return;
          }
          const updated = await state.mutex.runExclusive(async () => {
            const room = state.rooms.get(rid);
            if (!room) return null;
            room.maxUsers = maxUsers;
            return roomIdToString(room.id);
          });
          if (!updated) {
            write(404, { ok: false, error: "room-not-found" });
            return;
          }
          write(200, { ok: true, roomid: updated, max_users: maxUsers });
          return;
        }

        const mRoomDisband = /^\/admin\/rooms\/(.+)\/disband$/.exec(url.pathname);
        if (req.method === "POST" && mRoomDisband) {
          const roomIdText = decodeURIComponent(mRoomDisband[1]!);
          const rid = parseRoomIdOrWriteError(roomIdText, res);
          if (!rid) return;

          const room = await state.mutex.runExclusive(async () => state.rooms.get(rid) ?? null);
          if (!room) {
            write(404, { ok: false, error: "room-not-found" });
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

          logRoomInfo(state.logger, state.serverLang, rid, "log-room-disbanded-by-admin");
          write(200, { ok: true, roomid: roomIdToString(rid) });
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
          write(out.ok ? 200 : 404, out);
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/ban/user") {
          const body = await read();
          const raw = (body ?? {}) as { userId?: unknown; banned?: unknown; disconnect?: unknown };
          const userId = Number(raw.userId);
          const banned = Boolean(raw.banned);
          const disconnect = Boolean(raw.disconnect);
          if (!Number.isInteger(userId)) {
            write(400, { ok: false, error: "bad-user-id" });
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
              if (u && u.room) {
                await abortPlayingUserAndCheckReady({ state, user: u, room: u.room });
              }
              await sessionToDisconnect.adminDisconnect({ preserveRoom: true });
            }
          }
          
          write(200, { ok: true });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/ban/room") {
          const body = await read();
          const raw = (body ?? {}) as { userId?: unknown; roomId?: unknown; banned?: unknown };
          const userId = Number(raw.userId);
          const roomIdText = typeof raw.roomId === "string" ? raw.roomId : String(raw.roomId ?? "");
          const rid = parseRoomIdOrWriteError(roomIdText, res);
          if (!rid) return;
          const banned = Boolean(raw.banned);
          if (!Number.isInteger(userId)) {
            write(400, { ok: false, error: "bad-user-id" });
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
          write(200, { ok: true });
          return;
        }

        const mDisconnect = /^\/admin\/users\/(\d+)\/disconnect$/.exec(url.pathname);
        if (req.method === "POST" && mDisconnect) {
          const userId = Number(mDisconnect[1]);
          await read();
          const target = await state.mutex.runExclusive(async () => state.users.get(userId)?.session ?? null);
          if (!target) {
            write(404, { ok: false, error: "user-not-connected" });
            return;
          }
          const u = target.user;
          if (u && u.room) {
            await abortPlayingUserAndCheckReady({ state, user: u, room: u.room });
          }
          await target.adminDisconnect({ preserveRoom: false });
          write(200, { ok: true });
          return;
        }

        const mMove = /^\/admin\/users\/(\d+)\/move$/.exec(url.pathname);
        if (req.method === "POST" && mMove) {
          const userId = Number(mMove[1]);
          const body = await read();
          const raw = (body ?? {}) as { roomId?: unknown; monitor?: unknown };
          const roomIdText = typeof raw.roomId === "string" ? raw.roomId : String(raw.roomId ?? "");
          const rid = parseRoomIdOrWriteError(roomIdText, res);
          if (!rid) return;
          const monitor = Boolean(raw.monitor);

          const u = await state.mutex.runExclusive(async () => state.users.get(userId) ?? null);
          if (!u) {
            write(404, { ok: false, error: "user-not-found" });
            return;
          }
          if (u.session) {
            write(400, { ok: false, error: "user-must-be-disconnected" });
            return;
          }
          const from = u.room;
          if (!from) {
            write(400, { ok: false, error: "user-not-in-room" });
            return;
          }
          if (from.state.type !== "SelectChart") {
            write(400, { ok: false, error: "cannot-move-while-playing" });
            return;
          }
          const to = await state.mutex.runExclusive(async () => state.rooms.get(rid) ?? null);
          if (!to) {
            write(404, { ok: false, error: "room-not-found" });
            return;
          }
          if (to.state.type !== "SelectChart") {
            write(400, { ok: false, error: "target-room-not-idle" });
            return;
          }
          try {
            to.validateJoin(u, monitor);
          } catch (e) {
            write(400, { ok: false, error: e instanceof Error ? e.message : String(e) });
            return;
          }
          if (!to.addUser(u, monitor)) {
            write(400, { ok: false, error: "room-full" });
            return;
          }

          const shouldDrop = await from.onUserLeave({
            user: u,
            usersById: (id) => state.users.get(id),
            broadcast: (cmd) => broadcastRoomAll(state, from.id, cmd),
            broadcastToMonitors: (cmd) => broadcastRoomAll(state, from.id, cmd),
            pickRandomUserId: pickRandomUserId,
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
          return;
        }

        const mContestConfig = /^\/admin\/contest\/rooms\/(.+)\/config$/.exec(url.pathname);
        if (req.method === "POST" && mContestConfig) {
          const roomIdText = decodeURIComponent(mContestConfig[1]!);
          const rid = parseRoomIdOrWriteError(roomIdText, res);
          if (!rid) return;
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
            const currentIds = [...room.userIds(), ...room.monitorIds()];
            const set = new Set<number>(whitelistArr && whitelistArr.length > 0 ? whitelistArr : currentIds);
            for (const id of currentIds) set.add(id);
            room.contest = { whitelist: set, manualStart: true, autoDisband: true };
            return true;
          });

          write(ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: "room-not-found" });
          return;
        }

        const mContestWhitelist = /^\/admin\/contest\/rooms\/(.+)\/whitelist$/.exec(url.pathname);
        if (req.method === "POST" && mContestWhitelist) {
          const roomIdText = decodeURIComponent(mContestWhitelist[1]!);
          const rid = parseRoomIdOrWriteError(roomIdText, res);
          if (!rid) return;
          const body = await read();
          const raw = (body ?? {}) as { userIds?: unknown };
          const userIds = Array.isArray(raw.userIds) ? raw.userIds.map((it) => Number(it)).filter((n) => Number.isInteger(n)) : null;
          if (!userIds) {
            write(400, { ok: false, error: "bad-user-ids" });
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
          write(ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: "contest-room-not-found" });
          return;
        }

        const mContestStart = /^\/admin\/contest\/rooms\/(.+)\/start$/.exec(url.pathname);
        if (req.method === "POST" && mContestStart) {
          const roomIdText = decodeURIComponent(mContestStart[1]!);
          const rid = parseRoomIdOrWriteError(roomIdText, res);
          if (!rid) return;
          const body = await read();
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
            write(result.status, { ok: false, error: result.error });
            return;
          }
          const room = result.room;

          const users = room.userIds();
          const monitors = room.monitorIds();
          const sep = state.serverLang.lang === "zh-CN" ? "、" : ", ";
          const usersText = users.join(sep);
          const monitorsText = monitors.join(sep);
          const monitorsSuffix = monitors.length > 0 ? tl(state.serverLang, "log-room-game-start-monitors", { monitors: monitorsText }) : "";
          logRoomInfo(state.logger, state.serverLang, room.id, "log-room-game-start", { users: usersText, monitorsSuffix });
          await room.send((c) => broadcastRoomAll(state, room.id, c), { type: "StartPlaying" }, (id) => state.users.get(id));
          room.resetGameTime((id) => state.users.get(id));
          if (state.replayEnabled && room.replayEligible) {
            const users = room.userIds().map((id) => ({ id, name: state.users.get(id)?.name ?? String(id) }));
            await state.replayRecorder.startRoom(room.id, room.chart!, users);
          }
          room.state = { type: "Playing", results: new Map(), aborted: new Set() };
          await room.onStateChange((c) => broadcastRoomAll(state, room.id, c));
          await room.notifyWebSocket(state);
          write(200, { ok: true });
          return;
        }

        // 全服广播接口
        if (req.method === "POST" && url.pathname === "/admin/broadcast") {
          const body = await read();
          const raw = (body ?? {}) as { message?: unknown };
          const message = typeof raw.message === "string" ? raw.message.trim() : "";
          if (!message) {
            write(400, { ok: false, error: "bad-message" });
            return;
          }
          if (message.length > 200) {
            write(400, { ok: false, error: "message-too-long" });
            return;
          }

          const snapshot = await state.mutex.runExclusive(async () => {
            return [...state.rooms.keys()];
          });

          // 优化：完全异步，不等待
          for (const roomId of snapshot) {
            const room = state.rooms.get(roomId);
            if (room) room.addLog(message, Date.now());
            void broadcastRoomAll(state, roomId, { type: "Message", message: { type: "Chat", user: 0, content: message } }).catch(() => {});
          }

          state.logger.info(tl(state.serverLang, "log-admin-broadcast", { message, rooms: String(snapshot.length) }));
          write(200, { ok: true, rooms: snapshot.length });
          return;
        }

        // 向指定房间发送消息接口
        const mRoomChat = /^\/admin\/rooms\/(.+)\/chat$/.exec(url.pathname);
        if (req.method === "POST" && mRoomChat) {
          const roomIdText = decodeURIComponent(mRoomChat[1]!);
          const rid = parseRoomIdOrWriteError(roomIdText, res);
          if (!rid) return;

          const body = await read();
          const raw = (body ?? {}) as { message?: unknown };
          const message = typeof raw.message === "string" ? raw.message.trim() : "";
          if (!message) {
            write(400, { ok: false, error: "bad-message" });
            return;
          }
          if (message.length > 200) {
            write(400, { ok: false, error: "message-too-long" });
            return;
          }

          const room = state.rooms.get(rid);

          if (!room) {
            write(404, { ok: false, error: "room-not-found" });
            return;
          }

          room.addLog(message, Date.now());
          void broadcastRoomAll(state, rid, { type: "Message", message: { type: "Chat", user: 0, content: message } }).catch(() => {});
          logRoomInfo(state.logger, state.serverLang, rid, "log-admin-room-message", { message });
          write(200, { ok: true });
          return;
        }

        // IP黑名单管理接口
        if (req.method === "GET" && url.pathname === "/admin/ip-blacklist") {
          const blacklist = state.logger.getBlacklistedIps();
          write(200, { ok: true, blacklist });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/ip-blacklist/remove") {
          const body = await read();
          const ip = typeof (body as any)?.ip === "string" ? String((body as any).ip).trim() : "";
          if (!ip) {
            write(400, { ok: false, error: "bad-ip" });
            return;
          }
          state.logger.removeFromBlacklist(ip);
          write(200, { ok: true });
          return;
        }

        if (req.method === "POST" && url.pathname === "/admin/ip-blacklist/clear") {
          state.logger.clearBlacklist();
          write(200, { ok: true });
          return;
        }

        if (req.method === "GET" && url.pathname === "/admin/log-rate") {
          const rate = state.logger.getCurrentRate();
          write(200, { ok: true, rate });
          return;
        }

        write(404, { ok: false, error: "not-found" });
        return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(tl(lang, "http-not-found"));
    })().catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      state.logger.error(`HTTP request error: ${err instanceof Error ? err.message : String(err)}`);
      writeJson(res, 500, { ok: false, error: "internal-error" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: opts.host, port: opts.port }, () => resolve());
  });

  // 启动 WebSocket 服务
  const ws = startWebSocketService({ httpServer: server, state });

  const handleGameEndAutoUpload = createAutoUploadHandler(state);

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
    },
    handleGameEndAutoUpload
  };
}

