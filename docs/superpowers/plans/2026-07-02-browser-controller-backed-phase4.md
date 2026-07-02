# Browser Controller-Backed Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Codex-shaped Chrome history, tab content export, and plain text clipboard APIs that are already backed by Lume controllers.

**Architecture:** Keep the current client/runtime projection model. `BrowserClient.ts` adapts public Codex method shapes to existing extension commands, while `RuntimeDispatcher.extensionCaps()` controls which contract members are visible. Tests assert that visible methods are callable and hidden methods remain absent.

**Tech Stack:** TypeScript, Chrome extension runtime, Node `node:test`, npm scripts in `plugins/lume-chrome`.

---

### Task 1: Client Conformance For Controller-Backed APIs

**Files:**
- Test: `plugins/lume-chrome/tests/client-conformance.test.mjs`

- [ ] **Step 1: Write the failing client conformance test**

In `plugins/lume-chrome/tests/client-conformance.test.mjs`, extend the existing fake extension backend setup with nonconformant member hides and fake responses:

```js
"ContentAPI.exportGsuite": false,
"TabClipboardAPI.read": false,
"TabClipboardAPI.write": false,
```

Add responses after the current `finalize_tabs` response:

```js
fake.respond("browser_user_history", [
  {
    url: "https://example.com/docs",
    title: "Docs",
    lastVisitTime: Date.parse("2026-01-02T03:04:05.000Z"),
  },
]);
fake.respond("tab_content_export", { assetId: "asset-1", path: "C:\\tmp\\page.md" });
fake.respond("tab_clipboard_read_text", "clipboard text");
fake.respond("tab_clipboard_write_text", undefined);
```

Add assertions after `assert.equal(browser.tabs.content, undefined);`:

```js
const history = await browser.user.history({
  queries: ["lume", "chrome"],
  from: "2026-01-01T00:00:00.000Z",
  to: new Date("2026-01-03T00:00:00.000Z"),
  limit: 5,
});
assert.deepEqual(history, [
  {
    url: "https://example.com/docs",
    title: "Docs",
    dateVisited: "2026-01-02T03:04:05.000Z",
  },
]);
const historyCall = fake.calls.find((call) => call.method === "browser_user_history");
assert.deepEqual(historyCall.params.options, {
  text: "lume chrome",
  maxResults: 5,
  startTime: Date.parse("2026-01-01T00:00:00.000Z"),
  endTime: Date.parse("2026-01-03T00:00:00.000Z"),
});
```

Add assertions after `const tab = await browser.tabs.get("42");` and before stale-object checks:

```js
assert.equal(typeof tab.content.export, "function");
assert.equal(tab.content.exportGsuite, undefined);
assert.equal(await tab.content.export(), "C:\\tmp\\page.md");
const exportCall = fake.calls.find((call) => call.method === "tab_content_export");
assert.deepEqual(exportCall.params.options, { format: "markdown" });

assert.equal(tab.clipboard.read, undefined);
assert.equal(typeof tab.clipboard.readText, "function");
assert.equal(await tab.clipboard.readText(), "clipboard text");
assert.equal(tab.clipboard.write, undefined);
assert.equal(typeof tab.clipboard.writeText, "function");
await tab.clipboard.writeText("new clipboard text");
const clipboardWrite = fake.calls.find((call) => call.method === "tab_clipboard_write_text");
assert.equal(clipboardWrite.params.text, "new clipboard text");
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/client-conformance.test.mjs`

Expected: FAIL because `browser.user.history(...)` still returns raw Chrome entries, `tab.content` is missing, and descriptor projection may still expose or hide the wrong clipboard members.

### Task 2: Implement Client Adapters And Runtime Descriptor

**Files:**
- Modify: `plugins/lume-chrome/src/client/BrowserClient.ts`
- Modify: `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`
- Test: `plugins/lume-chrome/tests/client-conformance.test.mjs`
- Test: `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`

- [ ] **Step 1: Add failing descriptor expectations**

In `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`, update the expected `apiSupportOverrides`:

