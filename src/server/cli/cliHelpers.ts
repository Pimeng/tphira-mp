// CLI handler 通用辅助函数

import { parseRoomId, type RoomId } from "../../common/roomId.js";
import { tl, type Language } from "../utils/l10n.js";

export type Printer = {
  print: (msg: string) => void;
  printError: (msg: string) => void;
  printSuccess: (msg: string) => void;
  printInfo: (msg: string) => void;
};

export function makePrinter(): Printer {
  return {
    print: (msg) => process.stdout.write(`${msg}\n`),
    printError: (msg) => process.stderr.write(`\x1b[31m${msg}\x1b[0m\n`),
    printSuccess: (msg) => process.stdout.write(`\x1b[32m${msg}\x1b[0m\n`),
    printInfo: (msg) => process.stdout.write(`\x1b[36m${msg}\x1b[0m\n`)
  };
}

/** GUI 控制台命令执行后捕获到的一行输出 */
export type ConsoleOutputLine = {
  kind: "out" | "error" | "success" | "info";
  text: string;
};

/**
 * 捕获式 Printer：输出不写终端，而是收集到 lines 数组，
 * 供 GUI 控制台把命令结果回传给请求方。
 */
export function makeCapturePrinter(): { printer: Printer; lines: ConsoleOutputLine[] } {
  const lines: ConsoleOutputLine[] = [];
  const push = (kind: ConsoleOutputLine["kind"]) => (msg: string) => {
    // 多行输出（如 help、列表）拆成独立行，便于前端逐行渲染
    for (const text of msg.split("\n")) lines.push({ kind, text });
  };
  return {
    printer: {
      print: push("out"),
      printError: push("error"),
      printSuccess: push("success"),
      printInfo: push("info")
    },
    lines
  };
}

/** 解析正整数参数；非法时调用 printError 并返回 null。 */
export function parseUserIdArg(
  arg: string | undefined,
  lang: Language,
  printError: (m: string) => void
): number | null {
  const id = Number(arg);
  if (!Number.isInteger(id)) {
    printError(tl(lang, "cli-bad-user-id"));
    return null;
  }
  return id;
}

/** 解析房间 ID 参数；非法时调用 printError 并返回 null。 */
export function parseRoomIdArg(
  arg: string | undefined,
  lang: Language,
  printError: (m: string) => void
): RoomId | null {
  if (!arg) {
    printError(tl(lang, "cli-bad-room-id"));
    return null;
  }
  try {
    return parseRoomId(arg);
  } catch {
    printError(tl(lang, "cli-bad-room-id"));
    return null;
  }
}

/** 解析 1..max 整数；非法时调用 printError 并返回 null。 */
export function parseBoundedIntArg(
  arg: string | undefined,
  min: number,
  max: number,
  errorKey: string,
  lang: Language,
  printError: (m: string) => void
): number | null {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < min || n > max) {
    printError(tl(lang, errorKey));
    return null;
  }
  return n;
}

/** 解析 on/off/status 三态命令；其他值视为非法。 */
type Toggle = "on" | "off" | "status";

export function parseToggleArg(arg: string | undefined): Toggle | null {
  if (arg === undefined || arg === "status") return "status";
  const lower = arg.toLowerCase();
  if (lower === "on" || lower === "off") return lower;
  return null;
}

/** 校验消息长度（默认 200）；超长时打印错误并返回 null。 */
export function validateChatMessage(
  message: string,
  lang: Language,
  printError: (m: string) => void,
  maxLen = 200
): string | null {
  if (message.length === 0) {
    printError(tl(lang, "cli-message-empty"));
    return null;
  }
  if (message.length > maxLen) {
    printError(tl(lang, "cli-message-too-long", { max: maxLen }));
    return null;
  }
  return message;
}
