export type RoomId = string & { readonly __roomId: unique symbol };

export function parseRoomId(value: string): RoomId {
  if (value.length === 0) throw new Error("roomid-empty");
  if (value.length > 20) throw new Error("roomid-too-long");
  for (const ch of value) {
    const ok =
      ch === "-" || ch === "_" || (ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");
    if (!ok) throw new Error("roomid-invalid");
  }
  return value as RoomId;
}

export function roomIdToString(id: RoomId): string {
  return id as string;
}
