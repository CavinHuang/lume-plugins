import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPairingCode } from "../src/obsidian-app/pairing-ui.ts";

test("formatPairingCode groups pairing code for display", () => {
  assert.equal(formatPairingCode("123456"), "123 456");
  assert.equal(formatPairingCode("1234567"), "123 456 7");
});

test("formatPairingCode shows fallback when code is missing", () => {
  assert.equal(formatPairingCode(""), "—");
});
