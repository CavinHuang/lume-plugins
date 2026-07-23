---
name: lume-chrome
description: Control the user's existing Chrome tabs through Lume's authenticated Browser Broker.
---

# Lume Chrome

Use this skill only when the user explicitly wants external Chrome or when the
task depends on Chrome's current tabs, logged-in session, cookies, extensions,
or profile state. Use the `browser` plugin and its default `iab` backend for
ordinary public browsing.

The Chrome extension and Native Host are transport components. Never start a
second IPC server from `node_repl`; Lume owns the authenticated current-user
Browser Broker pipe.

## Startup

Use `mcp__node_repl__js`. The runtime is persistent, so use `var` for reusable
top-level bindings. Do not use top-level `const` or `let`. Verify the Broker-provided bridge and select the explicit
`extension` backend:

```js
if (!nodeRepl.browser || typeof nodeRepl.browser.request !== "function") {
  throw new Error("Lume Browser Broker is unavailable");
}
var chromeRequest = async function chromeRequest(method, params = {}) {
  return nodeRepl.browser.request(method, { ...params, __browserBackend: "extension" });
};
var chromeDescriptor = await chromeRequest("handshake");
nodeRepl.write(JSON.stringify(chromeDescriptor));
```

If handshake returns `browser_unavailable`, ask the user to enable both the
Browser plugin and the external Chrome backend, confirm `lume-chrome` is
installed, and verify the extension popup reports Native Host connected.

## Existing Chrome tabs

Never guess a tab ID. List visible Chrome tabs, then claim the exact tab before
acting:

```js
var chromeTabs = await chromeRequest("openTabs");
nodeRepl.write(JSON.stringify(chromeTabs));
var claimed = await chromeRequest("claim", { tabId: chromeTabs[0].tabId });
var chromeTabId = claimed.tabId;
```

Use a new tab when the user did not ask for an existing one:

```js
var created = await chromeRequest("ensure", { url: "https://example.com", active: true });
var chromeTabId = created.tabId;
```

## Playwright-like operations

Locators use the serializable locator AST. Prefer stable role, label, text,
test-id, or CSS locators over coordinates.

```js
var searchBox = { version: 1, steps: [{ kind: "css", selector: "input[type=search]" }] };
await chromeRequest("fill", { tabId: chromeTabId, locator: searchBox, value: "Lume" });
await chromeRequest("press", { tabId: chromeTabId, locator: searchBox, key: "Enter" });
var snapshot = await chromeRequest("snapshot", { tabId: chromeTabId });
nodeRepl.write(JSON.stringify({ url: snapshot.url, title: snapshot.title, text: snapshot.text }));
```

Supported automatic operations are `goto`, `back`, `forward`, `reload`,
`click`, `doubleClick`, `hover`, `fill`, `type`, `press`, `select`, `check`,
`uncheck`, `scroll`, `snapshot`, and `screenshot`. Locator click/input/scroll
move the visible Lume cursor to the resolved element before dispatch.

## Safety and collaboration

- User clicks, scrolling, and typing do not pause the Agent; re-observe after
  user input or a stale-target result.
- Never put passwords, OTPs, cookies, tokens, or other secrets in ordinary
  `fill`, `type`, chat text, logs, or `nodeRepl.write`.
- Ask for exact confirmation before submit/send/delete/purchase/payment,
  authorization, file, clipboard, credential, or CAPTCHA actions.
- External Chrome has weaker network isolation than an Agent task partition;
  do not navigate to private, loopback, link-local, or `.local` targets without
  the product's explicit private-origin confirmation.
- Re-snapshot after navigation and after any failed action.
