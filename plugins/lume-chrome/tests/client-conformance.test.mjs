import assert from "node:assert/strict";
import test from "node:test";
import { setupBrowserRuntime } from "../dist/client/setupBrowserRuntime.js";
import { createFakeBackend } from "./helpers/fake-browser-backend.mjs";

test("URL selection defaults to IAB without inspecting external Chrome tabs", async () => {
  const fake = createFakeBackend({ id: "lume-iab", type: "iab" });
  fake.respond("runtime_list_browsers", [
    fake.descriptor,
    { ...fake.descriptor, id: "lume-extension", name: "Lume Chrome", type: "extension" },
  ]);
  const runtime = await setupBrowserRuntime({ globals: {}, transport: fake.transport });
  const browser = await runtime.agent.browsers.getForUrl("https://example.com/");
  assert.equal(browser.browserId, "lume-iab");
  assert.equal(fake.calls.some((call) => call.method === "browser_user_open_tabs"), false);
});

test("agent discovers, selects, documents, and invalidates browsers", async () => {
  const fake = createFakeBackend({
    id: "chrome-1",
    type: "extension",
    generation: 7,
    apiSupportOverrides: {
      "CUAAPI.downloadMedia": false,
      "Tabs.content": false,
      "Tab.dom_cua": false,
      "TabClipboardAPI.read": false,
      "TabClipboardAPI.write": false,
      "PlaywrightAPI.frameLocator": false,
      "PlaywrightAPI.waitForEvent": false,
      "PlaywrightDownload.path": false,
      "PlaywrightFileChooser.setFiles": false,
      "PlaywrightFrameLocator.frameLocator": false,
      "PlaywrightLocator.downloadMedia": false,
    },
    browserCapabilities: [{ id: "visibility", description: "Visibility" }],
    tabCapabilities: [{ id: "pageAssets", description: "Page assets" }],
  });
  fake.respond("browser_user_open_tabs", [{ id: "42", url: "https://example.com/" }]);
  fake.respond("get_tab", { tabId: "42" });
  fake.respond("tab_url", "https://example.com/");
  fake.respond("finalize_tabs", undefined);
  fake.respond("browser_user_history", [
    {
      url: "https://example.com/docs",
      title: "Docs",
      lastVisitTime: Date.parse("2026-01-02T03:04:05.000Z"),
    },
  ]);
  fake.respond("tab_content_export", { assetId: "asset-1", path: "C:\\tmp\\page.md" });
  fake.respond("tab_content_export_gsuite", { assetId: "asset-gsuite", path: "C:\\tmp\\sheet.xlsx" });
  fake.respond("tab_js_dialog_get", { type: "confirm", message: "Continue?" });
  fake.respond("tab_js_dialog_handle", undefined);
  fake.respond("tab_clipboard_read_text", "clipboard text");
  fake.respond("tab_clipboard_write_text", undefined);
  fake.respond("cua_move", undefined);
  fake.respond("cua_click", undefined);
  fake.respond("playwright_element_info", [
    {
      tagName: "BUTTON",
      role: "button",
      visibleText: "Save",
      selector: { primary: "button", candidates: ["button"] },
      boundingBox: { x: 10, y: 20, width: 80, height: 30 },
    },
  ]);
  fake.respond("playwright_element_screenshot", { dataBase64: Buffer.from("png").toString("base64") });
  fake.respond("playwright_locator_type", undefined);

  const globals = {};
  const runtime = await setupBrowserRuntime({
    globals,
    transport: fake.transport,
    readDocument: async (name) => `DOC:${name}`,
  });

  assert.equal(globals.agent, runtime.agent);
  assert.equal((await runtime.agent.browsers.list())[0].id, "chrome-1");
  const browser = await runtime.agent.browsers.get("extension");
  assert.equal(browser.browserId, "chrome-1");
  assert.equal(browser.tabs.content, undefined);
  const history = await browser.user.history({
    queries: ["lume", "chrome"],
    from: "2026-01-01T00:00:00.000Z",
    to: new Date("2026-01-03T00:00:00.000Z"),
    limit: 5,
  });
  assert.deepEqual(history, [
    {
      url: "https://example.com/docs",
      title: "Docs",
      dateVisited: "2026-01-02T03:04:05.000Z",
    },
  ]);
  const historyCall = fake.calls.find((call) => call.method === "browser_user_history");
  assert.deepEqual(historyCall.params.options, {
    text: "lume chrome",
    maxResults: 5,
    startTime: Date.parse("2026-01-01T00:00:00.000Z"),
    endTime: Date.parse("2026-01-03T00:00:00.000Z"),
  });
  assert.equal(typeof browser.tabs.finalize, "function");
  const tab = await browser.tabs.get("42");
  assert.equal(typeof tab.getJsDialog, "function");
  const dialog = await tab.getJsDialog();
  assert.equal(dialog.type, "confirm");
  assert.equal(dialog.message, "Continue?");
  await dialog.accept();
  await dialog.dismiss();
  assert.deepEqual(
    fake.calls
      .filter((call) => call.method === "tab_js_dialog_handle")
      .map((call) => call.params),
    [
      {
        context: { browserSessionId: "browser-runtime", browserTurnId: "browser-runtime", actor: "agent" },
        browserId: "chrome-1",
        tabId: "42",
        accept: true,
      },
      {
        context: { browserSessionId: "browser-runtime", browserTurnId: "browser-runtime", actor: "agent" },
        browserId: "chrome-1",
        tabId: "42",
        accept: false,
      },
    ],
  );
  assert.equal(await tab.url(), "https://example.com/");
  assert.equal(typeof tab.content.export, "function");
  assert.equal(typeof tab.content.exportGsuite, "function");
  assert.equal(await tab.content.exportGsuite("xlsx"), "C:\\tmp\\sheet.xlsx");
  const gsuiteCall = fake.calls.find((call) => call.method === "tab_content_export_gsuite");
  assert.equal(gsuiteCall.params.type, "xlsx");
  assert.equal(await tab.content.export(), "C:\\tmp\\page.md");
  const exportCall = fake.calls.find((call) => call.method === "tab_content_export");
  assert.deepEqual(exportCall.params.options, { format: "markdown" });
  assert.equal(tab.clipboard.read, undefined);
  assert.equal(typeof tab.clipboard.readText, "function");
  assert.equal(await tab.clipboard.readText(), "clipboard text");
  assert.equal(tab.clipboard.write, undefined);
  assert.equal(typeof tab.clipboard.writeText, "function");
  await tab.clipboard.writeText("new clipboard text");
  const clipboardWrite = fake.calls.find((call) => call.method === "tab_clipboard_write_text");
  assert.equal(clipboardWrite.params.text, "new clipboard text");
  assert.equal(tab.dom_cua, undefined);
  assert.equal(typeof tab.cua.move, "function");
  assert.equal(typeof tab.cua.click, "function");
  assert.equal(tab.cua.downloadMedia, undefined);
  await tab.cua.move({ x: 12, y: 34 });
  await tab.cua.click({ x: 56, y: 78 });
  assert.deepEqual(
    fake.calls
      .filter((call) => call.method === "cua_move" || call.method === "cua_click")
      .map((call) => ({ method: call.method, x: call.params.x, y: call.params.y })),
    [
      { method: "cua_move", x: 12, y: 34 },
      { method: "cua_click", x: 56, y: 78 },
    ],
  );
  assert.equal(typeof tab.markDeliverable, "function");
  assert.equal(typeof tab.markHandoff, "function");
  await tab.markDeliverable("ready for user");
  await tab.markHandoff("continue next turn");
  const finalizeCalls = fake.calls.filter((call) => call.method === "finalize_tabs");
  assert.deepEqual(finalizeCalls.map((call) => call.params.keep), [
    [{ tabId: "42", status: "deliverable", reason: "ready for user" }],
    [{ tabId: "42", status: "handoff", reason: "continue next turn" }],
  ]);
  assert.deepEqual(finalizeCalls.map((call) => call.params.browserId), ["chrome-1", "chrome-1"]);
  assert.equal(typeof tab.playwright.domSnapshot, "function");
  assert.equal(typeof tab.playwright.evaluate, "function");
  assert.equal(typeof tab.playwright.expectNavigation, "function");
  assert.equal(typeof tab.playwright.waitForURL, "function");
  assert.equal(typeof tab.playwright.waitForLoadState, "function");
  assert.equal(typeof tab.playwright.waitForTimeout, "function");
  assert.equal(typeof tab.playwright.elementInfo, "function");
  assert.deepEqual(await tab.playwright.elementInfo({ x: 10, y: 20 }), [
    {
      tagName: "BUTTON",
      role: "button",
      visibleText: "Save",
      selector: { primary: "button", candidates: ["button"] },
      boundingBox: { x: 10, y: 20, width: 80, height: 30 },
    },
  ]);
  const elementInfoCall = fake.calls.find((call) => call.method === "playwright_element_info");
  assert.deepEqual(elementInfoCall.params.options, { x: 10, y: 20 });
  assert.equal(typeof tab.playwright.elementScreenshot, "function");
  assert.deepEqual([...await tab.playwright.elementScreenshot({ x: 10, y: 20 })], [...Buffer.from("png")]);
  const elementScreenshotCall = fake.calls.find((call) => call.method === "playwright_element_screenshot");
  assert.deepEqual(elementScreenshotCall.params.options, { x: 10, y: 20 });
  assert.equal(tab.playwright.frameLocator, undefined);
  assert.equal(tab.playwright.waitForEvent, undefined);
  const locator = tab.playwright.locator("button");
  assert.equal(typeof locator.click, "function");
  assert.equal(typeof locator.fill, "function");
  assert.equal(typeof locator.allTextContents, "function");
  assert.equal(typeof locator.and, "function");
  assert.equal(typeof locator.or, "function");
  assert.equal(typeof locator.type, "function");
  const andLocator = locator.and(tab.playwright.getByText("Save"));
  const orLocator = locator.or(tab.playwright.getByText("Cancel"));
  assert.equal(typeof andLocator.click, "function");
  assert.equal(typeof orLocator.click, "function");
  await locator.type(" appended", { timeoutMs: 123 });
  const typeCall = fake.calls.find((call) => call.method === "playwright_locator_type");
  assert.deepEqual(typeCall.params.locator, {
    version: 1,
    steps: [{ kind: "locator", selector: "button" }],
  });
  assert.equal(typeCall.params.text, " appended");
  assert.equal(typeCall.params.timeoutMs, 123);
  assert.equal(locator.downloadMedia, undefined);
  assert.match(await browser.documentation(), /DOC:browser-safety/);

  fake.descriptor.generation = 8;
  await runtime.refreshBackends();
  await assert.rejects(tab.url(), /Browser object is stale/);
});

test("setup reuses an existing agent in the same kernel", async () => {
  const fake = createFakeBackend({ id: "iab-1", type: "iab" });
  const globals = {};
  const first = await setupBrowserRuntime({
    globals,
    transport: fake.transport,
    readDocument: async () => "",
  });
  const second = await setupBrowserRuntime({
    globals,
    transport: fake.transport,
    readDocument: async () => "",
  });

  assert.equal(second.agent, first.agent);
});
