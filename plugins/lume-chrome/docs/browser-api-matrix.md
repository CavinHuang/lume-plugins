# Lume Browser API Matrix

This is the Codex-compatible public contract exposed to Lume agents through
the canonical `agent.browsers` runtime. Method names come from
`src/client/BrowserClient.ts`; backend descriptors dynamically hide unavailable
capabilities instead of presenting them as working features.

## Capability Summary

| Category | Status | Public API | Notes |
| --- | --- | --- | --- |
| browser | implemented | `agent.browsers.*`, `browser.*` | Always await `agent.browsers.get(...)`. |
| session | implemented | Broker-issued context and generation | Callers cannot override trusted identity fields. |
| tab | implemented | `browser.tabs.*`, `browser.user.*`, `tab.*` | Use `browser.tabs.new()`, not `browser.tabs.create`. |
| navigation | implemented | `tab.goto()`, `tab.back()`, `tab.forward()`, `tab.reload()` | IAB is the default backend; request `extension` explicitly for Chrome. |
| locator | implemented | `tab.playwright` locator builders and locator operations | Preferred for stable element interaction. |
| playwright | implemented | snapshots, navigation waits, event waits | There is no generic JavaScript `evaluate` or `browser.utils.wait`. |
| cua | implemented | `tab.dom_cua.*`, `tab.cua.*` | Prefer DOM CUA over coordinates. |
| screenshot | implemented | `tab.screenshot()` | Returns `Uint8Array`. |
| finalize | implemented | `browser.tabs.finalize()`, `release()`, `handoff()` | Finalize every browser turn. |
| diagnostics | implemented | `agent.browsers.diagnostics()` | Reports registered backends and connection state. |
| guarded files | IAB only | guarded upload and task download APIs | External Chrome does not advertise Agent upload/download. |
| saved credentials | IAB only | Broker-controlled `browserAuth` | External Chrome never receives saved secrets. |
| raw protocol | reference-only | `BrowserCommandType` in `src/shared/protocol.ts` | Do not send raw commands when a client method exists. |
| invented helpers | intentionally unsupported | `lumeBrowser.control.*`, `browser.tabs.create`, `browser.tabs.open`, `agent.navigate` | These APIs do not exist. |

## Stable Runtime Global

| Global | Status | Purpose |
| --- | --- | --- |
| `agent` | implemented | Entry point containing `browsers` and runtime documentation. |

The legacy `lumeBrowser`, `lumeBrowserControl`, `lumeBrowserAgent`, and
`lumeBrowserBridge` globals were removed. Browser commands must pass through the
Broker-backed `agent.browsers` transport.

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
| `tab.content` | `export()`, `exportGsuite(type)` when the descriptor advertises support |
| `tab.capabilities` | `list()`, `get()` |
| `tab.clipboard` | `read()`, `readText()`, `write()`, `writeText()` when advertised and confirmed |
| `tab.dev` | allowlisted CDP calls for an enabled isolated IAB developer session |
| `tab.capabilities` | Descriptor-gated `pageAssets`, `cdp`, `botDetection`, and backend-specific capabilities |

## Playwright And Locators

Canonical method names include `locator.readAll()` and all methods in the table.
The backend descriptor is authoritative: a member listed in the shared client is
not evidence that a particular backend supports it.

| Object | Implemented methods |
| --- | --- |
| `tab.playwright` | `domSnapshot()`, `elementInfo()`, `elementScreenshot()`, `expectNavigation()`, `frameLocator()`, `locator()`, `getByRole()`, `getByText()`, `getByLabel()`, `getByPlaceholder()`, `getByTestId()`, `waitForURL()`, `waitForLoadState()`, `waitForTimeout()`, `waitForEvent()` |
| `locator` composition | `first()`, `last()`, `nth()`, `filter()`, `and()`, `or()`, `locator()`, `getByRole()`, `getByText()`, `getByLabel()`, `getByPlaceholder()`, `getByTestId()` |
| `locator` actions | `click()`, `dblclick()`, `fill()`, `press()`, `type()`, `selectOption()`, `setChecked()`, `check()`, `uncheck()`, `waitFor()` |
| `locator` readers | `getAttribute()`, `innerText()`, `textContent()`, `inputValue()`, `isVisible()`, `isEnabled()`, `isChecked()`, `count()`, `allTextContents()`, `readAll()`, `all()` |

External Chrome intentionally returns `E_UNSUPPORTED` for file chooser, Agent
download, download-path, and saved-credential commands and does not advertise
those capabilities. IAB file operations use opaque task-bound file references;
arbitrary local paths are never accepted from Agent input.

## CUA

Canonical method names include `tab.dom_cua.get_visible_dom()` and
`tab.cua.double_click()`.

| Object | Implemented methods |
| --- | --- |
| `tab.dom_cua` | `get_visible_dom()`, `click()`, `double_click()`, `type()`, `keypress()`, `scroll()` |
| `tab.cua` | `click()`, `double_click()`, `move()`, `drag()`, `scroll()`, `type()`, `keypress()` |

Clipboard methods use the canonical names `tab.clipboard.read()`,
`tab.clipboard.readText()`, `tab.clipboard.write()`, and
`tab.clipboard.writeText()`.

```js
const browser = await agent.browsers.get("iab");
const tab = await browser.tabs.new();
await tab.goto("https://example.com");
await browser.tabs.finalize({ keepTabIds: [tab.id] });
```
