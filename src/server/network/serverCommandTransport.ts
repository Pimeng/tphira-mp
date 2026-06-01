import { encodePacket } from "../../common/binary.js";
import { encodeServerCommand, type ServerCommand } from "../../common/commands.js";
import { encodeLengthPrefixU32 } from "../../common/framing.js";

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
  const body = encodePacket(cmd, encodeServerCommand);
  const header = encodeLengthPrefixU32(body.length);
  return {
    frame: Buffer.concat([header, body]),
    highPriority: isHighPriorityServerCommand(cmd)
  };
}