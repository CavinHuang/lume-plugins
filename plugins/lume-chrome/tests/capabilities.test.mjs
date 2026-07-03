import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityCollection,
  createCapabilityDefinitions,
} from "../dist/client/capabilities.js";

function makeTransport() {
  const calls = [];
  return {
    calls,
    async send(method, params) {
      calls.push({ method, params });
      if (method.endsWith("_documentation")) return `docs:${params.capabilityId}`;
      if (method === "browser_visibility_get") return true;
      if (method === "tab_page_assets_list") return { id: "inventory-1", assets: [] };
      return null;
    },
  };
}

test("capabilities.get returns the callable capability object", async () => {
  const transport = makeTransport();
  const collection = new CapabilityCollection({
    advertised: [{ id: "visibility", description: "Show or hide browser" }],
    browserId: "iab-1",
    definitions: createCapabilityDefinitions(),
    scope: "browser",
    transport,
  });

  assert.deepEqual(await collection.list(), [
    { id: "visibility", description: "Show or hide browser" },
  ]);
  const visibility = await collection.get("visibility");
  assert.equal(await visibility.get(), true);
  assert.equal(await visibility.documentation(), "docs:visibility");
});

test("tab capability carries browser and tab identity", async () => {
  const transport = makeTransport();
  const collection = new CapabilityCollection({
    advertised: [{ id: "pageAssets", description: "Page assets" }],
    browserId: "chrome-1",
    definitions: createCapabilityDefinitions(),
    scope: "tab",
    tabId: "42",
    transport,
  });

  const assets = await collection.get("pageAssets");
  assert.deepEqual(await assets.list(), { id: "inventory-1", assets: [] });
  assert.deepEqual(transport.calls.at(-1).params, { browserId: "chrome-1", tabId: "42" });
});

test("cdp capability sends commands and reads events for a tab", async () => {
  const transport = makeTransport();
  const collection = new CapabilityCollection({
    advertised: [{ id: "cdp", description: "CDP" }],
    browserId: "chrome-1",
    definitions: createCapabilityDefinitions(),
    scope: "tab",
    tabId: "42",
    transport,
  });

  const cdp = await collection.get("cdp");
  await cdp.send("Runtime.evaluate", { expression: "location.href" }, { timeoutMs: 1000 });
  await cdp.readEvents({ afterSequence: 3, methods: ["Runtime.consoleAPICalled"], limit: 5 });

  assert.deepEqual(transport.calls.slice(-2), [
    {
      method: "tab_cdp_send",
      params: {
        browserId: "chrome-1",
        tabId: "42",
        method: "Runtime.evaluate",
        params: { expression: "location.href" },
        options: { timeoutMs: 1000 },
      },
    },
    {
      method: "tab_cdp_read_events",
      params: {
        browserId: "chrome-1",
        tabId: "42",
        options: { afterSequence: 3, methods: ["Runtime.consoleAPICalled"], limit: 5 },
      },
    },
  ]);
});

test("unknown and internal capabilities are unavailable", async () => {
  const collection = new CapabilityCollection({
    advertised: [{ id: "webmcp", description: "internal" }],
    browserId: "chrome-1",
    definitions: createCapabilityDefinitions(),
    scope: "tab",
    tabId: "42",
    transport: makeTransport(),
  });

  await assert.rejects(collection.get("webmcp"), /Capability not available: webmcp/);
});
