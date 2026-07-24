import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

test("browser package embeds the canonical contract", () => {
  const hash = (path) => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
  assert.equal(hash("../../../shared/browser-contract.json"), hash("../src/browser-contract.json"));
});

test("browser package embeds the canonical generated BrowserClient", () => {
  const hash = (path) => createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex");
  assert.equal(hash("../../lume-chrome/dist/client/BrowserClient.js"), hash("../dist/client/BrowserClient.js"));
  assert.equal(hash("../../lume-chrome/dist/client/setupBrowserRuntime.js"), hash("../dist/client/setupBrowserRuntime.js"));
});
