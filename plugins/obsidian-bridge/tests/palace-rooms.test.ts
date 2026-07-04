import { test } from "node:test";
import assert from "node:assert/strict";
import { PALACE_ROOMS } from "../src/obsidian-app/boot.ts";
import { parseRoomCard } from "../src/obsidian-app/palace.ts";

test("PALACE_ROOMS 含 5 张卡且每张可解析五段", () => {
  const ids = PALACE_ROOMS.map((r) => r.path).sort();
  assert.deepEqual(ids, [
    "palace/apply_memory_room.md",
    "palace/digest_note_room.md",
    "palace/review_inbox_room.md",
    "palace/update_profile_room.md",
    "palace/vault_doctor_room.md",
  ]);
  for (const room of PALACE_ROOMS) {
    const card = parseRoomCard(room.md);
    assert.ok(card.trigger.length > 0, `${room.path} 缺触发场景`);
    assert.ok(card.outputLocation.length > 0, `${room.path} 缺输出位置`);
  }
});
