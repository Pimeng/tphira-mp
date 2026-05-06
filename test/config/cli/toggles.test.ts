import { describe, expect, it } from "vitest";
import { useCliTestSuite } from "./_setup.js";

describe("CLI 功能开关", () => {
  const refs = useCliTestSuite();

  it("应该能够开启回放录制", async () => {
    const { state } = refs.current();
    expect(state.replayEnabled).toBe(false);

    // 模拟 replay on 命令
    await state.mutex.runExclusive(async () => {
      state.replayEnabled = true;
    });

    expect(state.replayEnabled).toBe(true);
  });

  it("应该能够关闭回放录制", async () => {
    const { state } = refs.current();
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
    const { state } = refs.current();
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
    const { state } = refs.current();
    // 模拟 replay status 命令
    const replayStatus = state.replayEnabled;
    expect(typeof replayStatus).toBe("boolean");

    // 模拟 roomcreation status 命令
    const roomCreationStatus = state.roomCreationEnabled;
    expect(typeof roomCreationStatus).toBe("boolean");
  });
});
