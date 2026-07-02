# Browser Playwright Locator Parity Design

## Goal

Close the next low-risk Codex Chrome parity gap by exposing the existing
Playwright locator combinators and append-typing method that can be supported
inside the current Lume Chrome extension runtime.

## Scope

This phase exposes:

- `PlaywrightLocator.and(locator)`
- `PlaywrightLocator.or(locator)`
- `PlaywrightLocator.type(value, options)`

The phase intentionally does not expose downloads, uploads, rich clipboard, raw
CDP, JavaScript dialogs, DOM CUA, `elementInfo`, `elementScreenshot`, or frame
locator support.

## Current Gap

`BrowserClient` and the canonical API catalog already include `and`, `or`, and
`type`, but `RuntimeDispatcher.extensionCaps()` hides them for the extension
backend. The runtime locator resolver also has stubbed handling for `and` and
`or`, so un-hiding them without resolver work would produce incorrect results.

## Runtime Design

The locator resolver will gain a small recursive resolver function inside the
page context. It resolves a `LocatorAst` from the document roots using the same
step semantics as the primary locator path. The `and` step keeps only current
elements that also appear in the nested locator result. The `or` step returns a
deduplicated union of current elements and nested locator results.

`type(value, options)` appends text to the current value or text content without
clearing existing content. It focuses the target element, applies the inserted
text to editable controls or contenteditable elements, and dispatches input and
change events. `fill(value)` remains replacement-oriented and unchanged.

## Public Projection

The extension descriptor will stop hiding `PlaywrightLocator.and`,
`PlaywrightLocator.or`, and `PlaywrightLocator.type`. Existing high-risk hidden
members remain hidden.

## Tests

Client conformance will verify that `and`, `or`, and `type` are visible and
send the expected command payloads.

Runtime or facade tests will verify that `and` returns an intersection, `or`
returns a deduplicated union, and `type` appends text without clearing existing
value.

Packaging tests will verify the API matrix documents the newly projected
members and still documents high-risk hidden surface.

## Risks

The resolver is a partial Playwright-compatible implementation. It should not
attempt to match every Playwright edge case in this phase. The implementation
must stay small and preserve current locator behavior for already exposed
members.
