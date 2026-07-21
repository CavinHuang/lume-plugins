import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16);
  const extensionId = [...digest]
    .flatMap((byte) => [byte >> 4, byte & 15])
    .map((nibble) => String.fromCharCode(97 + nibble))
    .join("");
  assert.equal(extensionId, "hgoclajdgiicjpnggdkjidkopoleddoe");
});

test("browser skill starts through Lume node_repl MCP", async () => {
  const skill = await readText(join("skills", "control-browser", "SKILL.md"));

  assert.match(skill, /^name:\s*lume-chrome$/m);
  assert.match(skill, /mcp__node_repl__js/);
  assert.match(skill, /setupNodeReplBrowserRuntime/);
  assert.match(skill, /var\s+fs\s*=\s*await import/);
  assert.match(skill, /tabs\.new\(\{\s*url:/);
  assert.match(skill, /Do not use top-level `const` or `let`/);
  assert.match(skill, /If this skill was activated with a concrete user request/);
  assert.match(skill, /When the user explicitly activates this skill, use it even for a public page/);
  assert.match(skill, /Do not use `browser\.tabs\.create`/);
  assert.match(skill, /Do not use `browser\.utils\.wait`/);
  assert.match(skill, /Do not use `bridge\.isConnected`/);
  assert.match(skill, /Always `await agent\.browsers\.get/);
  assert.match(skill, /browser\.documentation\(\)/);
  assert.match(skill, /Browser Auth/);
  assert.match(skill, /Never ask the user to paste credentials into chat/);
  assert.match(skill, /tab\.playwright\.domSnapshot\(\)/);
  assert.match(skill, /tab\.dom_cua\.get_visible_dom\(\)/);
  assert.match(skill, /nodeRepl\.emitImage/);
  assert.match(skill, /docs[\\/]+browser-api-matrix\.md/);
  assert.doesNotMatch(skill, /const\s+fs\s*=\s*await import/);
  assert.doesNotMatch(skill, /const\s+browser\s*=/);
  assert.doesNotMatch(skill, /const\s+tabs\s*=/);
  assert.doesNotMatch(skill, /const\s+tab\s*=/);
  assert.doesNotMatch(skill, /const\s+result\s*=/);
  assert.doesNotMatch(skill, /browser\.user\.updateTab/);
  assert.doesNotMatch(skill, /D:\\\\workspace/);
  assert.doesNotMatch(skill, /@lume\/browser-client/);
  assert.doesNotMatch(skill, /setupBrowserRuntime\(\{ transport, context \}\)/);
});

test("browser API matrix documents the public surface", async () => {
  const matrix = await readText(join("docs", "browser-api-matrix.md"));

  for (const section of [
    "browser",
    "session",
    "tab",
    "navigation",
    "locator",
    "playwright",
    "cua",
    "screenshot",
    "finalize",
    "diagnostics"
  ]) {
    assert.match(matrix, new RegExp(`\\| ${section} \\|`));
  }
  assert.match(matrix, /Codex-compatible public contract/);
  assert.match(matrix, /dynamically hidden/);
  assert.match(matrix, /lumeBrowser\.control\.openUrl/);
  assert.match(matrix, /lumeBrowser\.control\.search/);
  assert.match(matrix, /implemented/);
  assert.match(matrix, /intentionally unsupported/);
  assert.match(matrix, /`tab\.cua\.double_click\(\)`/);
  assert.match(matrix, /`tab\.dom_cua\.get_visible_dom\(\)`/);
  assert.match(matrix, /`locator\.readAll\(\)`/);
  assert.match(matrix, /and\(\)/);
  assert.match(matrix, /or\(\)/);
  assert.match(matrix, /type\(\)/);
  assert.match(matrix, /`tab\.clipboard\.writeText\(\)`/);
  assert.match(matrix, /visibility/);
  assert.match(matrix, /viewport/);
  assert.match(matrix, /pageAssets/);
  assert.match(matrix, /tab\.content\.export\(\)/);
  assert.match(matrix, /tab\.getJsDialog\(\)/);
  assert.match(matrix, /tab\.capabilities\.get\("cdp"\)/);
  assert.match(matrix, /tab\.capabilities\.get\("botDetection"\)/);
  assert.match(matrix, /downloadMedia/);
  assert.match(matrix, /tab\.playwright/);
  assert.match(matrix, /waitForEvent/);
  assert.match(matrix, /file chooser/);
  assert.match(matrix, /download/);
  assert.match(matrix, /Secure Browser Auth/);
  assert.match(matrix, /browserAuth/);
  assert.match(matrix, /never returns password, OTP/);
  assert.doesNotMatch(matrix, /webmcp.*implemented/i);
});
