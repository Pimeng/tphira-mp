export type RoomId = string & { readonly __roomId: unique symbol };

export function parseRoomId(value: string): RoomId {
  if (value.length === 0) throw new Error("房间 ID 不能为空");
  if (value.length > 20) throw new Error("房间 ID 过长");
  for (const ch of value) {
    const ok = ch === "-" || ch === "_" || (ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");
    if (!ok) throw new Error("房间 ID 不合法");
  }
  return value as RoomId;
}

export function roomIdToString(id: RoomId): string {
  return id as string;
}

