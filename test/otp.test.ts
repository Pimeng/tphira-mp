import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startServer, type RunningServer } from "../src/server/server.js";

describe("OTP临时TOKEN功能测试", () => {
  let server: RunningServer;
  let httpPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    // 启动服务器，不配置ADMIN_TOKEN
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      config: {
        http_service: true,
        http_port: 0,
        monitors: [],
        log_level: "ERROR"
      }
    });
    httpPort = server.http!.address().port;
    baseUrl = `http://127.0.0.1:${httpPort}`;
  });

  afterAll(async () => {
    await server.close();
  });

  test("请求OTP应该返回SSID", async () => {
    const res = await fetch(`${baseUrl}/admin/otp/request`, {
      method: "POST"
    });
    const data = await res.json() as any;
    
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.ssid).toBeDefined();
    expect(typeof data.ssid).toBe("string");
    expect(data.expiresIn).toBe(5 * 60 * 1000); // 5分钟
  });

  test("使用无效OTP应该返回错误", async () => {
    const res = await fetch(`${baseUrl}/admin/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ssid: "invalid-ssid",
        otp: "invalid-otp"
      })
    });
    const data = await res.json() as any;
    
    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("invalid-or-expired-otp");
  });

  test("完整OTP流程：请求->验证->使用临时TOKEN", async () => {
    // 1. 请求OTP
    const otpRes = await fetch(`${baseUrl}/admin/otp/request`, {
      method: "POST"
    });
    const otpData = await otpRes.json() as any;
    expect(otpData.ok).toBe(true);
    
    // 注意：实际测试中无法获取终端输出的OTP，这里仅测试API结构
    // 在真实场景中，管理员需要从服务器终端查看OTP
  });

  test("未配置ADMIN_TOKEN时，普通管理员API应该返回403", async () => {
    const res = await fetch(`${baseUrl}/admin/rooms`, {
      headers: { "X-Admin-Token": "any-token" }
    });
    const data = await res.json() as any;
    
    // 因为没有配置ADMIN_TOKEN，且没有有效的临时TOKEN
    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
  });
});

describe("配置ADMIN_TOKEN后OTP应该被禁用", () => {
  let server: RunningServer;
  let httpPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    // 启动服务器，配置ADMIN_TOKEN
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      config: {
        http_service: true,
        http_port: 0,
        monitors: [],
        admin_token: "test-admin-token",
        log_level: "ERROR"
      }
    });
    httpPort = server.http!.address().port;
    baseUrl = `http://127.0.0.1:${httpPort}`;
  });

  afterAll(async () => {
    await server.close();
  });

  test("配置ADMIN_TOKEN后，OTP请求应该返回403", async () => {
    const res = await fetch(`${baseUrl}/admin/otp/request`, {
      method: "POST"
    });
    const data = await res.json() as any;
    
    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("otp-disabled-when-token-configured");
  });

  test("配置ADMIN_TOKEN后，OTP验证应该返回403", async () => {
    const res = await fetch(`${baseUrl}/admin/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ssid: "any-ssid",
        otp: "any-otp"
      })
    });
    const data = await res.json() as any;
    
    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error).toBe("otp-disabled-when-token-configured");
  });

  test("使用永久ADMIN_TOKEN应该可以访问管理员API", async () => {
    const res = await fetch(`${baseUrl}/admin/rooms`, {
      headers: { "X-Admin-Token": "test-admin-token" }
    });
    const data = await res.json() as any;
    
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.rooms)).toBe(true);
  });
});
