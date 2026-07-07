import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBridgeToolError } from "../src/mcp/tools.ts";
import { BridgeError } from "../src/mcp/obsidian-client.ts";
import { ERROR_CODES } from "../src/shared/protocol.ts";

test("formatBridgeToolError 把 needs_confirmation 翻译为可操作指引", () => {
  const msg = formatBridgeToolError(
    new BridgeError(ERROR_CODES.needs_confirmation, "writing to people/x.md requires confirmation", 409),
  );
  assert.match(msg, /people\/x\.md/);
  assert.match(msg, /confirmed=true/);
});
