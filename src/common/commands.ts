import { BinaryReader, BinaryWriter, decodeStringResult, encodeStringResult, type StringResult } from "./binary.js";
import { parseRoomId, type RoomId } from "./roomId.js";

export const HEARTBEAT_INTERVAL_MS = 3000;
export const HEARTBEAT_TIMEOUT_MS = 2000;
export const HEARTBEAT_DISCONNECT_TIMEOUT_MS = 10000;

export type CompactPos = { x: number; y: number };

export type TouchFrame = {
  time: number;
  points: Array<[number, CompactPos]>;
};

export enum Judgement {
  Perfect = 0,
  Good = 1,
  Bad = 2,
  Miss = 3,
  HoldPerfect = 4,
  HoldGood = 5
}

export type JudgeEvent = {
  time: number;
  line_id: number;
  note_id: number;
  judgement: Judgement;
};

export type Message =
  | { type: "Chat"; user: number; content: string }
  | { type: "CreateRoom"; user: number }
  | { type: "JoinRoom"; user: number; name: string }
  | { type: "LeaveRoom"; user: number; name: string }
  | { type: "NewHost"; user: number }
  | { type: "SelectChart"; user: number; name: string; id: number }
  | { type: "GameStart"; user: number }
  | { type: "Ready"; user: number }
  | { type: "CancelReady"; user: number }
  | { type: "CancelGame"; user: number }
  | { type: "StartPlaying" }
  | { type: "Played"; user: number; score: number; accuracy: number; full_combo: boolean }
  | { type: "GameEnd" }
  | { type: "Abort"; user: number }
  | { type: "LockRoom"; lock: boolean }
  | { type: "CycleRoom"; cycle: boolean };

export type RoomState =
  | { type: "SelectChart"; id: number | null }
  | { type: "WaitingForReady" }
  | { type: "Playing" };

export type UserInfo = {
  id: number;
  name: string;
  monitor: boolean;
};

export type ClientRoomState = {
  id: RoomId;
  state: RoomState;
  live: boolean;
  locked: boolean;
  cycle: boolean;
  is_host: boolean;
  is_ready: boolean;
  users: Map<number, UserInfo>;
};

export type JoinRoomResponse = {
  state: RoomState;
  users: UserInfo[];
  live: boolean;
};

export type ClientCommand =
  | { type: "Ping" }
  | { type: "Authenticate"; token: string }
  | { type: "Chat"; message: string }
  | { type: "Touches"; frames: TouchFrame[] }
  | { type: "Judges"; judges: JudgeEvent[] }
  | { type: "CreateRoom"; id: RoomId }
  | { type: "JoinRoom"; id: RoomId; monitor: boolean }
  | { type: "LeaveRoom" }
  | { type: "LockRoom"; lock: boolean }
  | { type: "CycleRoom"; cycle: boolean }
  | { type: "SelectChart"; id: number }
  | { type: "RequestStart" }
  | { type: "Ready" }
  | { type: "CancelReady" }
  | { type: "Played"; id: number }
  | { type: "Abort" };

export type ServerCommand =
  | { type: "Pong" }
  | { type: "Authenticate"; result: StringResult<[UserInfo, ClientRoomState | null]> }
  | { type: "Chat"; result: StringResult<Record<never, never>> }
  | { type: "Touches"; player: number; frames: TouchFrame[] }
  | { type: "Judges"; player: number; judges: JudgeEvent[] }
  | { type: "Message"; message: Message }
  | { type: "ChangeState"; state: RoomState }
  | { type: "ChangeHost"; is_host: boolean }
  | { type: "CreateRoom"; result: StringResult<Record<never, never>> }
  | { type: "JoinRoom"; result: StringResult<JoinRoomResponse> }
  | { type: "OnJoinRoom"; info: UserInfo }
  | { type: "LeaveRoom"; result: StringResult<Record<never, never>> }
  | { type: "LockRoom"; result: StringResult<Record<never, never>> }
  | { type: "CycleRoom"; result: StringResult<Record<never, never>> }
  | { type: "SelectChart"; result: StringResult<Record<never, never>> }
  | { type: "RequestStart"; result: StringResult<Record<never, never>> }
  | { type: "Ready"; result: StringResult<Record<never, never>> }
  | { type: "CancelReady"; result: StringResult<Record<never, never>> }
  | { type: "Played"; result: StringResult<Record<never, never>> }
  | { type: "Abort"; result: StringResult<Record<never, never>> };

function encodeCompactPos(w: BinaryWriter, v: CompactPos): void {
  w.writeCompactPos(v);
}

function decodeCompactPos(r: BinaryReader): CompactPos {
  return r.readCompactPos();
}

function encodeTouchFrame(w: BinaryWriter, v: TouchFrame): void {
  w.writeF32(v.time);
  w.writeArray(v.points, (ww, [id, pos]) => {
    ww.writeI8(id);
    encodeCompactPos(ww, pos);
  });
}

