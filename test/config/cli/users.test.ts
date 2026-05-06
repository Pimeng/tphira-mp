import { describe, expect, it } from "vitest";
import { User } from "../../../src/server/game/user.js";
import { useCliTestSuite } from "./_setup.js";

describe("CLI 用户管理", () => {
  const refs = useCliTestSuite();

  it("应该正确列出所有在线用户", async () => {
    const { state } = refs.current();
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
    const { state } = refs.current();
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
    const { state } = refs.current();
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
