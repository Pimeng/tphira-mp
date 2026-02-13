import type http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ServerState } from "./state.js";
import type { RoomId } from "../common/roomId.js";
import { roomIdToString, parseRoomId } from "../common/roomId.js";
import { tl } from "./l10n.js";

export type WebSocketClient = {
  ws: WebSocket;
  roomId: RoomId | null;
  userId: number | null;
  isAlive: boolean;
  isAdmin: boolean;
  adminToken: string | null;
  lastAdminSnapshot: string | null; // 用于比较变化
  clientIp: string; // 客户端 IP 地址
};

export type WebSocketService = {
  wss: WebSocketServer;
  clients: Map<WebSocket, WebSocketClient>;
  broadcastRoomUpdate: (roomId: RoomId) => Promise<void>;
  broadcastRoomLog: (message: string, timestamp: Date) => Promise<void>;
  broadcastAdminUpdate: () => Promise<void>;
  close: () => Promise<void>;
};

export type WebSocketMessage =
  | { type: "subscribe"; roomId: string; userId?: number }
  | { type: "unsubscribe" }
  | { type: "ping" }
  | { type: "admin_subscribe"; token: string }
  | { type: "admin_unsubscribe" };

export type WebSocketResponse =
  | { type: "error"; message: string }
  | { type: "subscribed"; roomId: string }
  | { type: "unsubscribed" }
  | { type: "pong" }
  | { type: "room_update"; data: RoomUpdateData }
  | { type: "room_log"; data: { message: string; timestamp: number } }
  | { type: "admin_subscribed" }
  | { type: "admin_unsubscribed" }
  | { type: "admin_update"; data: AdminUpdateData };

export type RoomUpdateData = {
  roomid: string;
  state: "select_chart" | "waiting_for_ready" | "playing";
  locked: boolean;
  cycle: boolean;
  live: boolean;
  chart: { name: string; id: number } | null;
  host: { id: number; name: string };
  users: Array<{ id: number; name: string; is_ready: boolean }>;
  monitors: Array<{ id: number; name: string }>;
};

export type AdminUpdateData = {
  timestamp: number;
  changes: {
    rooms?: AdminRoomData[];
    total_rooms?: number;
  };
};

export type AdminRoomData = {
  roomid: string;
  max_users: number;
  current_users: number;
  current_monitors: number;
  replay_eligible: boolean;
  live: boolean;
  locked: boolean;
  cycle: boolean;
  host: { 
    id: number; 
    name: string;
    connected: boolean;
  };
  state: {
    type: "select_chart" | "waiting_for_ready" | "playing";
    ready_users?: number[];
    ready_count?: number;
    results_count?: number;
    aborted_count?: number;
    finished_users?: number[];
    aborted_users?: number[];
  };
  chart: { 
    name: string; 
    id: number;
  } | null;
  contest: {
    whitelist_count: number;
    whitelist: number[];
    manual_start: boolean;
    auto_disband: boolean;
  } | null;
  users: Array<{
    id: number;
    name: string;
    connected: boolean;
    is_host: boolean;
    game_time: number;
    language: string;
    finished?: boolean;
    aborted?: boolean;
    record_id?: number | null;
  }>;
  monitors: Array<{
    id: number;
    name: string;
    connected: boolean;
    language: string;
  }>;
};

