import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../../src/client/client.js";
import { startServer } from "../../src/server/core/server.js";
import { cleanupTempDir, createTempDir, setupMockFetch, waitFor } from "../helpers.js";

describe("Phira Multiplayer Protocol & State Machine", () => {
    const { originalFetch, mockFetch } = setupMockFetch();

    beforeAll(() => {
        globalThis.fetch = mockFetch;
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
    });

    test("应当遵循完整的图表状态机全流程 (SelectChart -> WaitingForReady -> Playing -> SelectChart)", async () => {
        const tempDir = await createTempDir("phira-sm-full");
        const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
        const port = running.address().port;

        const host = await Client.connect("127.0.0.1", port);
        const player = await Client.connect("127.0.0.1", port);

        try {
            await host.authenticate("a".repeat(32));
            await player.authenticate("b".repeat(32));

            await host.createRoom("room_sm_root");
            await player.joinRoom("room_sm_root", false); // 以普通玩家身份加入

            // 1. Initial State: SelectChart
            expect(host.roomState()?.type).toBe("SelectChart");
            expect(player.roomState()?.type).toBe("SelectChart");

            // 2. 房主选择歌曲并请求开始
            await host.selectChart(12345);
            await waitFor(() => host.roomState()?.type === "SelectChart" && (host.roomState() as any).id === 12345);
            
            await host.requestStart();
            
            // Wait for transition to WaitingForReady
            await waitFor(() => host.roomState()?.type === "WaitingForReady");
            await waitFor(() => player.roomState()?.type === "WaitingForReady");

            expect(host.roomState()?.type).toBe("WaitingForReady");

            // 3. 玩家进行准备，一旦所有人都 Ready，服务器自动进入 Playing 状态
            await player.ready();
            // host.ready() 不应被调用，因为他在 RequestStart 的时候就已经算在 started 里面了

            await waitFor(() => host.roomState()?.type === "Playing");
            await waitFor(() => player.roomState()?.type === "Playing");

            // 4. 游玩结束，上报成绩 (Played)
            await host.played(1);
            // 这里只有 host 发送了 played，服务器应该还在等 player，所以还是 Playing
            // 注意这里短时间内状态依然是 Playing，除非 player 也提交或者强制结束

            await player.played(2);

            // 当全部玩家汇报成绩完毕后，房间退回 SelectChart
            await waitFor(() => host.roomState()?.type === "SelectChart");
            await waitFor(() => player.roomState()?.type === "SelectChart");
            
        } finally {
            await host.close();
            await player.close();
            await running.close();
            await cleanupTempDir(tempDir);
        }
    });

    test("非房主不能执行越权操作 (如 SelectChart, RequestStart 等)", async () => {
        const tempDir = await createTempDir("phira-sm-perms");
        const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
        const port = running.address().port;

        const host = await Client.connect("127.0.0.1", port);
        const player = await Client.connect("127.0.0.1", port);

        try {
            await host.authenticate("a".repeat(32));
            await host.createRoom("room_perms");
            await player.authenticate("b".repeat(32));
            await player.joinRoom("room_perms", false);

            expect(host.isHost()).toBe(true);
            expect(player.isHost()).toBe(false);

            // 玩家尝试选歌，应当被服务端拒绝
            await expect(player.selectChart(999)).rejects.toThrow();
            // 确保状态没有变
            expect((player.roomState() as any).id).not.toBe(999);
            
            // 主机选歌确保流程正常可测试下一步
            await host.selectChart(111);
            await waitFor(() => (host.roomState() as any).id === 111);

            // 玩家尝试启动游戏，应当被服务端拒绝
            await expect(player.requestStart()).rejects.toThrow();
            
            // 状态应该依然是 SelectChart，越权操作未生效
            expect(host.roomState()?.type).toBe("SelectChart");

        } finally {
            await host.close();
            await player.close();
            await running.close();
            await cleanupTempDir(tempDir);
        }
    });

    test("游戏中途玩家离开 (Abort) 应当正确处理房内状态", async () => {
        const tempDir = await createTempDir("phira-sm-abort");
        const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
        const port = running.address().port;

        const host = await Client.connect("127.0.0.1", port);
        const player = await Client.connect("127.0.0.1", port);

        try {
            await host.authenticate("a".repeat(32));
            await host.createRoom("room_abort");
            
            await player.authenticate("b".repeat(32));
            await player.joinRoom("room_abort", false);

            await host.selectChart(222);
            await host.requestStart();

            // 双方准备
            await player.ready();
            // host.ready() 省略

            await waitFor(() => host.roomState()?.type === "Playing");
            
            // 正在游玩阶段，玩家突然终止退出（或者点此了 Abort）
            await player.abort();

            // 此时由于玩家已经中断并退出（或被视为提前结束此局），房主依然在 Playing
            // 一旦房主发送自己完成的信号
            await host.played(1);

            // 系统不需要再等那个 abort 掉的 player，直接流转回 SelectChart
            await waitFor(() => host.roomState()?.type === "SelectChart", 1500);

        } finally {
            await host.close();
            await player.close();
            await running.close();
            await cleanupTempDir(tempDir);
        }
    });

    test("观战者(Monitor)的连接不影响正常状态机推进", async () => {
        const tempDir = await createTempDir("phira-sm-monitor");
        const running = await startServer({ port: 0, config: { replay_base_dir: tempDir, monitors: [300] } });
        const port = running.address().port;

        const host = await Client.connect("127.0.0.1", port);
        const player = await Client.connect("127.0.0.1", port);
        const spectator = await Client.connect("127.0.0.1", port);

        try {
            await host.authenticate("a".repeat(32));
            await host.createRoom("room_monitor");
            
            await player.authenticate("b".repeat(32));
            await player.joinRoom("room_monitor", false);

            await spectator.authenticate("c".repeat(32)); // "c"x32 should mock the 3rd user
            await spectator.joinRoom("room_monitor", true); // 注意：此时为观战者 monitor = true

            // 确认身份
            expect(spectator.state()?.users.get(spectator.me()!.id)?.monitor).toBe(true);

            await host.selectChart(333);
            await host.requestStart();

            // 房主不需要 Ready，但观战者(Monitor)在 Phira-mp 协议中确实需要发出 Ready
            await player.ready();
            await spectator.ready();

            // 所有需要的人都 Ready 后，进入 Playing
            await waitFor(() => host.roomState()?.type === "Playing");
            await waitFor(() => spectator.roomState()?.type === "Playing");

            // 游戏结束
            await host.played(1);
            await player.played(2);

            // 会退回 SelectChart：观战者完全是不干扰状态机的小透明
            await waitFor(() => host.roomState()?.type === "SelectChart");
            await waitFor(() => spectator.roomState()?.type === "SelectChart");
            
        } finally {
            await host.close();
            await player.close();
            await spectator.close();
            await running.close();
            await cleanupTempDir(tempDir);
        }
    });

    test("非游玩状态下丢弃无效及恶意注入的触控/判定帧", async () => {
        const tempDir = await createTempDir("phira-sm-illegal-frame");
        const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
        const port = running.address().port;

        const host = await Client.connect("127.0.0.1", port);
        const player = await Client.connect("127.0.0.1", port);

        try {
            await host.authenticate("a".repeat(32));
            await host.createRoom("room_illegal");
            await player.authenticate("b".repeat(32));
            await player.joinRoom("room_illegal", false);

            expect(host.roomState()?.type).toBe("SelectChart");

            // 在未开始的时段恶意注入触控帧与判定信息
            const maliciousTouches = [{ time: 10, points: [[1, { x: 0, y: 1 }]] as [number, { x: number; y: number }][] }];
            await player.sendTouches(maliciousTouches);
            await player.sendJudges([{ time: 10, line_id: 0, note_id: 0, judgement: 1 }]);

            await new Promise(r => setTimeout(r, 200));

            // 对端（Host）在此期间不可能会受到非游戏状态下的人为注入数据
            expect(host.livePlayer(player.me()!.id).touch_frames.length).toBe(0);
            expect(host.livePlayer(player.me()!.id).judge_events.length).toBe(0);

            // 如果服务端有防御体系，该协议甚至可能直接把 Client 断开或者强踢
            // (断开逻辑取决于具体服务端实现，在这里核心预期是不把脏数据透传分发出去)

        } finally {
            await host.close();
            await player.close();
            await running.close();
            await cleanupTempDir(tempDir);
        }
    });
});
