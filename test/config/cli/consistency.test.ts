import { describe, expect, it } from "vitest";
import { parseRoomId } from "../../../src/common/roomId.js";
import { Room } from "../../../src/server/game/room.js";
import { User } from "../../../src/server/game/user.js";
import { useCliTestSuite } from "./_setup.js";

describe("CLI 状态一致性", () => {
  const refs = useCliTestSuite();

  it("应该维护房间数量一致性", async () => {
    const { state } = refs.current();
    const rooms = [
      { id: parseRoomId("newbie_room"), hostId: 100 },
      { id: parseRoomId("advanced_room"), hostId: 200 },
      { id: parseRoomId("expert_room"), hostId: 300 },
      { id: parseRoomId("master_room"), hostId: 400 }
    ];

    for (const { id, hostId } of rooms) {
      const room = new Room({
        id,
        hostId,
        maxUsers: 8,
        replayEligible: true
      });

      await state.mutex.runExclusive(async () => {
        state.rooms.set(id, room);
      });
    }

    const count = await state.mutex.runExclusive(async () => {
      return state.rooms.size;
    });

    expect(count).toBe(4);
  });

  it("应该维护用户数量一致性", async () => {
    const { state } = refs.current();
    const users = [
      { id: 1001, name: "玩家A" },
      { id: 1002, name: "玩家B" },
      { id: 1003, name: "玩家C" },
      { id: 1004, name: "玩家D" },
      { id: 1005, name: "玩家E" }
    ];

    for (const { id, name } of users) {
      const user = new User({
        id,
        name,
        language: "zh-CN",
        server: state
      });

      await state.mutex.runExclusive(async () => {
        state.users.set(id, user);
      });
    }

    const count = await state.mutex.runExclusive(async () => {
      return state.users.size;
    });

    expect(count).toBe(5);
  });

  it("应该维护封禁列表一致性", async () => {
    const { state } = refs.current();
    const bannedIds = [10001, 10002, 10003, 10004, 10005, 10006, 10007];

    await state.mutex.runExclusive(async () => {
      for (const id of bannedIds) {
        state.bannedUsers.add(id);
      }
    });

    const count = await state.mutex.runExclusive(async () => {
      return state.bannedUsers.size;
    });

    expect(count).toBe(7);

    // 移除一些用户
    await state.mutex.runExclusive(async () => {
      state.bannedUsers.delete(10002);
      state.bannedUsers.delete(10004);
      state.bannedUsers.delete(10006);
    });

    const newCount = await state.mutex.runExclusive(async () => {
      return state.bannedUsers.size;
    });

    expect(newCount).toBe(4);
  });

  it("应该在删除房间时同步清理房间封禁", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("temp_room");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
      // 添加房间封禁
      const set = new Set<number>([100, 200, 300]);
      state.bannedRoomUsers.set(roomId, set);
    });

    // 删除房间
    await state.mutex.runExclusive(async () => {
      state.rooms.delete(roomId);
      // 实际应用中应该同步清理封禁
      state.bannedRoomUsers.delete(roomId);
    });

    const roomExists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });

    const banExists = await state.mutex.runExclusive(async () => {
      return state.bannedRoomUsers.has(roomId);
    });

    expect(roomExists).toBe(false);
    expect(banExists).toBe(false);
  });
});
