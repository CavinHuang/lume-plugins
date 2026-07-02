# Browser Controller-Backed Phase 4 Design

## Context

Phase 3 opened Chrome tab cleanup and a conservative Playwright core for
`plugins/lume-chrome`. The remaining Codex browser surface is larger, but not
all parts have the same implementation risk. Lume already has controllers for
browser history, clipboard text, and tab content export, while upload/download,
CDP capability, browserAuth, botDetection, and JavaScript dialogs still require
separate safety and runtime contracts.

This phase opens only controller-backed APIs that can be adapted to Codex's
public shape without new dependencies or new host protocols.

## Goals

- Expose `browser.user.history(options)` for Chrome with Codex-shaped
  arguments and results.
- Expose `tab.content.export()` as a Codex-shaped content export returning a
  local asset path string.
- Expose `tab.clipboard.readText()` and `tab.clipboard.writeText(text)` for
  plain text clipboard workflows.
- Keep unsupported or nonconformant members dynamically hidden so agents cannot
  call APIs that only partially work.
- Update tests and documentation so the advertised surface matches the actual
  runtime behavior.

## Non-Goals

- Do not expose `Tabs.content(...)`; background temporary tab extraction has a
  different contract from current per-tab export.
- Do not expose `ContentAPI.exportGsuite(...)`; the current controller does not
  accept Codex's explicit export type argument and returns a generic markdown
  artifact.
- Do not expose `TabClipboardAPI.read()` or `write(items)`; Codex expects a
  multi-entry clipboard item shape, while Lume currently supports text-first
  simplified payloads.
- Do not expose Playwright file chooser, downloads, `frameLocator`, event
  waiting, CDP capability, browserAuth, botDetection, or dialogs in this phase.

## Public API Surface

The extension descriptor should stop hiding:

- `BrowserUser.history`
- `Tab.content`
- `ContentAPI.export`
- `Tab.clipboard`
- `TabClipboardAPI.readText`
- `TabClipboardAPI.writeText`

The extension descriptor should continue hiding:

- `Tabs.content`
- `ContentAPI.exportGsuite`
- `TabClipboardAPI.read`
- `TabClipboardAPI.write`
- all previously hidden high-risk Playwright, CDP, auth, bot detection, dialog,
  and download/upload members.

## API Shape Adaptation

### Browser History

Codex expects:

```ts
history(options: {
  from?: string | Date;
  limit?: number;
  queries?: string[];
  to?: string | Date;
}): Promise<Array<{ dateVisited: string; title?: string; url: string }>>;
```

Lume should translate this to the existing `browser_user_history` command:

- `queries` becomes a focused Chrome `text` search. Use a single joined query
  string rather than repeated exploratory calls.
- `limit` maps to `maxResults`.
- `from` and `to` map to millisecond timestamps.
- results map Chrome `lastVisitTime` to ISO `dateVisited`.

If no query is provided, the call still works with an empty `text` value and the
explicit bounds/limit.

### Tab Content Export

Codex expects `tab.content.export(): Promise<string>`.

Lume should add a `ContentAPI` object to `Tab` and implement `export()` by
calling `tab_content_export` with the existing safe default content format. The
client should return the local path string when the runtime returns a path, and
fall back to the asset id only if no path is present.

`tab.exportContent(...)` remains as a Lume internal convenience but is outside
the canonical public contract and should not be documented as the Codex path.

### Plain Text Clipboard

Codex text clipboard methods align with existing controller commands:

- `readText()` calls `tab_clipboard_read_text`.
- `writeText(text)` calls `tab_clipboard_write_text`.

The richer `read()` and `write(items)` methods remain hidden until Lume returns
and accepts Codex-shaped `TabClipboardItem[]`.

## Runtime Descriptor And Documentation

`RuntimeDispatcher.extensionCaps()` remains the single source of runtime
visibility for the extension backend. It should expose only the newly adapted
members above and keep high-risk members disabled through `apiSupportOverrides`.

`docs/browser-api-matrix.md` should list the newly visible paths and explicitly
state that rich clipboard, background content extraction, GSuite typed export,
uploads/downloads, CDP, auth, bot detection, and dialogs remain hidden.

## Testing Strategy

Use the existing Node test suite and TDD:

- `client-conformance.test.mjs` should assert that the new public methods are
  visible through `setupBrowserRuntime`, call the fake backend with adapted
  payloads, and return Codex-shaped results.
- `runtime-dispatcher-descriptor.test.mjs` should assert that the descriptor no
  longer hides the newly supported members and still hides nonconformant ones.
- `plugin-packaging.test.mjs` should assert that the API matrix documents the
  newly exposed controller-backed surface.
- Full verification remains `npm test` and `npm run check:coverage` in
  `plugins/lume-chrome`.

## Risks

- Chrome history access can require permission or user approval. The runtime
  already routes history through confirmation policy; this phase only adapts
  the client-visible shape.
- Clipboard APIs depend on page/browser permissions. This phase exposes only
  plain text methods and relies on existing runtime confirmation for writes.
- Content export currently returns local asset metadata. The client adapter
  must not promise richer file typing than the runtime can provide.
