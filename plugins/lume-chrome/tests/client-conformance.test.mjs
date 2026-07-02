import assert from "node:assert/strict";
import test from "node:test";
import { setupBrowserRuntime } from "../dist/client/setupBrowserRuntime.js";
import { createFakeBackend } from "./helpers/fake-browser-backend.mjs";

test("agent discovers, selects, documents, and invalidates browsers", async () => {
  const fake = createFakeBackend({
    id: "chrome-1",
    type: "extension",
    generation: 7,
    apiSupportOverrides: {
      "Tabs.content": false,
      "Tab.getJsDialog": false,
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
    browserCapabilities: [{ id: "visibility", description: "Visibility" }],
    tabCapabilities: [{ id: "pageAssets", description: "Page assets" }],
  });
  fake.respond("browser_user_open_tabs", [{ id: "42", url: "https://example.com/" }]);
  fake.respond("get_tab", { tabId: "42" });
  fake.respond("tab_url", "https://example.com/");
  fake.respond("finalize_tabs", undefined);

  const globals = {};
  const runtime = await setupBrowserRuntime({
    globals,
    transport: fake.transport,
    readDocument: async (name) => `DOC:${name}`,
  });

  assert.equal(globals.agent, runtime.agent);
  assert.equal((await runtime.agent.browsers.list())[0].id, "chrome-1");
  const browser = await runtime.agent.browsers.getForUrl("https://example.com/");
  assert.equal(browser.browserId, "chrome-1");
  assert.equal(browser.tabs.content, undefined);
  assert.equal(typeof browser.tabs.finalize, "function");
  const tab = await browser.tabs.get("42");
  assert.equal(tab.getJsDialog, undefined);
  assert.equal(await tab.url(), "https://example.com/");
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
  assert.equal(tab.playwright.elementInfo, undefined);
  assert.equal(tab.playwright.elementScreenshot, undefined);
  assert.equal(tab.playwright.frameLocator, undefined);
  assert.equal(tab.playwright.waitForEvent, undefined);
  const locator = tab.playwright.locator("button");
  assert.equal(typeof locator.click, "function");
  assert.equal(typeof locator.fill, "function");
  assert.equal(typeof locator.allTextContents, "function");
  assert.equal(locator.and, undefined);
  assert.equal(locator.downloadMedia, undefined);
  assert.equal(locator.or, undefined);
  assert.equal(locator.type, undefined);
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
