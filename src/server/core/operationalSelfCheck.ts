import type { ServerConfig } from "./types.js";

export type OperationalSelfCheckFinding = {
  key: string;
  message: string;
};

const PLACEHOLDER_SECRET_VALUES = new Set([
  "replace_me",
  "your_token",
  "your_token_here",
  "your_secure_token_here",
  "your_share_station_token_here",
  "test-token",
  "admin",
  "123456"
]);

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (PLACEHOLDER_SECRET_VALUES.has(normalized)) return true;
  return normalized.includes("example") && normalized.includes("token");
}

export function isWeakAdminToken(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (isPlaceholderSecret(normalized)) return true;
  return normalized.length < 16;
}

export function computeOperationalSelfCheckFindings(config: ServerConfig): OperationalSelfCheckFinding[] {
  const findings: OperationalSelfCheckFinding[] = [];

  if (config.http_service === true && (!config.cors_origins || config.cors_origins.length === 0)) {
    findings.push({
      key: "http-cors-open",
      message: "[SelfCheck] HTTP service is running with permissive CORS (*). Set CORS_ORIGINS to trusted admin origins in production."
    });
  }

  if (config.http_service === true && config.allow_token_in_query === true) {
    findings.push({
      key: "admin-token-query-enabled",
      message:
        "[SelfCheck] ALLOW_TOKEN_IN_QUERY=true exposes admin tokens in URLs, browser history, and proxy logs. Keep it disabled unless you have no header-based option."
    });
  }

  if (config.http_service === true) {
    const adminToken = config.admin_token?.trim();
    if (adminToken && isWeakAdminToken(adminToken)) {
      findings.push({
        key: "weak-admin-token",
        message:
          "[SelfCheck] ADMIN_TOKEN looks weak or placeholder-like. Use a long random secret before exposing the admin HTTP service publicly."
      });
    }
  }

  const shareToken = config.share_station?.token?.trim();
  if (shareToken && isPlaceholderSecret(shareToken)) {
    findings.push({
      key: "placeholder-share-station-token",
      message:
        "[SelfCheck] SHARE_STATION.TOKEN still looks like a placeholder value. Replace it before enabling replay uploads in production."
    });
  }

  return findings;
}
