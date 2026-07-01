---
name: control-browser
description: Control the user's Chrome browser through Lume's built-in node_repl MCP when existing browser state is required.
---

# Control Browser Skill

Use this skill when a task depends on the user's existing browser state: logged-in sessions, cookies, current tab, browser profile, or a SaaS/internal tool.

Do not use it for public pages or local development previews when an in-app browser or fetch tool is enough.

## Startup

Use the `mcp__node_repl__js` tool. Do not assume a `transport` variable, `agent`
global, or browser runtime already exists.

Run this once before browser operations:

```js
const fs = await import("node:fs/promises");
const path = await import("node:path");
const os = await import("node:os");
const { pathToFileURL } = await import("node:url");

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function findLumeChromeRoot() {
  const candidates = [
    nodeRepl.cwd,
    path.join(nodeRepl.cwd, "plugins", "lume-chrome"),
    path.join(os.homedir(), ".lume", "plugins", "lume-chrome")
  ];

  for (const candidate of candidates) {
    const runtime = path.join(candidate, "dist", "client", "setupNodeReplBrowserRuntime.js");
    if (await exists(runtime)) return candidate;

    const versions = await fs.readdir(candidate, { withFileTypes: true }).catch(() => []);
    for (const entry of versions) {
      if (!entry.isDirectory()) continue;
      const versioned = path.join(candidate, entry.name);
      const versionedRuntime = path.join(versioned, "dist", "client", "setupNodeReplBrowserRuntime.js");
      if (await exists(versionedRuntime)) return versioned;
    }
  }

  throw new Error("Cannot find lume-chrome dist/client/setupNodeReplBrowserRuntime.js");
}

var lumeChromeRoot = await findLumeChromeRoot();
const runtimeUrl = pathToFileURL(path.join(lumeChromeRoot, "dist", "client", "setupNodeReplBrowserRuntime.js")).href;
const { setupNodeReplBrowserRuntime } = await import(runtimeUrl);
var { agent, bridge: lumeBrowserBridge } = await setupNodeReplBrowserRuntime({ globals: globalThis });

nodeRepl.write(JSON.stringify({
  bridgeUrl: lumeBrowserBridge.url,
  pluginRoot: lumeChromeRoot
}));
```

Then use:

```js
const browser = await agent.browsers.get("extension");
```

## Existing tabs

Never guess tab ids. Use:

```js
const tabs = await browser.user.openTabs();
const tab = await browser.user.claimTab(tabs[0]);
```

## Operating discipline

- Snapshot before acting.
- Prefer DOM CUA or Playwright locator over coordinates.
- Use coordinates only when DOM/locator fails.
- Re-snapshot after failures.
- Ask before high-risk actions.
- Always finalize tabs at the end of the browser turn.

```js
await browser.tabs.finalize({ keep: [{ tabId: tab.tabId, status: "handoff" }] });
```
