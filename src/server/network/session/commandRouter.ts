/**
 * 客户端命令路由模块
 *
 * 封装 process() 方法的 switch 调度逻辑,把"输入命令 → 输出响应"的纯路由
 * 与 Session 类的连接生命周期解耦。Session 通过构造一个 CommandContext
 * 委托命令处理,自身只关心连接、认证、心跳、断线等底层事务。
 */
import { err, type StringResult } from "../../../common/binary.js";
import { EMPTY_RECORD } from "../../../common/utils.js";
import type { ClientCommand, JoinRoomResponse, ServerCommand } from "../../../common/commands.js";
import { refreshRoomLive as refreshRoomLiveState } from "../../game/roomUtils.js";
import type { Room, RoomLifecycleOptions } from "../../game/room.js";
import type { User } from "../../game/user.js";
import type { ServerState } from "../../core/state.js";
import type { Chart, RecordData } from "../../core/types.js";
import type { Logger } from "../../utils/logger.js";
import { tl } from "../../utils/l10n.js";
import { logRoomInfo, logRoomMark } from "../../utils/logUtils.js";
import type { MonitorBuffer } from "./monitorBuffer.js";

/**
 * 房间相关回调集合
 *
 * 以 {@link RoomLifecycleOptions}（Room.onUserLeave / checkAllReady 的共享形状）为
 * 单一事实源，在命令路由场景下把必定提供的字段（logger、wsService、状态钩子）收紧
 * 为必填，避免与 room.ts 重复声明同一组回调。
 */
export type RoomCallbacks = RoomLifecycleOptions & {
  logger: Logger;
  wsService: ServerState["wsService"];
  onEnterPlaying: (room: Room) => Promise<void>;
  onGameEnd: (room: Room) => Promise<void>;
};

/**
 * 命令路由所需的上下文
 *
 * 由 Session 在 process() 中构造,把它依赖的能力以最小化接口形式注入,
 * 让 commandRouter 不直接持有 Session 实例,从而避免循环引用。
 */
type CommandContext = {
  state: ServerState;
  user: User;
  errToStr: <T>(fn: () => Promise<T>) => Promise<StringResult<T>>;
  requireRoom: (user: User) => Room;
  broadcastRoom: (room: Room, cmd: ServerCommand) => Promise<void>;
  broadcastRoomFast: (room: Room, cmd: ServerCommand) => void;
  broadcastRoomMessage: (room: Room, msg: Parameters<Room["send"]>[1]) => Promise<void>;
  monitorBuffer: MonitorBuffer;
  processCreateRoom: (user: User, id: string) => Promise<Record<never, never>>;
  processJoinRoom: (user: User, id: string, monitor: boolean) => Promise<JoinRoomResponse>;
  disbandRoom: (room: Room) => Promise<void>;
  checkRoomAllReady: (room: Room) => Promise<void>;
  fetchChart: (user: User, id: number) => Promise<Chart>;
  fetchRecord: (user: User, id: number) => Promise<RecordData>;
  makeRoomCallbacks: (room: Room) => RoomCallbacks;
};

/**
 * 处理一条客户端命令并返回响应(若有)
 *
 * 主要分发以下命令:
 * - 房间生命周期: CreateRoom / JoinRoom / LeaveRoom / LockRoom / CycleRoom
 * - 选谱与就绪: SelectChart / RequestStart / Ready / CancelReady
 * - 游戏过程: Touches / Judges / Played / Abort
 * - 聊天: Chat
 * - 协议元: Authenticate(重复) / Ping
 *
 * @returns 需要回复给客户端的命令,或 null 表示无需回复
 */
