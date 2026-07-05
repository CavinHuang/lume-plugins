# Lume Browse

Lume Browse controls the user's Chrome browser from Lume through the built-in
`node_repl` MCP tool. It is a clean-room, Lume-oriented browser runtime
reference derived from publicly documented behavior and static observations of
the user-provided Codex plugin packages. It does not contain copied Codex source
code or branding.

## Runtime flow

1. The agent calls Lume's built-in `mcp__node_repl__js` tool.
2. The `control-browser` skill imports `dist/client/setupNodeReplBrowserRuntime.js`.
3. The node_repl runtime opens a local app-server WebSocket at
   `ws://127.0.0.1:43127/browser`.
4. The Chrome Native Host connects to that WebSocket and forwards JSON-RPC
   between the extension and the browser client exposed as `agent.browsers`.

Use this plugin when existing Chrome state matters: logged-in sessions, cookies,
current tabs, browser profile data, or a SaaS/internal tool that cannot be
recreated in the in-app browser.

## Setup in Lume

1. Install or load the MV3 Chrome extension from this plugin package and keep it
   enabled in Chrome.
2. Build the Native Host, set `LUME_EXTENSION_ID`, `LUME_CHROME_HOST_PATH`, and
   `LUME_APP_SERVER_URL`, then run `npm run install:native-host`.
3. Keep Chrome and Lume running. The extension popup should show that the Native
   Host is connected to the local Lume app server.
4. When Chrome control reaches a sensitive action such as login, clipboard,
   download, or credential fill, confirm the Lume or Chrome authorization prompt
   before continuing the chat turn.

## What it implements

- MV3 Chrome extension with Native Messaging transport and reconnect status
- Full-duplex Native Host bridge between Chrome and a Lume App Server WebSocket
- Browser Client SDK: `Browsers`, `Browser`, `BrowserUser`, `Tabs`, `Tab`
- Dynamic browser/tab capability discovery and documentation
- Browser session, turn, tab lease, handoff, deliverable and tab-group lifecycle
- MV3 service-worker state persistence and tab reconciliation
- Chrome debugger/CDP attach, screenshots, full-page clips, input, navigation history and network-idle waits
- CUA, DOM CUA, restricted Playwright-like API and serializable Locator AST
- `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByTestId`, frame scopes, filters and positional locators
- File chooser interception with `DOM.setFileInputFiles`
- Download waiting/path lookup and media download helpers
- Clipboard read/write with confirmation hooks
- Page content export, GSuite-oriented export, page-assets inventory and download bundle
- Chunked large-asset transfer to the Native Host
- Site allow/session/block storage and just-in-time confirmation requests
- Restricted CDP event streaming back to the Lume runtime
- Secure `browserAuth` credential request/fill flow with status-only results
- Popup diagnostics for Native Host connection, permissions, capabilities and recent errors
- Diagnostics, Native Host installation, protocol/version metadata and command coverage tests

## Build

```bash
npm install
npm run build
npm test
npm run zip:extension
```

Build the Native Host separately with Cargo, then set `LUME_EXTENSION_ID`,
`LUME_CHROME_HOST_PATH`, and `LUME_APP_SERVER_URL` before running
`npm run install:native-host`. If `LUME_APP_SERVER_URL` is omitted, the host
uses `ws://127.0.0.1:43127/browser`, matching the node_repl bridge default.

## Lume skill entrypoint

The plugin is consumed through `skills/control-browser/SKILL.md`. The skill must
start from `mcp__node_repl__js`; do not assume a pre-existing `transport` or
global browser agent.

After startup, browser tasks use:

```js
const browser = await agent.browsers.get("extension");
```

## Permissions

| Permission | Purpose |
|---|---|
| `filesystem.read: ./**` | Read this plugin's packaged client runtime and skill files. |
| `tools.allow: mcp__node_repl__js` | Start the local browser bridge inside Lume's built-in node_repl MCP. |

This plugin does not request Lume shell execution, filesystem write access, or
Lume-declared outbound network access. The Chrome extension and Native Host still
require the browser/Native Messaging permissions declared in
`extension/manifest.json` and the native-host manifest.

## Important limitations

This is a functional reference, not a production-ready clone. Cross-origin frame
locators, browser-store signing/update, real Lume confirmation UI, complete
WebMCP, and exhaustive upstream Playwright semantics still require product
integration and hardening. Browser credential entry must use `browserAuth`; do
not collect secrets through chat fallback. See `docs/FEATURE_COVERAGE.md`.
