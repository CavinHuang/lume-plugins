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

| Object | Effective public members |
| --- | --- |
| `browser` | `browserId`, `capabilities`, `tabs`, `user`, `documentation()`, `nameSession()` |
| `browser.user` | `openTabs()`, `claimTab()` |
| `browser.tabs` | `new()`, `get()`, `selected()`, `list()` |
| `tab` | `id`, `capabilities`, `close()`, `title()`, `url()`, `goto()`, `back()`, `forward()`, `reload()`, `screenshot()` |

The extension currently advertises no optional capability objects. A capability
can be obtained only when the backend advertises it and the client has a
callable definition for it.

## Hidden Surface

These implementation paths are intentionally not part of the current extension
projection: Playwright, DOM CUA, coordinate CUA, clipboard, dev/CDP, content,
tab finalization, history, and dialog helpers. They remain dynamically hidden
until their command parameters, return values, safety policy, and conformance
tests match the public contract.

The temporary Node REPL WebSocket bootstrap is an implementation detail, not an
Agent API. Direct bridge state and helper facades must not be used by skills.
`webmcp` is internal and not public.

## Object Lifetime

Browser objects are tied to the backend generation from which they were
created. After backend refresh or native reconnection changes that generation,
old command-bearing objects reject locally with `Browser object is stale`.
Select the browser again before continuing.
