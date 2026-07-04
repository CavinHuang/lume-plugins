import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_VERSION,
  ERROR_CODES,
  ENDPOINTS,
  type TrustLevel,
} from "../src/shared/protocol.ts";

test("PROTOCOL_VERSION is 1", () => {
  assert.equal(PROTOCOL_VERSION, 1);
});

test("ERROR_CODES covers contract", () => {
  for (const code of [
    "bridge_unreachable",
    "token_invalid",
    "vault_mismatch",
    "protocol_mismatch",
    "raw_readonly",
    "needs_confirmation",
    "not_found",
    "merge_conflict",
  ] as const) {
    assert.equal(ERROR_CODES[code], code);
  }
});

test("ENDPOINTS has health/pair/notes/search/metadata/backlinks/palace/events", () => {
  assert.ok(ENDPOINTS.health && ENDPOINTS.pair && ENDPOINTS.notes);
  assert.ok(ENDPOINTS.search && ENDPOINTS.metadata && ENDPOINTS.backlinks);
  assert.ok(ENDPOINTS.palace && ENDPOINTS.events);
});

test("TrustLevel union", () => {
  const levels: TrustLevel[] = ["raw_readonly", "free_write", "needs_confirmation", "free"];
  assert.equal(levels.length, 4);
});
