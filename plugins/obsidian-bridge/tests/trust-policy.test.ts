import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTrust } from "../src/obsidian-app/trust-policy.ts";

test("raw/ is raw_readonly at any depth", () => {
  assert.equal(classifyTrust("raw/x.pdf"), "raw_readonly");
  assert.equal(classifyTrust("raw/sub/a.png"), "raw_readonly");
});

test("sources/ and memory inbox/feedback are free_write", () => {
  assert.equal(classifyTrust("sources/note.md"), "free_write");
  assert.equal(classifyTrust("memory/inbox/2026-07-03.md"), "free_write");
  assert.equal(classifyTrust("memory/feedback/2026-07-03.md"), "free_write");
});

test("long-term memory zones need confirmation", () => {
  for (const p of [
    "people/zhang.md",
    "projects/x.md",
    "wiki/concept.md",
    "decisions/d1.md",
    "daily/today.md",
    "palace/room.md",
    "profile.md",
    "vault.md",
    "style.md",
    "memory_policy.md",
  ]) {
    assert.equal(classifyTrust(p), "needs_confirmation", p);
  }
});

test("other paths are free", () => {
  assert.equal(classifyTrust("meetings/abc.md"), "free");
  assert.equal(classifyTrust("Inbox/note.md"), "free"); // 区分大小写:不是 memory/inbox/
});
