import { TEMP_TOKEN_TTL_MS } from "../../core/state.js";
import { newUuid } from "../../../common/uuid.js";
import type { CommandCtx } from "./types.js";

/** 通过完整 ssid 或前缀短码，唯一定位一个 CLI 提权会话；歧义时返回 "ambiguous"。 */
function findApprovalSsid(ctx: CommandCtx, input: string): string | "ambiguous" | null {
  const sessions = ctx.state.cliApprovalSessions;
  if (sessions.has(input)) return input;
  let found: string | null = null;
  for (const ssid of sessions.keys()) {
    if (ssid.startsWith(input)) {
      if (found !== null) return "ambiguous";
      found = ssid;
    }
  }
  return found;
}

export async function handleApprove(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    logger,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-approve"));
    return;
  }
  const input = args[0]!.trim();
  if (!input) {
    printError(t("cli-usage-approve"));
    return;
  }

  const result = findApprovalSsid(ctx, input);
  if (result === "ambiguous") {
    printError(t("cli-approve-ambiguous", { input }));
    return;
  }
  if (!result) {
    printError(t("cli-approve-not-found", { input }));
    return;
  }

  const session = state.cliApprovalSessions.get(result)!;
  if (Date.now() > session.expiresAt) {
    state.cliApprovalSessions.delete(result);
    printError(t("cli-approve-expired", { ssid: result.slice(0, 8) }));
    return;
  }
  if (session.status !== "pending") {
    printError(t("cli-approve-already-handled", { ssid: result.slice(0, 8), status: session.status }));
    return;
  }

  // 生成临时 TOKEN，并放入 tempAdminTokens（与 OTP 流程产物一致）
  const token = newUuid();
  const tokenExpiresAt = Date.now() + TEMP_TOKEN_TTL_MS;
  state.tempAdminTokens.set(token, { ip: session.ip, expiresAt: tokenExpiresAt, banned: false });

  session.status = "approved";
  session.token = token;
  session.tokenExpiresAt = tokenExpiresAt;

  logger.info(
    `[OTP CLI Approve] 会话 ${result.slice(0, 8)} 已批准，签发临时TOKEN ${token.slice(0, 8)}... (IP: ${session.ip})`
  );
  printSuccess(t("cli-approve-success", { ssid: result.slice(0, 8), ip: session.ip }));
}

export async function handleDeny(ctx: CommandCtx, args: string[]): Promise<void> {
  const {
    state,
    logger,
    t,
    printer: { printError, printSuccess }
  } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-deny"));
    return;
  }
  const input = args[0]!.trim();
  if (!input) {
    printError(t("cli-usage-deny"));
    return;
  }

  const result = findApprovalSsid(ctx, input);
  if (result === "ambiguous") {
    printError(t("cli-approve-ambiguous", { input }));
    return;
  }
  if (!result) {
    printError(t("cli-approve-not-found", { input }));
    return;
  }

  const session = state.cliApprovalSessions.get(result)!;
  if (session.status !== "pending") {
    printError(t("cli-approve-already-handled", { ssid: result.slice(0, 8), status: session.status }));
    return;
  }

  session.status = "denied";
  logger.info(`[OTP CLI Deny] 会话 ${result.slice(0, 8)} 已被拒绝 (IP: ${session.ip})`);
  printSuccess(t("cli-deny-success", { ssid: result.slice(0, 8), ip: session.ip }));
}

export async function handlePending(ctx: CommandCtx): Promise<void> {
  const {
    state,
    t,
    printer: { print, printInfo }
  } = ctx;
  const now = Date.now();
  // 顺便清理过期项
  for (const [ssid, sess] of state.cliApprovalSessions) {
    if (now > sess.expiresAt) state.cliApprovalSessions.delete(ssid);
  }

  const items = [...state.cliApprovalSessions.entries()]
    .filter(([, s]) => s.status === "pending")
    .map(([ssid, s]) => ({
      ssid,
      ip: s.ip,
      remainingSec: Math.max(0, Math.ceil((s.expiresAt - now) / 1000))
    }));

  if (items.length === 0) {
    printInfo(t("cli-pending-empty"));
    return;
  }

  print("");
  print(t("cli-pending-header", { count: items.length }));
  for (const it of items) {
    print(t("cli-pending-line", { ssid: it.ssid.slice(0, 8), full: it.ssid, ip: it.ip, seconds: it.remainingSec }));
  }
  print("");
}
