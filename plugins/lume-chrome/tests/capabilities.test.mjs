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
      if (method === "tab_browser_auth_request") return { status: "submitted" };
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

test("botDetection capability reports a reason for a tab", async () => {
  const transport = makeTransport();
  const collection = new CapabilityCollection({
    advertised: [{ id: "botDetection", description: "Bot detection" }],
    browserId: "chrome-1",
    definitions: createCapabilityDefinitions(),
    scope: "tab",
    tabId: "42",
    transport,
  });

  const botDetection = await collection.get("botDetection");
  await botDetection.report({ reason: "access_denied" });

  assert.deepEqual(transport.calls.at(-1), {
    method: "tab_bot_detection_report",
    params: {
      browserId: "chrome-1",
      tabId: "42",
      reason: "access_denied",
    },
  });
});

test("browserAuth capability requests credentials without exposing values to the caller", async () => {
  const transport = makeTransport();
  const collection = new CapabilityCollection({
    advertised: [{ id: "browserAuth", description: "Browser auth" }],
    browserId: "chrome-1",
    definitions: createCapabilityDefinitions(),
    scope: "tab",
    tabId: "42",
    transport,
  });

  const browserAuth = await collection.get("browserAuth");
  const result = await browserAuth.request({
    origin: "https://accounts.example.test",
    reason: "Sign in is required.",
    expires_at: "2026-07-03T12:00:00.000Z",
    fields: [{
      id: "password",
      label: "Password",
      type: "password",
      autocomplete: "current-password",
      required: true,
      selector: "input[type=password]",
    }],
    submit: {
      selector: "button[type=submit]",
      action: "click",
    },
  });

  assert.equal(result.status, "submitted");
  assert.deepEqual(transport.calls.at(-1), {
    method: "tab_browser_auth_request",
    params: {
      browserId: "chrome-1",
      tabId: "42",
      options: {
        origin: "https://accounts.example.test",
        reason: "Sign in is required.",
        expires_at: "2026-07-03T12:00:00.000Z",
        fields: [{
          id: "password",
          label: "Password",
          type: "password",
          autocomplete: "current-password",
          required: true,
          selector: "input[type=password]",
        }],
        submit: {
          selector: "button[type=submit]",
          action: "click",
        },
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /password-value|secret|current-password-value/);
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
