# Lume Browser API Matrix

This is the Codex-compatible public contract exposed to Lume agents through
`lume-chrome` and `node_repl`. The method names below match
`src/client/BrowserClient.ts`; unsupported members are dynamically hidden by the
selected backend descriptor rather than exposed as callable placeholders.

## Capability Summary

| Category | Status | Public API | Notes |
| --- | --- | --- | --- |
| browser | implemented | `agent.browsers.*`, `browser.*` | Always await `agent.browsers.get(...)`. |
| session | implemented | `lumeBrowser.context`, `lumeBrowser.bridge.url`, `lumeBrowser.control.getStatus()` | Stable runtime globals are listed below. |
| tab | implemented | `browser.tabs.*`, `browser.user.*`, `tab.*` | Use `browser.tabs.new()`, not `browser.tabs.create`. |
| navigation | implemented | `tab.goto()`, `tab.back()`, `tab.forward()`, `tab.reload()`, `lumeBrowser.control.openUrl()` | Prefer the facade for simple page opens. |
| locator | implemented | `tab.playwright` locator builders and locator operations | Preferred for stable element interaction. |
| playwright | implemented | snapshots, evaluation, navigation waits, event waits | There is no `browser.utils.wait`. |
| cua | implemented | `tab.dom_cua.*`, `tab.cua.*` | Prefer DOM CUA over coordinates. |
| screenshot | implemented | `tab.screenshot()` | Returns `Uint8Array`; emit as a data URL with `nodeRepl.emitImage`. |
| finalize | implemented | `browser.tabs.finalize()`, `release()`, `handoff()`, `lumeBrowser.control.finalizeTabs()` | Finalize every browser turn. |
| diagnostics | implemented | `agent.browsers.diagnostics()`, `lumeBrowser.control.getStatus()` | The facade fails fast when no native host is connected. |
| search | implemented | `lumeBrowser.control.search({ engine, query })` | Supports `baidu`, `bing`, and `google`. |
| raw protocol | reference-only | `BrowserCommandType` in `src/shared/protocol.ts` | Do not send raw commands when a client method exists. |
| direct bridge state | intentionally unsupported | `bridge.isConnected`, `bridge.reconnect` | Use `lumeBrowser.control.getStatus()`. |
| invented tab helpers | intentionally unsupported | `browser.tabs.create`, `browser.tabs.open`, `browser.user.open`, `agent.navigate` | These APIs do not exist. |
| generic wait helpers | intentionally unsupported | `browser.utils.wait`, global `wait(ms)` | Use targeted Playwright waits. |

## Stable Runtime Globals

| Global | Status | Purpose |
| --- | --- | --- |
| `agent` | implemented | Entry point for low-level browser APIs. |
| `lumeBrowser` | implemented | Runtime object with `agent`, `bridge`, `context`, and `control`. |
| `lumeBrowserAgent` | implemented | Alias for `lumeBrowser.agent`. |
| `lumeBrowserBridge` | implemented | Alias for `lumeBrowser.bridge`; public uses are `url` and `close()`. |
| `lumeBrowserControl` | implemented | Alias for `lumeBrowser.control`. |

## High-Level Facade

| API | Status | Purpose |
| --- | --- | --- |
| `lumeBrowser.control.openUrl(url, options?)` | implemented | Open one tab and wait for its load state. |
| `lumeBrowser.control.search(query, options?)` | implemented | Search with the default or selected engine. |
| `lumeBrowser.control.search({ engine, query, ...options })` | implemented | Object form of search. |
| `lumeBrowser.control.listTabs()` | implemented | List user-visible Chrome tabs. |
| `lumeBrowser.control.getStatus()` | implemented | Diagnose bridge/native-host connectivity without throwing. |
| `lumeBrowser.control.finalizeTabs(options?)` | implemented | Finalize the turn and optionally retain selected tab IDs. |

## Browser And Session

| Object | Implemented methods |
| --- | --- |
| `agent.browsers` | `get()`, `list()`, `diagnostics()` |
| `browser` | `documentation()`, `nameSession()` |
| `browser.visibility` | `get()`, `set()` |
| `browser.viewport` | `set()`, `reset()` |
| `browser.sitePermissions` | `list()`, `allowForSession()`, `alwaysAllow()`, `block()`, `clear()` |
| `browser.capabilities` | `list()`, `get()`; returned capability has `documentation()` |
| `browser.user` | `openTabs()`, `claimTab()`, `history()`, `topSites()`, `recentSessions()` |

## Tabs And Navigation

