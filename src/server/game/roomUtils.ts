import type { Room } from "../game/room.js";

export function roomShouldBeLive(room: Room, replayEnabled: boolean): boolean {
  return room.monitorIds().length > 0 || (replayEnabled && room.replayEligible);
}

export function refreshRoomLive(room: Room, replayEnabled: boolean): boolean {
  const live = roomShouldBeLive(room, replayEnabled);
  room.live = live;
  return live;
}
