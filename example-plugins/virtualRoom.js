import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseRoomId, roomIdToString } from "../src/common/roomId.js";

/**
 * 虚拟房间插件
 * 
 * 功能：
 * - 创建一个虚拟房间，所有玩家可见但互不可见
 * - 自动下发谱面选择和开始游戏指令
 * - 收集玩家成绩并保存为 JSON 文件
 * 
 * 使用方法：
 * 1. 玩家加入虚拟房间（房间ID以 "_virtual_" 开头）
 * 2. 插件自动下发谱面并开始游戏
 * 3. 玩家完成游戏后，成绩自动保存到 data/virtual_room_results/ 目录
 */

class VirtualRoomPlugin {
  constructor() {
    this.context = null;
    this.config = {
      roomId: "_virtual_lobby",
      defaultChartId: 1,
      defaultChartName: "Default Chart",
      resultsDir: "data/virtual_room_results",
      autoStartDelay: 3000
    };
    
    this.virtualRooms = new Set();
    this.roomResults = new Map();
    this.roomCharts = new Map();
  }
  
  async onInit(context) {
    this.context = context;
    
    // 确保结果目录存在
    await mkdir(this.config.resultsDir, { recursive: true });
    
    // 创建默认虚拟房间
    this.createVirtualRoom(this.config.roomId);
    
    context.logger.log("INFO", `Virtual Room Plugin initialized with room: ${this.config.roomId}`);
  }
  
  async onDestroy() {
    // 清理虚拟房间
    for (const roomId of this.virtualRooms) {
      const room = this.context.getRoom(parseRoomId(roomId));
      if (room) {
        this.context.state.rooms.delete(parseRoomId(roomId));
      }
    }
    
    this.context.logger.log("INFO", "Virtual Room Plugin destroyed");
  }
  
  /**
   * 创建虚拟房间
   */
  createVirtualRoom(roomId) {
    const room = this.context.createVirtualRoom(parseRoomId(roomId), { maxUsers: 64 });
    
    // 设置默认谱面
    room.chart = {
      id: this.config.defaultChartId,
      name: this.config.defaultChartName
    };
    
    this.virtualRooms.add(roomId);
    this.roomResults.set(roomId, new Map());
    this.roomCharts.set(roomId, room.chart);
    
    this.context.logger.log("INFO", `Created virtual room: ${roomId}`);
  }
  
  /**
   * 检查是否为虚拟房间
   */
  isVirtualRoom(roomId) {
    return this.virtualRooms.has(roomId);
  }
  
  /**
   * 用户加入房间后
   */
  async onUserJoinRoom(user, room) {
    if (!this.isVirtualRoom(roomIdToString(room.id))) return;
    
    this.context.logger.log("INFO", `User ${user.name} (${user.id}) joined virtual room ${room.id}`);
    
    // 发送欢迎消息
    await this.context.sendToUser(user.id, {
      type: "Message",
      message: {
        type: "Chat",
        user: 0,
        content: `欢迎来到虚拟房间！这是一个海选房间，所有玩家互不可见。游戏将自动开始。`
      }
    });
    
    // 延迟后自动下发谱面选择和开始游戏
    setTimeout(() => {
      this.autoStartGame(user, room);
    }, this.config.autoStartDelay);
  }
  
  /**
   * 自动开始游戏
   */
  async autoStartGame(user, room) {
    try {
      // 检查用户是否还在房间
      if (user.room?.id !== room.id) return;
      
      // 下发谱面选择
      const chart = this.roomCharts.get(roomIdToString(room.id));
      if (chart) {
        await this.context.sendToUser(user.id, {
          type: "Message",
          message: {
            type: "SelectChart",
            user: 0,
            name: chart.name,
            id: chart.id
          }
        });
      }
      
      // 下发开始游戏指令
      await this.context.sendToUser(user.id, {
        type: "Message",
        message: {
          type: "GameStart",
          user: 0
        }
      });
      
      // 设置房间状态为等待准备
      if (room.state.type === "SelectChart") {
        room.state = { type: "WaitForReady", started: new Set([user.id]) };
        
        // 通知用户状态变化
        await this.context.sendToUser(user.id, {
          type: "ChangeState",
          state: { type: "WaitingForReady" }
        });
        
        // 自动准备并开始
        setTimeout(async () => {
          if (user.room?.id !== room.id) return;
          
          // 发送开始游戏
          await this.context.sendToUser(user.id, {
            type: "Message",
            message: { type: "StartPlaying" }
          });
          
          // 更新房间状态
          room.state = { type: "Playing", results: new Map(), aborted: new Set() };
          
          await this.context.sendToUser(user.id, {
            type: "ChangeState",
            state: { type: "Playing" }
          });
          
          this.context.logger.log("INFO", `Auto-started game for user ${user.name} in virtual room ${room.id}`);
        }, 1000);
      }
    } catch (e) {
      this.context.logger.log("ERROR", `Failed to auto-start game: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  
  /**
   * 游戏结束后
   */
  async onGameEnd(room, results) {
    if (!this.isVirtualRoom(roomIdToString(room.id))) return;
    
    const roomId = roomIdToString(room.id);
    const chart = this.roomCharts.get(roomId);
    
    if (!chart) return;
    
    // 收集结果
    const players = [];
    
    for (const [userId, record] of results) {
      const user = this.context.getUser(userId);
      if (!user) continue;
      
      players.push({
        userId: user.id,
        userName: user.name,
        score: record.score,
        accuracy: record.accuracy,
        perfect: record.perfect,
        good: record.good,
        bad: record.bad,
        miss: record.miss,
        maxCombo: record.max_combo,
        fullCombo: record.full_combo,
        std: record.std,
        stdScore: record.std_score
      });
    }
    
    // 按分数排序
    players.sort((a, b) => b.score - a.score);
    
    // 保存结果
    const gameResult = {
      timestamp: new Date().toISOString(),
      roomId,
      chartId: chart.id,
      chartName: chart.name,
      players
    };
    
    await this.saveResult(gameResult);
    
    this.context.logger.log("INFO", `Saved virtual room results: ${roomId}, ${players.length} player(s)`);
  }
  
  /**
   * 保存游戏结果
   */
  async saveResult(result) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `result_${result.roomId}_${timestamp}.json`;
    const filepath = join(this.config.resultsDir, filename);
    
    await writeFile(filepath, JSON.stringify(result, null, 2), "utf8");
  }
}

// 导出插件
export default {
  metadata: {
    id: "virtual-room",
    name: "虚拟房间海选插件",
    version: "1.0.0",
    description: "使用虚拟房间来达到自动让玩家提交成绩海选",
    author: "Pimeng",
    enabled: false // 默认不启用，需要手动启用
  },
  hooks: new VirtualRoomPlugin()
};
