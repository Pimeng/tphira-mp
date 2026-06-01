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
  const w = new BinaryWriter(512, 5);
  encodeServerCommand(w, cmd);
  return {
    frame: w.toFrameBuffer(),
    highPriority: isHighPriorityServerCommand(cmd)
  };
}