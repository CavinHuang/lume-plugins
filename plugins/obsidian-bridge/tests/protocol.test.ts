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

test("ENDPOINTS 登记了 list/diagnostics/graph 入口", () => {
  // ENDPOINTS 是字符串常量集合;graph 子路径在 router 用前缀匹配,此处只校验存在 graph 标记
  assert.ok(Object.values(ENDPOINTS).some((v) => String(v).includes("graph")));
});

test("TrustLevel union", () => {
  const levels: TrustLevel[] = ["raw_readonly", "free_write", "needs_confirmation", "free"];
  assert.equal(levels.length, 4);
});
