import type { RequestContext } from "./types.js";

/**
 * 收集并返回服务器性能与业务监控指标。
 * 仅管理员可访问。
 */
export async function tryHandleAdminMetricsRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, url, state, services, write } = ctx;

  if (req.method !== "GET" || url.pathname !== "/admin/metrics") {
    return false;
  }

  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const stats = services.processStats;
  // ?history=1 时附带 CPU/内存历史采样（GUI 图表回填用）
  const includeHistory = url.searchParams.get("history") === "1";

  // 业务指标
  const activeSessions = state.sessions.size;
  const onlineUsers = state.users.size;
  const activeRooms = state.rooms.size;
  const wsConnections = state.wsService?.clients.size ?? 0;

  // 封禁统计
  const serverBannedUsers = state.bannedUsers.size;
  const roomBannedUsers = (() => {
    let count = 0;
    for (const set of state.bannedRoomUsers.values()) {
      count += set.size;
    }
    return count;
  })();

  write(200, {
    ok: true,
    timestamp: Date.now(),
    server: {
      name: state.serverName,
      version: state.version
    },
    process: {
      pid: process.pid,
      uptime,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      systemTotal: stats.systemTotalMem()
    },
    cpu: {
      percent: stats.current()?.cpuPercent ?? 0,
      cores: stats.cpuCount()
    },
    ...(includeHistory ? { history: stats.history() } : {}),
    business: {
      activeSessions,
      onlineUsers,
      activeRooms,
      wsConnections,
      serverBannedUsers,
      roomBannedUsers,
      tempAdminTokens: state.tempAdminTokens.size,
      replayEnabled: state.replayEnabled,
      roomCreationEnabled: state.roomCreationEnabled
    }
  });
  return true;
}