function decodeTouchFrame(r: BinaryReader): TouchFrame {
  const time = r.readF32();
  const points = r.readArray((rr) => {
    const id = rr.readI8();
    const pos = decodeCompactPos(rr);
    return [id, pos] as [number, CompactPos];
  });
  return { time, points };
}

function encodeJudgement(w: BinaryWriter, v: Judgement): void {
  w.writeU8(v);
}

function decodeJudgement(r: BinaryReader): Judgement {
  return r.readU8() as Judgement;
}

function encodeJudgeEvent(w: BinaryWriter, v: JudgeEvent): void {
  w.writeF32(v.time);
  w.writeU32(v.line_id);
  w.writeU32(v.note_id);
  encodeJudgement(w, v.judgement);
}

function decodeJudgeEvent(r: BinaryReader): JudgeEvent {
  const time = r.readF32();
  const line_id = r.readU32();
  const note_id = r.readU32();
  const judgement = decodeJudgement(r);
  return { time, line_id, note_id, judgement };
}

function encodeRoomId(w: BinaryWriter, v: RoomId): void {
  w.writeString(v);
}

function decodeRoomId(r: BinaryReader): RoomId {
  return parseRoomId(r.readString());
}

function encodeUserInfo(w: BinaryWriter, v: UserInfo): void {
  w.writeI32(v.id);
  w.writeString(v.name);
  w.writeBool(v.monitor);
}

function decodeUserInfo(r: BinaryReader): UserInfo {
  const id = r.readI32();
  const name = r.readString();
  const monitor = r.readBool();
  return { id, name, monitor };
}

function encodeRoomState(w: BinaryWriter, v: RoomState): void {
  switch (v.type) {
    case "SelectChart":
      w.writeU8(0);
      w.writeOption(v.id, (ww, id) => ww.writeI32(id));
      return;
    case "WaitingForReady":
      w.writeU8(1);
      return;
    case "Playing":
      w.writeU8(2);
      return;
  }
}

function decodeRoomState(r: BinaryReader): RoomState {
  const tag = r.readU8();
  switch (tag) {
    case 0: {
      const id = r.readOption((rr) => rr.readI32());
      return { type: "SelectChart", id };
    }
    case 1:
      return { type: "WaitingForReady" };
    case 2:
      return { type: "Playing" };
    default:
      throw new Error("RoomState 标签不合法");
  }
}

function encodeClientRoomState(w: BinaryWriter, v: ClientRoomState): void {
  encodeRoomId(w, v.id);
  encodeRoomState(w, v.state);
  w.writeBool(v.live);
  w.writeBool(v.locked);
  w.writeBool(v.cycle);
  w.writeBool(v.is_host);
  w.writeBool(v.is_ready);

  const keys = [...v.users.keys()].sort((a, b) => a - b);
  w.writeUleb(keys.length);
  for (const k of keys) {
    w.writeI32(k);
    const info = v.users.get(k);
    if (!info) throw new Error("users 键不存在");
    encodeUserInfo(w, info);
  }
}

function decodeClientRoomState(r: BinaryReader): ClientRoomState {
  const id = decodeRoomId(r);
  const state = decodeRoomState(r);
  const live = r.readBool();
  const locked = r.readBool();
  const cycle = r.readBool();
  const is_host = r.readBool();
  const is_ready = r.readBool();
  const users = r.readMap((rr) => rr.readI32(), decodeUserInfo);
  return { id, state, live, locked, cycle, is_host, is_ready, users };
}

function encodeJoinRoomResponse(w: BinaryWriter, v: JoinRoomResponse): void {
  encodeRoomState(w, v.state);
  w.writeArray(v.users, encodeUserInfo);
  w.writeBool(v.live);
}

function decodeJoinRoomResponse(r: BinaryReader): JoinRoomResponse {
  const state = decodeRoomState(r);
  const users = r.readArray(decodeUserInfo);
  const live = r.readBool();
  return { state, users, live };
}