export async function processClientCommand(ctx: CommandContext, cmd: ClientCommand): Promise<ServerCommand | null> {
  const { state, user } = ctx;

  switch (cmd.type) {
    case "Authenticate":
      return { type: "Authenticate", result: err(user.lang.format("auth-repeated-authenticate")) };

    case "Chat":
      return {
        type: "Chat",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          logRoomInfo(
            state.logger,
            state.serverLang,
            room.id,
            "log-user-chat",
            { user: user.name },
            { userId: user.id }
          );
          // 限制聊天消息长度，防止恶意客户端发送超大消息
          const MAX_CHAT_LENGTH = 500;
          const rawContent =
            state.config.chat_enabled === false ? tl(user.lang, "chat-disabled-by-server") : cmd.message;
          const content = rawContent.length > MAX_CHAT_LENGTH ? rawContent.slice(0, MAX_CHAT_LENGTH) : rawContent;
          await room.sendAs((c) => ctx.broadcastRoom(room, c), user, content, state.serverLang);
          return EMPTY_RECORD;
        })
      };

    case "Touches": {
      const room = user.room;
      if (!room) return null;
      if (room.state.type !== "Playing") return null;
      if (room.state.aborted.has(user.id) || room.state.results.has(user.id)) return null;
      const last = cmd.frames.at(-1);
      if (last) user.gameTime = last.time;
      // DEBUG 帧日志：先短路判断等级，避免热路径上无谓的格式化与 meta 分配
      if (state.logger.isLevelEnabled("DEBUG")) {
        state.logger.log(
          "DEBUG",
          tl(state.serverLang, "log-user-touches", {
            user: user.name,
            room: room.id,
            count: String(cmd.frames.length)
          }),
          { frames: cmd.frames },
          { userId: user.id }
        );
      }
      if (room.monitors.size > 0) {
        ctx.monitorBuffer.bufferTouches(room, room.monitors, user.id, cmd.frames);
      }
      if (state.replayEnabled && room.replayEligible) {
        state.replayRecorder.appendTouches(room.id, user.id, cmd.frames);
      }
      return null;
    }

    case "Judges": {
      const room = user.room;
      if (!room) return null;
      if (room.state.type !== "Playing") return null;
      if (room.state.aborted.has(user.id) || room.state.results.has(user.id)) return null;
      // DEBUG 帧日志：先短路判断等级，避免热路径上无谓的格式化与 meta 分配
      if (state.logger.isLevelEnabled("DEBUG")) {
        state.logger.log(
          "DEBUG",
          tl(state.serverLang, "log-user-judges", { user: user.name, room: room.id, count: String(cmd.judges.length) }),
          { judges: cmd.judges },
          { userId: user.id }
        );
      }
      if (room.monitors.size > 0) {
        ctx.monitorBuffer.bufferJudges(room, room.monitors, user.id, cmd.judges);
      }
      if (state.replayEnabled && room.replayEligible) {
        state.replayRecorder.appendJudges(room.id, user.id, cmd.judges);
      }
      return null;
    }

    case "CreateRoom":
      return {
        type: "CreateRoom",
        result: await ctx.errToStr(async () => ctx.processCreateRoom(user, cmd.id))
      };

    case "JoinRoom":
      return {
        type: "JoinRoom",
        result: await ctx.errToStr(async () => ctx.processJoinRoom(user, cmd.id, cmd.monitor))
      };

    case "LeaveRoom":
      return {
        type: "LeaveRoom",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          const suffix = user.monitor ? tl(state.serverLang, "label-monitor-suffix") : "";
          logRoomMark(
            state.logger,
            state.serverLang,
            room.id,
            "log-room-left",
            { user: user.name, suffix },
            { userId: user.id }
          );
          const shouldDrop = await room.onUserLeave({
            user,
            ...ctx.makeRoomCallbacks(room),
            disbandRoom: (r) => ctx.disbandRoom(r)
          });
          if (shouldDrop) {
            logRoomInfo(state.logger, state.serverLang, room.id, "log-room-recycled", undefined, { userId: user.id });
            await state.mutex.runExclusive(async () => {
              state.rooms.delete(room.id);
            });
          } else {
            refreshRoomLiveState(room, state.replayEnabled);
          }
          return EMPTY_RECORD;
        })
      };

    case "LockRoom":
      return {
        type: "LockRoom",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          room.checkHost(user);
          room.locked = cmd.lock;
          logRoomMark(
            state.logger,
            state.serverLang,
            room.id,
            "log-room-lock",
            { user: user.name, lock: cmd.lock ? "true" : "false" },
            { userId: user.id }
          );
          await ctx.broadcastRoomMessage(room, { type: "LockRoom", lock: cmd.lock });
          return EMPTY_RECORD;
        })
      };

    case "CycleRoom":
      return {
        type: "CycleRoom",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          room.checkHost(user);
          room.cycle = cmd.cycle;
          logRoomMark(
            state.logger,
            state.serverLang,
            room.id,
            "log-room-cycle",
            { user: user.name, cycle: cmd.cycle ? "true" : "false" },
            { userId: user.id }
          );
          await ctx.broadcastRoomMessage(room, { type: "CycleRoom", cycle: cmd.cycle });
          return EMPTY_RECORD;
        })
      };

    case "SelectChart":
      return {
        type: "SelectChart",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          room.validateSelectChart(user);
          const chart = await ctx.fetchChart(user, cmd.id);
          room.chart = chart;
          logRoomMark(
            state.logger,
            state.serverLang,
            room.id,
            "log-room-select-chart",
            { user: user.name, userId: String(user.id), chart: chart.name },
            { userId: user.id }
          );
          // 并行发送 Message 广播和状态变更，不相互等待
          const msgPromise = ctx.broadcastRoomMessage(room, {
            type: "SelectChart",
            user: user.id,
            name: chart.name,
            id: chart.id
          });
          const statePromise = room.onStateChange((c) => ctx.broadcastRoom(room, c));
          void room.notifyWebSocket(state);
          await Promise.all([msgPromise, statePromise]);
          return EMPTY_RECORD;
        })
      };

    case "RequestStart":
      return {
        type: "RequestStart",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          room.validateStart(user);
          room.resetGameTime((id) => state.users.get(id));
          logRoomMark(
            state.logger,
            state.serverLang,
            room.id,
            "log-room-request-start",
            { user: user.name },
            { userId: user.id }
          );
          const msgPromise = ctx.broadcastRoomMessage(room, { type: "GameStart", user: user.id });
          room.state = { type: "WaitForReady", started: new Set([user.id]) };
          const statePromise = room.onStateChange((c) => ctx.broadcastRoom(room, c));
          void room.notifyWebSocket(state);
          await Promise.all([msgPromise, statePromise]);
          await ctx.checkRoomAllReady(room);
          return EMPTY_RECORD;
        })
      };

    case "Ready":
      return {
        type: "Ready",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          if (room.state.type === "Playing") throw new Error(user.lang.format("room-invalid-state"));
          if (room.state.type === "WaitForReady") {
            if (room.state.started.has(user.id)) throw new Error(user.lang.format("room-already-ready"));
            room.state.started.add(user.id);
            logRoomInfo(
              state.logger,
              state.serverLang,
              room.id,
              "log-room-ready",
              { user: user.name },
              { userId: user.id }
            );
            const msgPromise = ctx.broadcastRoomMessage(room, { type: "Ready", user: user.id });
            void room.notifyWebSocket(state);
            await msgPromise;
            await ctx.checkRoomAllReady(room);
          }
          return EMPTY_RECORD;
        })
      };

    case "CancelReady":
      return {
        type: "CancelReady",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          if (room.state.type === "Playing") throw new Error(user.lang.format("room-invalid-state"));
          if (room.state.type === "WaitForReady") {
            if (!room.state.started.delete(user.id)) throw new Error(user.lang.format("room-not-ready"));
            if (room.hostId === user.id) {
              logRoomMark(
                state.logger,
                state.serverLang,
                room.id,
                "log-room-cancel-game",
                { user: user.name },
                { userId: user.id }
              );
              const msgPromise = ctx.broadcastRoomMessage(room, { type: "CancelGame", user: user.id });
              room.state = { type: "SelectChart" };
              const statePromise = room.onStateChange((c) => ctx.broadcastRoom(room, c));
              void room.notifyWebSocket(state);
              await Promise.all([msgPromise, statePromise]);
            } else {
              logRoomInfo(
                state.logger,
                state.serverLang,
                room.id,
                "log-room-cancel-ready",
                { user: user.name },
                { userId: user.id }
              );
              const msgPromise = ctx.broadcastRoomMessage(room, { type: "CancelReady", user: user.id });
              void room.notifyWebSocket(state);
              await msgPromise;
            }
          }
          return EMPTY_RECORD;
        })
      };

    case "Played":
      return {
        type: "Played",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          const record = await ctx.fetchRecord(user, cmd.id);
          if (record.player !== user.id) throw new Error(user.lang.format("record-invalid"));
          // 反作弊：成绩必须对应本房间当前谱面，防止提交别的（更简单的）谱面成绩冒充。
          // record.chart 缺失（API/旧客户端未返回）时跳过校验，避免误伤正常玩家。
          if (room.chart && typeof record.chart === "number" && record.chart !== room.chart.id) {
            throw new Error(user.lang.format("record-chart-mismatch"));
          }
          logRoomMark(
            state.logger,
            state.serverLang,
            room.id,
            "log-room-played",
            { user: user.name, score: String(record.score), acc: String(record.accuracy) },
            { userId: user.id }
          );
          const msgPromise = ctx.broadcastRoomMessage(room, {
            type: "Played",
            user: user.id,
            score: record.score,
            accuracy: record.accuracy,
            full_combo: record.full_combo
          });
          if (room.state.type === "Playing") {
            if (room.state.aborted.has(user.id)) throw new Error(user.lang.format("room-game-aborted"));
            if (room.state.results.has(user.id)) throw new Error(user.lang.format("record-already-uploaded"));
            room.state.results.set(user.id, record);
            if (state.replayEnabled && room.replayEligible)
              state.replayRecorder.setRecordId(room.id, user.id, record.id);
            void room.notifyWebSocket(state);
            await msgPromise;
            await ctx.checkRoomAllReady(room);
          }
          return EMPTY_RECORD;
        })
      };

    case "Abort":
      return {
        type: "Abort",
        result: await ctx.errToStr(async () => {
          const room = ctx.requireRoom(user);
          if (room.state.type === "Playing") {
            if (room.state.results.has(user.id)) throw new Error(user.lang.format("record-already-uploaded"));
            if (room.state.aborted.has(user.id)) throw new Error(user.lang.format("room-game-aborted"));
            room.state.aborted.add(user.id);
            logRoomMark(
              state.logger,
              state.serverLang,
              room.id,
              "log-room-abort",
              { user: user.name },
              { userId: user.id }
            );
            const msgPromise = ctx.broadcastRoomMessage(room, { type: "Abort", user: user.id });
            void room.notifyWebSocket(state);
            await msgPromise;
            await ctx.checkRoomAllReady(room);
          }
          return EMPTY_RECORD;
        })
      };

    case "Ping":
      return null;
  }

  // 满足 TS 穷尽性: ClientCommand 联合类型完全覆盖
  const _exhaustive: never = cmd;
  return _exhaustive;
}
