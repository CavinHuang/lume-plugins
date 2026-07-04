import { test } from "node:test";
import assert from "node:assert/strict";
import { createPairingStore } from "../src/obsidian-app/pairing-store.ts";

test("generate + consume valid code yields token", () => {
  const s = createPairingStore({
    ttlMs: 600000,
    now: () => 1000,
    random: (() => {
      let n = 0;
      return () => String(100000 + n++).padStart(6, "0");
    })(),
  });
  const code = s.generateCode();
  const token = s.consumeCode(code);
  assert.ok(token);
  assert.ok(s.isActive(token));
});

test("code rejected after ttl", () => {
  let t = 1000;
  const s = createPairingStore({
    ttlMs: 600000,
    now: () => t,
    random: () => "123456",
  });
  const code = s.generateCode();
  t += 600001; // 超时
  assert.equal(s.consumeCode(code), null);
});

test("token not active after reset", () => {
  const s = createPairingStore({ ttlMs: 600000, now: () => 1000, random: () => "112233" });
  const code = s.generateCode();
  const token = s.consumeCode(code);
  s.reset();
  assert.equal(s.isActive(token), false);
});
