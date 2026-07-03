const BROWSER_CAPABILITIES = [
    { id: "visibility", name: "Browser visibility", scope: "browser", description: "Show or hide the browser window.", state: "available" },
    { id: "viewport", name: "Viewport control", scope: "browser", description: "Set or reset the browser viewport.", state: "available" }
];
const TAB_CAPABILITIES = [
    { id: "pageAssets", name: "Page assets", scope: "tab", description: "Inventory and bundle rendered page assets.", state: "available" },
    { id: "cdp", name: "CDP", scope: "tab", description: "Read buffered CDP events and send permitted CDP commands.", state: "available" },
    { id: "botDetection", name: "Bot detection", scope: "tab", description: "Report bot detection or access-control blockers for this tab.", state: "available" }
];
const DOCS = {
    visibility: "Use set(true) to show the browser window and set(false) to hide it. Use get() to read whether the browser is currently visible.",
    viewport: "Use set({width,height}) only when a specific viewport is required. Use reset() before finishing unless the user asked to keep the viewport.",
    pageAssets: "Use list() to inventory assets observed in the rendered page state, then bundle(...) to export selected assets through the native host.",
    cdp: "Use send(method, params?, options?) for permitted CDP commands and readEvents(options?) for buffered events. Prefer higher-level browser APIs unless raw CDP is needed.",
    botDetection: "Use report({reason}) only when the current tab is blocked by CAPTCHA, access denial, challenge loops, or another bot-detection failure."
};
export class CapabilityRegistry {
    list(scope) { return scope === "browser" ? BROWSER_CAPABILITIES : TAB_CAPABILITIES; }
    documentation(id) { const value = DOCS[id]; if (!value)
        throw new Error(`Unknown capability: ${id}`); return value; }
}
