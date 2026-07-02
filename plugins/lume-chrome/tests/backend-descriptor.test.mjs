import assert from "node:assert/strict";
import test from "node:test";

import { PROTOCOL_VERSION } from "../dist/shared/protocol.js";
import { createFakeBackend } from "./helpers/fake-browser-backend.mjs";

test("fake iab backend advertises a versioned descriptor and records calls", async () => {
  const backend = createFakeBackend({
    id: "local-iab",
    type: "iab",
    generation: 3,
    metadata: { channel: "test" },
    browserCapabilities: [{ id: "browser.openTabs", description: "List open tabs" }],
    tabCapabilities: [{ id: "tab.screenshot", description: "Capture screenshots" }],
    apiSupportOverrides: { "Tabs.finalize": false },
  });

  const params = { context: { browserSessionId: "session-1", browserTurnId: "turn-1", actor: "agent" } };
  const browsers = await backend.transport.send("runtime_list_browsers", params);

  assert.equal(PROTOCOL_VERSION, 5);
  assert.deepEqual(backend.calls, [{ method: "runtime_list_browsers", params }]);
  assert.notEqual(browsers[0], backend.descriptor);
  assert.deepEqual(browsers, [
    {
      id: "local-iab",
      name: "Lume Local Browser",
      type: "iab",
      protocolVersion: 5,
      generation: 3,
      metadata: { channel: "test" },
      capabilities: {
        browser: [{ id: "browser.openTabs", description: "List open tabs" }],
        tab: [{ id: "tab.screenshot", description: "Capture screenshots" }],
      },
      apiSupportOverrides: { "Tabs.finalize": false },
    },
  ]);
});

test("fake extension backend uses the Chrome default name", () => {
  const backend = createFakeBackend({ type: "extension" });

  assert.equal(backend.descriptor.name, "Lume Chrome");
  assert.equal(backend.descriptor.type, "extension");
  assert.equal(backend.descriptor.generation, 1);
});

test("fake backend returns configured responses as clones", async () => {
  const backend = createFakeBackend();
  const configured = { tabId: "tab-1", nested: { title: "Configured" } };

  backend.respond("get_tab", configured);
  const first = await backend.transport.send("get_tab", { tabId: "tab-1" });
  first.nested.title = "mutated";

  assert.deepEqual(await backend.transport.send("get_tab", { tabId: "tab-1" }), configured);
  assert.deepEqual(backend.calls.map((call) => call.method), ["get_tab", "get_tab"]);
});

test("fake backend supports function responses and rejects missing methods", async () => {
  const backend = createFakeBackend();

  backend.respond("echo", (params) => ({ echoed: params.value }));

  assert.deepEqual(await backend.transport.send("echo", { value: 42 }), { echoed: 42 });
  await assert.rejects(
    () => backend.transport.send("missing_method", {}),
    /No fake response for missing_method/,
  );
});