function encodeMessage(w: BinaryWriter, v: Message): void {
  switch (v.type) {
    case "Chat":
      w.writeU8(0);
      w.writeI32(v.user);
      w.writeString(v.content);
      return;
    case "CreateRoom":
      w.writeU8(1);
      w.writeI32(v.user);
      return;
    case "JoinRoom":
      w.writeU8(2);
      w.writeI32(v.user);
      w.writeString(v.name);
      return;
    case "LeaveRoom":
      w.writeU8(3);
      w.writeI32(v.user);
      w.writeString(v.name);
      return;
    case "NewHost":
      w.writeU8(4);
      w.writeI32(v.user);
      return;
    case "SelectChart":
      w.writeU8(5);
      w.writeI32(v.user);
      w.writeString(v.name);
      w.writeI32(v.id);
      return;
    case "GameStart":
      w.writeU8(6);
      w.writeI32(v.user);
      return;
    case "Ready":
      w.writeU8(7);
      w.writeI32(v.user);
      return;
    case "CancelReady":
      w.writeU8(8);
      w.writeI32(v.user);
      return;
    case "CancelGame":
      w.writeU8(9);
      w.writeI32(v.user);
      return;
    case "StartPlaying":
      w.writeU8(10);
      return;
    case "Played":
      w.writeU8(11);
      w.writeI32(v.user);
      w.writeI32(v.score);
      w.writeF32(v.accuracy);
      w.writeBool(v.full_combo);
      return;
    case "GameEnd":
      w.writeU8(12);
      return;
    case "Abort":
      w.writeU8(13);
      w.writeI32(v.user);
      return;
    case "LockRoom":
      w.writeU8(14);
      w.writeBool(v.lock);
      return;
    case "CycleRoom":
      w.writeU8(15);
      w.writeBool(v.cycle);
      return;
  }
}

function decodeMessage(r: BinaryReader): Message {
  const tag = r.readU8();
  switch (tag) {
    case 0:
      return { type: "Chat", user: r.readI32(), content: r.readString() };
    case 1:
      return { type: "CreateRoom", user: r.readI32() };
    case 2:
      return { type: "JoinRoom", user: r.readI32(), name: r.readString() };
    case 3:
      return { type: "LeaveRoom", user: r.readI32(), name: r.readString() };
    case 4:
      return { type: "NewHost", user: r.readI32() };
    case 5:
      return { type: "SelectChart", user: r.readI32(), name: r.readString(), id: r.readI32() };
    case 6:
      return { type: "GameStart", user: r.readI32() };
    case 7:
      return { type: "Ready", user: r.readI32() };
    case 8:
      return { type: "CancelReady", user: r.readI32() };
    case 9:
      return { type: "CancelGame", user: r.readI32() };
    case 10:
      return { type: "StartPlaying" };
    case 11:
      return { type: "Played", user: r.readI32(), score: r.readI32(), accuracy: r.readF32(), full_combo: r.readBool() };
    case 12:
      return { type: "GameEnd" };
    case 13:
      return { type: "Abort", user: r.readI32() };
    case 14:
      return { type: "LockRoom", lock: r.readBool() };
    case 15:
      return { type: "CycleRoom", cycle: r.readBool() };
    default:
      throw new Error("Message 标签不合法");
  }
}

export function encodeClientCommand(w: BinaryWriter, cmd: ClientCommand): void {
  switch (cmd.type) {
    case "Ping":
      w.writeU8(0);
      return;
    case "Authenticate":
      w.writeU8(1);
      w.writeVarchar(32, cmd.token);
      return;
    case "Chat":
      w.writeU8(2);
      w.writeVarchar(200, cmd.message);
      return;
    case "Touches":
      w.writeU8(3);
      w.writeArray(cmd.frames, encodeTouchFrame);
      return;
    case "Judges":
      w.writeU8(4);
      w.writeArray(cmd.judges, encodeJudgeEvent);
      return;
    case "CreateRoom":
      w.writeU8(5);
      encodeRoomId(w, cmd.id);
      return;
    case "JoinRoom":
      w.writeU8(6);
      encodeRoomId(w, cmd.id);
      w.writeBool(cmd.monitor);
      return;
    case "LeaveRoom":
      w.writeU8(7);
      return;
    case "LockRoom":
      w.writeU8(8);
      w.writeBool(cmd.lock);
      return;
    case "CycleRoom":
      w.writeU8(9);
      w.writeBool(cmd.cycle);
      return;
    case "SelectChart":
      w.writeU8(10);
      w.writeI32(cmd.id);
      return;
    case "RequestStart":
      w.writeU8(11);
      return;
    case "Ready":
      w.writeU8(12);
      return;
    case "CancelReady":
      w.writeU8(13);
      return;
    case "Played":
      w.writeU8(14);
      w.writeI32(cmd.id);
      return;
    case "Abort":
      w.writeU8(15);
      return;
  }
}

export function decodeClientCommand(r: BinaryReader): ClientCommand {
  const tag = r.readU8();
  switch (tag) {
    case 0:
      return { type: "Ping" };
    case 1:
      return { type: "Authenticate", token: r.readVarchar(32) };
    case 2:
      return { type: "Chat", message: r.readVarchar(200) };
    case 3:
      return { type: "Touches", frames: r.readArray(decodeTouchFrame) };
    case 4:
      return { type: "Judges", judges: r.readArray(decodeJudgeEvent) };
    case 5:
      return { type: "CreateRoom", id: decodeRoomId(r) };
    case 6:
      return { type: "JoinRoom", id: decodeRoomId(r), monitor: r.readBool() };
    case 7:
      return { type: "LeaveRoom" };
    case 8:
      return { type: "LockRoom", lock: r.readBool() };
    case 9:
      return { type: "CycleRoom", cycle: r.readBool() };
    case 10:
      return { type: "SelectChart", id: r.readI32() };
    case 11:
      return { type: "RequestStart" };
    case 12:
      return { type: "Ready" };
    case 13:
      return { type: "CancelReady" };
    case 14:
      return { type: "Played", id: r.readI32() };
    case 15:
      return { type: "Abort" };
    default:
      throw new Error("ClientCommand 标签不合法");
  }
}

