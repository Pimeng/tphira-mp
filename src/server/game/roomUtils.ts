// 房间相关的通用工具函数

import type { User } from "../game/user.js";
import type { Room } from "../game/room.js";
import { tl } from "../utils/l10n.js";

/**
 * 要求用户必须在房间中，否则抛出错误
 * @param user 用户对象
 * @returns 用户所在的房间
 * @throws 如果用户不在房间中
 */
export function requireRoom(user: User): Room {
  const room = user.room;
  if (!room) throw new Error(user.lang.format("room-no-room"));
  return room;
}

/**
 * 检查用户是否为房间主持人
 * @param room 房间对象
 * @param user 用户对象
 * @throws 如果用户不是房间主持人
 */
export function checkHost(room: Room, user: User): void {
  if (room.hostId !== user.id) {
    throw new Error(tl(user.lang, "room-not-host"));
  }
}

/**
 * 验证用户是否可以加入房间
 * @param room 房间对象
 * @param user 用户对象
 * @param monitor 是否作为观察者加入
 * @throws 如果验证失败
 */
export function validateJoin(room: Room, user: User, monitor: boolean): void {
  if (room.contest && !room.contest.whitelist.has(user.id)) {
    throw new Error(tl(user.lang, "room-not-whitelisted"));
  }
  if (room.locked) {
    throw new Error(tl(user.lang, "join-room-locked"));
  }
  if (room.state.type !== "SelectChart") {
    throw new Error(tl(user.lang, "join-game-ongoing"));
  }
  if (monitor && !user.canMonitor()) {
    throw new Error(tl(user.lang, "join-cant-monitor"));
  }
}

/**
 * 验证是否可以开始游戏
 * @param room 房间对象
 * @param user 用户对象
 * @throws 如果验证失败
 */
export function validateStart(room: Room, user: User): void {
  checkHost(room, user);
  if (!room.chart) {
    throw new Error(tl(user.lang, "start-no-chart-selected"));
  }
  if (room.state.type !== "SelectChart") {
    throw new Error(tl(user.lang, "room-invalid-state"));
  }
}

/**
 * 验证是否可以选择谱面
 * @param room 房间对象
 * @param user 用户对象
 * @throws 如果验证失败
 */
export function validateSelectChart(room: Room, user: User): void {
  checkHost(room, user);
  if (room.state.type !== "SelectChart") {
    throw new Error(tl(user.lang, "room-invalid-state"));
  }
}

/**
 * 检查房间是否处于选择谱面状态
 * @param room 房间对象
 */
export function isSelectingChart(room: Room): boolean {
  return room.state.type === "SelectChart";
}

/**
 * 检查房间是否处于游戏中状态
 * @param room 房间对象
 */
export function isPlaying(room: Room): boolean {
  return room.state.type === "Playing";
}

/**
 * 检查房间是否处于等待准备状态
 * @param room 房间对象
 */
export function isWaitingForReady(room: Room): boolean {
  return room.state.type === "WaitForReady";
}

/**
 * 获取房间中所有用户的信息
 * @param room 房间对象
 * @param usersById 根据 ID 获取用户的函数
 */
export function getRoomUserInfos(
  room: Room,
  usersById: (id: number) => User | undefined
): Array<{ id: number; name: string; monitor: boolean }> {
  const allIds = [...room.userIds(), ...room.monitorIds()];
  return allIds
    .map((id) => usersById(id))
    .filter((user): user is User => Boolean(user))
    .map((user) => ({
      id: user.id,
      name: user.name,
      monitor: user.monitor
    }));
}
