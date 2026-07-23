# Lume Browse

Lume Browse provides the external Chrome backend used by Lume Browser through
the built-in `node_repl` MCP tool. It is a clean-room, Lume-oriented browser runtime
reference derived from publicly documented behavior and static observations of
the user-provided Codex plugin packages. It does not contain copied Codex source
code or branding.

## Runtime flow

1. Lume starts the authenticated current-user Browser Broker pipe.
2. The Chrome Native Host loads its pairing key from the OS credential store and connects to the configured pipe endpoint.
3. The Browser plugin calls the Broker through Lume's built-in `node_repl` tool.
4. The Broker forwards explicit external-Chrome operations to the extension.

Use this plugin when existing Chrome state matters: logged-in sessions, cookies,
current tabs, browser profile data, or a SaaS/internal tool that cannot be
recreated in the in-app browser.

## Setup in Lume

1. Save and extract the MV3 Chrome extension package from the plugin detail
   page, then load that folder once from `chrome://extensions`.
2. Click **Install Native Host** in Lume. Lume selects the precompiled runtime
   for the current platform, verifies it, installs it in the current user's Lume
   directory, and registers it with Chrome. No Rust, npm, environment variables,
   or command line are required.
3. Restart Lume. The installer-generated configuration contains only the random
   current-user pipe endpoint; its random pairing key remains in Windows
   Credential Manager or macOS Keychain.
4. Keep Chrome and Lume running. The extension popup should show that the Native
   Host is connected to the local Lume app server.
5. Lume's Broker asks for confirmation before a classified high-risk action.
   Password filling, clipboard access, upload, and Agent downloads are not
   exposed by the external Chrome backend.

## Activate in chat

From the Lume plugin detail page, use "try in chat"; it seeds the chat with
`$lume-chrome` so the Agent loads `skills/control-browser/SKILL.md`.

You can also type `$lume-chrome` manually in any Lume chat. Passwords, OTP
codes, and login secrets are not available to the external Chrome backend; enter
them manually in Chrome and do not paste credentials directly into chat.

## What it implements

- MV3 Chrome extension with Native Messaging transport and reconnect status
- Full-duplex Native Host bridge over a current-user named pipe / Unix socket
- Browser Client SDK: `Browsers`, `Browser`, `BrowserUser`, `Tabs`, `Tab`
- Dynamic browser/tab capability discovery and documentation
- Browser session, turn, tab lease, handoff, deliverable and tab-group lifecycle
- MV3 service-worker state persistence and tab reconciliation
- Chrome debugger-backed screenshots, input, navigation, and load/network-idle waits behind the Broker
- CUA, DOM CUA, restricted Playwright-like API and serializable Locator AST
- `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByTestId`, frame scopes, filters and positional locators
- External Chrome upload and Agent download APIs fail closed as unsupported
- Broker-owned high-risk confirmation and audit policy; the extension has no independent confirmation or site-permission store
- Content export, page assets, clipboard, raw CDP, credential transfer, upload, and Agent downloads fail closed as unsupported
- External Chrome credential filling is unavailable; Chrome/user autofill remains manual
- Popup diagnostics for Native Host connection, permissions, capabilities and recent errors
- Diagnostics, Native Host installation, protocol/version metadata and command coverage tests

## Build

```bash
npm install
npm run build
npm test
npm run zip:extension
```

Native Host release binaries are built by
`.github/workflows/build-lume-chrome-native-host.yml`. The local
`npm run install:native-host` script remains available only for contributors
testing a locally compiled Host. The installer stores the pairing key in the OS
credential store; non-secret configuration contains only the endpoint, pairing
ID, generation, and verified Native Host path.

## Lume skill entrypoint

The plugin is consumed through `skills/control-browser/SKILL.md`. The skill uses
the Broker bridge already exposed by `mcp__node_repl__js`; it must not start a
second IPC server.

The expected manual activation prefix is `$lume-chrome`. When activated this
way, the Agent should continue into the requested browser task after startup
instead of only reporting setup status.

After startup, browser tasks select the extension backend explicitly:

```js
await nodeRepl.browser.request("handshake", { __browserBackend: "extension" });
```

## Permissions

| Permission | Purpose |
|---|---|
| `filesystem.read: ./**` | Read this plugin's packaged client runtime and skill files. |
| `tools.allow: mcp__node_repl__js` | Call Lume's authenticated Browser Broker bridge. |

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
