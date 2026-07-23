import assert from "node:assert/strict";
import test from "node:test";

function asyncStub(initialValue) {
  let value = initialValue;
  const fn = async (...args) => {
    fn.lastCall = { args };
    return value;
  };
  fn.resolves = (nextValue) => {
    value = nextValue;
  };
  return fn;
}

async function createDispatcherHarness() {
  const debuggerListeners = [];
  const native = {
    notifications: [],
    connectionGeneration: () => 1,
    notifyHost(method, params) {
      this.notifications.push({ method, params });
    },
    async requestHost() {
      return {};
    },
  };
  const chrome = {
    runtime: {
      id: "test-extension",
      getManifest: () => ({ version: "0.4.0" }),
    },
    storage: {
      local: {
        async get() {
          return {};
        },
        async set() {},
      },
      session: {
        async get() {
          return {};
        },
        async set() {},
      },
    },
    debugger: {
      onEvent: { addListener(listener) { debuggerListeners.push(listener); } },
      onDetach: { addListener() {} },
      attach: asyncStub(undefined),
      detach: asyncStub(undefined),
      sendCommand: asyncStub(undefined),
      emitEvent(source, method, params) {
        for (const listener of debuggerListeners) listener(source, method, params);
      },
    },
    tabs: {
      create: asyncStub({ id: 101, url: "about:blank" }),
      get: asyncStub({ id: 101, url: "about:blank", title: "" }),
      query: asyncStub([]),
      update: asyncStub(undefined),
      reload: asyncStub(undefined),
      remove: asyncStub(undefined),
      sendMessage: asyncStub(undefined),
    },
    tabGroups: {
      group: asyncStub(1),
      update: asyncStub(undefined),
      query: asyncStub([]),
    },
    scripting: {
      executeScript: asyncStub([{ result: undefined }]),
    },
  };
  globalThis.chrome = chrome;
  const { RuntimeDispatcher } = await import("../dist/extension/runtime/RuntimeDispatcher.js");
  const dispatcher = new RuntimeDispatcher(native);
  await dispatcher.ready();
  return { dispatcher, chrome, native };
}

test("extension success responses preserve void results across native messaging JSON", async () => {
  const { createSuccessResponse } = await import("../dist/extension/runtime/RuntimeDispatcher.js");

  const serialized = JSON.parse(JSON.stringify(createSuccessResponse("void-1", undefined)));

  assert.deepEqual(serialized, {
    jsonrpc: "2.0",
    id: "void-1",
    result: null,
  });
  assert.equal(createSuccessResponse("false-1", false).result, false);
  assert.equal(createSuccessResponse("zero-1", 0).result, 0);
});

test("dispatcher exposes active JavaScript dialogs and handles them", async () => {
  const { dispatcher, chrome, native } = await createDispatcherHarness();
  dispatcher.leases.get = async () => ({ chromeTabId: 101 });

  chrome.debugger.emitEvent({ tabId: 101 }, "Page.javascriptDialogOpening", {
    type: "confirm",
    message: "Continue?",
  });

  const get = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "dialog-get-1",
    method: "tab_js_dialog_get",
    params: { tabId: "lume-tab:1" },
  });
  assert.deepEqual(get.result, { type: "confirm", message: "Continue?", defaultValue: undefined });

  const handle = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "dialog-handle-1",
    method: "tab_js_dialog_handle",
    params: { tabId: "lume-tab:1", accept: true },
  });
  assert.equal(handle.result, null);
  assert.deepEqual(chrome.debugger.sendCommand.lastCall.args, [
    { tabId: 101 },
    "Page.handleJavaScriptDialog",
    { accept: true },
  ]);
  assert.equal(native.notifications.length, 0);

  chrome.debugger.emitEvent({ tabId: 101 }, "Page.javascriptDialogClosed", {});
  const closed = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "dialog-get-2",
    method: "tab_js_dialog_get",
    params: { tabId: "lume-tab:1" },
  });
  assert.equal(closed.result, null);
});

