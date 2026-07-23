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
  const nativeHost = manifest.marketplace.setup.find((step) => step.id === "install-native-host");
  assert.match(nativeHost.description, /写入系统凭证库/);
  assert.match(manifest.marketplace.setup.find((step) => step.id === "keep-chrome-ready").description, /bridge 配置/);
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
  assert.match(skill, /nodeRepl\.browser\.request/);
  assert.match(skill, /__browserBackend:\s*"extension"/);
  assert.match(skill, /chromeRequest\("openTabs"\)/);
  assert.match(skill, /chromeRequest\("claim"/);
  assert.match(skill, /chromeRequest\("fill"/);
  assert.match(skill, /chromeRequest\("snapshot"/);
  assert.match(skill, /Do not use top-level `const` or `let`/);
  assert.match(skill, /Never start a\s+second IPC server/);
  assert.match(skill, /passwords, OTPs, cookies, tokens/);
  assert.doesNotMatch(skill, /setupNodeReplBrowserRuntime/);
  assert.doesNotMatch(skill, /D:\\\\workspace/);
});

test("native host installer keeps pairing secrets out of config files", async () => {
  const installer = await readText(join("scripts", "install-native-host.mjs"));
  assert.match(installer, /\["pairing","store",pairingId\]/);
  assert.match(installer, /schemaVersion:3,endpoint,pairingId,generation,hostPath,hostSha256/);
  assert.doesNotMatch(installer, /schemaVersion:3,endpoint,token/);
  assert.match(installer, /createHash\("sha256"\).*hostPath/);
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
  assert.match(matrix, /dynamically hide/);
  assert.match(matrix, /legacy `lumeBrowser`/);
  assert.match(matrix, /agent\.browsers\.get/);
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
  assert.match(matrix, /`tab\.content`.*`export\(\)`/);
  assert.match(matrix, /`tab`.*`getJsDialog\(\)`/);
  assert.match(matrix, /`cdp`/);
  assert.match(matrix, /`botDetection`/);
  assert.match(matrix, /tab\.playwright/);
  assert.match(matrix, /waitForEvent/);
  assert.match(matrix, /file chooser/);
  assert.match(matrix, /download/);
  assert.match(matrix, /browserAuth/);
  assert.match(matrix, /never receives saved secrets/);
  assert.match(matrix, /arbitrary local paths are never accepted/);
  assert.doesNotMatch(matrix, /webmcp.*implemented/i);
});
