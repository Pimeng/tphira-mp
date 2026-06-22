import { describe, expect, it } from "vitest";
import {
  computeOperationalSelfCheckFindings,
  isWeakAdminToken
} from "../../src/server/core/operationalSelfCheck.js";

describe("operationalSelfCheck", () => {
  it("识别生产环境高风险配置", () => {
    const findings = computeOperationalSelfCheckFindings({
      monitors: [2],
      http_service: true,
      allow_token_in_query: true,
      admin_token: "test-token",
      share_station: { url: "http://127.0.0.1:40004", token: "your_share_station_token_here" }
    });

    expect(findings.map((finding) => finding.key)).toEqual([
      "http-cors-open",
      "admin-token-query-enabled",
      "weak-admin-token",
      "placeholder-share-station-token"
    ]);
  });

  it("安全配置不产生告警", () => {
    const findings = computeOperationalSelfCheckFindings({
      monitors: [2],
      http_service: true,
      cors_origins: ["https://admin.example.com"],
      admin_token: "4d8cf0506db84f0bb4c702dc71f82ca8",
      allow_token_in_query: false,
      share_station: { url: "http://127.0.0.1:40004", token: "share-station-secret-42" }
    });

    expect(findings).toEqual([]);
  });

  it("弱管理员令牌检测覆盖占位值与短值", () => {
    expect(isWeakAdminToken("replace_me")).toBe(true);
    expect(isWeakAdminToken("short-secret")).toBe(true);
    expect(isWeakAdminToken("0123456789abcdef0123456789abcdef")).toBe(false);
  });
});
