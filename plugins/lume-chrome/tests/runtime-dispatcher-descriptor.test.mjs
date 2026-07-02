import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeDispatcher } from "../dist/extension/runtime/RuntimeDispatcher.js";
import { PROTOCOL_VERSION } from "../dist/shared/protocol.js";

function createDispatcher() {
  globalThis.chrome = {
    debugger: {
      onEvent: { addListener() {} },
      onDetach: { addListener() {} },
    },
  };
  const native = {
    connectionGeneration: () => 12,
    notifyHost() {},
    requestHost() {
      throw new Error("requestHost should not be called by descriptor tests");
    },
  };
  return new RuntimeDispatcher(native);
}

async function dispatch(dispatcher, method, params = {}) {
  const response = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: `${method}-1`,
    method,
    params,
  });

  if (response.error) throw new Error(response.error.message);
  return response.result;
}

test("runtime descriptor advertises only implemented extension capabilities", async () => {
  const dispatcher = createDispatcher();
  const browsers = await dispatch(dispatcher, "runtime_list_browsers");

  assert.equal(browsers.length, 1);
  assert.deepEqual(browsers[0], {
    id: "extension",
    name: "Lume Chrome",
    type: "extension",
    protocolVersion: PROTOCOL_VERSION,
    generation: 12,
    metadata: {},
    capabilities: {
      browser: [
        { id: "visibility", description: "Show or hide the browser window." },
        { id: "viewport", description: "Set or reset the browser viewport." },
      ],
      tab: [
        { id: "pageAssets", description: "Inventory and bundle rendered page assets." },
      ],
    },
    apiSupportOverrides: {
      "ContentAPI.exportGsuite": false,
      "Tabs.content": false,
      "Tab.cua": false,
      "Tab.dev": false,
      "Tab.dom_cua": false,
      "Tab.getJsDialog": false,
      "TabClipboardAPI.read": false,
      "TabClipboardAPI.write": false,
      "PlaywrightAPI.elementInfo": false,
      "PlaywrightAPI.elementScreenshot": false,
      "PlaywrightAPI.frameLocator": false,
      "PlaywrightAPI.waitForEvent": false,
      "PlaywrightDownload.path": false,
      "PlaywrightFileChooser.setFiles": false,
      "PlaywrightFrameLocator.frameLocator": false,
      "PlaywrightLocator.and": false,
      "PlaywrightLocator.downloadMedia": false,
      "PlaywrightLocator.or": false,
      "PlaywrightLocator.type": false,
    },
  });
});

test("runtime capability commands match the advertised descriptor surface", async () => {
  const dispatcher = createDispatcher();

  assert.deepEqual(await dispatch(dispatcher, "browser_capabilities_list"), [
    {
      id: "visibility",
      name: "Browser visibility",
      scope: "browser",
      description: "Show or hide the browser window.",
      state: "available",
    },
    {
      id: "viewport",
      name: "Viewport control",
      scope: "browser",
      description: "Set or reset the browser viewport.",
      state: "available",
    },
  ]);
  assert.deepEqual(await dispatch(dispatcher, "tab_capabilities_list"), [
    {
      id: "pageAssets",
      name: "Page assets",
      scope: "tab",
      description: "Inventory and bundle rendered page assets.",
      state: "available",
    },
  ]);
  assert.match(
    await dispatch(dispatcher, "browser_capability_documentation", { capabilityId: "visibility" }),
    /set\(true\).*set\(false\)/,
  );
  assert.match(
    await dispatch(dispatcher, "tab_capability_documentation", { capabilityId: "pageAssets" }),
    /bundle/,
  );
});

test("visibility capability adapts between public booleans and controller state", async () => {
  const dispatcher = createDispatcher();
  let received;
  dispatcher.visibility.get = async () => ({ visibility: "visible" });
  dispatcher.visibility.set = async (value) => {
    received = value;
    return { visibility: value };
  };

  assert.equal(await dispatch(dispatcher, "browser_visibility_get"), true);
  await dispatch(dispatcher, "browser_visibility_set", { visible: false });

  assert.equal(received, "hidden");
});
