import type { RequestContext } from "./types.js";

/**
 * 检查 admin 鉴权。未通过时已写出错误响应。返回 true 表示通过。
 * 支持永久 admin token、临时 token（IP 绑定）；失败累积超过阈值会临时封禁 IP。
 */
export function checkAdminAuth(ctx: RequestContext): boolean {
  const { state, services, clientIp, reqAdminToken, write } = ctx;
  const adminToken = state.config.admin_token?.trim() || "";

  // 调试输出（注意：不输出任何 token 内容，仅输出元信息防止泄露）
  state.logger.debug(
    `requireAdmin: ip=${clientIp}, hasReqToken=${Boolean(reqAdminToken)}, hasAdminConfig=${Boolean(adminToken)}, tempTokens=${state.tempAdminTokens.size}`
  );

  if (services.adminBannedIps.has(clientIp)) {
    write(401, { ok: false, error: "unauthorized", message: ctx.t("auth-unauthorized") });
    return false;
  }

  // 检查临时 TOKEN
  ctx.cleanupExpired();
  if (reqAdminToken) {
    const tempTokenData = state.tempAdminTokens.get(reqAdminToken);
    if (tempTokenData) {
      state.logger.debug("Found temp token, checking validity");
      if (tempTokenData.banned) {
        state.logger.debug("Temp token is banned");
        write(401, { ok: false, error: "token-expired", message: ctx.t("token-expired") });
        return false;
      }
      if (Date.now() > tempTokenData.expiresAt) {
        state.logger.debug("Temp token expired");
        state.tempAdminTokens.delete(reqAdminToken);
        write(401, { ok: false, error: "token-expired", message: ctx.t("token-expired") });
        return false;
      }
      // 验证 IP 是否匹配
      if (tempTokenData.ip !== clientIp) {
        state.logger.debug(`IP mismatch: token IP=${tempTokenData.ip}, request IP=${clientIp}`);
        // IP 不匹配，封禁该 TOKEN 但不显式告知
        tempTokenData.banned = true;
        write(401, { ok: false, error: "token-expired", message: ctx.t("token-expired") });
        return false;
      }
      // 临时 TOKEN 验证通过
      state.logger.debug("Temp token validated successfully");
      return true;
    }
    state.logger.debug("Temp token not found in map");
  }

  // 检查永久管理员 TOKEN
  state.logger.debug("Checking permanent admin token");
  if (!adminToken) {
    state.logger.debug("No permanent admin token configured, returning admin-disabled");
    write(403, { ok: false, error: "admin-disabled", message: ctx.t("admin-disabled") });
    return false;
  }
  if (!reqAdminToken || reqAdminToken !== adminToken) {
    const prev = services.adminFailedAttemptsByIp.get(clientIp);
    const next = (prev?.count ?? 0) + 1;
    services.adminFailedAttemptsByIp.set(clientIp, { count: next, lastAttempt: Date.now() });
    if (next >= services.ADMIN_MAX_FAILED_ATTEMPTS_PER_IP) {
      services.adminBannedIps.add(clientIp);
    }
    write(401, { ok: false, error: "unauthorized", message: ctx.t("auth-unauthorized") });
    return false;
  }
  services.adminFailedAttemptsByIp.delete(clientIp);
  return true;
}
