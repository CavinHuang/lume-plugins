import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("MCP bundle is self-contained for Lume plugin installs", async () => {
  const bundle = await readFile(join(__dirname, "..", "dist", "mcp.js"), "utf-8");

  assert.equal(
    /^\s*import\s+.*@modelcontextprotocol\/sdk/m.test(bundle),
    false,
    "dist/mcp.js must not keep external @modelcontextprotocol/sdk imports because installed plugins do not include node_modules",
  );
});
