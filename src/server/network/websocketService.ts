import type http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ServerState } from "../core/state.js";
import type { RoomId } from "../../common/roomId.js";
import { roomIdToString, parseRoomId } from "../../common/roomId.js";
import { getClientIp } from "../../common/http.js";
import { tl } from "../utils/l10n.js";
import {
  buildAdminRoomsData,
  buildRoomUpdateData,
  type AdminRoomData,
  type RoomUpdateData
} from "../game/adminViews.js";

type WebSocketClient = {
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
  broadcastRoomLog: (roomId: RoomId, message: string, timestamp: Date) => Promise<void>;
  broadcastAdminUpdate: () => Promise<void>;
  close: () => Promise<void>;
};

type WebSocketMessage =
  | { type: "subscribe"; roomId: string; userId?: number }
  | { type: "unsubscribe" }
  | { type: "ping" }
  | { type: "admin_subscribe"; token: string }
  | { type: "admin_unsubscribe" };

type WebSocketResponse =
  | { type: "error"; message: string }
  | { type: "subscribed"; roomId: string }
  | { type: "unsubscribed" }
  | { type: "pong" }
  | { type: "room_update"; data: RoomUpdateData }
  | { type: "room_log"; data: { message: string; timestamp: number } }
  | { type: "admin_subscribed" }
  | { type: "admin_unsubscribed" }
  | { type: "admin_update"; data: AdminUpdateData };

type AdminUpdateData = {
  timestamp: number;
  changes: {
    rooms?: AdminRoomData[];
    total_rooms?: number;
  };
};

