---
name: lume-chrome
description: Control the user's Chrome browser through Lume's built-in node_repl MCP when existing browser state is required.
---

# Control Browser Skill

Use this skill when a task depends on the user's existing Chrome state: logged-in
sessions, cookies, current tabs, browser profile, extensions, or SaaS/internal
tools.

For implicit routing, do not use it for public pages or local development
previews when an in-app browser, fetch, or search tool is enough. When the user explicitly activates this skill, use it even for a public page.

If this skill was activated with a concrete user request, complete that request
in the same turn after Startup. Do not stop after reporting the bridge URL, and
do not ask the user to repeat the task.

## Startup

Use the `mcp__node_repl__js` tool. Do not assume a `transport` variable, `agent`
global, or browser runtime already exists.

`node_repl` is persistent across calls. Do not use top-level `const` or `let`
for browser-operation variables such as `browser`, `tabs`, `tab`, or `result`.
Use `var` for reusable top-level names, or wrap temporary `const`/`let` names in
an async function block.

Run this once before browser operations:

```js
var fs = await import("node:fs/promises");
var path = await import("node:path");
var os = await import("node:os");
var { pathToFileURL } = await import("node:url");

var exists = async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

var findLumeChromeRoot = async function findLumeChromeRoot() {
  var candidates = [
    nodeRepl.cwd,
    path.join(nodeRepl.cwd, "plugins", "lume-chrome"),
    path.join(os.homedir(), ".lume", "plugins", "lume-chrome")
  ];

  for (var candidate of candidates) {
    var runtime = path.join(candidate, "dist", "client", "setupNodeReplBrowserRuntime.js");
    if (await exists(runtime)) return candidate;

    var versions = await fs.readdir(candidate, { withFileTypes: true }).catch(() => []);
    for (var entry of versions) {
      if (!entry.isDirectory()) continue;
      var versioned = path.join(candidate, entry.name);
      var versionedRuntime = path.join(versioned, "dist", "client", "setupNodeReplBrowserRuntime.js");
      if (await exists(versionedRuntime)) return versioned;
    }
  }

  throw new Error("Cannot find lume-chrome dist/client/setupNodeReplBrowserRuntime.js");
};

var lumeChromeRoot = await findLumeChromeRoot();
var runtimeUrl = pathToFileURL(path.join(lumeChromeRoot, "dist", "client", "setupNodeReplBrowserRuntime.js")).href;
var { setupNodeReplBrowserRuntime } = await import(runtimeUrl);
var lumeBrowser = await setupNodeReplBrowserRuntime({ globals: globalThis });
var agent = lumeBrowser.agent;
var browserControl = lumeBrowser.control;
var lumeBrowserBridge = lumeBrowser.bridge;

nodeRepl.write(JSON.stringify({
  bridgeUrl: lumeBrowserBridge.url,
  pluginRoot: lumeChromeRoot,
  helpers: [
    "browserControl.openUrl",
    "browserControl.search",
    "browserControl.listTabs",
    "browserControl.getStatus",
    "browserControl.finalizeTabs"
  ]
}));
```

## Preferred High-Level API

For ordinary "open this page" tasks:

```js
var result = await browserControl.openUrl("https://www.baidu.com");
await browserControl.finalizeTabs({ keepTabIds: [result.tabId] });
nodeRepl.write(JSON.stringify(result));
```

For ordinary "search" tasks:

```js
var result = await browserControl.search({ engine: "baidu", query: "glm" });
await browserControl.finalizeTabs({ keepTabIds: [result.tabId] });
nodeRepl.write(JSON.stringify(result));
```

Use `browserControl.getStatus()` for diagnostics:

```js
nodeRepl.write(JSON.stringify(await browserControl.getStatus()));
```

## Low-Level API

Use the low-level API only when the task requires custom navigation, locators,
DOM/CUA, screenshots, downloads, or browser state inspection.

The exact public surface is in `docs/browser-api-matrix.md` under
`lumeChromeRoot`. For runtime-specific guidance, ask the connected browser:

```js
var browser = await agent.browsers.get("extension");
nodeRepl.write(await browser.documentation());
```

Capabilities are discoverable rather than guessed:

```js
var capabilities = await browser.capabilities.list();
var capability = await browser.capabilities.get(capabilities[0].id);
nodeRepl.write(await capability.documentation());
```

Always `await agent.browsers.get` before using a browser object:

```js
var browser = await agent.browsers.get("extension");
```

To open a new page, create the tab with the URL in one operation:

```js
var browser = await agent.browsers.get("extension");
var tab = await browser.tabs.new({ url: "https://www.baidu.com" });
```

For ordinary "open this page and search" tasks, prefer a fresh tab. Do not scan
for existing tabs first unless the user asks to use the current or existing tab.

## Existing Tabs

Never guess tab ids. Use:

```js
var browser = await agent.browsers.get("extension");
var tabs = await browser.user.openTabs();
var tab = await browser.user.claimTab(tabs[0]);
```

`browser.user.openTabs()` returns user-visible tabs, and an existing tab can be
claimed by another session. If claiming fails, create a fresh tab instead of
retrying with invented APIs.

## Common Operations

```js
var browser = await agent.browsers.get("extension");
var tab = await browser.tabs.new({ url: "https://www.baidu.com" });
await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 5000 });
await tab.playwright.locator("#kw").fill("glm", { timeoutMs: 5000 });
await tab.playwright.locator("#kw").press("Enter", { timeoutMs: 5000 });
nodeRepl.write(JSON.stringify({ tabId: tab.id, url: await tab.url() }));
await browser.tabs.finalize({ keep: [{ tabId: tab.id, status: "handoff" }] });
```

Prefer Playwright locators or DOM CUA over coordinates:

```js
var snapshot = await tab.playwright.domSnapshot();
await tab.playwright.getByRole("button", { name: "Search" }).click({ timeoutMs: 5000 });
var visibleDom = await tab.dom_cua.get_visible_dom();
await tab.dom_cua.click({ node_id: "node-1" });
await tab.cua.click({ x: 120, y: 240 });
```

Return screenshots as an image block instead of printing raw bytes:

```js
var png = await tab.screenshot({ format: "png" });
await nodeRepl.emitImage(`data:image/png;base64,${Buffer.from(png).toString("base64")}`);
```

## APIs That Do Not Exist

Do not use `browser.tabs.create`; use `browser.tabs.new(...)` or
`browserControl.openUrl(...)`.

Do not use `browser.utils.wait`; use `tab.playwright.waitForTimeout(...)`,
`tab.playwright.waitForLoadState(...)`, or locator waits.

Do not use `bridge.isConnected`; use `browserControl.getStatus()`.

Do not use `agent.navigate`; use `browserControl.openUrl(...)`,
`browserControl.search(...)`, `browser.tabs.new(...)`, or `tab.goto(...)`.

Do not use `tab.playwright.keyboard`; use locator `.press(...)` or
`tab.cua.keypress(...)`.

Do not call `agent.browsers.get("extension")` without `await`; it returns a
Promise.

Do not invent user-level tab update, open, or script-execution helpers. The
public low-level APIs are `browser.tabs.new(...)`, `browser.tabs.get(...)`,
`tab.goto(...)`, Playwright locators, DOM CUA, and CUA methods.

## Operating Discipline

- Snapshot before acting when reading page state matters.
- Prefer DOM CUA or Playwright locator over coordinates.
- Use coordinates only when DOM/locator fails.
- Re-snapshot after failures.
- Ask before high-risk actions.
- Always finalize tabs at the end of the browser turn.

```js
await browserControl.finalizeTabs({ keepTabIds: [result.tabId] });
```
