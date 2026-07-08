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

  assert.equal(browsers.length, 3);
  assert.deepEqual(browsers[0], {
    id: "chrome-extension",
    browserId: "chrome-extension",
    name: "Lume Chrome",
    type: "extension",
    clientType: "extension",
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
        { id: "cdp", description: "Read buffered CDP events and send permitted CDP commands." },
        { id: "botDetection", description: "Report bot detection or access-control blockers for this tab." },
        { id: "browserAuth", description: "Securely collect user credentials and fill validated login forms." },
      ],
    },
    apiSupportOverrides: {
      "Tabs.content": false,
      "Tab.content": false,
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
      cdp: "available",
      cua: "available",
      dom_cua: "available",
      playwright: "limited",
      pageAssets: "available",
      tabGroups: "available",
      history: "limited",
      contentExport: "available",
      fileChooser: "available",
      downloads: "available",
      browserAuth: "available",
    },
  });
  assert.deepEqual(browsers.slice(1).map((browser) => browser.clientType), ["iab", "cdp"]);
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
    {
      id: "cdp",
      name: "CDP",
      scope: "tab",
      description: "Read buffered CDP events and send permitted CDP commands.",
      state: "available",
    },
    {
      id: "botDetection",
      name: "Bot detection",
      scope: "tab",
      description: "Report bot detection or access-control blockers for this tab.",
      state: "available",
    },
    {
      id: "browserAuth",
      name: "Browser auth",
      scope: "tab",
      description: "Securely collect user credentials and fill a validated login form without returning values to the agent.",
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
  assert.match(
    await dispatch(dispatcher, "tab_capability_documentation", { capabilityId: "cdp" }),
    /readEvents/,
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
  const dispatcher = createDispatcher();
  dispatcher.leases.get = async () => ({ chromeTabId: 77 });
  dispatcher.pw.operation = async (tabId, locator, operation, payload) => {
    calls.push({ tabId, locator, operation, payload });
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
      operation: "type",
      payload: { tabId: "lume-tab:1", locator, text: " appended", timeoutMs: 250 },
    },
  ]);
});
