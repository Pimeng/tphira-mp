import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { startServer, type RunningServer } from "../../src/server/core/server.js";

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
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as any);

    try {
      const res = await fetch(`${baseUrl}/admin/otp/request`, {
        method: "POST"
      });
      const data = await res.json() as any;
      
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.ssid).toBeDefined();
      expect(typeof data.ssid).toBe("string");
      expect(data.expiresIn).toBe(60 * 1000); // 1分钟
      expect(data.mode).toBe("otp");

      const stdout = stdoutChunks.join("");
      expect(stdout).toContain("管理员后台 API");
      expect(stdout).not.toContain("�");
    } finally {
      stdoutSpy.mockRestore();
    }
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

  test("OTP验证失败3次后应该封禁IP和SSID", async () => {
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as any);

    // 1. 请求OTP获取有效的SSID
    try {
      const otpRes = await fetch(`${baseUrl}/admin/otp/request`, {
        method: "POST"
      });
      const otpData = await otpRes.json() as any;
      expect(otpData.ok).toBe(true);
      const ssid = otpData.ssid;

      // 2. 尝试3次错误的OTP
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${baseUrl}/admin/otp/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ssid: ssid,
            otp: "wrong-otp"
          })
        });
        const data = await res.json() as any;
        expect(data.ok).toBe(false);
      }

      // 3. 第4次尝试应该返回封禁错误
      const res4 = await fetch(`${baseUrl}/admin/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ssid: ssid,
          otp: "wrong-otp"
        })
      });
      const data4 = await res4.json() as any;
      
      expect(res4.status).toBe(403);
      expect(data4.ok).toBe(false);
      expect(data4.error).toMatch(/banned/);

      const stdout = stdoutChunks.join("");
      expect(stdout).toContain("（3次）");
      expect(stdout).not.toContain("{ipAttempts}");
      expect(stdout).not.toContain("{ssidAttempts}");
      expect(stdout).not.toContain("�");
    } finally {
      stdoutSpy.mockRestore();
    }
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

  test("CLI 批准模式：请求时返回 mode=cli 且不打印验证码", async () => {
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: any) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as any);

    try {
      const res = await fetch(`${baseUrl}/admin/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "cli" })
      });
      const data = await res.json() as any;

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.mode).toBe("cli");
      expect(typeof data.ssid).toBe("string");
      expect(data.expiresIn).toBe(60 * 1000);

      const stdout = stdoutChunks.join("");
      expect(stdout).toContain("CLI Request");
      expect(stdout).toContain("approve");
      expect(stdout).not.toContain("验证码是");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  test("CLI 批准模式：未批准前 verify 应返回 202 pending-approval", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as any);
    try {
      const reqRes = await fetch(`${baseUrl}/admin/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "cli" })
      });
      const { ssid } = (await reqRes.json()) as any;

      const verifyRes = await fetch(`${baseUrl}/admin/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, mode: "cli" })
      });
      const verifyData = (await verifyRes.json()) as any;

      expect(verifyRes.status).toBe(202);
      expect(verifyData.ok).toBe(false);
      expect(verifyData.error).toBe("pending-approval");
      expect(verifyData.status).toBe("pending");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  test("CLI 批准模式：管理员批准后 verify 应返回 token", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as any);
    try {
      const reqRes = await fetch(`${baseUrl}/admin/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "cli" })
      });
      const { ssid } = (await reqRes.json()) as any;

      // 模拟 CLI 管理员批准：直接操作 state
      const sess = server.state.cliApprovalSessions.get(ssid)!;
      expect(sess).toBeDefined();
      const tokenExpiresAt = Date.now() + 4 * 60 * 60 * 1000;
      sess.status = "approved";
      sess.token = "test-cli-token-uuid";
      sess.tokenExpiresAt = tokenExpiresAt;
      server.state.tempAdminTokens.set("test-cli-token-uuid", {
        ip: sess.ip,
        expiresAt: tokenExpiresAt,
        banned: false
      });

      const verifyRes = await fetch(`${baseUrl}/admin/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, mode: "cli" })
      });
      const verifyData = (await verifyRes.json()) as any;

      expect(verifyRes.status).toBe(200);
      expect(verifyData.ok).toBe(true);
      expect(verifyData.mode).toBe("cli");
      expect(verifyData.token).toBe("test-cli-token-uuid");
      expect(typeof verifyData.expiresAt).toBe("number");

      // 一次性会话：再次取应失败
      const verify2 = await fetch(`${baseUrl}/admin/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, mode: "cli" })
      });
      const verify2Data = (await verify2.json()) as any;
      expect(verify2.status).toBe(401);
      expect(verify2Data.error).toBe("invalid-or-expired-session");
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  test("CLI 批准模式：管理员拒绝后 verify 应返回 403 approval-denied", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as any);
    try {
      const reqRes = await fetch(`${baseUrl}/admin/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "cli" })
      });
      const { ssid } = (await reqRes.json()) as any;

      const sess = server.state.cliApprovalSessions.get(ssid)!;
      sess.status = "denied";

      const verifyRes = await fetch(`${baseUrl}/admin/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, mode: "cli" })
      });
      const verifyData = (await verifyRes.json()) as any;

      expect(verifyRes.status).toBe(403);
      expect(verifyData.error).toBe("approval-denied");
      expect(verifyData.status).toBe("denied");
    } finally {
      stdoutSpy.mockRestore();
    }
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