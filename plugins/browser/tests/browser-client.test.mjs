import assert from "node:assert/strict";
import test from "node:test";
import { BrowserRegistry, setupBrowserRuntime } from "../dist/browser-client.js";

test("browser plugin exports the canonical BrowserClient runtime", () => {
  assert.equal(typeof BrowserRegistry, "function");
  assert.equal(typeof setupBrowserRuntime, "function");
});
