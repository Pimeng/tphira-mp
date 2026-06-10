/**
 * Phira MP 服务器主入口文件
 *
 * 负责解析命令行参数、加载配置并启动服务器。
 * 支持通过 CLI 参数、环境变量和配置文件三种方式配置服务器。
 *
 * 配置优先级：命令行参数 > 环境变量 > 配置文件
 */
import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import yaml from "js-yaml";
import { startServer } from "./core/server.js";
import {
  buildConfigFromRecord,
  parseBoolValue,
  parseIntegerListValue,
  parsePortValue,
  parseRoomMaxUsersValue
} from "./core/configValues.js";
import { Language, tl } from "./utils/l10n.js";
import { getAppPaths } from "./utils/appPaths.js";

/**
 * 解析启动时的语言设置
 *
 * 用于 CLI 参数校验错误的本地化提示。
 * 优先级与运行时一致：
 *   1. 环境变量 PHIRA_MP_LANG
 *   2. 环境变量 LANG
 *   3. 配置文件中的 LANG 字段
 *   4. 空字符串（默认回退到 zh-CN）
 *
 * @returns 解析后的 Language 实例
 */
function resolveStartupLang(): Language {
  const envLang = process.env.PHIRA_MP_LANG?.trim() || process.env.LANG?.trim();
  if (envLang) return new Language(envLang);
  try {
    const { configPath } = getAppPaths();
    if (existsSync(configPath)) {
      const cfg = buildConfigFromRecord(yaml.load(readFileSync(configPath, "utf8")));
      if (cfg.lang) return new Language(cfg.lang);
    }
  } catch {
    // 配置文件读取失败时静默回退（main 阶段不应因此中断）
  }
  return new Language("");
}

/**
 * 主函数：解析 CLI 参数并启动服务器
 *
 * 支持的命令行参数：
 *   --host          监听主机地址
 *   -p, --port      监听端口
 *   --httpService   是否启用 HTTP 服务 (true/false)
 *   --httpPort      HTTP 服务端口
 *   --gui           启动时打开服务端 GUI 窗口（自动开启 HTTP 服务）
 *   --roomMaxUsers  房间最大用户数
 *   --serverName    服务器名称
 *   --monitors      观战权限用户 ID 列表（逗号分隔）
 */
async function main(): Promise<void> {
  const lang = resolveStartupLang();
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      host: { type: "string" },
      port: { type: "string", short: "p" },
      httpService: { type: "string" },
      httpPort: { type: "string" },
      gui: { type: "boolean" },
      roomMaxUsers: { type: "string" },
      serverName: { type: "string" },
      monitors: { type: "string" }
    },
    allowPositionals: true
  });

  /**
   * 辅助函数：解析并校验 CLI 参数值
   * @param raw - 原始字符串值
   * @param parser - 解析函数
   * @param errorKey - 解析失败时的本地化错误消息键
   * @returns 解析后的值，若 raw 为 undefined 则返回 undefined
   */
  const requireParse = <T>(
    raw: string | undefined,
    parser: (v: unknown) => T | undefined,
    errorKey: string
  ): T | undefined => {
    if (raw === undefined) return undefined;
    const out = parser(raw);
    if (out === undefined) throw new Error(tl(lang, errorKey));
    return out;
  };

  // 解析各个 CLI 参数
  const host = values.host?.trim() || undefined;
  const port = requireParse(values.port, parsePortValue, "cli-invalid-port");
  const http_service = requireParse(values.httpService, parseBoolValue, "cli-invalid-http-service");
  const http_port = requireParse(values.httpPort, parsePortValue, "cli-invalid-http-port");
  const room_max_users = requireParse(values.roomMaxUsers, parseRoomMaxUsersValue, "cli-invalid-room-max-users");
  const server_name = values.serverName?.trim() || undefined;
  const monitors = requireParse(values.monitors, parseIntegerListValue, "cli-invalid-monitors");

  /**
   * 优雅关闭服务器
   * 处理 SIGINT / SIGTERM 信号以及 CLI 的 stop/shutdown 命令，确保资源正确释放。
   * 前置声明，使其引用可作为 onShutdownRequest 传入 startServer。
   */
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  let stopping = false;
  const stop = async (exitCode = 0): Promise<void> => {
    if (stopping) return;
    stopping = true;
    try {
      await running?.close();
    } catch (e) {
      running?.logger.error(`Error during shutdown: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      process.exit(exitCode);
    }
  };

  // 启动服务器，将 CLI 参数作为配置传入
  running = await startServer({
    host,
    port,
    config: {
      ...(http_service !== undefined ? { http_service } : {}),
      ...(http_port !== undefined ? { http_port } : {}),
      ...(values.gui === true ? { gui: true } : {}),
      ...(room_max_users !== undefined ? { room_max_users } : {}),
      ...(server_name !== undefined ? { server_name } : {}),
      ...(monitors !== undefined ? { monitors } : {})
    },
    // CLI 输入 stop/shutdown 时走与信号一致的优雅关闭路径
    onShutdownRequest: () => void stop(),
    // 真实启动：配置文件缺失时自动生成默认配置
    autoCreateConfig: true
  });

  // 注册进程信号处理器
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());

  // 进程级异常兜底：避免单个未捕获错误拖垮整个进程（导致所有房间 / 玩家一起掉线）。
  // - unhandledRejection：多数源自单次异步操作失败，记录后继续运行，不退出；
  // - uncaughtException：进程状态可能已不可靠，记录后优雅关闭并以非零码退出，
  //   交由守护进程（systemd / docker restart / pm2）拉起，实现自动恢复。
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    running?.logger.error(`[unhandledRejection] ${msg}`);
  });
  process.on("uncaughtException", (err) => {
    running?.logger.error(`[uncaughtException] ${err.stack ?? err.message}`);
    void stop(1);
  });
}

// 启动主程序，捕获未处理的异常
main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[FATAL] Server failed to start: ${message}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
