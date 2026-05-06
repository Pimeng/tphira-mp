import type http from "node:http";
import type { ServerState } from "../../core/state.js";
import type { Language } from "../../utils/l10n.js";

/** Per-server 状态：HTTP 服务级别的会话/封禁映射 */
export type ServerServices = {
  readonly ADMIN_MAX_FAILED_ATTEMPTS_PER_IP: number;
  readonly REPLAY_SESSION_TTL_MS: number;
  readonly OTP_MAX_ATTEMPTS: number;

  adminFailedAttemptsByIp: Map<string, number>;
  adminBannedIps: Set<string>;

  replaySessions: Map<string, { userId: number; expiresAt: number }>;

  otpSessions: Map<string, { otp: string; expiresAt: number }>;
  otpAttemptsByIp: Map<string, number>;
  otpAttemptsBySsid: Map<string, number>;
  otpBannedIps: Set<string>;
  otpBannedSsids: Set<string>;
};

/** Per-request 上下文 */
export type RequestContext = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  lang: Language;
  clientIp: string;
  reqAdminToken: string;
  state: ServerState;
  services: ServerServices;
  /** 写入 JSON 响应 */
  write: (status: number, body: unknown) => void;
  /** 读取 JSON 请求体 */
  read: () => Promise<unknown>;
  /** 清理过期 token/OTP */
  cleanupExpired: () => void;
  /** 验证用户 token，返回 userId 或 null */
  verifyUserToken: (token: string) => Promise<number | null>;
  /** 验证管理员权限，未通过会自动写出错误响应 */
  requireAdmin: () => boolean;
};
