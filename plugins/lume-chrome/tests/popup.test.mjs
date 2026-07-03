import assert from "node:assert/strict";
import test from "node:test";

import { buildPopupViewModel } from "../dist/popup/popup.js";

test("popup view model summarizes connection, host, permissions, and capability health", () => {
  const model = buildPopupViewModel({
    status: "connected",
    host: "com.lume.browser",
    connected: true,
    updatedAt: 1782895721755,
    diagnostics: {
      extension: { version: "0.4.0" },
      permissions: { debugger: "granted", tabs: "granted", history: "optional" },
      capabilities: {
        browser: [{ id: "visibility" }],
        tab: [{ id: "cdp" }, { id: "browserAuth" }],
      },
    },
  });

  assert.equal(model.tone, "ok");
  assert.equal(model.statusLabel, "Connected");
  assert.equal(model.hostLabel, "com.lume.browser");
  assert.deepEqual(model.permissionCards.map((item) => `${item.id}:${item.state}`), [
    "debugger:granted",
    "tabs:granted",
    "history:optional",
  ]);
  assert.deepEqual(model.capabilityCards.map((item) => item.id), ["visibility", "cdp", "browserAuth"]);
  assert.doesNotMatch(model.detailsText, /password|token|cookie/i);
});

test("popup view model gives actionable reconnecting state", () => {
  const model = buildPopupViewModel({
    status: "reconnecting",
    host: "com.lume.browser",
    connected: false,
    lastError: "failed to connect",
  });

  assert.equal(model.tone, "warn");
  assert.equal(model.statusLabel, "Reconnecting");
  assert.match(model.primaryActionLabel, /diagnostics/i);
  assert.match(model.summary, /native host/i);
});
