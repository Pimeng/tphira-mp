import type { Room } from "../game/room.js";

/** monitor数据转发模块：判断房间是否有观战者 */
export function roomHasMonitors(room: Room): boolean {
  return room.monitorIds().length > 0;
}

/** 录制回放模块：判断房间是否应该录制 */
export function roomShouldRecord(room: Room, replayEnabled: boolean): boolean {
  return replayEnabled && room.replayEligible;
}

/** 综合判断：房间是否处于活跃状态（用于客户端显示） */
export function roomShouldBeLive(room: Room, replayEnabled: boolean): boolean {
  return roomHasMonitors(room) || roomShouldRecord(room, replayEnabled);
}

export function refreshRoomLive(room: Room, replayEnabled: boolean): boolean {
  const live = roomShouldBeLive(room, replayEnabled);
  room.live = live;
  return live;
}