test("dispatcher rejects raw CDP commands and reads buffered events", async () => {
  const { dispatcher, chrome } = await createDispatcherHarness();
  dispatcher.leases.get = async () => ({ chromeTabId: 101 });
  const sent = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "cdp-send-1",
    method: "tab_cdp_send",
    params: {
      tabId: "lume-tab:1",
      method: "Runtime.evaluate",
      params: { expression: "document.visibilityState" },
    },
  });
  assert.equal(sent.error.code, "E_UNSUPPORTED");

  chrome.debugger.emitEvent({ tabId: 101 }, "Network.requestWillBeSent", {
    requestId: "request-1",
  });
  const current = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "cdp-events-current",
    method: "tab_cdp_read_events",
    params: { tabId: "lume-tab:1", options: {} },
  });
  assert.equal(current.result.events.length, 0);
  assert.equal(current.result.cursor, 1);

  const read = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "cdp-events-read",
    method: "tab_cdp_read_events",
    params: {
      tabId: "lume-tab:1",
      options: { afterSequence: 0, limit: 1, methods: ["Network.requestWillBeSent"] },
    },
  });
  assert.deepEqual(read.result, {
    cursor: 1,
    events: [
      {
        method: "Network.requestWillBeSent",
        params: { requestId: "request-1" },
        sequence: 1,
        source: { tabId: 101 },
      },
    ],
    hasMore: false,
    truncated: false,
  });
});

test("dispatcher reports bot detection with hostname only", async () => {
  const { dispatcher, chrome, native } = await createDispatcherHarness();
  dispatcher.leases.get = async () => ({ chromeTabId: 101 });
  chrome.tabs.get.resolves({
    id: 101,
    url: "https://accounts.example.test/challenge?token=secret",
    title: "Blocked",
  });

  const report = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "bot-report-1",
    method: "tab_bot_detection_report",
    params: { tabId: "lume-tab:1", reason: "captcha_failed" },
  });

  assert.deepEqual(report.result, {
    hostname: "accounts.example.test",
    status: "reported",
  });
  assert.deepEqual(native.notifications, [
    {
      method: "browser.botDetection.report",
      params: {
        context: undefined,
        tabId: "lume-tab:1",
        hostname: "accounts.example.test",
        reason: "captcha_failed",
      },
    },
  ]);
  assert.equal(JSON.stringify(native.notifications).includes("token=secret"), false);
});

test("dispatcher moves the visible cursor for locator hover and scroll", async () => {
  const { dispatcher, chrome } = await createDispatcherHarness();
  dispatcher.leases.get = async () => ({ chromeTabId: 101 });
  dispatcher.pw.operation = async (_tabId, _locator, operation) => {
    if (operation === "actionPoint") return { x: 40, y: 60 };
    throw new Error(`Unexpected operation: ${operation}`);
  };

  const hover = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "locator-hover-1",
    method: "playwright_locator_hover",
    params: { tabId: "lume-tab:1", locator: { version: 1, steps: [{ kind: "locator", selector: "button" }] } },
  });
  assert.equal(hover.result, null);
  assert.deepEqual(chrome.tabs.sendMessage.lastCall.args, [101, { type: "LUME_CURSOR_MOVE", x: 40, y: 60, pulse: false }]);
  assert.deepEqual(chrome.debugger.sendCommand.lastCall.args, [
    { tabId: 101 },
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: 40, y: 60 },
  ]);

  const scroll = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "locator-scroll-1",
    method: "playwright_locator_scroll",
    params: { tabId: "lume-tab:1", locator: { version: 1, steps: [{ kind: "locator", selector: "button" }] }, deltaX: 5, deltaY: 300 },
  });
  assert.equal(scroll.result, null);
  assert.deepEqual(chrome.debugger.sendCommand.lastCall.args, [
    { tabId: 101 },
    "Input.dispatchMouseEvent",
    { type: "mouseWheel", x: 40, y: 60, deltaX: 5, deltaY: 300 },
  ]);
});