| Object | Implemented methods |
| --- | --- |
| `browser.tabs` | `new()`, `get()`, `selected()`, `list()`, `sessionTabs()`, `finalize()`, `release()`, `handoff()`, `resumeHandoff()` |
| `tab` | `close()`, `title()`, `url()`, `goto()`, `back()`, `forward()`, `reload()`, `screenshot()`, `getJsDialog()`, `markDeliverable()`, `markHandoff()`, `exportContent()` |
| `tab.content` | `export()`, `exportGsuite(type)` |
| `tab.capabilities` | `list()`, `get()` |
| `tab.capabilities.pageAssets` | `list()`, `bundle()`, `documentation()` |
| `tab.clipboard` | `read()`, `readText()`, `write()`, `writeText()` |
| `tab.dev` | `cdpCall()`, `subscribe()`, `logs()` |

Canonical `tab.content.export()`, `tab.content.exportGsuite(type)`,
`tab.getJsDialog()`, `tab.markDeliverable()`, and `tab.markHandoff()` are
implemented by the extension backend. `browser.tabs.content()` remains hidden
because temporary background extraction is not implemented.

## Implemented Optional Capabilities

| Capability | Scope | Public API |
| --- | --- | --- |
| `visibility` | browser | `await browser.capabilities.get("visibility")` |
| `viewport` | browser | `await browser.capabilities.get("viewport")` |
| `pageAssets` | tab | `await tab.capabilities.get("pageAssets")` |
| `cdp` | tab | `await tab.capabilities.get("cdp")` |
| `botDetection` | tab | `await tab.capabilities.get("botDetection")` |
| `browserAuth` | tab | `await tab.capabilities.get("browserAuth")` |

A capability can be obtained only when the backend advertises it and the client
has a callable definition for it.

## Playwright And Locators

Canonical method names include `locator.readAll()` and all methods in the table.

| Object | Implemented methods |
| --- | --- |
| `tab.playwright` | `domSnapshot()`, `evaluate()`, `elementInfo()`, `elementScreenshot()`, `expectNavigation()`, `frameLocator()`, `locator()`, `getByRole()`, `getByText()`, `getByLabel()`, `getByPlaceholder()`, `getByTestId()`, `waitForURL()`, `waitForLoadState()`, `waitForTimeout()`, `waitForEvent()` |
| `locator` composition | `first()`, `last()`, `nth()`, `filter()`, `and()`, `or()`, `locator()`, `getByRole()`, `getByText()`, `getByLabel()`, `getByPlaceholder()`, `getByTestId()` |
| `locator` actions | `click()`, `dblclick()`, `fill()`, `press()`, `type()`, `selectOption()`, `setChecked()`, `check()`, `uncheck()`, `waitFor()`, `downloadMedia()` |
| `locator` readers | `getAttribute()`, `innerText()`, `textContent()`, `inputValue()`, `isVisible()`, `isEnabled()`, `isChecked()`, `count()`, `allTextContents()`, `readAll()`, `all()` |
| `fileChooser` | `isMultiple()`, `accept()`, `setFiles()` |
| `download` | `suggestedFilename()`, `path()` |

Use `tab.playwright.waitForEvent("filechooser")` before file chooser upload
flows.

## Secure Browser Auth

| Capability | Status | Public API |
| --- | --- | --- |
| `browserAuth` | implemented | `await tab.capabilities.get("browserAuth").request(options)` |

`browserAuth.request({ origin, reason, expires_at, fields, submit? })` returns
only `{ status }`. It never returns password, OTP, cookies, screenshots, DOM
snippets, full URLs, or query strings to the agent. If `browserAuth` is
`unavailable`, do not ask the user to paste secrets into chat; stop and report
that secure browser credential entry is unavailable.

## CUA

Canonical method names include `tab.dom_cua.get_visible_dom()` and
`tab.cua.double_click()`.

| Object | Implemented methods |
| --- | --- |
| `tab.dom_cua` | `get_visible_dom()`, `click()`, `double_click()`, `type()`, `keypress()`, `scroll()`, `downloadMedia()` |
| `tab.cua` | `click()`, `double_click()`, `move()`, `drag()`, `scroll()`, `type()`, `keypress()`, `downloadMedia()` |

Clipboard methods use the canonical names `tab.clipboard.read()`,
`tab.clipboard.readText()`, `tab.clipboard.write()`, and
`tab.clipboard.writeText()`.

Prefer the high-level facade for ordinary user tasks:

```js
var result = await lumeBrowser.control.search({ engine: "baidu", query: "glm" });
await lumeBrowser.control.finalizeTabs({ keepTabIds: [result.tabId] });
nodeRepl.write(JSON.stringify(result));
```
