// 认证和授权相关的工具函数

import { newUuid } from "../../common/uuid.js";
import { cleanupExpiredSessions } from "../../common/utils.js";
import type { ServerState } from "../core/state.js";
import { debugLog, infoLog, warnLog } from "../utils/logUtils.js";

/**
 * 临时管理员 Token 数据
 */
export interface TempAdminToken {
  ip: string;
  expiresAt: number;
  banned: boolean;
}

/**
 * OTP 会话数据
 */
export interface OtpSession {
  otp: string;
  expiresAt: number;
}

/**
 * 管理员认证管理器
 */
export class AdminAuthManager {
  private readonly maxFailedAttempts: number = 5;
  private readonly failedAttemptsByIp = new Map<string, number>();
  private readonly bannedIps = new Set<string>();

  /**
   * 检查 IP 是否被封禁
   */
  isIpBanned(ip: string): boolean {
    return this.bannedIps.has(ip);
  }

  /**
   * 记录失败的认证尝试
   * @returns 是否已被封禁
   */
  recordFailedAttempt(ip: string): boolean {
    const attempts = (this.failedAttemptsByIp.get(ip) ?? 0) + 1;
    this.failedAttemptsByIp.set(ip, attempts);
    
    if (attempts >= this.maxFailedAttempts) {
      this.bannedIps.add(ip);
      return true;
    }
    return false;
  }

  /**
   * 清除 IP 的失败尝试记录
   */
  clearFailedAttempts(ip: string): void {
    this.failedAttemptsByIp.delete(ip);
  }

  /**
   * 验证管理员权限
   * @param reqToken 请求中的 token
   * @param adminToken 配置的管理员 token
   * @param ip 客户端 IP
   * @param state 服务器状态
   * @returns 是否验证通过
   */
  validateAdmin(
    reqToken: string,
    adminToken: string,
    ip: string,
    state: ServerState
  ): { valid: boolean; error?: string } {
    debugLog("requireAdmin called", {
      ip,
      reqToken: reqToken ? `${reqToken.slice(0, 8)}...` : "(empty)",
      adminToken: adminToken ? `${adminToken.slice(0, 8)}...` : "(empty)",
      tempTokensCount: state.tempAdminTokens.size,
      hasTempToken: reqToken ? state.tempAdminTokens.has(reqToken) : false
    });

    // 检查 IP 是否被封禁
    if (this.isIpBanned(ip)) {
      return { valid: false, error: "unauthorized" };
    }

    // 清理过期的临时 token
    cleanupExpiredSessions(state.tempAdminTokens);

    // 检查临时 token
    if (reqToken) {
      const tempTokenData = state.tempAdminTokens.get(reqToken);
      if (tempTokenData) {
        debugLog("Found temp token, checking validity");
        
        if (tempTokenData.banned) {
          debugLog("Temp token is banned");
          return { valid: false, error: "token-expired" };
        }
        
        if (Date.now() > tempTokenData.expiresAt) {
          debugLog("Temp token expired");
          state.tempAdminTokens.delete(reqToken);
          return { valid: false, error: "token-expired" };
        }
        
        // 验证 IP 是否匹配
        if (tempTokenData.ip !== ip) {
          debugLog("IP mismatch", {
            tokenIp: tempTokenData.ip,
            requestIp: ip
          });
          // IP 不匹配，封禁该 token
          tempTokenData.banned = true;
          return { valid: false, error: "token-expired" };
        }
        
        debugLog("Temp token validated successfully");
        return { valid: true };
      } else {
        debugLog("Temp token not found in map");
      }
    }

    // 检查永久管理员 token
    debugLog("Checking permanent admin token");
    if (!adminToken) {
      debugLog("No permanent admin token configured");
      return { valid: false, error: "admin-disabled" };
    }

    if (!reqToken || reqToken !== adminToken) {
      const banned = this.recordFailedAttempt(ip);
      if (banned) {
        warnLog(`IP ${ip} banned due to too many failed admin auth attempts`);
      }
      return { valid: false, error: "unauthorized" };
    }

    this.clearFailedAttempts(ip);
    return { valid: true };
  }
}

/**
 * OTP 认证管理器
 */
export class OtpAuthManager {
  private readonly maxAttempts: number = 3;
  private readonly attemptsByIp = new Map<string, number>();
  private readonly attemptsBySsid = new Map<string, number>();
  private readonly bannedIps = new Set<string>();
  private readonly bannedSsids = new Set<string>();

