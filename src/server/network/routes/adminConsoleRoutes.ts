import type { RequestContext } from "./types.js";

/** GUI 控制台单条命令的最大长度 */
const MAX_COMMAND_LENGTH = 500;

/**
 * 处理 GUI 控制台路由：
 * - GET  /admin/console/logs    最近的控制台日志（WebSocket 不可用时的回填/轮询回退）
 * - POST /admin/console/command 执行一条 CLI 命令并返回捕获的输出
 * 仅管理员可访问。
 */
export async function tryHandleAdminConsoleRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, url, state, write, read } = ctx;

  if (req.method === "GET" && url.pathname === "/admin/console/logs") {
    const rawLimit = Number(url.searchParams.get("limit") ?? "200");
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;
    write(200, { ok: true, lines: state.consoleHub.getRecent(limit) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/console/command") {
    const body = await read();
    const raw = (body ?? {}) as { command?: unknown };
    const command = typeof raw.command === "string" ? raw.command.trim() : "";
    if (!command) {
      write(400, { ok: false, error: "bad-command" });
      return true;
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      write(400, { ok: false, error: "command-too-long" });
      return true;
    }

    const executor = state.consoleExecutor;
    if (!executor) {
      // CLI 尚未完成启动注册（仅启动早期的极短窗口）
      write(503, { ok: false, error: "console-not-ready" });
      return true;
    }

    try {
      const lines = await executor(command);
      write(200, { ok: true, lines });
    } catch (e) {
      write(500, {
        ok: false,
        error: "command-failed",
        message: e instanceof Error ? e.message : String(e)
      });
    }
    return true;
  }

  return false;
}
