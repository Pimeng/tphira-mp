// HTTP Service 辅助函数：路由 handler 中常见的解析/校验/清理模式

import type http from "node:http";
import { writeJson, fetchWithRetry } from "../../common/http.js";
import { parseRoomId, type RoomId } from "../../common/roomId.js";
import type { ServerState } from "../core/state.js";
import type { ServerCommand } from "../../common/commands.js";
import type { Room } from "../game/room.js";

const DEFAULT_PHIRA_API_ENDPOINT = "https://phira.5wyxi.com";

/**
 * 解析 URL 路径中的 roomId；失败时写出 400 响应并返回 null。
 *
 * 配合 `if (!rid) return;` 使用，避免每个 handler 都重复 try-catch。
 */
export function parseRoomIdOrWriteError(text: string, res: http.ServerResponse): RoomId | null {
  try {
    return parseRoomId(text);
  } catch {
    writeJson(res, 400, { ok: false, error: "bad-room-id" });
    return null;
  }
}

/**
 * 通用地清理一个或多个含有 expiresAt 字段的 Map。
 * 取代 httpService 中重复出现的 `for (const [k,v] of m) if (Date.now() > v.expiresAt) m.delete(k)`。
 */
export function cleanupExpiringMaps(...maps: ReadonlyArray<Map<string, { expiresAt: number }>>): void {
  const now = Date.now();
  for (const map of maps) {
    for (const [key, value] of map) {
      if (now > value.expiresAt) map.delete(key);
    }
  }
}

/**
 * 调用 Phira API 验证 token 并取出 user ID。失败时返回 null。
 */
export async function verifyUserTokenViaApi(state: ServerState, token: string, timeoutMs = 8000): Promise<number | null> {
  const endpoint = state.config.phira_api_endpoint || DEFAULT_PHIRA_API_ENDPOINT;
  try {
    const resp = await fetchWithRetry(`${endpoint}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      proxy: state.config.outbound_proxy
    }, timeoutMs);
    if (!resp.ok) return null;
    const data = await resp.json() as { id: number };
    return Number.isInteger(data.id) ? data.id : null;
  } catch {
    return null;
  }
}

/**
 * 把所有未完成成绩的玩家标记为 abort，触发 checkAllReady。
 * 用于管理员踢人/封禁时不让对局卡在等待该玩家上传成绩。
 */
export async function abortPlayingUserAndCheckReady(opts: {
  state: ServerState;
  user: { id: number; room: Room | null };
  room: Room;
  broadcastRoomAll: (roomId: RoomId, cmd: ServerCommand) => Promise<void>;
  pickRandomUserId: (ids: number[]) => number | null;
}): Promise<void> {
  const { state, user, room, broadcastRoomAll, pickRandomUserId } = opts;
  if (room.state.type !== "Playing") return;
  room.state.aborted.add(user.id);
  await broadcastRoomAll(room.id, { type: "Message", message: { type: "Abort", user: user.id } });
  await room.checkAllReady({
    usersById: (id) => state.users.get(id),
    broadcast: (cmd) => broadcastRoomAll(room.id, cmd),
    broadcastToMonitors: (cmd) => broadcastRoomAll(room.id, cmd),
    pickRandomUserId,
    lang: state.serverLang,
    logger: state.logger,
    wsService: state.wsService
  });
}

/**
 * 用 multipart/form-data 编码字段。返回 `{ body, contentType }`。
 *
 * `fields` 中每个值若为 Buffer 则作为文件上传（需要 filename），否则作为文本字段。
 */
export function encodeMultipartFormData(fields: Array<{
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}>): { body: Buffer; contentType: string } {
  const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  const chunks: Buffer[] = [];
  for (const field of fields) {
    if (Buffer.isBuffer(field.value)) {
      chunks.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename ?? ""}"\r\n` +
        `Content-Type: ${field.contentType ?? "application/octet-stream"}\r\n\r\n`,
        "utf-8"
      ));
      chunks.push(field.value);
      chunks.push(Buffer.from("\r\n", "utf-8"));
    } else {
      chunks.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${field.name}"\r\n\r\n` +
        `${field.value}\r\n`,
        "utf-8"
      ));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
