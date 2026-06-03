import { OTP_TTL_MS, TEMP_TOKEN_TTL_MS } from "../../core/state.js";
import { newUuid } from "../../../common/uuid.js";
import type { RequestContext } from "./types.js";

/**
 * 处理 OTP / CLI 提权相关路由
 */
export async function tryHandleOtpRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, url, state, services, clientIp, write, read, cleanupExpired } = ctx;
  const { otpSessions, otpAttemptsByIp, otpAttemptsBySsid, otpBannedIps, otpBannedSsids, OTP_MAX_ATTEMPTS } = services;

  if (req.method === "POST" && url.pathname === "/admin/otp/request") {
    const adminToken = state.config.admin_token?.trim() || "";
    if (adminToken) {
      write(403, {
        ok: false,
        error: "otp-disabled-when-token-configured",
        message: ctx.t("otp-disabled-when-token-configured")
      });
      return true;
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
      return true;
    }

    // 默认 OTP 模式
    const otp = newUuid().slice(0, 8); // 8 位验证码
    otpSessions.set(ssid, { otp, expiresAt });

    // 输出到终端（INFO 级别，强制输出，不写入文件）
    const message = `[OTP Request] 您正在尝试请求验证码登录管理员后台 API，本次请求的验证码是 ${otp}，会话ID: ${ssid}, 1分钟内有效`;
    process.stdout.write(`\x1b[32m[${new Date().toISOString()}] [INFO] ${message}\x1b[0m\n`);

    write(200, { ok: true, ssid, expiresIn: OTP_TTL_MS, mode: "otp" });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/otp/verify") {
    const adminToken = state.config.admin_token?.trim() || "";
    if (adminToken) {
      write(403, { ok: false, error: "otp-disabled-when-token-configured" });
      return true;
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
      write(400, { ok: false, error: "bad-request", message: ctx.t("bad-request") });
      return true;
    }

    cleanupExpired();

    // CLI 批准模式：检查批准状态并返回 token（如果已批准）
    if (mode === "cli") {
      const session = state.cliApprovalSessions.get(ssid);
      if (!session || Date.now() > session.expiresAt) {
        state.cliApprovalSessions.delete(ssid);
        write(401, { ok: false, error: "invalid-or-expired-session", message: ctx.t("invalid-or-expired-session") });
        return true;
      }
      // 仅允许同 IP 轮询
      if (session.ip !== clientIp) {
        write(403, { ok: false, error: "ip-mismatch", message: ctx.t("ip-mismatch") });
        return true;
      }
      if (session.status === "pending") {
        write(202, { ok: false, error: "pending-approval", status: "pending", message: ctx.t("pending-approval") });
        return true;
      }
      if (session.status === "denied") {
        state.cliApprovalSessions.delete(ssid);
        write(403, { ok: false, error: "approval-denied", status: "denied", message: ctx.t("approval-denied") });
        return true;
      }
      // approved
      const token = session.token;
      const tokenExpiresAt = session.tokenExpiresAt;
      if (!token || !tokenExpiresAt) {
        // 状态异常，清理后报错
        state.cliApprovalSessions.delete(ssid);
        write(500, { ok: false, error: "token-not-issued", message: ctx.t("token-not-issued") });
        return true;
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
      return true;
    }

    // 默认 OTP 验证模式
    const otp = typeof raw.otp === "string" ? raw.otp.trim() : "";
    if (!otp) {
      write(400, { ok: false, error: "bad-request", message: ctx.t("bad-request") });
      return true;
    }

    // 检查 IP 和 SSID 是否已被封禁
    if (otpBannedIps.has(clientIp)) {
      write(403, { ok: false, error: "ip-banned-too-many-attempts", message: ctx.t("ip-banned-too-many-attempts") });
      return true;
    }
    if (otpBannedSsids.has(ssid)) {
      write(403, {
        ok: false,
        error: "ssid-banned-too-many-attempts",
        message: ctx.t("ssid-banned-too-many-attempts")
      });
      return true;
    }

    const otpData = otpSessions.get(ssid);
    if (!otpData || Date.now() > otpData.expiresAt) {
      write(401, { ok: false, error: "invalid-or-expired-otp", message: ctx.t("invalid-or-expired-otp") });
      return true;
    }

    if (otpData.otp !== otp) {
      // 记录失败尝试
      const prevIp = otpAttemptsByIp.get(clientIp);
      const prevSsid = otpAttemptsBySsid.get(ssid);
      const ipAttempts = (prevIp?.count ?? 0) + 1;
      const ssidAttempts = (prevSsid?.count ?? 0) + 1;

      otpAttemptsByIp.set(clientIp, { count: ipAttempts, lastAttempt: Date.now() });
      otpAttemptsBySsid.set(ssid, { count: ssidAttempts, lastAttempt: Date.now() });

      // 检查是否超过最大尝试次数
      if (ipAttempts >= OTP_MAX_ATTEMPTS) {
        otpBannedIps.set(clientIp, Date.now());
        const message = `[OTP] IP ${clientIp} 因OTP验证失败次数过多（${ipAttempts}次）已被封禁`;
        process.stdout.write(`\x1b[31m[${new Date().toISOString()}] [WARN] ${message}\x1b[0m\n`);
      }
      if (ssidAttempts >= OTP_MAX_ATTEMPTS) {
        otpBannedSsids.set(ssid, Date.now());
        otpSessions.delete(ssid); // 删除被封禁的会话
        const message = `[OTP] 会话 ${ssid} 因OTP验证失败次数过多（${ssidAttempts}次）已被封禁`;
        process.stdout.write(`\x1b[31m[${new Date().toISOString()}] [WARN] ${message}\x1b[0m\n`);
      }

      write(401, { ok: false, error: "invalid-or-expired-otp", message: ctx.t("invalid-or-expired-otp") });
      return true;
    }

    // 验证成功，清除尝试记录
    otpAttemptsByIp.delete(clientIp);
    otpAttemptsBySsid.delete(ssid);

    // 验证成功，生成临时 TOKEN
    const tempToken = newUuid();
    const expiresAt = Date.now() + TEMP_TOKEN_TTL_MS;
    state.tempAdminTokens.set(tempToken, { ip: clientIp, expiresAt, banned: false });
    otpSessions.delete(ssid); // 删除已使用的 OTP

    // 输出到终端
    const message = `[OTP] 临时管理员TOKEN已生成，生成时使用IP: ${clientIp}，临时Token: ${tempToken.slice(0, 8)}..., 此Token将在4小时内有效`;
    process.stdout.write(`\x1b[32m[${new Date().toISOString()}] [INFO] ${message}\x1b[0m\n`);

    write(200, { ok: true, token: tempToken, expiresAt, expiresIn: TEMP_TOKEN_TTL_MS });
    return true;
  }

  return false;
}