  /**
   * 检查 IP 是否被封禁
   */
  isIpBanned(ip: string): boolean {
    return this.bannedIps.has(ip);
  }

  /**
   * 检查会话 ID 是否被封禁
   */
  isSsidBanned(ssid: string): boolean {
    return this.bannedSsids.has(ssid);
  }

  /**
   * 记录失败的 OTP 验证尝试
   * @returns 封禁信息 { ipBanned, ssidBanned }
   */
  recordFailedAttempt(ip: string, ssid: string): { ipBanned: boolean; ssidBanned: boolean } {
    const ipAttempts = (this.attemptsByIp.get(ip) || 0) + 1;
    const ssidAttempts = (this.attemptsBySsid.get(ssid) || 0) + 1;
    
    this.attemptsByIp.set(ip, ipAttempts);
    this.attemptsBySsid.set(ssid, ssidAttempts);

    let ipBanned = false;
    let ssidBanned = false;

    if (ipAttempts >= this.maxAttempts) {
      this.bannedIps.add(ip);
      ipBanned = true;
      warnLog(`IP ${ip} banned due to too many OTP verification failures (${ipAttempts} attempts)`);
    }

    if (ssidAttempts >= this.maxAttempts) {
      this.bannedSsids.add(ssid);
      ssidBanned = true;
      warnLog(`Session ${ssid} banned due to too many OTP verification failures (${ssidAttempts} attempts)`);
    }

    return { ipBanned, ssidBanned };
  }

  /**
   * 清除尝试记录
   */
  clearAttempts(ip: string, ssid: string): void {
    this.attemptsByIp.delete(ip);
    this.attemptsBySsid.delete(ssid);
  }

  /**
   * 生成 OTP 验证码
   */
  generateOtp(): string {
    return newUuid().slice(0, 8);
  }

  /**
   * 创建 OTP 会话
   * @param ttlMs 有效期（毫秒）
   */
  createOtpSession(ttlMs: number): { ssid: string; otp: string; expiresAt: number } {
    const ssid = newUuid();
    const otp = this.generateOtp();
    const expiresAt = Date.now() + ttlMs;
    
    infoLog(`[OTP Request] 验证码: ${otp}, 会话ID: ${ssid}, ${Math.floor(ttlMs / 1000 / 60)}分钟内有效`);
    
    return { ssid, otp, expiresAt };
  }

  /**
   * 验证 OTP
   * @param otpSessions OTP 会话 Map
   * @param ssid 会话 ID
   * @param otp 用户提供的 OTP
   * @param ip 客户端 IP
   * @returns 验证结果
   */
  verifyOtp(
    otpSessions: Map<string, OtpSession>,
    ssid: string,
    otp: string,
    ip: string
  ): { valid: boolean; error?: string } {
    // 检查封禁状态
    if (this.isIpBanned(ip)) {
      return { valid: false, error: "ip-banned-too-many-attempts" };
    }
    if (this.isSsidBanned(ssid)) {
      return { valid: false, error: "ssid-banned-too-many-attempts" };
    }

    // 清理过期会话
    cleanupExpiredSessions(otpSessions);

    // 检查会话是否存在
    const otpData = otpSessions.get(ssid);
    if (!otpData || Date.now() > otpData.expiresAt) {
      return { valid: false, error: "invalid-or-expired-otp" };
    }

    // 验证 OTP
    if (otpData.otp !== otp) {
      const { ipBanned, ssidBanned } = this.recordFailedAttempt(ip, ssid);
      
      // 如果会话被封禁，删除会话
      if (ssidBanned) {
        otpSessions.delete(ssid);
      }
      
      return { valid: false, error: "invalid-or-expired-otp" };
    }

    // 验证成功，清除尝试记录
    this.clearAttempts(ip, ssid);
    return { valid: true };
  }

  /**
   * 生成临时管理员 token
   * @param ip 客户端 IP
   * @param ttlMs 有效期（毫秒）
   */
  generateTempToken(ip: string, ttlMs: number): { token: string; expiresAt: number } {
    const token = newUuid();
    const expiresAt = Date.now() + ttlMs;
    
    infoLog(`[OTP] 临时管理员TOKEN已生成，IP: ${ip}，Token: ${token.slice(0, 8)}...，${Math.floor(ttlMs / 1000 / 60 / 60)}小时内有效`);
    
    return { token, expiresAt };
  }
}