export function startWebSocketService(opts: { httpServer: http.Server; state: ServerState }): WebSocketService {
  const { httpServer, state } = opts;
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, WebSocketClient>();

  // 从请求中获取客户端 IP
  const getClientIp = (req: http.IncomingMessage): string => {
    const headerName = (state.config.real_ip_header || "X-Forwarded-For").toLowerCase();
    const headerValue = typeof req.headers[headerName] === "string" ? req.headers[headerName] : "";
    const first = headerValue ? headerValue.split(",")[0]?.trim() : "";
    const raw = first || req.socket.remoteAddress || "";
    return raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
  };

  // 处理 HTTP 升级请求
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    
    // 只处理 /ws 路径
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // WebSocket 连接处理
  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    const clientIp = getClientIp(req);
    
    const client: WebSocketClient = {
      ws,
      roomId: null,
      userId: null,
      isAlive: true,
      isAdmin: false,
      adminToken: null,
      lastAdminSnapshot: null,
      clientIp
    };
    clients.set(ws, client);

    state.logger.log("DEBUG", tl(state.serverLang, "log-websocket-connected", { total: String(clients.size) }));

    ws.on("message", async (data: Buffer) => {
      try {
        const text = data.toString("utf8");
        const msg = JSON.parse(text) as WebSocketMessage;

        if (msg.type === "ping") {
          client.isAlive = true;
          const response: WebSocketResponse = { type: "pong" };
          ws.send(JSON.stringify(response));
          return;
        }

        if (msg.type === "subscribe") {
          try {
            const roomId = parseRoomId(msg.roomId);
            const room = await state.mutex.runExclusive(async () => state.rooms.get(roomId) ?? null);
            
            if (!room) {
              const response: WebSocketResponse = { type: "error", message: "room-not-found" };
              ws.send(JSON.stringify(response));
              return;
            }

            client.roomId = roomId;
            client.userId = msg.userId ?? null;

            const response: WebSocketResponse = { type: "subscribed", roomId: msg.roomId };
            ws.send(JSON.stringify(response));

            // 立即发送当前房间状态
            await sendRoomUpdate(ws, roomId);
          } catch (e) {
            const response: WebSocketResponse = { type: "error", message: "invalid-room-id" };
            ws.send(JSON.stringify(response));
          }
          return;
        }

        if (msg.type === "unsubscribe") {
          client.roomId = null;
          client.userId = null;
          const response: WebSocketResponse = { type: "unsubscribed" };
          ws.send(JSON.stringify(response));
          return;
        }

        if (msg.type === "admin_subscribe") {
          // 验证管理员权限
          const isAuthorized = await verifyAdminToken(msg.token, client.clientIp);
          if (!isAuthorized) {
            const response: WebSocketResponse = { type: "error", message: "unauthorized" };
            ws.send(JSON.stringify(response));
            return;
          }

          client.isAdmin = true;
          client.adminToken = msg.token;
          client.lastAdminSnapshot = null;

          const response: WebSocketResponse = { type: "admin_subscribed" };
          ws.send(JSON.stringify(response));

          // 立即发送当前完整状态
          await sendAdminUpdate(ws, client, true);
          return;
        }

        if (msg.type === "admin_unsubscribe") {
          client.isAdmin = false;
          client.adminToken = null;
          client.lastAdminSnapshot = null;
          const response: WebSocketResponse = { type: "admin_unsubscribed" };
          ws.send(JSON.stringify(response));
          return;
        }
      } catch (e) {
        const response: WebSocketResponse = { type: "error", message: "invalid-message" };
        ws.send(JSON.stringify(response));
      }
    });

    ws.on("pong", () => {
      client.isAlive = true;
    });

    ws.on("close", () => {
      clients.delete(ws);
      state.logger.log("DEBUG", tl(state.serverLang, "log-websocket-disconnected", { total: String(clients.size) }));
    });

    ws.on("error", (err: Error) => {
      state.logger.log("WARN", `WebSocket error: ${err.message}`);
    });
  });

  // 验证管理员 Token
  const verifyAdminToken = async (token: string, clientIp: string): Promise<boolean> => {
    const adminToken = state.config.admin_token?.trim() || "";
    
    // 检查永久管理员 Token
    if (adminToken && token === adminToken) {
      return true;
    }
    
    // 检查临时 Token
    const now = Date.now();
    
    // 清理过期的临时 token
    for (const [t, data] of state.tempAdminTokens) {
      if (now > data.expiresAt) {
        state.tempAdminTokens.delete(t);
      }
    }
    
    const tempTokenData = state.tempAdminTokens.get(token);
    if (tempTokenData) {
      // 检查是否被封禁
      if (tempTokenData.banned) {
        return false;
      }
      
      // 检查是否过期
      if (now > tempTokenData.expiresAt) {
        state.tempAdminTokens.delete(token);
        return false;
      }
      
      // 验证 IP 是否匹配
      if (tempTokenData.ip !== clientIp) {
        // IP 不匹配，封禁该 token
        tempTokenData.banned = true;
        return false;
      }
      
      // 临时 token 验证通过
      return true;
    }
    
    return false;
  };

  // 获取管理员视图的完整房间数据
  const getAdminRoomsData = async (): Promise<AdminRoomData[]> => {
    return await state.mutex.runExclusive(async () => {
      const rooms: AdminRoomData[] = [];

      for (const [rid, room] of state.rooms) {
        const roomid = roomIdToString(rid);
        const hostUser = state.users.get(room.hostId);
        const hostName = hostUser?.name ?? String(room.hostId);
        const hostConnected = Boolean(hostUser?.session);
        
        // 状态详细信息
        const stateStr =
          room.state.type === "Playing" ? "playing" : room.state.type === "WaitForReady" ? "waiting_for_ready" : "select_chart";
        
        let stateDetails: AdminRoomData["state"] = { type: stateStr };
        if (room.state.type === "WaitForReady") {
          stateDetails.ready_users = Array.from(room.state.started);
          stateDetails.ready_count = room.state.started.size;
        } else if (room.state.type === "Playing") {
          stateDetails.results_count = room.state.results.size;
          stateDetails.aborted_count = room.state.aborted.size;
          stateDetails.finished_users = Array.from(room.state.results.keys());
          stateDetails.aborted_users = Array.from(room.state.aborted);
        }
        
        // 谱面信息
        const chart = room.chart ? { 
          name: room.chart.name, 
          id: room.chart.id
        } : null;
        
        // 用户详细信息
        const users = room.userIds().map((id) => {
          const u = state.users.get(id);
          const userInfo: AdminRoomData["users"][0] = { 
            id, 
            name: u?.name ?? String(id), 
            connected: Boolean(u?.session),
            is_host: id === room.hostId,
            game_time: u?.gameTime ?? Number.NEGATIVE_INFINITY,
            language: u?.lang.lang ?? "unknown"
          };
          
          // 如果房间在进行中，添加玩家的游玩状态和成绩ID
          if (room.state.type === "Playing") {
            const isFinished = room.state.results.has(id);
            const isAborted = room.state.aborted.has(id);
            userInfo.finished = isFinished || isAborted;
            userInfo.aborted = isAborted;
            if (isFinished) {
              const record = room.state.results.get(id);
              userInfo.record_id = record?.id ?? null;
            }
          }
          
          return userInfo;
        });
        
        // 观察者详细信息
        const monitors = room.monitorIds().map((id) => {
          const u = state.users.get(id);
          return { 
            id, 
            name: u?.name ?? String(id), 
            connected: Boolean(u?.session),
            language: u?.lang.lang ?? "unknown"
          };
        });
        
        // 比赛模式信息
        const contest = room.contest ? {
          whitelist_count: room.contest.whitelist.size,
          whitelist: Array.from(room.contest.whitelist),
          manual_start: room.contest.manualStart,
          auto_disband: room.contest.autoDisband
        } : null;
        
        rooms.push({
          roomid,
          max_users: room.maxUsers,
          current_users: users.length,
          current_monitors: monitors.length,
          replay_eligible: room.replayEligible,
          live: room.live,
          locked: room.locked,
          cycle: room.cycle,
          host: { 
            id: room.hostId, 
            name: hostName,
            connected: hostConnected
          },
          state: stateDetails,
          chart,
          contest,
          users,
          monitors
        });
      }

      rooms.sort((a, b) => a.roomid.localeCompare(b.roomid));
      return rooms;
    });
  };

  // 发送管理员更新（支持增量更新）
  const sendAdminUpdate = async (ws: WebSocket, client: WebSocketClient, forceFullUpdate = false): Promise<void> => {
    if (!client.isAdmin) return;

    const roomsData = await getAdminRoomsData();
    const currentSnapshot = JSON.stringify(roomsData);

    // 如果是强制完整更新或者是首次发送
    if (forceFullUpdate || !client.lastAdminSnapshot) {
      const response: WebSocketResponse = {
        type: "admin_update",
        data: {
          timestamp: Date.now(),
          changes: {
            rooms: roomsData,
            total_rooms: roomsData.length
          }
        }
      };

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
        client.lastAdminSnapshot = currentSnapshot;
      }
      return;
    }

    // 检查是否有变化
    if (currentSnapshot === client.lastAdminSnapshot) {
      return; // 没有变化，不推送
    }

    // 有变化，推送更新
    const response: WebSocketResponse = {
      type: "admin_update",
      data: {
        timestamp: Date.now(),
        changes: {
          rooms: roomsData,
          total_rooms: roomsData.length
        }
      }
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
      client.lastAdminSnapshot = currentSnapshot;
    }
  };

  // 心跳检测
  const heartbeatInterval = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.isAlive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      client.isAlive = false;
      ws.ping();
    }
  }, 30000); // 30秒心跳

  const sendRoomUpdate = async (ws: WebSocket, roomId: RoomId): Promise<void> => {
    const data = await getRoomUpdateData(roomId);
    if (!data) return;

    const response: WebSocketResponse = { type: "room_update", data };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  };

  const getRoomUpdateData = async (roomId: RoomId): Promise<RoomUpdateData | null> => {
    return await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      if (!room) return null;

      const hostUser = state.users.get(room.hostId);
      const hostName = hostUser?.name ?? String(room.hostId);

      const stateStr =
        room.state.type === "Playing" ? "playing" : room.state.type === "WaitForReady" ? "waiting_for_ready" : "select_chart";

      const chart = room.chart ? { name: room.chart.name, id: room.chart.id } : null;

      const users = room.userIds().map((id) => {
        const u = state.users.get(id);
        const isReady = room.state.type === "WaitForReady" ? room.state.started.has(id) : false;
        return {
          id,
          name: u?.name ?? String(id),
          is_ready: isReady
        };
      });

      const monitors = room.monitorIds().map((id) => {
        const u = state.users.get(id);
        return {
          id,
          name: u?.name ?? String(id)
        };
      });

      return {
        roomid: roomIdToString(roomId),
        state: stateStr,
        locked: room.locked,
        cycle: room.cycle,
        live: room.live,
        chart,
        host: { id: room.hostId, name: hostName },
        users,
        monitors
      };
    });
  };

  const broadcastRoomUpdate = async (roomId: RoomId): Promise<void> => {
    const data = await getRoomUpdateData(roomId);
    if (!data) return;

    const response: WebSocketResponse = { type: "room_update", data };
    const message = JSON.stringify(response);

    for (const [ws, client] of clients) {
      if (client.roomId && roomIdToString(client.roomId) === roomIdToString(roomId)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }
  };

  const broadcastRoomLog = async (message: string, timestamp: Date): Promise<void> => {
    // 从日志消息中提取房间 ID
    // 日志格式通常包含房间信息，例如："用户 "xxx" 加入房间 "room-id""
    const roomIdMatch = message.match(/房间\s*[「""]([^」""]+)[」""]/);
    if (!roomIdMatch) {
      return; // 如果没有房间信息，不推送
    }

    const roomIdStr = roomIdMatch[1];
    let roomId: RoomId;
    try {
      roomId = parseRoomId(roomIdStr);
    } catch {
      return; // 无效的房间 ID
    }

    const response: WebSocketResponse = {
      type: "room_log",
      data: {
        message,
        timestamp: timestamp.getTime()
      }
    };
    const messageStr = JSON.stringify(response);

    for (const [ws, client] of clients) {
      if (client.roomId && roomIdToString(client.roomId) === roomIdStr) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      }
    }
  };

  const broadcastAdminUpdate = async (): Promise<void> => {
    const tasks: Promise<void>[] = [];
    
    for (const [ws, client] of clients) {
      if (client.isAdmin) {
        tasks.push(sendAdminUpdate(ws, client, false));
      }
    }

    await Promise.allSettled(tasks);
  };

  return {
    wss,
    clients,
    broadcastRoomUpdate,
    broadcastRoomLog,
    broadcastAdminUpdate,
    close: async () => {
      clearInterval(heartbeatInterval);
      for (const [ws] of clients) {
        ws.close();
      }
      clients.clear();
      wss.close();
    }
  };
}