Remove these false overrides:

```js
"BrowserUser.history": false,
"Tab.clipboard": false,
"Tab.content": false,
```

Add these false overrides:

```js
"ContentAPI.exportGsuite": false,
"TabClipboardAPI.read": false,
"TabClipboardAPI.write": false,
```

- [ ] **Step 2: Run descriptor test and confirm failure**

Run: `npm test -- tests/runtime-dispatcher-descriptor.test.mjs`

Expected: FAIL because `RuntimeDispatcher.extensionCaps()` still hides `BrowserUser.history`, `Tab.clipboard`, and `Tab.content`, and does not hide the finer-grained members.

- [ ] **Step 3: Implement browser history adaptation**

In `plugins/lume-chrome/src/client/BrowserClient.ts`, replace `BrowserUser.history(...)` with Codex-shaped options and results:

```ts
type BrowserHistoryOptions = {
  from?: string | Date;
  limit?: number;
  queries?: string[];
  to?: string | Date;
};

type BrowserHistoryEntry = {
  dateVisited: string;
  title?: string;
  url: string;
};

type RawBrowserHistoryEntry = {
  lastVisitTime?: number;
  title?: string;
  url?: string;
};
```

Use this method body:

```ts
async history(options: BrowserHistoryOptions = {}): Promise<BrowserHistoryEntry[]> {
  const query = options.queries?.filter(Boolean).join(" ") ?? "";
  const commandOptions: { text: string; maxResults?: number; startTime?: number; endTime?: number } = {
    text: query,
  };
  if (typeof options.limit === "number") commandOptions.maxResults = options.limit;
  const startTime = historyTime(options.from);
  const endTime = historyTime(options.to);
  if (startTime !== undefined) commandOptions.startTime = startTime;
  if (endTime !== undefined) commandOptions.endTime = endTime;

  const entries = await this.t.send<RawBrowserHistoryEntry[]>("browser_user_history", {
    context: this.ctx,
    options: commandOptions,
  });
  return entries.flatMap((entry) => entry.url
    ? [{
        url: entry.url,
        ...(entry.title ? { title: entry.title } : {}),
        dateVisited: new Date(entry.lastVisitTime ?? 0).toISOString(),
      }]
    : []);
}
```

Add this helper near `requestedType(...)`:

```ts
function historyTime(value: string | Date | undefined): number | undefined {
  if (value === undefined) return undefined;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}
```

- [ ] **Step 4: Implement tab content export adapter**

In `Tab`, add a public field:

```ts
readonly content: ContentAPI;
```

Initialize it in the constructor:

```ts
this.content = new ContentAPI(t, ctx, id);
```

Add this class before `TabDevAPI`:

```ts
class ContentAPI {
  constructor(private readonly t: BrowserTransport, private readonly ctx: BrowserContext, private readonly tabId: string) {}
  async export(): Promise<string> {
    const result = await this.t.send<{ assetId: string; path?: string }>("tab_content_export", {
      context: this.ctx,
      tabId: this.tabId,
      options: { format: "markdown" },
    });
    return result.path ?? result.assetId;
  }
}
```

- [ ] **Step 5: Update runtime descriptor visibility**

In `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`, update `extensionCaps()` so `apiSupportOverrides` no longer includes:

```ts
"BrowserUser.history": false,
"Tab.clipboard": false,
"Tab.content": false,
```

Add:

```ts
"ContentAPI.exportGsuite": false,
"TabClipboardAPI.read": false,
"TabClipboardAPI.write": false,
```

Do not expose `Tabs.content`, `ContentAPI.exportGsuite`, rich clipboard, downloads, uploads, CDP, auth, bot detection, or dialogs.

- [ ] **Step 6: Run tests and confirm pass**

Run: `npm test -- tests/client-conformance.test.mjs tests/runtime-dispatcher-descriptor.test.mjs`

Expected: PASS.

### Task 3: Documentation Matrix

**Files:**
- Modify: `plugins/lume-chrome/docs/browser-api-matrix.md`
- Test: `plugins/lume-chrome/tests/plugin-packaging.test.mjs`

