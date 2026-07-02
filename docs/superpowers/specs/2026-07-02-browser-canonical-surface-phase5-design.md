# Browser canonical surface phase 5 design

## Objective

Phase 5 aligns the remaining practical `lume-chrome` browser surface with the Codex Chrome contract while keeping the runtime honest: agents should only see methods and capabilities that have usable implementations, and hidden methods should be limited to genuinely unsupported features.

The immediate user-facing goal is to stop agents from falling back to invented browser APIs or claiming browser automation is unavailable when the installed plugin can perform the work.

## Current state

`plugins/lume-chrome/src/client/api-contract.ts` now matches Codex Chrome's `docs/api.json` interface/member names. The remaining gaps are implementation and descriptor gaps:

- `Tab.content` is present in client code but hidden by the extension descriptor.
- `ContentAPI.exportGsuite(type)` is declared but missing from the client wrapper.
- `Tab.markDeliverable()` and `Tab.markHandoff()` are implemented in the client but hidden by the extension descriptor.
- `Tab.getJsDialog()` is declared but not implemented.
- `PlaywrightAPI.elementInfo()` and `PlaywrightAPI.elementScreenshot()` are declared and partially backed by runtime commands, but the client wrapper is missing and the runtime coordinate semantics are not Codex-compatible yet.
- The `cdp` tab capability is documented by Codex but Lume only exposes non-conformant low-level `tab.dev` helpers.
- The `botDetection` tab capability is documented by Codex and can be implemented as a safe host/local report that records only the current hostname and reason.
- `browserAuth` requires a secure credential-entry interruption/UI flow. A fake or chat-based implementation would be unsafe, so it stays out of this phase.

## Options considered

### Option A: Descriptor-only unhide

This would remove `apiSupportOverrides` for already implemented methods and leave missing wrappers for later.

Rejected because it would expose callable-looking contract members that still fail at runtime or have mismatched signatures. That is the same class of issue currently confusing agents.

### Option B: Core canonical surface plus safe capabilities

This phase implements the missing client wrappers, fixes runtime semantics where commands already exist, unhides only methods that pass conformance tests, and adds safe `cdp` and `botDetection` capability objects.

Recommended because it maximizes useful Codex parity without introducing the secure-auth UI dependency.

### Option C: Implement every remaining capability, including `browserAuth`

This would try to finish all Codex capability docs in one phase.

Rejected for now because `browserAuth` needs a trusted Lume host flow for secret input, selector validation, timeout handling, and result reporting. Implementing it in the extension alone would either leak secrets to the model or return a permanent stub that teaches agents an unhelpful path.

## Design

### Client API surface

Add or finish canonical wrappers in `src/client/BrowserClient.ts`:

- `Tab.getJsDialog()` returns `undefined` or a dialog object with `type`, `accept(...)`, and/or `dismiss()`.
- `ContentAPI.exportGsuite(type)` sends `tab_content_export_gsuite` with the requested type and returns a path or asset id string, matching `ContentAPI.export()`.
- `PlaywrightAPI.elementInfo(options)` sends coordinate-based element inspection and returns Codex-shaped element metadata.
- `PlaywrightAPI.elementScreenshot(options)` sends coordinate-based screenshot annotation/crop and returns `Uint8Array`.
- Keep `Tab.markDeliverable()` and `Tab.markHandoff()` as thin wrappers over `finalize_tabs`.

Do not add aliases such as `browser.tabs.create`, `browser.utils.wait`, or global helpers. The goal is Codex parity, not convenience sprawl.

### Runtime descriptor

Update `RuntimeDispatcher.extensionCaps()` so methods are hidden only when the extension truly does not implement them.

The phase should remove overrides for:

- `Tab.content`
- `Tab.getJsDialog`
- `Tab.markDeliverable`
- `Tab.markHandoff`
- `ContentAPI.export`
- `ContentAPI.exportGsuite`
- `PlaywrightAPI.elementInfo`
- `PlaywrightAPI.elementScreenshot`

The descriptor should advertise tab capabilities for `pageAssets`, `cdp`, and `botDetection`. It should not advertise `browserAuth` in this phase.

