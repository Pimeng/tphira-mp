import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "../../src/client/client.js";
import { startServer } from "../../src/server/core/server.js";
import { cleanupTempDir, createTempDir, setupMockFetch, waitFor } from "../helpers.js";

describe("Phira Room Management & Features", () => {
    const { originalFetch, mockFetch } = setupMockFetch();

    beforeAll(() => {
        globalThis.fetch = mockFetch;
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
    });

    test("上锁与轮询周期 (Lock & Cycle) 需要房主权限才可设置与变更", async () => {
        const tempDir = await createTempDir("phira-room-feats");
        const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
        const port = running.address().port;

        const host = await Client.connect("127.0.0.1", port);
        const player = await Client.connect("127.0.0.1", port);

        try {
            await host.authenticate("a".repeat(32));
            await player.authenticate("b".repeat(32));

            await host.createRoom("test_room");
            await player.joinRoom("test_room", false);

            expect(host.state()?.locked).toBe(false);
            
            // Player attempts to lock room
            await expect(player.lockRoom(true)).rejects.toThrow();
            // 应该无效，不能由非房主上锁
            expect(host.state()?.locked).toBe(false);

            // Host locks room
            await host.lockRoom(true);
            await waitFor(() => host.state()?.locked === true);
            await waitFor(() => player.state()?.locked === true);
            
            // Cycle behavior similarly
            await host.cycleRoom(true);
            await waitFor(() => host.state()?.cycle === true);

        } finally {
            await host.close();
            await player.close();
            await running.close();
            await cleanupTempDir(tempDir);
        }
    });

    test("房主中途离开房间应该导致房主身份转移或解散房间", async () => {
        const tempDir = await createTempDir("phira-transfer");
        const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
        const port = running.address().port;

        const host = await Client.connect("127.0.0.1", port);
        const player = await Client.connect("127.0.0.1", port);

        try {
            await host.authenticate("a".repeat(32));
            await player.authenticate("b".repeat(32));

            await host.createRoom("test_room_trans");
            await player.joinRoom("test_room_trans", false);
            
            expect(host.isHost()).toBe(true);
            expect(player.isHost()).toBe(false);

            // Host 退出房间
            await host.leaveRoom();

            // 检查房主是否已移交给 Player
            await waitFor(() => player.isHost() === true, 1000);
            expect(player.state()?.is_host).toBe(true);

        } finally {
            await host.close();
            await player.close();
            await running.close();
            await cleanupTempDir(tempDir);
        }
    });

    test("顶号逻辑：同一 Token 在不同终端登入应切断前驱连接", async () => {
        const tempDir = await createTempDir("phira-kick");
        const running = await startServer({ port: 0, config: { replay_base_dir: tempDir } });
        const port = running.address().port;

        const client1 = await Client.connect("127.0.0.1", port);
        
        try {
            // client 1 正常登入
            await client1.authenticate("a".repeat(32));
            
            // Client 2 使用相同的 Token (模拟被顶号)
            const client2 = await Client.connect("127.0.0.1", port);
            await client2.authenticate("a".repeat(32));

            // Client 1 的底层 Socket 应被服务侧主动强制 Close (断开连接)
            await waitFor(() => (client1 as any).stream?.socket?.destroyed === true, 1000);
            expect((client1 as any).stream?.socket?.destroyed).toBe(true);

            await client2.close();
        } finally {
            if (!(client1 as any).stream?.socket?.destroyed) await client1.close();
            await running.close();
            await cleanupTempDir(tempDir);
        }
    });
});
