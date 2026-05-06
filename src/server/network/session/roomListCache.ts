/**
 * 房间列表文本缓存
 *
 * 为减轻欢迎消息生成时的房间列表查询压力,缓存按语言生成的房间列表文本。
 * 缓存有 2 秒 TTL,最多缓存 10 种语言以防止内存泄漏。
 */
import type { ServerState } from "../../core/state.js";
import type { Language } from "../../utils/l10n.js";

/** 缓存有效期(2 秒) */
const ROOM_LIST_CACHE_TTL_MS = 2000;
/** 最大缓存语言数,防止内存泄漏 */
const ROOM_LIST_MAX_CACHED_LANGS = 10;

type RoomListCache = {
  text: Map<string, string>;
  timestamp: number;
};

let cache: RoomListCache = { text: new Map(), timestamp: 0 };

/**
 * 获取可加入房间列表的本地化文本
 *
 * 过滤条件: 排除以 `_` 开头的房间、已锁定的房间、非 SelectChart/Playing 状态的房间、
 * 已满员的房间。结果按房间 ID 字母序排序,并按语言缓存 2 秒。
 *
 * @param state - 服务器状态
 * @param lang - 目标语言
 * @returns 格式化后的房间列表文本(空列表时返回本地化的"无房间"提示,且不缓存)
 */
export function getAvailableRoomsText(state: ServerState, lang: Language): string {
  const now = Date.now();

  if (now - cache.timestamp < ROOM_LIST_CACHE_TTL_MS) {
    const cached = cache.text.get(lang.lang);
    if (cached !== undefined) return cached;
  }

  const rooms: Array<{ id: string; count: number; max: number }> = [];
  for (const [id, room] of state.rooms) {
    if (String(id).startsWith("_")) continue;
    if (room.locked) continue;
    if (room.state.type !== "SelectChart" && room.state.type !== "Playing") continue;
    const count = room.userIds().length;
    if (count >= room.maxUsers) continue;
    rooms.push({ id: String(id), count, max: room.maxUsers });
  }
  rooms.sort((a, b) => a.id.localeCompare(b.id));

  if (rooms.length === 0) {
    // 不缓存空列表,因为房间可能很快被创建
    return lang.format("chat-roomlist-empty");
  }

  const joiner = lang.lang === "zh-CN" ? "；" : "; ";
  const items = rooms.map((r) => lang.format("chat-roomlist-item", { id: r.id, count: r.count, max: r.max }));
  const text = items.join(joiner);

  if (cache.text.size >= ROOM_LIST_MAX_CACHED_LANGS) {
    const firstKey = cache.text.keys().next().value;
    if (firstKey !== undefined) cache.text.delete(firstKey);
  }
  cache.text.set(lang.lang, text);
  cache.timestamp = now;

  return text;
}

/**
 * 清空房间列表缓存(测试辅助)
 */
export function clearRoomListCache(): void {
  cache = { text: new Map(), timestamp: 0 };
}