export function encodeServerCommand(w: BinaryWriter, cmd: ServerCommand): void {
  switch (cmd.type) {
    case "Pong":
      w.writeU8(0);
      return;
    case "Authenticate":
      w.writeU8(1);
      encodeStringResult(w, cmd.result, (ww, [me, room]) => {
        encodeUserInfo(ww, me);
        ww.writeOption(room, encodeClientRoomState);
      });
      return;
    case "Chat":
      w.writeU8(2);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "Touches":
      w.writeU8(3);
      w.writeI32(cmd.player);
      w.writeArray(cmd.frames, encodeTouchFrame);
      return;
    case "Judges":
      w.writeU8(4);
      w.writeI32(cmd.player);
      w.writeArray(cmd.judges, encodeJudgeEvent);
      return;
    case "Message":
      w.writeU8(5);
      encodeMessage(w, cmd.message);
      return;
    case "ChangeState":
      w.writeU8(6);
      encodeRoomState(w, cmd.state);
      return;
    case "ChangeHost":
      w.writeU8(7);
      w.writeBool(cmd.is_host);
      return;
    case "CreateRoom":
      w.writeU8(8);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "JoinRoom":
      w.writeU8(9);
      encodeStringResult(w, cmd.result, encodeJoinRoomResponse);
      return;
    case "OnJoinRoom":
      w.writeU8(10);
      encodeUserInfo(w, cmd.info);
      return;
    case "LeaveRoom":
      w.writeU8(11);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "LockRoom":
      w.writeU8(12);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "CycleRoom":
      w.writeU8(13);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "SelectChart":
      w.writeU8(14);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "RequestStart":
      w.writeU8(15);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "Ready":
      w.writeU8(16);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "CancelReady":
      w.writeU8(17);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "Played":
      w.writeU8(18);
      encodeStringResult(w, cmd.result, () => {});
      return;
    case "Abort":
      w.writeU8(19);
      encodeStringResult(w, cmd.result, () => {});
      return;
  }
}

export function decodeServerCommand(r: BinaryReader): ServerCommand {
  const tag = r.readU8();
  switch (tag) {
    case 0:
      return { type: "Pong" };
    case 1: {
      const result = decodeStringResult(r, (rr) => {
        const me = decodeUserInfo(rr);
        const room = rr.readOption(decodeClientRoomState);
        return [me, room] as [UserInfo, ClientRoomState | null];
      });
      return { type: "Authenticate", result };
    }
    case 2:
      return { type: "Chat", result: decodeStringResult(r, () => ({})) };
    case 3:
      return { type: "Touches", player: r.readI32(), frames: r.readArray(decodeTouchFrame) };
    case 4:
      return { type: "Judges", player: r.readI32(), judges: r.readArray(decodeJudgeEvent) };
    case 5:
      return { type: "Message", message: decodeMessage(r) };
    case 6:
      return { type: "ChangeState", state: decodeRoomState(r) };
    case 7:
      return { type: "ChangeHost", is_host: r.readBool() };
    case 8:
      return { type: "CreateRoom", result: decodeStringResult(r, () => ({})) };
    case 9:
      return { type: "JoinRoom", result: decodeStringResult(r, decodeJoinRoomResponse) };
    case 10:
      return { type: "OnJoinRoom", info: decodeUserInfo(r) };
    case 11:
      return { type: "LeaveRoom", result: decodeStringResult(r, () => ({})) };
    case 12:
      return { type: "LockRoom", result: decodeStringResult(r, () => ({})) };
    case 13:
      return { type: "CycleRoom", result: decodeStringResult(r, () => ({})) };
    case 14:
      return { type: "SelectChart", result: decodeStringResult(r, () => ({})) };
    case 15:
      return { type: "RequestStart", result: decodeStringResult(r, () => ({})) };
    case 16:
      return { type: "Ready", result: decodeStringResult(r, () => ({})) };
    case 17:
      return { type: "CancelReady", result: decodeStringResult(r, () => ({})) };
    case 18:
      return { type: "Played", result: decodeStringResult(r, () => ({})) };
    case 19:
      return { type: "Abort", result: decodeStringResult(r, () => ({})) };
    default:
      throw new Error("ServerCommand 标签不合法");
  }
}

