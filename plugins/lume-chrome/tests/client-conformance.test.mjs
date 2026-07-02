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
      "PlaywrightLocator.and": false,
    },
    browserCapabilities: [{ id: "visibility", description: "Visibility" }],
    tabCapabilities: [{ id: "pageAssets", description: "Page assets" }],
  });
  fake.respond("browser_user_open_tabs", [{ id: "42", url: "https://example.com/" }]);
  fake.respond("get_tab", { tabId: "42" });
  fake.respond("tab_url", "https://example.com/");

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
  const tab = await browser.tabs.get("42");
  assert.equal(tab.getJsDialog, undefined);
  assert.equal(await tab.url(), "https://example.com/");
  assert.equal(tab.playwright.locator("button").and, undefined);
  assert.equal(tab.playwright.frameLocator("iframe").evaluate, undefined);
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
