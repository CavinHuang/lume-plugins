import assert from "node:assert/strict";
import test from "node:test";

test("extension success responses preserve void results across native messaging JSON", async () => {
  const { createSuccessResponse } = await import("../dist/extension/runtime/RuntimeDispatcher.js");

  const serialized = JSON.parse(JSON.stringify(createSuccessResponse("void-1", undefined)));

  assert.deepEqual(serialized, {
    jsonrpc: "2.0",
    id: "void-1",
    result: null,
  });
  assert.equal(createSuccessResponse("false-1", false).result, false);
  assert.equal(createSuccessResponse("zero-1", 0).result, 0);
});
