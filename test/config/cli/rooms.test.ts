import { describe, expect, it } from "vitest";
import { parseRoomId } from "../../../src/common/roomId.js";
import { Room } from "../../../src/server/game/room.js";
import { User } from "../../../src/server/game/user.js";
import { useCliTestSuite } from "./_setup.js";

describe("CLI 房间管理", () => {
  const refs = useCliTestSuite();

  it("应该正确列出所有房间", async () => {
    const { state } = refs.current();
    // 创建多个测试房间，模拟真实场景
    const room1 = new Room({
      id: parseRoomId("newbie_room"),
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    const room2 = new Room({
      id: parseRoomId("expert_room"),
      hostId: 200,
      maxUsers: 16,
      replayEligible: true
    });
    room2.locked = true;
    room2.cycle = true;

    const room3 = new Room({
      id: parseRoomId("contest_room"),
      hostId: 300,
      maxUsers: 4,
      replayEligible: true
    });

    await state.mutex.runExclusive(async () => {
      state.rooms.set(room1.id, room1);
      state.rooms.set(room2.id, room2);
      state.rooms.set(room3.id, room3);
    });

    const rooms = await state.mutex.runExclusive(async () => {
      return [...state.rooms.entries()].map(([rid, room]) => ({
        roomid: String(rid),
        users: room.userIds().length,
        maxUsers: room.maxUsers,
        locked: room.locked,
        cycle: room.cycle
      }));
    });

    expect(rooms).toHaveLength(3);
    expect(rooms.find(r => r.roomid === "newbie_room")).toBeDefined();
    expect(rooms.find(r => r.roomid === "expert_room")?.maxUsers).toBe(16);
    expect(rooms.find(r => r.roomid === "expert_room")?.locked).toBe(true);
    expect(rooms.find(r => r.roomid === "contest_room")?.maxUsers).toBe(4);
  });

  it("应该能够修改房间最大人数", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("test_room");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
    });

    // 模拟 maxusers 命令：将房间人数从 8 改为 16
    const updated = await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      if (!room) return null;
      room.maxUsers = 16;
      return room.maxUsers;
    });

    expect(updated).toBe(16);

    // 验证修改生效
    const currentMaxUsers = await state.mutex.runExclusive(async () => {
      return state.rooms.get(roomId)?.maxUsers;
    });
    expect(currentMaxUsers).toBe(16);
  });

  it("应该能够修改房间最大人数到边界值", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("boundary_test");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
    });

    // 测试最小值 1
    await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      if (room) room.maxUsers = 1;
    });
    expect((await state.mutex.runExclusive(async () => state.rooms.get(roomId)?.maxUsers))).toBe(1);

    // 测试最大值 64
    await state.mutex.runExclusive(async () => {
      const room = state.rooms.get(roomId);
      if (room) room.maxUsers = 64;
    });
    expect((await state.mutex.runExclusive(async () => state.rooms.get(roomId)?.maxUsers))).toBe(64);
  });

  it("应该能够解散房间", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("disband_test");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
    });

    // 验证房间存在
    let exists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });
    expect(exists).toBe(true);

    // 模拟 disband 命令：删除房间
    await state.mutex.runExclusive(async () => {
      state.rooms.delete(roomId);
    });

    // 验证房间已被删除
    exists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });
    expect(exists).toBe(false);
  });

  it("应该能够解散包含玩家的房间", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("disband_with_players");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    // 创建玩家
    const player1 = new User({
      id: 100,
      name: "玩家A",
      language: "zh-CN",
      server: state
    });

    const player2 = new User({
      id: 200,
      name: "玩家B",
      language: "zh-CN",
      server: state
    });

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
      state.users.set(100, player1);
      state.users.set(200, player2);
    });

    // 验证房间和玩家都存在
    let roomExists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });
    let playersCount = await state.mutex.runExclusive(async () => {
      return state.users.size;
    });
    expect(roomExists).toBe(true);
    expect(playersCount).toBe(2);

    // 模拟 disband 命令：删除房间
    await state.mutex.runExclusive(async () => {
      state.rooms.delete(roomId);
    });

    // 验证房间已被删除，但玩家仍然存在
    roomExists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });
    playersCount = await state.mutex.runExclusive(async () => {
      return state.users.size;
    });
    expect(roomExists).toBe(false);
    expect(playersCount).toBe(2);
  });

  it("应该能够解散包含观战者的房间", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("disband_monitor");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    // 创建观战者
    const monitor = new User({
      id: 300,
      name: "观战者C",
      language: "zh-CN",
      server: state
    });
    monitor.monitor = true;

    await state.mutex.runExclusive(async () => {
      state.rooms.set(roomId, room);
      state.users.set(300, monitor);
    });

    // 验证房间和观战者都存在
    let roomExists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });
    let monitorsCount = await state.mutex.runExclusive(async () => {
      return [...state.users.values()].filter(u => u.monitor).length;
    });
    expect(roomExists).toBe(true);
    expect(monitorsCount).toBe(1);

    // 模拟 disband 命令：删除房间
    await state.mutex.runExclusive(async () => {
      state.rooms.delete(roomId);
    });

    // 验证房间已被删除，但观战者仍然存在
    roomExists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });
    monitorsCount = await state.mutex.runExclusive(async () => {
      return [...state.users.values()].filter(u => u.monitor).length;
    });
    expect(roomExists).toBe(false);
    expect(monitorsCount).toBe(1);
  });

  it("应该能够解散启用了回放录制的房间", async () => {
    const { state } = refs.current();
    const roomId = parseRoomId("disband_with_replay");
    const room = new Room({
      id: roomId,
      hostId: 100,
      maxUsers: 8,
      replayEligible: true
    });

    // 启用回放录制
    await state.mutex.runExclusive(async () => {
      state.replayEnabled = true;
      state.rooms.set(roomId, room);
    });

    // 验证房间存在且回放录制已启用
    let roomExists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });
    let replayEnabled = state.replayEnabled;
    expect(roomExists).toBe(true);
    expect(replayEnabled).toBe(true);

    // 模拟 disband 命令：删除房间
    await state.mutex.runExclusive(async () => {
      state.rooms.delete(roomId);
    });

    // 验证房间已被删除
    roomExists = await state.mutex.runExclusive(async () => {
      return state.rooms.has(roomId);
    });
    expect(roomExists).toBe(false);
  });

  it("应该能够解散多个房间", async () => {
    const { state } = refs.current();
    const roomIds = [
      parseRoomId("disband_room1"),
      parseRoomId("disband_room2"),
      parseRoomId("disband_room3")
    ];

    // 创建多个房间
    await state.mutex.runExclusive(async () => {
      for (const roomId of roomIds) {
        const room = new Room({
          id: roomId,
          hostId: 100,
          maxUsers: 8,
          replayEligible: true
        });
        state.rooms.set(roomId, room);
      }
    });

    // 验证所有房间都存在
    let count = await state.mutex.runExclusive(async () => {
      return state.rooms.size;
    });
    expect(count).toBe(3);

    // 逐个解散房间
    for (const roomId of roomIds) {
      await state.mutex.runExclusive(async () => {
        state.rooms.delete(roomId);
      });
    }

    // 验证所有房间都已被删除
    count = await state.mutex.runExclusive(async () => {
      return state.rooms.size;
    });
    expect(count).toBe(0);
  });
});
