/**
 * 欢迎消息生成模块
 *
 * 在用户认证成功后,生成包含房间列表、服务器提示、一言的欢迎消息,
 * 以系统聊天形式发送给用户。
 */
import type { ServerState } from "../../core/state.js";
import type { User } from "../../game/user.js";
import { getHitokotoCached } from "../../utils/hitokotoCache.js";
import { getAvailableRoomsText } from "./roomListCache.js";

/**
 * 生成并发送欢迎消息(系统聊天)
 *
 * 内容包括: 30 行清屏空行 + 欢迎语 + 房间列表 + 服务器提示(可选) + 一言。
 * 任何环节失败都不会抛出异常,只会记录到 ERROR 日志,以避免阻塞认证流程。
 *
 * @param opts.user - 已认证的用户
 * @param opts.state - 服务器状态
 * @param opts.sendSystemChat - 发送系统聊天的回调
 */
export async function sendWelcomeExtras(opts: {
  user: User;
  state: ServerState;
  sendSystemChat: (content: string) => Promise<void>;
}): Promise<void> {
  const { user, state, sendSystemChat } = opts;
  try {
    const lang = user.lang;
    const tip = state.config.room_list_tip;
    const hitokoto = await getHitokotoCached(state.config.outbound_proxy);

    // 30 行换行用于清屏
    let message = "\n".repeat(30);
    message += lang.format("chat-welcome", { userName: user.name, serverName: state.serverName }) + "\n";
    message += "=".repeat(73) + "\n";
    message += lang.format("chat-roomlist-title") + "\n";
    message += getAvailableRoomsText(state, lang) + "\n";
    message += "=".repeat(73) + "\n";
    if (tip) message += tip + "\n";
    if (hitokoto) {
      const fromText = hitokoto.from ? hitokoto.from : lang.format("chat-hitokoto-from-unknown");
      message += `${hitokoto.quote} —— ${fromText}`;
    } else {
      message += lang.format("chat-hitokoto-unavailable");
    }
    await sendSystemChat(message);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    state.logger.log("ERROR", errorMsg);
  }
}
