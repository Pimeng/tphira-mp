import http from "node:http";
import type net from "node:net";
import {
  applyCors,
  extractAdminToken,
  getClientIp,
  handleOptionsRequest,
  readJson,
  writeJson
} from "../../common/http.js";
import type { ServerState } from "../core/state.js";
import { Language, tl } from "../utils/l10n.js";

import { createAutoUploadHandler } from "../replay/autoUpload.js";
import type { AutoUploadHandlerWithCleanup } from "../replay/autoUpload.js";
import { startWebSocketService, type WebSocketService } from "./websocketService.js";
import { cleanupExpiringMaps, verifyUserTokenViaApi } from "./httpHelpers.js";
import { checkAdminAuth } from "./routes/auth.js";
import type { RequestContext, ServerServices } from "./routes/types.js";
import { tryHandlePublicRoutes } from "./routes/publicRoutes.js";
import { tryHandleReplayPublicRoutes } from "./routes/replayPublicRoutes.js";
import { tryHandleOtpRoutes } from "./routes/otpRoutes.js";
import { tryHandleAdminConfigRoutes } from "./routes/adminConfigRoutes.js";
import { tryHandleAdminRoomRoutes } from "./routes/adminRoomRoutes.js";
import { tryHandleAdminUserRoutes } from "./routes/adminUserRoutes.js";
import { tryHandleAdminContestRoutes } from "./routes/adminContestRoutes.js";
import { tryHandleAdminLogRoutes } from "./routes/adminLogRoutes.js";

export type HttpService = {
  server: http.Server;
  ws: WebSocketService;
  address: () => net.AddressInfo;
  close: () => Promise<void>;
  /** 处理游戏结束时的自动上传任务 */
  handleGameEndAutoUpload: (userId: number, chartId: number, timestamp: number, recordId: number) => void;
  /** 自动上传清理函数 */
  cleanupAutoUpload: () => void;
};

/** 依次尝试 admin 路由模块，匹配到任何一个就返回 true */
async function tryHandleAdminRoutes(ctx: RequestContext): Promise<boolean> {
  if (await tryHandleAdminConfigRoutes(ctx)) return true;
  if (await tryHandleAdminRoomRoutes(ctx)) return true;
  if (await tryHandleAdminUserRoutes(ctx)) return true;
  if (await tryHandleAdminContestRoutes(ctx)) return true;
  if (await tryHandleAdminLogRoutes(ctx)) return true;
  return false;
}

export async function startHttpService(opts: { state: ServerState; host: string; port: number }): Promise<HttpService> {
  const { state } = opts;

  const services: ServerServices = {
    ADMIN_MAX_FAILED_ATTEMPTS_PER_IP: 5,
    REPLAY_SESSION_TTL_MS: 30 * 60 * 1000,
    OTP_MAX_ATTEMPTS: 3,
    adminFailedAttemptsByIp: new Map(),
    adminBannedIps: new Map(),
    replaySessions: new Map(),
    otpSessions: new Map(),
    otpAttemptsByIp: new Map(),
    otpAttemptsBySsid: new Map(),
    otpBannedIps: new Map(),
    otpBannedSsids: new Map()
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const lang = req.headers["accept-language"]
        ? new Language(String(req.headers["accept-language"]))
        : state.serverLang;
      const url = new URL(req.url ?? "/", "http://localhost");
      const clientIp = getClientIp(req, state.config.real_ip_header || "X-Forwarded-For");

      applyCors(res, req, state.config.cors_origins ?? []);

      if (req.method === "OPTIONS") {
        handleOptionsRequest(res);
        return;
      }

      const reqAdminToken = extractAdminToken(req, url, state.config.allow_token_in_query);

      const ctx: RequestContext = {
        req,
        res,
        url,
        lang,
        clientIp,
        reqAdminToken,
        state,
        services,
        write: (status, body) => writeJson(res, status, body),
        read: () => readJson(req),
        cleanupExpired: () =>
          cleanupExpiringMaps(state.tempAdminTokens, services.otpSessions, state.cliApprovalSessions),
        verifyUserToken: (token) => verifyUserTokenViaApi(state, token),
        requireAdmin: () => checkAdminAuth(ctx),
        t: (key, args) => tl(lang, key, args)
      };

      // 公开路由
      if (await tryHandlePublicRoutes(ctx)) return;
      if (await tryHandleReplayPublicRoutes(ctx)) return;
      if (await tryHandleOtpRoutes(ctx)) return;

      // /admin/* 需要管理员鉴权
      if (url.pathname.startsWith("/admin/")) {
        if (!ctx.requireAdmin()) return;
        if (await tryHandleAdminRoutes(ctx)) return;

        // /admin/* 路径但未匹配任何子路由
        ctx.write(404, { ok: false, error: "not-found", message: ctx.t("http-not-found") });
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
      writeJson(res, 500, { ok: false, error: "internal-error", message: tl(state.serverLang, "http-internal-error") });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: opts.host, port: opts.port }, () => resolve());
  });

  // 启动 WebSocket 服务
  const ws = startWebSocketService({ httpServer: server, state });

  const autoUpload = createAutoUploadHandler(state);

  /** 定期清理 HTTP 尝试计数映射和封禁列表，防止内存泄漏（24 小时未更新则删除） */
  const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
  const BAN_TTL_MS = 24 * 60 * 60 * 1000; // 封禁 IP 24 小时后自动解封
  const cleanupAttempts = (): void => {
    const now = Date.now();
    for (const [ip, entry] of services.adminFailedAttemptsByIp) {
      if (now - entry.lastAttempt > ATTEMPT_TTL_MS) {
        services.adminFailedAttemptsByIp.delete(ip);
      }
    }
    for (const [ip, entry] of services.otpAttemptsByIp) {
      if (now - entry.lastAttempt > ATTEMPT_TTL_MS) {
        services.otpAttemptsByIp.delete(ip);
      }
    }
    for (const [ssid, entry] of services.otpAttemptsBySsid) {
      if (now - entry.lastAttempt > ATTEMPT_TTL_MS) {
        services.otpAttemptsBySsid.delete(ssid);
      }
    }
    // 清理过期的封禁 IP 和 SSID（24 小时后自动解封）
    for (const [ip, bannedAt] of services.adminBannedIps) {
      if (now - bannedAt > BAN_TTL_MS) {
        services.adminBannedIps.delete(ip);
      }
    }
    for (const [ip, bannedAt] of services.otpBannedIps) {
      if (now - bannedAt > BAN_TTL_MS) {
        services.otpBannedIps.delete(ip);
      }
    }
    for (const [ssid, bannedAt] of services.otpBannedSsids) {
      if (now - bannedAt > BAN_TTL_MS) {
        services.otpBannedSsids.delete(ssid);
      }
    }
  };
  const cleanupAttemptsTimer = setInterval(cleanupAttempts, 60 * 60 * 1000);

  return {
    server,
    ws,
    address: () => server.address() as net.AddressInfo,
    close: async () => {
      clearInterval(cleanupAttemptsTimer);
      autoUpload.close();
      await ws.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    handleGameEndAutoUpload: autoUpload.handler,
    cleanupAutoUpload: autoUpload.close
  };
}
