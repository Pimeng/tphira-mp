/**
 * 欢迎消息生成模块
 *
 * 在用户认证成功后,生成包含房间列表、服务器提示、一言的欢迎消息,
 * 以系统聊天形式发送给用户。
 */
import type { ServerState } from "../../core/state.js";
import type { User } from "../../game/user.js";
import { getAvailableRoomsText } from "./roomListCache.js";

type HitokotoValue = { quote: string; from: string };

/**
 * 生成并发送欢迎消息(系统聊天)
 *
 * 内容包括: 清屏空行 + 欢迎语 + 房间列表 + 服务器提示(可选) + 一言。
 * 任何环节失败都不会抛出异常,只会记录到 ERROR 日志,以避免阻塞认证流程。
 *
 * @param opts.user - 已认证的用户
 * @param opts.state - 服务器状态
 * @param opts.sendSystemChat - 发送系统聊天的回调
 * @param opts.hitokoto - 预获取的一言数据(来自认证阶段预热,避免重复请求)
 */
export async function sendWelcomeExtras(opts: {
  user: User;
  state: ServerState;
  sendSystemChat: (content: string) => Promise<void>;
  hitokoto?: HitokotoValue | null;
}): Promise<void> {
  const { user, state, sendSystemChat, hitokoto } = opts;
  try {
    const lang = user.lang;
    const tip = state.config.room_list_tip;
    const sep = "=".repeat(73) + "\n";

    const parts: string[] = [];
    parts.push("\n".repeat(10));
    parts.push(lang.format("chat-welcome", { userName: user.name, serverName: state.serverName }) + "\n");
    parts.push(sep);
    parts.push(lang.format("chat-welcome-version", { version: state.version }) + "\n");
    parts.push(sep);
    parts.push(lang.format("chat-roomlist-title") + "\n");
    parts.push(getAvailableRoomsText(state, lang) + "\n");
    parts.push(sep);
    if (tip) parts.push(tip + "\n");
    if (hitokoto) {
      const fromText = hitokoto.from || lang.format("chat-hitokoto-from-unknown");
      parts.push(lang.format("chat-hitokoto", { quote: hitokoto.quote, from: fromText }));
    }
    await sendSystemChat(parts.join(""));
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    state.logger.log("ERROR", errorMsg);
  }
}
