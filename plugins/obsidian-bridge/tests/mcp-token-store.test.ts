import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFileTokenStore } from "../src/mcp/token-store.ts";

test("mcp token store writes, reads, and forgets token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obsidian-token-store-"));
  const store = createFileTokenStore(join(dir, "token.json"));

  assert.equal(await store.read(), null);
  await store.write("TOK");
  assert.equal(await store.read(), "TOK");
  await store.clear();
  assert.equal(await store.read(), null);
});
