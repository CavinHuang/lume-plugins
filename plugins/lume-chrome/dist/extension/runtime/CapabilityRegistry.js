const BROWSER_CAPABILITIES = [
    { id: "visibility", name: "Browser visibility", scope: "browser", description: "Show or hide the browser window.", state: "available" },
    { id: "viewport", name: "Viewport control", scope: "browser", description: "Set or reset the browser viewport.", state: "available" }
];
const TAB_CAPABILITIES = [
    { id: "botDetection", name: "Bot detection", scope: "tab", description: "Report bot detection or access-control blockers for this tab.", state: "available" }
];
const DOCS = {
    visibility: "Use set(true) to show the browser window and set(false) to hide it. Use get() to read whether the browser is currently visible.",
    viewport: "Use set({width,height}) only when a specific viewport is required. Use reset() before finishing unless the user asked to keep the viewport.",
    botDetection: "Use report({reason}) only when the current tab is blocked by CAPTCHA, access denial, challenge loops, or another bot-detection failure."
};
export class CapabilityRegistry {
    list(scope) { return scope === "browser" ? BROWSER_CAPABILITIES : TAB_CAPABILITIES; }
    documentation(id) { const value = DOCS[id]; if (!value)
        throw new Error(`Unknown capability: ${id}`); return value; }
}
