import { describe, expect, it } from "vitest";
import { parseRoomId } from "../../../src/common/roomId.js";
import { Room } from "../../../src/server/game/room.js";
import { useCliTestSuite } from "./_setup.js";

describe("CLI 比赛房间管理", () => {
  const refs = useCliTestSuite();

  it("应该能够启用比赛模式", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("contest_room1");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
    });

    // 模拟 contest enable 命令，设置白名单
    const whitelistUsers = [100, 200, 300, 400];
    const ok = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      if (!room) return false;
      const set = new Set<number>(whitelistUsers);
      room.contest = { whitelist: set, manualStart: true, autoDisband: true };
      return true;
    });

    expect(ok).toBe(true);

    const hasContest = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      return room?.contest !== null && room?.contest !== undefined;
    });

    expect(hasContest).toBe(true);

    // 验证白名单
    const whitelist = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      return room?.contest ? [...room.contest.whitelist] : [];
    });

    expect(whitelist).toHaveLength(4);
    expect(whitelist).toContain(100);
    expect(whitelist).toContain(400);
  });

  it("应该能够禁用比赛模式", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("contest_room2");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    room.contest = { whitelist: new Set([100, 200]), manualStart: true, autoDisband: true };

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
    });

    // 模拟 contest disable 命令
    const ok = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      if (!room) return false;
      room.contest = null;
      return true;
    });

    expect(ok).toBe(true);

    const hasContest = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      return room?.contest !== null && room?.contest !== undefined;
    });

    expect(hasContest).toBe(false);
  });

  it("应该能够更新比赛白名单", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("contest_room3");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    room.contest = { whitelist: new Set([100, 200]), manualStart: true, autoDisband: true };

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
    });

    // 模拟 contest whitelist 命令，更新白名单
    const newWhitelist = [100, 200, 300, 400, 500, 600];
    const ok = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      if (!room || !room.contest) return false;
      room.contest.whitelist = new Set<number>(newWhitelist);
      return true;
    });

    expect(ok).toBe(true);

    const whitelistSize = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      return room?.contest?.whitelist.size ?? 0;
    });

    expect(whitelistSize).toBe(6);

    // 验证新白名单包含所有用户
    const whitelist = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      return room?.contest ? [...room.contest.whitelist].sort((a, b) => a - b) : [];
    });

    expect(whitelist).toEqual([100, 200, 300, 400, 500, 600]);
  });

  it("应该能够为多个比赛房间分别设置白名单", async () => {
    const { state } = refs.current();
    const room1 = parseRoomId("junior_contest");
    const room2 = parseRoomId("senior_contest");

    const r1 = new Room({
      id: room1,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    const r2 = new Room({
      id: room2,
      hostId: 200,
      maxUsers: 8,
      replayEligible: true
    });

    await state.mutex.runExclusive(async () => {
      state.rooms.set(room1, r1);
      state.rooms.set(room2, r2);
    });

    // 为初级赛设置白名单
    await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(room1);
      if (room) {
        room.contest = { whitelist: new Set([1001, 1002, 1003]), manualStart: true, autoDisband: true };
      }
    });

    // 为高级赛设置白名单
    await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(room2);
      if (room) {
        room.contest = { whitelist: new Set([2001, 2002, 2003, 2004]), manualStart: true, autoDisband: true };
      }
    });

    const room1Whitelist = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(room1);
      return room?.contest ? [...room.contest.whitelist] : [];
    });

    const room2Whitelist = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(room2);
      return room?.contest ? [...room.contest.whitelist] : [];
    });

    expect(room1Whitelist).toHaveLength(3);
    expect(room2Whitelist).toHaveLength(4);
    expect(room1Whitelist).toContain(1001);
    expect(room2Whitelist).toContain(2001);
  });
});
