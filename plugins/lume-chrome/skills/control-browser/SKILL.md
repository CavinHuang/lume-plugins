---
name: lume-chrome
description: Control the user's Chrome browser through Lume's built-in node_repl MCP when existing browser state is required.
---

# Control Browser Skill

Use this skill for tasks that require the user's Chrome profile, authenticated
sessions, current tabs, or extensions. For implicit routing, prefer an in-app
browser or fetch for public pages and local previews.
When the user explicitly activates this skill, use it even for a public page.

If this skill was activated with a concrete user request, complete that request
in the same turn after Startup. Do not stop after initialization.

## Startup

Use `mcp__node_repl__js`. The REPL is persistent. Do not use top-level `const` or `let`
for reusable browser variables. Initialize once and reuse
`globalThis.agent` on later calls.

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
    var direct = path.join(candidate, "dist", "client", "setupNodeReplBrowserRuntime.js");
    if (await exists(direct)) return candidate;
    var versions = await fs.readdir(candidate, { withFileTypes: true }).catch(() => []);
    for (var entry of versions) {
      if (!entry.isDirectory()) continue;
      var versioned = path.join(candidate, entry.name);
      var runtime = path.join(versioned, "dist", "client", "setupNodeReplBrowserRuntime.js");
      if (await exists(runtime)) return versioned;
    }
  }
  throw new Error("Cannot find lume-chrome runtime");
};

if (!globalThis.agent?.browsers) {
  var lumeChromeRoot = await findLumeChromeRoot();
  var runtimeUrl = pathToFileURL(path.join(
    lumeChromeRoot,
    "dist",
    "client",
    "setupNodeReplBrowserRuntime.js"
  )).href;
  var { setupNodeReplBrowserRuntime } = await import(runtimeUrl);
  await setupNodeReplBrowserRuntime({ globals: globalThis });
}
var agent = globalThis.agent;
```

The same public runtime can also be initialized by `setupBrowserRuntime` when a
host supplies its own transport.

## Select A Browser

Use explicit Chrome when the request depends on the user's Chrome state:

```js
var browser = await agent.browsers.get("extension");
```

When a URL is known but no backend is explicit, let the runtime route it:

```js
var browser = await agent.browsers.getForUrl("https://example.com");
```

When neither backend nor URL is known, use the deterministic default:

```js
var browser = await agent.browsers.getDefault();
```

Always read the effective documentation before interaction. It contains only
members supported by the selected backend:

```js
nodeRepl.write(await browser.documentation());
```

The projected API is also summarized in `docs/browser-api-matrix.md` under the
plugin root. Unsupported members are absent rather than callable placeholders.

## Work With Tabs

Open a URL in one operation:

```js
var tab = await browser.tabs.new({ url: "https://www.baidu.com" });
nodeRepl.write(JSON.stringify({ tabId: tab.id, title: await tab.title(), url: await tab.url() }));
```

Use an existing Chrome tab only when the user asks for existing state:

```js
var tabs = await browser.user.openTabs();
var tab = await browser.user.claimTab(tabs[0]);
```

Never guess tab ids. If claiming fails, create a new tab instead of inventing
an update or script helper.

Capabilities are available only when both advertised and implemented:

```js
var capabilities = await browser.capabilities.list();
if (capabilities.length > 0) {
  var capability = await browser.capabilities.get(capabilities[0].id);
  nodeRepl.write(await capability.documentation());
}
```

Return screenshots as image blocks rather than raw bytes:

```js
var png = await tab.screenshot({ format: "png" });
await nodeRepl.emitImage(`data:image/png;base64,${Buffer.from(png).toString("base64")}`);
```

## Invalid APIs

- Do not use `browser.tabs.create`; use `browser.tabs.new(...)`.
- Do not use `browser.utils.wait`; use only waits listed by `browser.documentation()`.
- Do not use `bridge.isConnected` or direct bridge state.
- Do not use `agent.navigate`; select a browser and call its documented API.
- Do not use hidden Playwright, CUA, clipboard, finalize, or dev members unless
  the selected backend's effective documentation exposes them.
- `webmcp` is internal and is not part of the public Agent API.
