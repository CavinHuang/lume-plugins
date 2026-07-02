export type BrowserBackendType = "iab" | "extension" | "cdp";
export type ApiSupportOverrides = Record<string, boolean>;

export const API_MEMBERS = {
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
} as const;

export const PUBLIC_INTERFACE_NAMES = Object.keys(API_MEMBERS) as Array<keyof typeof API_MEMBERS>;

export const DEFAULT_UNSUPPORTED_MEMBERS: Record<BrowserBackendType, string[]> = {
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

export function disabledMembersFor(
  type: BrowserBackendType,
  overrides: ApiSupportOverrides = {},
): Set<string> {
  const disabled = new Set(DEFAULT_UNSUPPORTED_MEMBERS[type]);
  for (const [member, supported] of Object.entries(overrides)) {
    if (supported) disabled.delete(member);
    else disabled.add(member);
  }
  return disabled;
}
