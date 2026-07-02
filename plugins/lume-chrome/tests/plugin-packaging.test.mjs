import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url);

async function readText(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("plugin manifest matches marketplace identity", async () => {
  const manifest = JSON.parse(await readText("lume-plugin.json"));

  assert.equal(manifest.schema, "lume-plugin/v1");
  assert.equal(manifest.name, "lume-chrome");
  assert.equal(manifest.displayName, "Lume Browse");
  assert.deepEqual(manifest.skills, ["./skills/"]);
  assert.deepEqual(manifest.permissions.tools.allow, ["mcp__node_repl__js"]);
});

test("Chrome extension manifest uses Lume Browse identity", async () => {
  const manifest = JSON.parse(await readText(join("extension", "manifest.json")));

  assert.equal(manifest.name, "Lume Browse");
  assert.equal(manifest.description, "Control Chrome through Lume's browser plugin.");
});

test("browser skill starts through Lume node_repl MCP", async () => {
  const skill = await readText(join("skills", "control-browser", "SKILL.md"));

  assert.match(skill, /^name:\s*lume-chrome$/m);
  assert.match(skill, /mcp__node_repl__js/);
  assert.match(skill, /setupBrowserRuntime|setupNodeReplBrowserRuntime/);
  assert.match(skill, /agent\.browsers\.getForUrl/);
  assert.match(skill, /agent\.browsers\.getDefault/);
  assert.match(skill, /browser\.documentation\(\)/);
  assert.doesNotMatch(skill, /lumeBrowser\.control/);
  assert.doesNotMatch(skill, /browserControl|lumeBrowserControl/);
  assert.doesNotMatch(skill, /D:\\\\workspace/);
  assert.doesNotMatch(skill, /@lume\/browser-client/);
  assert.doesNotMatch(skill, /setupBrowserRuntime\(\{ transport, context \}\)/);
});

test("browser API matrix documents the projected compatibility surface", async () => {
  const matrix = await readText(join("docs", "browser-api-matrix.md"));

  assert.match(matrix, /Codex-compatible public contract/);
  assert.match(matrix, /dynamically hidden/);
  assert.match(matrix, /agent\.browsers\.getForUrl/);
  assert.match(matrix, /agent\.browsers\.getDefault/);
  assert.doesNotMatch(matrix, /lumeBrowser\.control/);
  assert.doesNotMatch(matrix, /webmcp.*implemented/i);
});
