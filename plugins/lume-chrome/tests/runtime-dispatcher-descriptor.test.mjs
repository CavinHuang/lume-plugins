import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeDispatcher } from "../dist/extension/runtime/RuntimeDispatcher.js";
import { PROTOCOL_VERSION } from "../dist/shared/protocol.js";

function createDispatcher(chromeOverrides = {}) {
  globalThis.chrome = {
    debugger: {
      onEvent: { addListener() {} },
      onDetach: { addListener() {} },
    },
    ...chromeOverrides,
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
    id: "chrome-extension",
    browserId: "chrome-extension",
    name: "Lume Chrome",
    type: "extension",
    clientType: "extension",
    protocolVersion: PROTOCOL_VERSION,
    minSupported: 5,
    maxSupported: 5,
    capabilityHash: "lume-browser-contract-v1-extension",
    generation: 12,
    metadata: {
      networkBoundary: "external-chrome-best-effort",
      credentials: "unavailable",
      agentDownloads: "unavailable",
    },
    capabilities: {
      browser: [
        { id: "visibility", description: "Show or hide the browser window." },
        { id: "viewport", description: "Set or reset the browser viewport." },
      ],
      tab: [
        { id: "botDetection", description: "Report bot detection or access-control blockers for this tab." },
      ],
    },
    apiSupportOverrides: {
      "BrowserUser.history": false,
      "Tabs.content": false,
      "Tab.content": false,
      "Tab.clipboard": false,
      "TabClipboardAPI.read": false,
      "TabClipboardAPI.readText": false,
      "TabClipboardAPI.write": false,
      "TabClipboardAPI.writeText": false,
      "PlaywrightAPI.evaluate": false,
      "PlaywrightAPI.waitForEvent": false,
      "PlaywrightLocator.downloadMedia": false,
      "CUAAPI.downloadMedia": false,
      "DomCUAAPI.downloadMedia": false,
    },
    permissions: {
      debugger: "granted",
      nativeMessaging: "granted",
      tabs: "granted",
      tabGroups: "granted",
      scripting: "granted",
      history: "missing",
      downloads: "missing",
      bookmarks: "missing",
    },
    features: {
      openTabs: "available",
      claimTab: "available",
      cua: "available",
      dom_cua: "available",
      pageAssets: "unavailable",
      tabGroups: "available",
      history: "unavailable",
      contentExport: "unavailable",
      fileChooser: "unavailable",
      downloads: "unavailable",
      browserAuth: "unavailable",
    },
  });
  assert.deepEqual(browsers.slice(1).map((browser) => browser.clientType), []);
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
      id: "botDetection",
      name: "Bot detection",
      scope: "tab",
      description: "Report bot detection or access-control blockers for this tab.",
      state: "available",
    },
  ]);
  assert.match(
    await dispatch(dispatcher, "browser_capability_documentation", { capabilityId: "visibility" }),
    /set\(true\).*set\(false\)/,
  );
  assert.match(
    await dispatch(dispatcher, "tab_capability_documentation", { capabilityId: "botDetection" }),
    /report/,
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

test("navigation is an adapter action and legacy asset writes fail closed", async () => {
  const updates = [];
  const dispatcher = createDispatcher({
    tabs: { async update(tabId, options) { updates.push({ tabId, options }); } },
  });
  dispatcher.sessions.getOrCreate = async () => ({ id: "session" });
  dispatcher.leases.get = async () => ({ chromeTabId: 42 });

  await dispatch(dispatcher, "navigate_tab_url", {
    context: { browserSessionId: "session", browserTurnId: "turn" },
    tabId: "lume-tab:1",
    url: "https://example.com/",
  });
  assert.deepEqual(updates, [{ tabId: 42, options: { url: "https://example.com/", active: true } }]);

  const response = await dispatcher.dispatch({ jsonrpc: "2.0", id: "asset-1", method: "asset_create", params: {} });
  assert.equal(response.error?.code, "E_UNSUPPORTED");
});

test("coordinate CUA mouse actions show the overlay cursor before CDP input", async () => {
  const events = [];
  const injections = [];
  const dispatcher = createDispatcher({
    scripting: {
      async executeScript(details) {
        injections.push(details);
      },
    },
    tabs: {
      async sendMessage(tabId, message) {
        events.push({ type: "cursor", tabId, message });
        return { ok: true };
      },
    },
  });
  dispatcher.leases.get = async () => ({ chromeTabId: 99 });
  dispatcher.cdp.click = async (tabId, x, y, clickCount = 1) => {
    events.push({ type: "cdpClick", tabId, x, y, clickCount });
  };
  dispatcher.cdp.dispatchMouse = async (tabId, eventType, x, y, params = {}) => {
    events.push({ type: "cdpMouse", tabId, eventType, x, y, params });
  };
  dispatcher.cdp.drag = async (tabId, path) => {
    events.push({ type: "cdpDrag", tabId, path });
  };

  await dispatch(dispatcher, "cua_move", { tabId: "lume-tab:1", x: 10, y: 20 });
  await dispatch(dispatcher, "cua_click", { tabId: "lume-tab:1", x: 30, y: 40 });
  await dispatch(dispatcher, "cua_double_click", { tabId: "lume-tab:1", x: 50, y: 60 });
  await dispatch(dispatcher, "cua_drag", { tabId: "lume-tab:1", path: [{ x: 70, y: 80 }, { x: 90, y: 100 }] });
  await dispatch(dispatcher, "cua_scroll", { tabId: "lume-tab:1", x: 110, y: 120, scrollY: 400 });

  assert.deepEqual(
    events.map((event) => event.type === "cursor" ? { type: event.type, x: event.message.x, y: event.message.y } : event),
    [
      { type: "cursor", x: 10, y: 20 },
      { type: "cdpMouse", tabId: 99, eventType: "mouseMoved", x: 10, y: 20, params: {} },
      { type: "cursor", x: 30, y: 40 },
      { type: "cdpClick", tabId: 99, x: 30, y: 40, clickCount: 1 },
      { type: "cursor", x: 50, y: 60 },
      { type: "cdpClick", tabId: 99, x: 50, y: 60, clickCount: 2 },
      { type: "cursor", x: 70, y: 80 },
      { type: "cdpDrag", tabId: 99, path: [{ x: 70, y: 80 }, { x: 90, y: 100 }] },
      { type: "cursor", x: 110, y: 120 },
      { type: "cdpMouse", tabId: 99, eventType: "mouseWheel", x: 110, y: 120, params: { deltaX: 0, deltaY: 400 } },
    ],
  );
  assert.deepEqual(
    injections.map((details) => ({ tabId: details.target.tabId, files: details.files })),
    [
      { tabId: 99, files: ["dist/extension/content/overlay.js"] },
      { tabId: 99, files: ["dist/extension/content/overlay.js"] },
      { tabId: 99, files: ["dist/extension/content/overlay.js"] },
      { tabId: 99, files: ["dist/extension/content/overlay.js"] },
      { tabId: 99, files: ["dist/extension/content/overlay.js"] },
    ],
  );
});

test("playwright locator and/or/type resolve through the page facade", async () => {
  const calls = [];
  const dispatcher = createDispatcher({
    scripting: { executeScript: async () => [{ result: undefined }] },
    tabs: { sendMessage: async () => ({ ok: true }) },
  });
  dispatcher.leases.get = async () => ({ chromeTabId: 77 });
  dispatcher.pw.operation = async (tabId, locator, operation, payload) => {
    calls.push({ tabId, locator, operation, payload });
    if (operation === "actionPoint") return { x: 20, y: 30 };
    return operation === "allTextContents" ? ["value"] : undefined;
  };

  const locator = {
    version: 1,
    steps: [
      { kind: "locator", selector: "button" },
      { kind: "and", locator: { version: 1, steps: [{ kind: "text", text: "Save" }] } },
      { kind: "or", locator: { version: 1, steps: [{ kind: "text", text: "Cancel" }] } },
    ],
  };

  await dispatch(dispatcher, "playwright_locator_type", {
    tabId: "lume-tab:1",
    locator,
    text: " appended",
    timeoutMs: 250,
  });

  assert.deepEqual(calls, [
    {
      tabId: 77,
      locator,
      operation: "actionPoint",
      payload: { tabId: "lume-tab:1", locator, text: " appended", timeoutMs: 250 },
    },
    {
      tabId: 77,
      locator,
      operation: "type",
      payload: { tabId: "lume-tab:1", locator, text: " appended", timeoutMs: 250 },
    },
  ]);
});
