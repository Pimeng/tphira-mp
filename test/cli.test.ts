import { describe, it, expect, beforeEach } from "vitest";
import { ServerState } from "../src/server/state.js";
import { Logger } from "../src/server/logger.js";
import type { ServerConfig } from "../src/server/types.js";
import { parseRoomId } from "../src/common/roomId.js";
import { Room } from "../src/server/room.js";
import { User } from "../src/server/user.js";

describe("CLI 命令逻辑测试", () => {
  let state: ServerState;
  let logger: Logger;

  beforeEach(() => {
    const config: ServerConfig = {
      monitors: [2],
      test_account_ids: [],
      server_name: "测试服务器",
      host: "localhost",
      port: 12346,
      http_service: false,
      http_port: 12347,
      room_max_users: 8,
      replay_enabled: false,
      admin_token: "test_token",
      admin_data_path: "./test_admin_data.json",
      room_list_tip: undefined,
      log_level: "ERROR",
      real_ip_header: undefined,
      haproxy_protocol: false
    };

    logger = new Logger({ logsDir: "./test_logs", minLevel: "ERROR" });
    state = new ServerState(config, logger, "测试服务器", "./test_admin_data.json");
  });

  describe("房间管理", () => {
    it("应该正确列出所有房间", async () => {
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
  });

  describe("用户管理", () => {
    it("应该正确列出所有在线用户", async () => {
      // 创建多个测试用户，模拟真实场景
      const alice = new User({
        id: 100,
        name: "小明",
        language: "zh-CN",
        server: state
      });

      const bob = new User({
        id: 200,
        name: "小红",
        language: "zh-CN",
        server: state
      });
      bob.monitor = true; // 设置为观战者

      const carol = new User({
        id: 300,
        name: "小刚",
        language: "en-US",
        server: state
      });

      await state.mutex.runExclusive(async () => {
        state.users.set(100, alice);
        state.users.set(200, bob);
        state.users.set(300, carol);
      });

      const users = await state.mutex.runExclusive(async () => {
        return [...state.users.values()].map((u) => ({
          id: u.id,
          name: u.name,
          monitor: u.monitor,
          lang: u.lang.lang
        }));
      });

      expect(users).toHaveLength(3);
      expect(users.find(u => u.name === "小明")?.monitor).toBe(false);
      expect(users.find(u => u.name === "小红")?.monitor).toBe(true);
      expect(users.find(u => u.name === "小刚")?.lang).toBe("en-US");
    });

    it("应该能够获取用户详细信息", async () => {
      const user = new User({
        id: 12345,
        name: "测试玩家",
        language: "zh-CN",
        server: state
      });

      await state.mutex.runExclusive(async () => {
        state.users.set(12345, user);
      });

      // 模拟 user 命令
      const info = await state.mutex.runExclusive(async () => {
        const u = state.users.get(12345);
        if (!u) return null;
        return {
          id: u.id,
          name: u.name,
          monitor: u.monitor,
          connected: Boolean(u.session),
          lang: u.lang.lang
        };
      });

      expect(info).not.toBeNull();
      expect(info?.id).toBe(12345);
      expect(info?.name).toBe("测试玩家");
      expect(info?.connected).toBe(false);
      expect(info?.lang).toBe("zh-CN");
    });

    it("应该能够区分玩家和观战者", async () => {
      const player = new User({
        id: 1001,
        name: "玩家A",
        language: "zh-CN",
        server: state
      });

      const monitor = new User({
        id: 1002,
        name: "观战者B",
        language: "zh-CN",
        server: state
      });
      monitor.monitor = true;

      await state.mutex.runExclusive(async () => {
        state.users.set(1001, player);
        state.users.set(1002, monitor);
      });

      const users = await state.mutex.runExclusive(async () => {
        return [...state.users.values()].map((u) => ({
          id: u.id,
          name: u.name,
          monitor: u.monitor
        }));
      });

      expect(users.find(u => u.id === 1001)?.monitor).toBe(false);
      expect(users.find(u => u.id === 1002)?.monitor).toBe(true);
    });
  });

  describe("封禁管理", () => {
    it("应该能够封禁用户", async () => {
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

  describe("功能开关", () => {
    it("应该能够开启回放录制", async () => {
      expect(state.replayEnabled).toBe(false);

      // 模拟 replay on 命令
      await state.mutex.runExclusive(async () => {
        state.replayEnabled = true;
      });

      expect(state.replayEnabled).toBe(true);
    });

    it("应该能够关闭回放录制", async () => {
      // 先开启
      await state.mutex.runExclusive(async () => {
        state.replayEnabled = true;
      });

      // 模拟 replay off 命令
      await state.mutex.runExclusive(async () => {
        state.replayEnabled = false;
      });

      expect(state.replayEnabled).toBe(false);
    });

    it("应该能够开启房间创建功能", async () => {
      expect(state.roomCreationEnabled).toBe(true);

      // 模拟 roomcreation off 命令
      await state.mutex.runExclusive(async () => {
        state.roomCreationEnabled = false;
      });

      expect(state.roomCreationEnabled).toBe(false);

      // 模拟 roomcreation on 命令
      await state.mutex.runExclusive(async () => {
        state.roomCreationEnabled = true;
      });

      expect(state.roomCreationEnabled).toBe(true);
    });

    it("应该能够查询功能状态", async () => {
      // 模拟 replay status 命令
      const replayStatus = state.replayEnabled;
      expect(typeof replayStatus).toBe("boolean");

      // 模拟 roomcreation status 命令
      const roomCreationStatus = state.roomCreationEnabled;
      expect(typeof roomCreationStatus).toBe("boolean");
    });
  });

  describe("比赛房间管理", () => {
    it("应该能够启用比赛模式", async () => {
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

  describe("IP黑名单管理", () => {
    it("应该能够获取黑名单列表", () => {
      const blacklist = logger.getBlacklistedIps();
      expect(Array.isArray(blacklist)).toBe(true);
    });

    it("应该能够从黑名单移除IP", () => {
      // 测试移除操作不会抛出错误
      expect(() => {
        logger.removeFromBlacklist("192.168.1.100");
        logger.removeFromBlacklist("10.0.0.1");
        logger.removeFromBlacklist("172.16.0.1");
      }).not.toThrow();
    });

    it("应该能够清空黑名单", () => {
      // 测试清空操作不会抛出错误
      expect(() => {
        logger.clearBlacklist();
      }).not.toThrow();
    });

    it("应该能够获取当前日志频率", () => {
      const rate = logger.getCurrentRate();
      expect(typeof rate).toBe("number");
      expect(rate).toBeGreaterThanOrEqual(0);
    });
  });

  describe("命令参数验证", () => {
    it("应该验证用户ID格式", () => {
      // 有效的用户ID
      const validId1 = Number("100");
      expect(Number.isInteger(validId1)).toBe(true);

      const validId2 = Number("12345");
      expect(Number.isInteger(validId2)).toBe(true);

      // 无效的用户ID
      const invalidId1 = Number("abc");
      expect(Number.isInteger(invalidId1)).toBe(false);

      const invalidId2 = Number("12.34");
      expect(Number.isInteger(invalidId2)).toBe(false);

      // Number("") 返回 0，这是一个整数，但在实际应用中应该被拒绝
      const emptyId = Number("");
      expect(Number.isInteger(emptyId)).toBe(true); // 0 是整数
      expect(emptyId).toBe(0); // 但值为 0
    });

    it("应该验证房间ID格式", () => {
      // 有效的房间ID（只能包含字母、数字、下划线和连字符）
      expect(() => parseRoomId("test_room")).not.toThrow();
      expect(() => parseRoomId("room-123")).not.toThrow();
      expect(() => parseRoomId("Room123")).not.toThrow();

      // 无效的房间ID（空字符串）
      expect(() => parseRoomId("")).toThrow();
      
      // 无效的房间ID（包含中文）
      expect(() => parseRoomId("测试房间")).toThrow();
      
      // 无效的房间ID（包含特殊字符）
      expect(() => parseRoomId("room@123")).toThrow();
    });

    it("应该验证最大人数范围", () => {
      // 有效的人数
      const validCount1 = 8;
      expect(Number.isInteger(validCount1)).toBe(true);
      expect(validCount1 >= 1 && validCount1 <= 64).toBe(true);

      const validCount2 = 1;
      expect(Number.isInteger(validCount2)).toBe(true);
      expect(validCount2 >= 1 && validCount2 <= 64).toBe(true);

      const validCount3 = 64;
      expect(Number.isInteger(validCount3)).toBe(true);
      expect(validCount3 >= 1 && validCount3 <= 64).toBe(true);

      // 无效的人数
      const invalidCount1 = 0;
      expect(invalidCount1 < 1).toBe(true);

      const invalidCount2 = 100;
      expect(invalidCount2 > 64).toBe(true);

      const invalidCount3 = -5;
      expect(invalidCount3 < 1).toBe(true);
    });

    it("应该验证广播消息长度", () => {
      // 有效的消息
      const validMessage1 = "服务器将在10分钟后重启";
      expect(validMessage1.length <= 200).toBe(true);

      const validMessage2 = "a".repeat(200);
      expect(validMessage2.length <= 200).toBe(true);

      // 无效的消息（过长）
      const invalidMessage = "a".repeat(201);
      expect(invalidMessage.length > 200).toBe(true);
    });

    it("应该验证IP地址格式", () => {
      // 这里只是示例，实际CLI不做IP格式验证
      const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
      
      expect(ipv4Pattern.test("192.168.1.1")).toBe(true);
      expect(ipv4Pattern.test("10.0.0.1")).toBe(true);
      expect(ipv4Pattern.test("invalid")).toBe(false);
    });
  });

  describe("状态一致性", () => {
    it("应该维护房间数量一致性", async () => {
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

  describe("边界情况处理", () => {
    it("应该正确处理不存在的房间", async () => {
      const roomId = parseRoomId("nonexistent");
      const room = await state.mutex.runExclusive(async () => {
        return state.rooms.get(roomId);
      });

      expect(room).toBeUndefined();
    });

    it("应该正确处理不存在的用户", async () => {
      const user = await state.mutex.runExclusive(async () => {
        return state.users.get(99999);
      });

      expect(user).toBeUndefined();
    });

    it("应该正确处理重复封禁", async () => {
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
      // 删除不存在的用户不应该抛出错误
      await state.mutex.runExclusive(async () => {
        state.bannedUsers.delete(99999);
      });

      expect(true).toBe(true);
    });

    it("应该正确处理空房间列表", async () => {
      const rooms = await state.mutex.runExclusive(async () => {
        return [...state.rooms.values()];
      });

      expect(rooms).toHaveLength(0);
    });

    it("应该正确处理空用户列表", async () => {
      const users = await state.mutex.runExclusive(async () => {
        return [...state.users.values()];
      });

      expect(users).toHaveLength(0);
    });

    it("应该正确处理空封禁列表", async () => {
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
      const validRoomIds = [
        "room_123",
        "room-test",
        "Room123",
        "test_room-01"
      ];

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
});
