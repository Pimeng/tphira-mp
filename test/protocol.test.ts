import { describe, expect, test } from "vitest";
import { decodePacket, encodePacket } from "../src/common/binary.js";
import { decodeClientCommand, encodeClientCommand } from "../src/common/commands.js";

describe("协议二进制编解码", () => {
  test("ClientCommand::Ping", () => {
    const buf = encodePacket({ type: "Ping" }, encodeClientCommand);
    expect(buf).toEqual(Buffer.from([0x00]));
    const decoded = decodePacket(buf, decodeClientCommand);
    expect(decoded).toEqual({ type: "Ping" });
  });

  test("ClientCommand::Authenticate(32字节 token)", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const buf = encodePacket({ type: "Authenticate", token }, encodeClientCommand);

    const expected = Buffer.concat([Buffer.from([0x01, 0x20]), Buffer.from(token, "utf8")]);
    expect(buf).toEqual(expected);

    const decoded = decodePacket(buf, decodeClientCommand);
    expect(decoded).toEqual({ type: "Authenticate", token });
  });

  test("ClientCommand::Touches(含 f16 CompactPos)", () => {
    const frames = [
      {
        time: 1.0,
        points: [[-1, { x: 0, y: 1 }]] as Array<[number, { x: number; y: number }]>
      }
    ];
    const buf = encodePacket({ type: "Touches", frames }, encodeClientCommand);

    const expected = Buffer.from([
      0x03,
      0x01,
      0x00,
      0x00,
      0x80,
      0x3f,
      0x01,
      0xff,
      0x00,
      0x00,
      0x00,
      0x3c
    ]);
    expect(buf).toEqual(expected);

    const decoded = decodePacket(buf, decodeClientCommand);
    expect(decoded).toEqual({ type: "Touches", frames });
  });
});

