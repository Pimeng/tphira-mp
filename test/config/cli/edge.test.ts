import { describe, expect, it } from "vitest";
import { parseRoomId } from "../../../src/common/roomId.js";
import { Room } from "../../../src/server/game/room.js";
import { useCliTestSuite } from "./_setup.js";

describe("CLI 边界情况处理", () => {
  const refs = useCliTestSuite();

  it("应该正确处理不存在的房间", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("nonexistent");
    const room = await state.mutex.runExclusive(async () => {
      return state.rooms.get(roomId);
    });

    expect(room).toBeUndefined();
  });

  it("应该正确处理不存在的用户", async () => {
    const { state } = refs.current();
    const user = await state.mutex.runExclusive(async () => {
      return state.users.get(99999);
    });

    expect(user).toBeUndefined();
  });

  it("应该正确处理重复封禁", async () => {
    const { state } = refs.current();
    const userId = 12345;

    await state.mutex.runExclusive(async () => {
      state.bannedUsers.add(userId);
      state.bannedUsers.add(userId); // 重复添加
      state.bannedUsers.add(userId); // 再次重复
    });

    const count = await state.mutex.runExclusive(async () => {
      return state.bannedUsers.size;
    });

    // Set 会自动去重
    expect(count).toBe(1);
  });

  it("应该正确处理解封不存在的用户", async () => {
    const { state } = refs.current();
    // 删除不存在的用户不应该抛出错误
    await state.mutex.runExclusive(async () => {
      state.bannedUsers.delete(99999);
    });

    expect(true).toBe(true);
  });

  it("应该正确处理空房间列表", async () => {
    const { state } = refs.current();
    const rooms = await state.mutex.runExclusive(async () => {
      return [...state.rooms.values()];
    });

    expect(rooms).toHaveLength(0);
  });

  it("应该正确处理空用户列表", async () => {
    const { state } = refs.current();
    const users = await state.mutex.runExclusive(async () => {
      return [...state.users.values()];
    });

    expect(users).toHaveLength(0);
  });

  it("应该正确处理空封禁列表", async () => {
    const { state } = refs.current();
    const banned = await state.mutex.runExclusive(async () => {
      return [...state.bannedUsers];
    });

    expect(banned).toHaveLength(0);
  });

  it("应该正确处理超长房间ID", async () => {
    // 房间ID最大长度为20
    const longRoomId = "a".repeat(21);

    expect(() => parseRoomId(longRoomId)).toThrow();
  });

  it("应该正确处理特殊字符的房间ID", async () => {
    const { state } = refs.current();
    const validRoomIds = ["room_123", "room-test", "Room123", "test_room-01"];

    for (const roomId of validRoomIds) {
      const parsed = parseRoomId(roomId);
      const room = new Room({
        id: parsed,
        hostId: 100,
        maxUsers: 8,
        replayEligible: true
      });

      await state.mutex.runExclusive(async () => {
        state.rooms.set(parsed, room);
      });

      const exists = await state.mutex.runExclusive(async () => {
        return state.rooms.has(parsed);
      });

      expect(exists).toBe(true);

      // 清理
      await state.mutex.runExclusive(async () => {
        state.rooms.delete(parsed);
      });
    }
  });

  it("应该正确处理大量封禁用户", async () => {
    const { state } = refs.current();
    // 测试封禁1000个用户
    const userIds = Array.from({ length: 1000 }, (_, i) => 10000 + i);

    await state.mutex.runExclusive(async () => {
      for (const id of userIds) {
        state.bannedUsers.add(id);
      }
    });

    const count = await state.mutex.runExclusive(async () => {
      return state.bannedUsers.size;
    });

    expect(count).toBe(1000);

    // 清理
    await state.mutex.runExclusive(async () => {
      state.bannedUsers.clear();
    });
  });
});