### JavaScript dialogs

Extend the debugger/controller layer to track `Page.javascriptDialogOpening` and `Page.javascriptDialogClosed` events per Chrome tab.

Runtime commands:

- `tab_js_dialog_get` returns the active dialog state or `undefined`.
- `tab_js_dialog_handle` accepts, dismisses, or submits prompt text through `Page.handleJavaScriptDialog`.

The client dialog object wraps those commands instead of trying to serialize functions over JSON-RPC.

### Content export

`tab.content.export()` should remain the canonical export path for the current page. `tab.exportContent()` can stay as a Lume-specific compatibility helper, but documentation should prefer `tab.content.export()`.

`exportGsuite(type)` should accept Codex's explicit type argument. For `md`, it can use the existing DOM/text extraction path. For binary or workspace-native formats such as `pdf`, `xlsx`, `csv`, `docx`, and `pptx`, the controller should attempt a Google Workspace export URL only when the current URL is recognizably Docs, Sheets, or Slides. If the page cannot be exported that way, return a typed unsupported error rather than silently producing the wrong format.

### Coordinate element inspection

`PlaywrightAPI.elementInfo({ x, y, includeNonInteractable? })` should inspect `document.elementFromPoint(x, y)` and nearby candidate ancestors, then return an array of Codex-shaped metadata with selector candidates, visible text, role, tag name, test id, and bounding box.

`elementScreenshot(...)` should use the same coordinate hit test and produce a screenshot focused on the chosen element bounds. Full annotation can be improved later; this phase should prefer a reliable bounded screenshot over pretending to provide richer overlays.

### `cdp` capability

Add a `CdpTabCapability` in `src/client/capabilities.ts`:

- `send(method, params?, options?)` forwards to a runtime CDP command for the tab.
- `readEvents(options?)` reads from an in-memory per-tab CDP event buffer using cursor semantics compatible with Codex docs.

Extend `ChromeDebugger` or a small adjacent controller to buffer CDP events with monotonically increasing sequence numbers. The buffer should be bounded to avoid unbounded memory growth; if events are evicted, `readEvents()` should report `truncated: true`.

Keep existing `tab.dev` helpers for compatibility, but document `tab.capabilities.get("cdp")` as the Codex-compatible path.

### `botDetection` capability

Add a `BotDetectionTabCapability`:

- `report({ reason })` validates the reason against Codex's enum.
- The runtime records only the parsed hostname and reason, never full URL, page content, screenshots, or cookies.
- The result shape is `{ status: "reported", hostname }`.

This is safe to implement without a host UI because it is metadata-only and does not grant additional browser control.

### Out of scope

- `browserAuth` secure credential request UI and interruption lifecycle.
- Full WebMCP tool forwarding.
- New dependencies.
- Replacing existing tab lease/group cleanup logic.
- Aliases for non-Codex helper names.

## Error handling

Expose capability or method failures as explicit runtime errors instead of hiding them behind generic fallback text:

- Unsupported GSuite export type/page combinations should explain that the current page cannot be exported as the requested type.
- `getJsDialog()` should return `undefined` when no dialog is active.
- Dialog handle calls should fail if the dialog is stale or already closed.
- `cdp.readEvents()` should validate limit and method filters.
- `botDetection.report()` should reject unknown reasons.

## Testing

Use existing test style and avoid full-repo validation.

Required checks:

- Client conformance tests for every newly visible method and capability wrapper.
- Runtime descriptor test proving the removed overrides stay removed and `cdp`/`botDetection` are advertised.
- Runtime dispatcher tests for dialog get/handle, CDP event buffering, and bot detection report shape.
- Packaging/documentation tests proving the browser API matrix teaches canonical `tab.content`, `getJsDialog`, `cdp`, and `botDetection`.
- `npm test`
- `npm run check:coverage`

## Success criteria

- Agents can discover and call the Codex canonical wrappers without hidden-method surprises.
- The descriptor does not advertise `browserAuth`.
- The API matrix clearly separates implemented canonical features from deferred secure-auth work.
- The package coverage check still reports no missing command handlers.
