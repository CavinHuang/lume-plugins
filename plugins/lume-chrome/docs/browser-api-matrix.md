# Lume Browser Compatibility Surface

Lume exposes a Codex-compatible public contract through `globalThis.agent`.
The runtime projects each backend through the canonical API catalog; members
that are unsupported or not yet conformant are dynamically hidden from normal
property access and reflection.

## Browser Selection

| Intent | Public API |
| --- | --- |
| Explicit Chrome state | `agent.browsers.get("extension")` |
| URL known, backend unspecified | `agent.browsers.getForUrl(url)` |
| No URL or backend preference | `agent.browsers.getDefault()` |
| Discover registered backends | `agent.browsers.list()` |

Call `await browser.documentation()` after selection. It combines backend-safe
guidance, the effective API member list, and available lookup documents.

## Current Extension Projection

The extension descriptor currently exposes the contract members that have
passed this phase's conformance boundary. The following object paths are
available:

### Projected core API

| Object | Effective public members |
| --- | --- |
| `browser` | `browserId`, `capabilities`, `tabs`, `user`, `documentation()`, `nameSession()` |
| `browser.user` | `openTabs()`, `claimTab()`, `history()` |
| `browser.tabs` | `new()`, `get()`, `selected()`, `list()`, `finalize()` |
| `tab` | `id`, `capabilities`, `clipboard`, `content`, `playwright`, `close()`, `title()`, `url()`, `goto()`, `back()`, `forward()`, `reload()`, `screenshot()`, `markDeliverable()`, `markHandoff()` |
| `tab.content` | `export()` |
| `tab.clipboard` | `readText()`, `writeText()` |
| `tab.playwright` | `domSnapshot()`, `evaluate()`, `expectNavigation()`, `locator()`, `getByRole()`, `getByText()`, `getByLabel()`, `getByPlaceholder()`, `getByTestId()`, `waitForURL()`, `waitForLoadState()`, `waitForTimeout()` |
| `tab.playwright.locator(...)` | `click()`, `dblclick()`, `fill()`, `press()`, `selectOption()`, `setChecked()`, `check()`, `uncheck()`, `getAttribute()`, `innerText()`, `textContent()`, `inputValue()`, `isVisible()`, `isEnabled()`, `isChecked()`, `count()`, `all()`, `allTextContents()`, `filter()`, `first()`, `last()`, `locator()`, `nth()`, `waitFor()` |

### Controller-backed adapters

`browser.user.history()` maps Codex `queries`, `from`, `to`, and `limit` into
Chrome history search options and returns ISO `dateVisited` values.
`tab.content.export()` returns a local asset path from the existing content
export controller. `tab.clipboard.readText()` and `writeText()` expose only the
plain text clipboard path.

### Playwright core

The projected Playwright core is the conservative subset backed by both the
client API and the Chrome extension dispatcher. It covers page snapshots,
read-only evaluation, navigation waits, and basic locator queries/actions.
`waitForEvent`, `frameLocator`, file chooser upload, and download methods stay
dynamically hidden until their safety and return-value contracts are conformant.

### Implemented optional capabilities

| Capability | Scope | Public API |
| --- | --- | --- |
| `visibility` | browser | `await browser.capabilities.get("visibility")` |
| `viewport` | browser | `await browser.capabilities.get("viewport")` |
| `pageAssets` | tab | `await tab.capabilities.get("pageAssets")` |

A capability can be obtained only when the backend advertises it and the client
has a callable definition for it.

## Hidden Surface

These implementation paths are intentionally not part of the current extension
projection: DOM CUA, coordinate CUA, rich clipboard, `exportGsuite()`,
background `Tabs.content(...)`, dev/CDP, dialog helpers, Playwright event/frame
helpers, file chooser upload, and download flows. They remain dynamically
hidden until their command parameters, return values, safety policy, and
conformance tests match the public contract.

### Unavailable Codex capabilities

| Capability | Status | Reason |
| --- | --- | --- |
| `browserAuth` | unavailable | Secure credential handoff needs a separate Lume interruption flow. |
| `botDetection` | unavailable | Reporting storage and host policy are not implemented. |
| `cdp` | unavailable | The Codex capability object (`send`, `readEvents`) is not conformant yet. |

The temporary Node REPL WebSocket bootstrap is an implementation detail, not an
Agent API. Direct bridge state and helper facades must not be used by skills.
`webmcp` is internal and not public.

## Object Lifetime

Browser objects are tied to the backend generation from which they were
created. After backend refresh or native reconnection changes that generation,
old command-bearing objects reject locally with `Browser object is stale`.
Select the browser again before continuing.