- [ ] **Step 1: Write failing documentation assertions**

In `plugins/lume-chrome/tests/plugin-packaging.test.mjs`, add matrix assertions:

```js
assert.match(matrix, /browser\.user.*history\(\)/s);
assert.match(matrix, /tab\.content/);
assert.match(matrix, /export\(\)/);
assert.match(matrix, /tab\.clipboard/);
assert.match(matrix, /readText\(\)/);
assert.match(matrix, /writeText\(\)/);
assert.match(matrix, /rich clipboard/);
assert.match(matrix, /exportGsuite/);
```

- [ ] **Step 2: Run packaging test and confirm failure**

Run: `npm test -- tests/plugin-packaging.test.mjs`

Expected: FAIL because `browser-api-matrix.md` does not yet document the new controller-backed surface.

- [ ] **Step 3: Update API matrix**

In `plugins/lume-chrome/docs/browser-api-matrix.md`, update the projected core table:

```md
| `browser.user` | `openTabs()`, `claimTab()`, `history()` |
| `tab` | `id`, `capabilities`, `clipboard`, `content`, `playwright`, `close()`, `title()`, `url()`, `goto()`, `back()`, `forward()`, `reload()`, `screenshot()`, `markDeliverable()`, `markHandoff()` |
| `tab.content` | `export()` |
| `tab.clipboard` | `readText()`, `writeText()` |
```

Add a short section:

```md
### Controller-backed adapters

`browser.user.history()` maps Codex `queries`, `from`, `to`, and `limit` into
Chrome history search options and returns ISO `dateVisited` values.
`tab.content.export()` returns a local asset path from the existing content
export controller. `tab.clipboard.readText()` and `writeText()` expose only the
plain text clipboard path.
```

Update hidden surface text to include:

```md
rich clipboard, `exportGsuite()`, background `Tabs.content(...)`
```

- [ ] **Step 4: Run packaging test and confirm pass**

Run: `npm test -- tests/plugin-packaging.test.mjs`

Expected: PASS.

### Task 4: Final Verification And Commit

**Files:**
- All files touched by Tasks 1-3.

- [ ] **Step 1: Run full plugin tests**

Run: `npm test`

Expected: all 54 tests pass, or the updated total if new tests are added.

- [ ] **Step 2: Run command coverage**

Run: `npm run check:coverage`

Expected: output contains `"missing": []`.

- [ ] **Step 3: Remove generated build noise**

From repo root, run:

```powershell
git restore --worktree -- plugins/lume-chrome/dist plugins/lume-chrome/lume-browser-extension-v4.zip
Remove-Item -LiteralPath "plugins\lume-chrome\dist\client\api-contract.js", "plugins\lume-chrome\dist\client\backend-selection.js", "plugins\lume-chrome\dist\client\capabilities.js", "plugins\lume-chrome\dist\client\documentation.js", "plugins\lume-chrome\dist\client\runtime-view.js" -ErrorAction SilentlyContinue
```

Expected: `git status --short` shows only source, test, docs, spec, and plan files.

- [ ] **Step 4: Commit implementation**

Use Lore format:

```bash
git add plugins/lume-chrome/src/client/BrowserClient.ts plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts plugins/lume-chrome/tests/client-conformance.test.mjs plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs plugins/lume-chrome/tests/plugin-packaging.test.mjs plugins/lume-chrome/docs/browser-api-matrix.md
git commit -m "✨ feat(browser): 开放控制器支撑的 Chrome API" \
  -m "在第四阶段只开放已有 controller 可适配到 Codex 形状的 history、tab content export 和 plain text clipboard，继续隐藏高风险或未对齐能力。" \
  -m "Constraint: 不新增依赖或 host protocol" \
  -m "Rejected: 开放完整 clipboard 和 upload/download | 返回值、安全边界和权限契约尚未对齐" \
  -m "Tested: npm test" \
  -m "Tested: npm run check:coverage"
```
