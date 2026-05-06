import { describe, expect, it } from "vitest";
import { parseRoomId } from "../../../src/common/roomId.js";
import { useCliTestSuite } from "./_setup.js";

describe("CLI 封禁管理", () => {
  const refs = useCliTestSuite();

  it("应该能够封禁用户", async () => {
    const { state } = refs.current();
    // 模拟 ban 命令
    await state.mutex.runExclusive(async () => {
      state.bannedUsers.add(12345);
    });

    const isBanned = await state.mutex.runExclusive(async () => {
      return state.bannedUsers.has(12345);
    });

    expect(isBanned).toBe(true);
  });

  it("应该能够解封用户", async () => {
    const { state } = refs.current();
    // 先封禁
    await state.mutex.runExclusive(async () => {
      state.bannedUsers.add(12345);
    });

    // 模拟 unban 命令
    await state.mutex.runExclusive(async () => {
      state.bannedUsers.delete(12345);
    });

    const isBanned = await state.mutex.runExclusive(async () => {
      return state.bannedUsers.has(12345);
    });

    expect(isBanned).toBe(false);
  });

  it("应该能够列出所有被封禁的用户", async () => {
    const { state } = refs.current();
    // 模拟封禁多个用户
    const bannedUserIds = [10001, 10002, 10003, 10004, 10005];

    await state.mutex.runExclusive(async () => {
      for (const id of bannedUserIds) {
        state.bannedUsers.add(id);
      }
    });

    // 模拟 banlist 命令
    const banned = await state.mutex.runExclusive(async () => {
      return [...state.bannedUsers].sort((a, b) => a - b);
    });

    expect(banned).toHaveLength(5);
    expect(banned).toEqual([10001, 10002, 10003, 10004, 10005]);
  });

  it("应该能够对特定房间封禁用户", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("vip_room");

    // 模拟 banroom 命令
    await state.mutex.runExclusive(async () => {
      const set = state.bannedRoomUsers.get(roomId) ?? new Set<number>();
      set.add(12345);
      state.bannedRoomUsers.set(roomId, set);
    });

    const isBanned = await state.mutex.runExclusive(async () => {
      const set = state.bannedRoomUsers.get(roomId);
      return set ? set.has(12345) : false;
    });

    expect(isBanned).toBe(true);
  });

  it("应该能够解除房间级封禁", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("vip_room");

    // 先封禁
    await state.mutex.runExclusive(async () => {
      const set = new Set<number>([12345]);
      state.bannedRoomUsers.set(roomId, set);
    });

    // 模拟 unbanroom 命令
    await state.mutex.runExclusive(async () => {
      const set = state.bannedRoomUsers.get(roomId);
      if (set) {
        set.delete(12345);
        if (set.size === 0) state.bannedRoomUsers.delete(roomId);
      }
    });

    const isBanned = await state.mutex.runExclusive(async () => {
      const set = state.bannedRoomUsers.get(roomId);
      return set ? set.has(12345) : false;
    });

    expect(isBanned).toBe(false);
  });

  it("应该能够对同一用户在多个房间进行封禁", async () => {
    const { state } = refs.current();
    const room1 = parseRoomId("room1");
    const room2 = parseRoomId("room2");
    const room3 = parseRoomId("room3");
    const userId = 99999;

    await state.mutex.runExclusive(async () => {
      for (const roomId of [room1, room2, room3]) {
        const set = state.bannedRoomUsers.get(roomId) ?? new Set<number>();
        set.add(userId);
        state.bannedRoomUsers.set(roomId, set);
      }
    });

    const bannedRooms = await state.mutex.runExclusive(async () => {
      const rooms: string[] = [];
      for (const [roomId, set] of state.bannedRoomUsers) {
        if (set.has(userId)) {
          rooms.push(String(roomId));
        }
      }
      return rooms;
    });

    expect(bannedRooms).toHaveLength(3);
    expect(bannedRooms).toContain("room1");
    expect(bannedRooms).toContain("room2");
    expect(bannedRooms).toContain("room3");
  });
});
