import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoomCard } from "../src/obsidian-app/palace.ts";

const MD = `# digest_note_room

## 触发场景
消化一篇笔记时进入此房间。

## 必读(按顺序)
- profile.md
- vault.md
- style.md

## 条件读
- 涉及人:people/<谁>.md
- 涉及项目:projects/<什么>.md

## 输出位置
memory/inbox/<date>.md

## 坑 / 禁区
- 不要直接写 people/ 或 projects/
`;

test("parse five sections", () => {
  const card = parseRoomCard(MD);
  assert.equal(card.trigger.trim(), "消化一篇笔记时进入此房间。");
  assert.deepEqual(card.mustRead, ["profile.md", "vault.md", "style.md"]);
  assert.equal(card.conditionalRead.length, 2);
  assert.equal(card.outputLocation.trim(), "memory/inbox/<date>.md");
  assert.equal(card.pitfalls.length, 1);
});

test("missing sections default to empty", () => {
  const card = parseRoomCard("# x\n## 触发场景\n仅触发\n");
  assert.deepEqual(card.mustRead, []);
  assert.deepEqual(card.conditionalRead, []);
});
