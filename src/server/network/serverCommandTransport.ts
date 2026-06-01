import { BinaryWriter } from "../../common/binary.js";
import { encodeServerCommand, type ServerCommand } from "../../common/commands.js";

export type PreparedServerCommand = {
  frame: Buffer;
  highPriority: boolean;
};

const HIGH_PRIORITY_TYPES = new Set<ServerCommand["type"]>([
  "Pong",
  "Authenticate",
  "ChangeState",
  "ChangeHost",
  "OnJoinRoom",
  "Message"
]);

export function isHighPriorityServerCommand(cmd: ServerCommand): boolean {
  return HIGH_PRIORITY_TYPES.has(cmd.type);
}

export function prepareServerCommand(cmd: ServerCommand): PreparedServerCommand {
  // 预留 5 字节头部（u32 LEB128 长度前缀上限），编码完成后原地回填长度，
  // 直接得到「长度前缀 + body」帧，省去单独的 header 分配与 body 拷贝。
  const w = new BinaryWriter(512, 5);
  encodeServerCommand(w, cmd);
  return {
    frame: w.toFrameBuffer(),
    highPriority: isHighPriorityServerCommand(cmd)
  };
}