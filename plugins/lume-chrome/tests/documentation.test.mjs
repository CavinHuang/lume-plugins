import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserDocumentation,
  Documentation,
  formatApiReference,
  formatLookupCatalog,
} from "../dist/client/documentation.js";
import { BrowserRegistry } from "../dist/client/BrowserClient.js";

const documents = new Map([
  ["browser-safety", "SAFETY"],
  ["api-use-behavior", "API USE"],
  ["tab-claiming-chrome", "CLAIM CHROME"],
  ["tab-cleanup-chrome", "FINALIZE CHROME"],
  ["file-uploads", "UPLOAD"],
  ["chrome-troubleshooting", "CHROME HELP"],
]);
const read = async (name) => {
  if (!documents.has(name)) throw new Error(`Unknown browser documentation: ${name}`);
  return documents.get(name);
};

test("extension guidance includes only supported and applicable documents", async () => {
  const docs = new BrowserDocumentation({
    api: async () => "API REFERENCE",
    browserType: "extension",
    capabilities: { browser: [], tab: [] },
    disabledMembers: new Set(),
    read,
  });

  const text = await docs.guidance();
  assert.match(text, /SAFETY/);
  assert.match(text, /CLAIM CHROME/);
  assert.match(text, /FINALIZE CHROME/);
  assert.match(text, /API USE/);
  assert.doesNotMatch(text, /UPLOAD/);
});

test("lookup catalog lists upload docs only when file chooser is supported", () => {
  const catalog = formatLookupCatalog({
    browserType: "extension",
    disabledMembers: new Set(),
  });
  assert.match(catalog, /file-uploads/);
  assert.match(catalog, /chrome-troubleshooting/);
  assert.doesNotMatch(formatLookupCatalog({
    browserType: "iab",
    disabledMembers: new Set(["PlaywrightFileChooser.setFiles"]),
  }), /file-uploads/);
});

test("effective API reference omits disabled members", () => {
  const api = formatApiReference(new Set(["Tab.getJsDialog", "Tabs.content"]));
  assert.match(api, /Tab\.goto/);
  assert.doesNotMatch(api, /Tab\.getJsDialog/);
  assert.doesNotMatch(api, /Tabs\.content/);
});

test("global documentation rejects traversal and extensions", async () => {
  const docs = new Documentation(read);
  assert.equal(await docs.get("browser-safety"), "SAFETY");
  await assert.rejects(() => docs.get("../browser-safety"), /relative path without an extension/);
  await assert.rejects(() => docs.get("browser-safety.md"), /relative path without an extension/);
});

test("browser documentation is composed locally from the effective contract", async () => {
  const calls = [];
  const transport = {
    async send(method) {
      calls.push(method);
      if (method !== "runtime_ping") throw new Error(`Unexpected transport call: ${method}`);
      return {
        id: "chrome-1",
        name: "Chrome",
        type: "extension",
        protocolVersion: 5,
        generation: 1,
        metadata: {},
        capabilities: { browser: [], tab: [] },
        apiSupportOverrides: { "Tab.getJsDialog": false },
        browserId: "chrome-1",
        clientType: "extension",
        permissions: {},
        features: {},
      };
    },
  };
  const registry = new BrowserRegistry(
    transport,
    { browserSessionId: "session-1", browserTurnId: "turn-1", actor: "agent" },
    async (name) => `DOC:${name}`,
  );

  const browser = await registry.get();
  const text = await browser.documentation();

  assert.match(text, /DOC:browser-safety/);
  assert.match(text, /Tab\.goto/);
  assert.doesNotMatch(text, /Tab\.getJsDialog/);
  assert.deepEqual(calls, ["runtime_ping"]);
});
