import assert from "node:assert/strict";
import test from "node:test";

import { BrowserAuthController } from "../dist/extension/controllers/BrowserAuthController.js";

test("BrowserAuthController validates origin, fills fields, submits, and returns status only", async () => {
  const calls = [];
  const controller = new BrowserAuthController({
    async tabUrl() {
      return "https://accounts.example.test/login?state=secret-query";
    },
    async requestCredentials(request) {
      calls.push({ type: "request", request });
      return {
        status: "approved",
        values: {
          username: "user@example.test",
          password: "password-value",
        },
      };
    },
    async fillField(tabId, selector, value) {
      calls.push({ type: "fill", tabId, selector, value });
    },
    async click(tabId, selector) {
      calls.push({ type: "click", tabId, selector });
    },
    async press(tabId, selector, key) {
      calls.push({ type: "press", tabId, selector, key });
    },
    async validateLocator(tabId, selector) {
      calls.push({ type: "validate", tabId, selector });
      return true;
    },
  });

  const result = await controller.request(7, {
    context: { browserSessionId: "s1", browserTurnId: "t1", actor: "agent" },
    tabId: "lume-tab:1",
    origin: "https://accounts.example.test",
    reason: "Sign in.",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    fields: [
      { id: "username", label: "Email", type: "email", selector: "input[name=email]" },
      { id: "password", label: "Password", type: "password", selector: "input[type=password]" },
    ],
    submit: { selector: "button[type=submit]", action: "click" },
  });

  assert.deepEqual(result, { status: "submitted" });
  assert.deepEqual(calls.filter((call) => call.type === "fill"), [
    { type: "fill", tabId: 7, selector: "input[name=email]", value: "user@example.test" },
    { type: "fill", tabId: 7, selector: "input[type=password]", value: "password-value" },
  ]);
  assert.deepEqual(calls.at(-1), { type: "click", tabId: 7, selector: "button[type=submit]" });
  assert.doesNotMatch(JSON.stringify(result), /password-value|user@example/);
  assert.doesNotMatch(JSON.stringify(calls.find((call) => call.type === "request").request), /secret-query|password-value/);
});

test("BrowserAuthController refuses stale or unsafe requests before asking for credentials", async () => {
  let asked = false;
  const controller = new BrowserAuthController({
    async tabUrl() {
      return "https://evil.example.test/login";
    },
    async requestCredentials() {
      asked = true;
      return { status: "approved", values: {} };
    },
    async fillField() {},
    async click() {},
    async press() {},
    async validateLocator() {
      return true;
    },
  });

  const result = await controller.request(7, {
    context: { browserSessionId: "s1", browserTurnId: "t1", actor: "agent" },
    tabId: "lume-tab:1",
    origin: "https://accounts.example.test",
    reason: "Sign in.",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    fields: [{ id: "password", label: "Password", type: "password", selector: "input[type=password]" }],
  });

  assert.deepEqual(result, { status: "origin_changed" });
  assert.equal(asked, false);
});
