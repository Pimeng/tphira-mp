import { describe, it, expect } from "vitest";
import { uuidToU64Pair, u64PairToUuid, newUuid } from "../../src/common/uuid.js";

describe("uuidToU64Pair / u64PairToUuid", () => {
  it("往返一致性", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const pair = uuidToU64Pair(uuid);
    const back = u64PairToUuid(pair);
    expect(back).toBe(uuid);
  });

  it("全 0 UUID", () => {
    const uuid = "00000000-0000-0000-0000-000000000000";
    const pair = uuidToU64Pair(uuid);
    expect(pair.high).toBe(0n);
    expect(pair.low).toBe(0n);
    expect(u64PairToUuid(pair)).toBe(uuid);
  });

  it("全 F UUID", () => {
    const uuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const pair = uuidToU64Pair(uuid);
    expect(pair.high).toBe(0xffffffffffffffffn);
    expect(pair.low).toBe(0xffffffffffffffffn);
    expect(u64PairToUuid(pair)).toBe(uuid);
  });

  it("多个 UUID 往返", () => {
    const uuids = [
      "12345678-1234-4678-9abc-def012345678",
      "aabbccdd-eeff-4122-9344-556677889900",
      "00000000-1111-4222-8333-444444444444"
    ];
    for (const uuid of uuids) {
      const pair = uuidToU64Pair(uuid);
      expect(u64PairToUuid(pair)).toBe(uuid);
    }
  });
});

describe("newUuid", () => {
  it("生成有效的 UUID v4", () => {
    const uuid = newUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("每次生成不同", () => {
    const u1 = newUuid();
    const u2 = newUuid();
    expect(u1).not.toBe(u2);
  });
});