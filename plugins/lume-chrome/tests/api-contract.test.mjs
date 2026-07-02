import test from "node:test";
import assert from "node:assert/strict";

import {
  API_MEMBERS,
  DEFAULT_UNSUPPORTED_MEMBERS,
  PUBLIC_INTERFACE_NAMES,
  disabledMembersFor,
} from "../dist/client/api-contract.js";

const EXPECTED_API_MEMBERS = {
  Agent: ["browsers", "documentation"],
  Browsers: ["get", "getDefault", "getForUrl", "list"],
  Browser: ["browserId", "capabilities", "tabs", "user", "documentation", "nameSession"],
  BrowserUser: ["claimTab", "history", "openTabs"],
  Tabs: ["content", "finalize", "get", "list", "new", "selected"],
  Tab: [
    "capabilities", "clipboard", "content", "cua", "dev", "dom_cua", "id", "playwright",
    "back", "close", "forward", "getJsDialog", "goto", "markDeliverable", "markHandoff",
    "reload", "screenshot", "title", "url",
  ],
  ContentAPI: ["export", "exportGsuite"],
  CUAAPI: ["click", "double_click", "downloadMedia", "drag", "keypress", "move", "scroll", "type"],
  DomCUAAPI: ["click", "double_click", "downloadMedia", "get_visible_dom", "keypress", "scroll", "type"],
  PlaywrightAPI: [
    "domSnapshot", "elementInfo", "elementScreenshot", "evaluate", "expectNavigation", "frameLocator",
    "getByLabel", "getByPlaceholder", "getByRole", "getByTestId", "getByText", "locator",
    "waitForEvent", "waitForLoadState", "waitForTimeout", "waitForURL",
  ],
  PlaywrightFrameLocator: [
    "frameLocator", "getByLabel", "getByPlaceholder", "getByRole", "getByTestId", "getByText", "locator",
  ],
  PlaywrightLocator: [
    "all", "allTextContents", "and", "check", "click", "count", "dblclick", "downloadMedia", "fill",
    "filter", "first", "getAttribute", "getByLabel", "getByPlaceholder", "getByRole", "getByTestId",
    "getByText", "innerText", "isEnabled", "isVisible", "last", "locator", "nth", "or", "press",
    "selectOption", "setChecked", "textContent", "type", "uncheck", "waitFor",
  ],
  PlaywrightDownload: ["path"],
  PlaywrightFileChooser: ["isMultiple", "setFiles"],
  TabClipboardAPI: ["read", "readText", "write", "writeText"],
  TabDevAPI: ["logs"],
  AlertDialog: ["type", "dismiss"],
  BeforeUnloadDialog: ["type", "dismiss"],
  ConfirmDialog: ["type", "accept", "dismiss"],
  PromptDialog: ["type", "accept", "dismiss"],
  BrowserDocumentation: ["api", "get", "guidance", "lookupCatalog"],
  Documentation: ["get"],
};

const EXPECTED_DEFAULTS = {
  extension: ["Tabs.content"],
  iab: [
    "BrowserUser.claimTab", "BrowserUser.history", "Tabs.content", "Tabs.finalize",
    "Tab.markDeliverable", "Tab.markHandoff", "CUAAPI.downloadMedia", "DomCUAAPI.downloadMedia",
    "PlaywrightFileChooser.setFiles",
  ],
  cdp: [
    "BrowserUser.claimTab", "BrowserUser.history", "Tabs.content", "Tabs.finalize",
    "Tab.markDeliverable", "Tab.markHandoff",
  ],
};

function assertCannotExtend(array, value) {
  const original = [...array];
  try {
    array.push(value);
  } catch {
    // Frozen ESM exports throw in strict mode.
  }
  assert.deepEqual(array, original);
}

test("exports the complete canonical public API catalog in interface order", () => {
  assert.deepEqual(API_MEMBERS, EXPECTED_API_MEMBERS);
  assert.deepEqual(PUBLIC_INTERFACE_NAMES, Object.keys(EXPECTED_API_MEMBERS));
});

test("exports the exact default unsupported members for every backend", () => {
  assert.deepEqual(DEFAULT_UNSUPPORTED_MEMBERS, EXPECTED_DEFAULTS);
});

test("applies support overrides without mutating backend defaults", () => {
  const disabled = disabledMembersFor("iab", {
    "Tabs.finalize": true,
    "Tab.screenshot": false,
    "Tab.url": true,
  });

  assert.equal(disabled.has("Tabs.finalize"), false);
  assert.equal(disabled.has("Tab.screenshot"), true);
  assert.equal(disabled.has("Tab.url"), false);
  assert.deepEqual(DEFAULT_UNSUPPORTED_MEMBERS, EXPECTED_DEFAULTS);
});

test("excludes non-canonical WebMCP and lumeBrowser surfaces", () => {
  const catalog = JSON.stringify(API_MEMBERS);
  assert.doesNotMatch(catalog, /webmcp/i);
  assert.doesNotMatch(catalog, /lumeBrowser/i);
});

test("prevents consumers from extending canonical contract arrays", () => {
  assertCannotExtend(PUBLIC_INTERFACE_NAMES, "NotARealInterface");
  assertCannotExtend(API_MEMBERS.Agent, "notARealMember");
  assertCannotExtend(DEFAULT_UNSUPPORTED_MEMBERS.extension, "Tabs.finalize");
});

test("mutation attempts do not affect extension disabled members", () => {
  assertCannotExtend(DEFAULT_UNSUPPORTED_MEMBERS.extension, "Tabs.finalize");
  assert.deepEqual([...disabledMembersFor("extension")], ["Tabs.content"]);
});