export function startWebSocketService(opts: { httpServer: http.Server; state: ServerState }): WebSocketService {
  const { httpServer, state } = opts;
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, WebSocketClient>();
  // 房间订阅索引：roomId string -> Set<WebSocket>，避免广播时全量遍历
  const roomSubscribers = new Map<string, Set<WebSocket>>();

  const addRoomSubscriber = (roomId: RoomId, ws: WebSocket): void => {
    const key = roomIdToString(roomId);
    let set = roomSubscribers.get(key);
    if (!set) {
      set = new Set();
      roomSubscribers.set(key, set);
    }
    set.add(ws);
  };

  const removeRoomSubscriber = (roomId: RoomId | null, ws: WebSocket): void => {
    if (!roomId) return;
    const key = roomIdToString(roomId);
    const set = roomSubscribers.get(key);
    if (set) {
      set.delete(ws);
      if (set.size === 0) roomSubscribers.delete(key);
    }
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

  const sendResponse = (ws: WebSocket, response: WebSocketResponse): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
  };

  // WebSocket 连接处理
  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    const clientIp = getClientIp(req, state.config.real_ip_header || "X-Forwarded-For");

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
          sendResponse(ws, { type: "pong" });
          return;
        }

        if (msg.type === "subscribe") {
          try {
            const roomId = parseRoomId(msg.roomId);
            const room = await state.mutex.runExclusive(async () => state.rooms.get(roomId) ?? null);

            if (!room) {
              sendResponse(ws, { type: "error", message: "room-not-found" });
              return;
            }

            removeRoomSubscriber(client.roomId, ws);
            client.roomId = roomId;
            client.userId = msg.userId ?? null;
            addRoomSubscriber(roomId, ws);

            sendResponse(ws, { type: "subscribed", roomId: msg.roomId });

            // 立即发送当前房间状态
            await sendRoomUpdate(ws, roomId);
          } catch {
            sendResponse(ws, { type: "error", message: "invalid-room-id" });
          }
          return;
        }

        if (msg.type === "unsubscribe") {
          removeRoomSubscriber(client.roomId, ws);
          client.roomId = null;
          client.userId = null;
          sendResponse(ws, { type: "unsubscribed" });
          return;
        }

        if (msg.type === "admin_subscribe") {
          // 验证管理员权限
          const isAuthorized = await verifyAdminToken(msg.token, client.clientIp);
          if (!isAuthorized) {
            sendResponse(ws, { type: "error", message: "unauthorized" });
            return;
          }

          client.isAdmin = true;
          client.adminToken = msg.token;
          client.lastAdminSnapshot = null;

          sendResponse(ws, { type: "admin_subscribed" });

          // 立即发送当前完整状态
          const adminData = buildAdminRoomsData(state);
          await sendAdminUpdate(ws, client, adminData, JSON.stringify(adminData), true);
          return;
        }

        if (msg.type === "admin_unsubscribe") {
          client.isAdmin = false;
          client.adminToken = null;
          client.lastAdminSnapshot = null;
          sendResponse(ws, { type: "admin_unsubscribed" });
          return;
        }
      } catch {
        sendResponse(ws, { type: "error", message: "invalid-message" });
      }
    });

    ws.on("pong", () => {
      client.isAlive = true;
    });

    ws.on("close", () => {
      removeRoomSubscriber(client.roomId, ws);
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

    // 清理过期的临时 token
    const now = Date.now();
    for (const [t, data] of state.tempAdminTokens) {
      if (now > data.expiresAt) state.tempAdminTokens.delete(t);
    }

    const tempTokenData = state.tempAdminTokens.get(token);
    if (!tempTokenData) return false;
    if (tempTokenData.banned) return false;
    if (now > tempTokenData.expiresAt) {
      state.tempAdminTokens.delete(token);
      return false;
    }
    if (tempTokenData.ip !== clientIp) {
      // IP 不匹配,封禁该 token
      tempTokenData.banned = true;
      return false;
    }
    return true;
  };

  // 发送管理员更新（支持增量更新）
  const sendAdminUpdate = (
    ws: WebSocket,
    client: WebSocketClient,
    roomsData: AdminRoomData[],
    roomsSnapshot: string,
    forceFullUpdate = false
  ): void => {
    if (!client.isAdmin) return;

    // 没有变化且不是首次推送：跳过
    if (!forceFullUpdate && client.lastAdminSnapshot === roomsSnapshot) return;

    const responseStr = `{"type":"admin_update","data":{"timestamp":${Date.now()},"changes":{"rooms":${roomsSnapshot},"total_rooms":${roomsData.length}}}}`;

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(responseStr);
      client.lastAdminSnapshot = roomsSnapshot;
    }
  };

  // 心跳检测
  const heartbeatInterval = setInterval(() => {
    const toRemove: WebSocket[] = [];
    for (const [ws, client] of clients) {
      if (!client.isAlive) {
        toRemove.push(ws);
        continue;
      }
      client.isAlive = false;
      ws.ping();
    }
    // 批量清理断开的连接，避免遍历时修改 Map
    for (const ws of toRemove) {
      ws.terminate();
      removeRoomSubscriber(clients.get(ws)?.roomId ?? null, ws);
      clients.delete(ws);
    }
  }, 30000); // 30秒心跳

  const sendRoomUpdate = async (ws: WebSocket, roomId: RoomId): Promise<void> => {
    const data = buildRoomUpdateData(state, roomId);
    if (!data) return;
    sendResponse(ws, { type: "room_update", data });
  };

  const broadcastRoomUpdate = async (roomId: RoomId): Promise<void> => {
    const data = buildRoomUpdateData(state, roomId);
    if (!data) return;

    const message = JSON.stringify({ type: "room_update", data } satisfies WebSocketResponse);
    const subscribers = roomSubscribers.get(roomIdToString(roomId));
    if (!subscribers) return;

    for (const ws of subscribers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(message, (err) => {
        if (err) state.logger.log("WARN", `WebSocket send error: ${err.message}`);
      });
    }
  };

  const broadcastRoomLog = async (roomId: RoomId, message: string, timestamp: Date): Promise<void> => {
    const messageStr = JSON.stringify({
      type: "room_log",
      data: { message, timestamp: timestamp.getTime() }
    } satisfies WebSocketResponse);

    const subscribers = roomSubscribers.get(roomIdToString(roomId));
    if (!subscribers) return;

    for (const ws of subscribers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(messageStr);
    }
  };

  const broadcastAdminUpdate = async (): Promise<void> => {
    const roomsData = buildAdminRoomsData(state);
    const roomsSnapshot = JSON.stringify(roomsData);
    for (const [ws, client] of clients) {
      if (client.isAdmin) {
        sendAdminUpdate(ws, client, roomsData, roomsSnapshot, false);
      }
    }
  };

  return {
    wss,
    clients,
    broadcastRoomUpdate,
    broadcastRoomLog,
    broadcastAdminUpdate,
    close: async () => {
      clearInterval(heartbeatInterval);
      for (const [ws] of clients) ws.close();
      clients.clear();
      roomSubscribers.clear();
      wss.close();
    }
  };
}
