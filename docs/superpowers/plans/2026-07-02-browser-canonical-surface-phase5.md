# Browser Canonical Surface Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the remaining practical `lume-chrome` API surface match Codex Chrome for canonical tab content, dialogs, coordinate element inspection, `cdp`, and `botDetection`.

**Architecture:** Keep the existing JSON-RPC boundary: client wrappers in `src/client`, runtime command handling in `src/extension/runtime`, browser-specific behavior in focused controllers, and advertised support in the backend descriptor. Hide only `browserAuth` after this phase; do not add aliases or new dependencies.

**Tech Stack:** TypeScript, Chrome Extension APIs, Chrome debugger protocol, Node test runner, existing plugin build and coverage scripts.

---

## File Structure

- Modify `plugins/lume-chrome/src/client/BrowserClient.ts`: add canonical wrappers for `getJsDialog`, `ContentAPI.exportGsuite`, `PlaywrightAPI.elementInfo`, `PlaywrightAPI.elementScreenshot`, and capability wrappers.
- Modify `plugins/lume-chrome/src/client/capabilities.ts`: add `CdpCapability` and `BotDetectionCapability`.
- Modify `plugins/lume-chrome/src/shared/protocol.ts`: add command names and shared result types for dialogs, CDP event reads, coordinate element info, and bot detection.
- Modify `plugins/lume-chrome/src/extension/debugger/ChromeDebugger.ts`: track active JavaScript dialogs and buffered CDP events.
- Modify `plugins/lume-chrome/src/extension/controllers/PlaywrightFacade.ts`: add coordinate-based element info and screenshot helpers.
- Modify `plugins/lume-chrome/src/extension/controllers/ContentExportController.ts`: accept explicit GSuite export type and fail unsupported type/page combinations clearly.
- Modify `plugins/lume-chrome/src/extension/runtime/CapabilityRegistry.ts`: advertise and document `cdp` and `botDetection`.
- Modify `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`: unhide implemented canonical methods, advertise safe capabilities, and dispatch new commands.
- Modify `plugins/lume-chrome/docs/browser-api-matrix.md`: document canonical supported methods and move `browserAuth` to the only deferred Codex capability.
- Modify generated `plugins/lume-chrome/dist/**` by running `npm run build`.
- Modify generated `plugins/lume-chrome/lume-browser-extension-v4.zip` by running `npm run zip:extension`.
- Test `plugins/lume-chrome/tests/client-conformance.test.mjs`: client-level wrapper and transport assertions.
- Test `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`: advertised descriptor and overrides.
- Test `plugins/lume-chrome/tests/runtime-dispatcher-response.test.mjs`: runtime response shape for new commands.
- Test `plugins/lume-chrome/tests/playwright-facade.test.mjs`: coordinate element inspection behavior.
- Test `plugins/lume-chrome/tests/plugin-packaging.test.mjs`: docs and packaging assertions.

---

### Task 1: Client Canonical Wrapper Tests

**Files:**
- Modify: `plugins/lume-chrome/tests/client-conformance.test.mjs`

- [ ] **Step 1: Add fake backend responses for newly visible wrappers**

In `client-conformance.test.mjs`, remove these entries from the fake descriptor's `apiSupportOverrides`:

```js
"ContentAPI.exportGsuite": false,
"Tab.getJsDialog": false,
"PlaywrightAPI.elementInfo": false,
"PlaywrightAPI.elementScreenshot": false,
```

Add these fake responses after the existing `tab_content_export` response:

```js
fake.respond("tab_content_export_gsuite", { assetId: "asset-gsuite", path: "C:\\tmp\\sheet.xlsx" });
fake.respond("tab_js_dialog_get", { type: "confirm", message: "Continue?" });
fake.respond("tab_js_dialog_handle", undefined);
fake.respond("playwright_element_info", [
  {
    tagName: "BUTTON",
    role: "button",
    visibleText: "Save",
    selector: { primary: "button", candidates: ["button"] },
    boundingBox: { x: 10, y: 20, width: 80, height: 30 },
  },
]);
fake.respond("playwright_element_screenshot", { dataBase64: Buffer.from("png").toString("base64") });
```

- [ ] **Step 2: Add assertions that prove the wrappers are callable and send canonical commands**

Replace the existing hidden-method assertions:

```js
assert.equal(tab.getJsDialog, undefined);
assert.equal(tab.content.exportGsuite, undefined);
assert.equal(tab.playwright.elementInfo, undefined);
assert.equal(tab.playwright.elementScreenshot, undefined);
```

with:

```js
assert.equal(typeof tab.getJsDialog, "function");
const dialog = await tab.getJsDialog();
assert.equal(dialog.type, "confirm");
await dialog.accept();
await dialog.dismiss();
assert.deepEqual(
  fake.calls
    .filter((call) => call.method === "tab_js_dialog_handle")
    .map((call) => call.params),
  [
    { context: { browserSessionId: "browser-runtime", browserTurnId: "browser-runtime", actor: "agent" }, browserId: "chrome-1", tabId: "42", accept: true },
    { context: { browserSessionId: "browser-runtime", browserTurnId: "browser-runtime", actor: "agent" }, browserId: "chrome-1", tabId: "42", accept: false },
  ],
);

assert.equal(typeof tab.content.exportGsuite, "function");
assert.equal(await tab.content.exportGsuite("xlsx"), "C:\\tmp\\sheet.xlsx");
const gsuiteCall = fake.calls.find((call) => call.method === "tab_content_export_gsuite");
assert.equal(gsuiteCall.params.type, "xlsx");

assert.equal(typeof tab.playwright.elementInfo, "function");
assert.deepEqual(await tab.playwright.elementInfo({ x: 10, y: 20 }), [
  {
    tagName: "BUTTON",
    role: "button",
    visibleText: "Save",
    selector: { primary: "button", candidates: ["button"] },
    boundingBox: { x: 10, y: 20, width: 80, height: 30 },
  },
]);
assert.equal(typeof tab.playwright.elementScreenshot, "function");
assert.deepEqual([...await tab.playwright.elementScreenshot({ x: 10, y: 20 })], [...Buffer.from("png")]);
```

- [ ] **Step 3: Run the targeted test and confirm it fails**

Run:

```powershell
npm test -- tests/client-conformance.test.mjs
```

Expected: FAIL because `getJsDialog`, `exportGsuite`, `elementInfo`, and `elementScreenshot` are not implemented by the client wrappers yet.

---

### Task 2: Client Canonical Wrapper Implementation

**Files:**
- Modify: `plugins/lume-chrome/src/shared/protocol.ts`
- Modify: `plugins/lume-chrome/src/client/BrowserClient.ts`
- Test: `plugins/lume-chrome/tests/client-conformance.test.mjs`

- [ ] **Step 1: Add protocol command names and shared types**

In `BrowserCommandType`, add these command strings near the tab and Playwright commands:

```ts
| "tab_js_dialog_get" | "tab_js_dialog_handle"
| "playwright_element_info" | "playwright_element_screenshot"
| "tab_bot_detection_report" | "tab_cdp_send" | "tab_cdp_read_events"
```

Add these exported interfaces below `DownloadInfo`:

```ts
export type JsDialogType = "alert" | "beforeunload" | "confirm" | "prompt";
export interface JsDialogInfo { type: JsDialogType; message?: string; defaultValue?: string; }
export interface CoordinateElementInfo {
  tagName: string;
  role?: string | null;
  ariaName?: string | null;
  visibleText?: string | null;
  testId?: string | null;
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
  selector: { primary?: string | null; candidates: string[]; frameSelectors?: string[] };
}
export type BotDetectionReason = "captcha_failed" | "access_denied" | "challenge_loop" | "unexpected_bot_error";
export interface CdpBufferedEvent {
  method: string;
  params?: Record<string, unknown>;
  sequence: number;
  source: { extensionId?: string; sessionId?: string; tabId?: number; targetId?: string };
}
export interface CdpReadEventsResult {
  cursor: number;
  events: CdpBufferedEvent[];
  hasMore: boolean;
  truncated: boolean;
}
```

- [ ] **Step 2: Add dialog wrapper classes**

Import `JsDialogInfo` in `BrowserClient.ts`, then add these classes before `ContentAPI`:

```ts
type DialogHandleOptions = { accept: boolean; promptText?: string };

class BaseDialog {
  constructor(
    protected readonly t: BrowserTransport,
    protected readonly ctx: BrowserContext,
    protected readonly tabId: string,
    public readonly type: string,
    public readonly message?: string,
  ) {}

  protected handle(options: DialogHandleOptions): Promise<void> {
    return this.t.send("tab_js_dialog_handle", {
      context: this.ctx,
      tabId: this.tabId,
      ...options,
    });
  }

  dismiss(): Promise<void> {
    return this.handle({ accept: false });
  }
}

class AlertDialog extends BaseDialog {}

class BeforeUnloadDialog extends BaseDialog {}

class ConfirmDialog extends BaseDialog {
  accept(): Promise<void> {
    return this.handle({ accept: true });
  }
}

class PromptDialog extends BaseDialog {
  accept(text: string): Promise<void> {
    return this.handle({ accept: true, promptText: text });
  }
}

function createDialog(
  t: BrowserTransport,
  ctx: BrowserContext,
  tabId: string,
  info: JsDialogInfo,
): AlertDialog | BeforeUnloadDialog | ConfirmDialog | PromptDialog {
  if (info.type === "confirm") return new ConfirmDialog(t, ctx, tabId, "confirm", info.message);
  if (info.type === "prompt") return new PromptDialog(t, ctx, tabId, "prompt", info.message);
  if (info.type === "beforeunload") return new BeforeUnloadDialog(t, ctx, tabId, "beforeunload", info.message);
  return new AlertDialog(t, ctx, tabId, "alert", info.message);
}
```

- [ ] **Step 3: Add `Tab.getJsDialog()`**

Inside `class Tab`, add:

```ts
async getJsDialog(): Promise<AlertDialog | BeforeUnloadDialog | ConfirmDialog | PromptDialog | undefined> {
  const info = await this.t.send<JsDialogInfo | undefined>("tab_js_dialog_get", {
    context: this.ctx,
    tabId: this.id,
  });
  return info ? createDialog(this.t, this.ctx, this.id, info) : undefined;
}
```

- [ ] **Step 4: Add `ContentAPI.exportGsuite(type)`**

Replace `ContentAPI` with:

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

  async exportGsuite(type: "pdf" | "md" | "xlsx" | "csv" | "docx" | "pptx"): Promise<string> {
    const result = await this.t.send<{ assetId: string; path?: string }>("tab_content_export_gsuite", {
      context: this.ctx,
      tabId: this.tabId,
      type,
    });
    return result.path ?? result.assetId;
  }
}
```

- [ ] **Step 5: Add coordinate Playwright wrappers**

Import `CoordinateElementInfo`, then add these methods to `PlaywrightAPI`:

```ts
elementInfo(options: { x: number; y: number; includeNonInteractable?: boolean }): Promise<CoordinateElementInfo[]> {
  return this.t.send("playwright_element_info", {
    context: this.ctx,
    tabId: this.tabId,
    options,
  });
}

elementScreenshot(options: { x: number; y: number; includeNonInteractable?: boolean }): Promise<Uint8Array> {
  return this.t.send<{ dataBase64: string }>("playwright_element_screenshot", {
    context: this.ctx,
    tabId: this.tabId,
    options,
  }).then((result) => Uint8Array.from(atob(result.dataBase64), (c) => c.charCodeAt(0)));
}
```

- [ ] **Step 6: Run the targeted test and commit**

Run:

```powershell
npm test -- tests/client-conformance.test.mjs
```

Expected: PASS.

Commit:

```powershell
git add plugins/lume-chrome/src/shared/protocol.ts plugins/lume-chrome/src/client/BrowserClient.ts plugins/lume-chrome/tests/client-conformance.test.mjs
git commit -m "✨ feat(browser): 补齐 canonical 客户端包装" -m "为 Codex 对齐补齐 getJsDialog、content.exportGsuite 和坐标元素检查的客户端 wrapper。" -m "Tested: npm test -- tests/client-conformance.test.mjs"
```

---

### Task 3: Runtime Descriptor And Documentation Surface

**Files:**
- Modify: `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`
- Modify: `plugins/lume-chrome/src/extension/runtime/CapabilityRegistry.ts`
- Modify: `plugins/lume-chrome/src/client/capabilities.ts`
- Modify: `plugins/lume-chrome/docs/browser-api-matrix.md`
- Test: `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`
- Test: `plugins/lume-chrome/tests/plugin-packaging.test.mjs`

- [ ] **Step 1: Update descriptor test expectations**

In `runtime-dispatcher-descriptor.test.mjs`, update the `apiSupportOverrides` expectation so it contains only:

```js
apiSupportOverrides: {
  "Tabs.content": false,
  "Tab.content": false,
},
```

Update the tab capabilities expectation to include:

```js
tab: [
  { id: "pageAssets", description: "Inventory and bundle rendered page assets." },
  { id: "cdp", description: "Read buffered CDP events and send permitted CDP commands." },
  { id: "botDetection", description: "Report bot detection or access-control blockers for this tab." },
],
```

- [ ] **Step 2: Update packaging test assertions**

In `plugin-packaging.test.mjs`, replace the assertion that `cdp` is unavailable with assertions that:

```js
assert.match(matrix, /tab\.content\.export\(\)/);
assert.match(matrix, /tab\.getJsDialog\(\)/);
assert.match(matrix, /tab\.capabilities\.get\("cdp"\)/);
assert.match(matrix, /tab\.capabilities\.get\("botDetection"\)/);
assert.match(matrix, /browserAuth/);
assert.match(matrix, /deferred/);
```

- [ ] **Step 3: Run tests and confirm they fail**

Run:

```powershell
npm test -- tests/runtime-dispatcher-descriptor.test.mjs tests/plugin-packaging.test.mjs
```

Expected: FAIL because descriptor, capability registry, and matrix still hide the newly implemented surface.

- [ ] **Step 4: Update runtime descriptor**

In `RuntimeDispatcher.extensionCaps()`, change the `capabilities.tab` array to:

```ts
tab: [
  { id: "pageAssets", description: "Inventory and bundle rendered page assets." },
  { id: "cdp", description: "Read buffered CDP events and send permitted CDP commands." },
  { id: "botDetection", description: "Report bot detection or access-control blockers for this tab." },
],
```

Change `apiSupportOverrides` to:

```ts
apiSupportOverrides: {
  "Tabs.content": false,
  "Tab.content": false,
},
```

- [ ] **Step 5: Update capability registry**

In `CapabilityRegistry.ts`, change `TAB_CAPABILITIES` to:

```ts
const TAB_CAPABILITIES: CapabilityInfo[] = [
  { id: "pageAssets", name: "Page assets", scope: "tab", description: "Inventory and bundle rendered page assets.", state: "available" },
  { id: "cdp", name: "CDP", scope: "tab", description: "Read buffered CDP events and send permitted CDP commands.", state: "available" },
  { id: "botDetection", name: "Bot detection", scope: "tab", description: "Report bot detection or access-control blockers for this tab.", state: "available" },
];
```

Extend `DOCS`:

```ts
cdp: "Use send(method, params?, options?) for permitted CDP commands and readEvents(options?) for buffered events. Prefer higher-level browser APIs unless raw CDP is needed.",
botDetection: "Use report({reason}) only when the current tab is blocked by CAPTCHA, access denial, challenge loops, or another bot-detection failure.",
```

- [ ] **Step 6: Add client capability definitions**

In `capabilities.ts`, import the new protocol types:

```ts
import type { AdvertisedCapability, BotDetectionReason, BrowserCommandType, CdpReadEventsResult } from "../shared/protocol";
```

Add:

```ts
export class CdpCapability extends DocumentedCapability {
  send(method: string, params: Record<string, unknown> = {}, options: { timeoutMs?: number } = {}): Promise<unknown> {
    return this.context.transport.send("tab_cdp_send", {
      browserId: this.context.browserId,
      tabId: this.context.tabId,
      method,
      params,
      options,
    });
  }

  readEvents(options: { afterSequence?: number; limit?: number; methods?: string[]; timeoutMs?: number } = {}): Promise<CdpReadEventsResult> {
    return this.context.transport.send("tab_cdp_read_events", {
      browserId: this.context.browserId,
      tabId: this.context.tabId,
      options,
    });
  }
}

export class BotDetectionCapability extends DocumentedCapability {
  report(options: { reason: BotDetectionReason }): Promise<{ hostname: string | null; status: "reported" }> {
    return this.context.transport.send("tab_bot_detection_report", {
      browserId: this.context.browserId,
      tabId: this.context.tabId,
      reason: options.reason,
    });
  }
}
```

Add definitions:

```ts
{
  id: "cdp",
  scope: "tab",
  create: (context) => new CdpCapability(context, "cdp", "tab"),
},
{
  id: "botDetection",
  scope: "tab",
  create: (context) => new BotDetectionCapability(context, "botDetection", "tab"),
},
```

- [ ] **Step 7: Update browser API matrix**

Replace the note saying `Tab.content`, `Tab.getJsDialog()`, `Tab.markDeliverable()`, and `Tab.markHandoff()` are hidden with:

```md
Canonical `tab.content.export()`, `tab.content.exportGsuite(type)`,
`tab.getJsDialog()`, `tab.markDeliverable()`, and `tab.markHandoff()` are
implemented by the extension backend. `browser.tabs.content()` remains hidden
because temporary background extraction is not implemented.
```

In implemented optional capabilities, add rows for `cdp` and `botDetection`:

```md
| `cdp` | tab | `await tab.capabilities.get("cdp")` |
| `botDetection` | tab | `await tab.capabilities.get("botDetection")` |
```

In unavailable capabilities, keep only:

```md
| `browserAuth` | deferred | Secure credential handoff needs a separate Lume interruption flow and trusted credential UI. |
```

- [ ] **Step 8: Run tests and commit**

Run:

```powershell
npm test -- tests/runtime-dispatcher-descriptor.test.mjs tests/plugin-packaging.test.mjs
```

Expected: PASS.

Commit:

```powershell
git add plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts plugins/lume-chrome/src/extension/runtime/CapabilityRegistry.ts plugins/lume-chrome/src/client/capabilities.ts plugins/lume-chrome/docs/browser-api-matrix.md plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs plugins/lume-chrome/tests/plugin-packaging.test.mjs
git commit -m "✨ feat(browser): 公开 canonical capability surface" -m "更新 descriptor、capability registry 和 API 矩阵，仅隐藏仍未实现的后台内容抽取和 browserAuth。" -m "Tested: npm test -- tests/runtime-dispatcher-descriptor.test.mjs tests/plugin-packaging.test.mjs"
```

---

### Task 4: JavaScript Dialog Runtime

**Files:**
- Modify: `plugins/lume-chrome/src/extension/debugger/ChromeDebugger.ts`
- Modify: `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`
- Test: `plugins/lume-chrome/tests/runtime-dispatcher-response.test.mjs`

- [ ] **Step 1: Add dispatcher tests**

In `runtime-dispatcher-response.test.mjs`, add this helper after the imports:

```js
function asyncStub(initialValue) {
  let value = initialValue;
  const fn = async (...args) => {
    fn.lastCall = { args };
    return value;
  };
  fn.resolves = (nextValue) => {
    value = nextValue;
  };
  return fn;
}

async function createDispatcherHarness() {
  const debuggerListeners = [];
  const storage = {};
  const native = {
    notifications: [],
    connectionGeneration: () => 1,
    notifyHost(method, params) {
      this.notifications.push({ method, params });
    },
    async requestHost() {
      return {};
    },
  };
  const chrome = {
    runtime: {
      id: "test-extension",
      getManifest: () => ({ version: "0.4.0" }),
    },
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return { [key]: storage[key] };
          return { ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
    debugger: {
      onEvent: { addListener(listener) { debuggerListeners.push(listener); } },
      onDetach: { addListener() {} },
      attach: asyncStub(undefined),
      detach: asyncStub(undefined),
      sendCommand: asyncStub(undefined),
      emitEvent(source, method, params) {
        for (const listener of debuggerListeners) listener(source, method, params);
      },
    },
    tabs: {
      create: asyncStub({ id: 101, url: "about:blank" }),
      get: asyncStub({ id: 101, url: "about:blank", title: "" }),
      query: asyncStub([]),
      update: asyncStub(undefined),
      reload: asyncStub(undefined),
      remove: asyncStub(undefined),
      sendMessage: asyncStub(undefined),
    },
    tabGroups: {
      group: asyncStub(1),
      update: asyncStub(undefined),
      query: asyncStub([]),
    },
    scripting: {
      executeScript: asyncStub([{ result: undefined }]),
    },
  };
  globalThis.chrome = chrome;
  const { RuntimeDispatcher } = await import("../dist/extension/runtime/RuntimeDispatcher.js");
  const dispatcher = new RuntimeDispatcher(native);
  await dispatcher.ready();
  return { dispatcher, chrome, native };
}
```

Then add this test:

```js
test("dispatcher exposes active JavaScript dialogs and handles them", async () => {
  const { dispatcher, chrome, native } = await createDispatcherHarness();
  const ctx = { browserSessionId: "s", browserTurnId: "t", actor: "agent" };
  chrome.tabs.create.resolves({ id: 101 });
  chrome.debugger.sendCommand.resolves(undefined);

  const create = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "1",
    method: "create_tab",
    params: { context: ctx, options: { active: true } },
  });
  const tabId = create.result.tabId;

  chrome.debugger.emitEvent({ tabId: 101 }, "Page.javascriptDialogOpening", {
    type: "confirm",
    message: "Continue?",
  });

  const get = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "2",
    method: "tab_js_dialog_get",
    params: { context: ctx, tabId },
  });
  assert.deepEqual(get.result, { type: "confirm", message: "Continue?" });

  const handle = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "3",
    method: "tab_js_dialog_handle",
    params: { context: ctx, tabId, accept: true },
  });
  assert.equal(handle.result, null);
  assert.deepEqual(chrome.debugger.sendCommand.lastCall.args, [
    { tabId: 101 },
    "Page.handleJavaScriptDialog",
    { accept: true },
  ]);
  assert.equal(native.notifications.length, 0);
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
npm test -- tests/runtime-dispatcher-response.test.mjs
```

Expected: FAIL because dialog commands are not handled yet.

- [ ] **Step 3: Track dialog state in ChromeDebugger**

In `ChromeDebugger`, add:

```ts
private activeDialogs = new Map<number, { type: "alert" | "beforeunload" | "confirm" | "prompt"; message?: string; defaultValue?: string }>();
```

Inside the `chrome.debugger.onEvent` listener, add:

```ts
if (method === "Page.javascriptDialogOpening") {
  this.activeDialogs.set(source.tabId, {
    type: params?.type ?? "alert",
    message: params?.message,
    defaultValue: params?.defaultPrompt,
  });
}
if (method === "Page.javascriptDialogClosed") {
  this.activeDialogs.delete(source.tabId);
}
```

Add methods:

```ts
getDialog(tabId: number) {
  return this.activeDialogs.get(tabId);
}

async handleDialog(tabId: number, options: { accept: boolean; promptText?: string }) {
  await this.ensureAttached(tabId);
  await this.send(tabId, "Page.handleJavaScriptDialog", {
    accept: options.accept,
    ...(options.promptText !== undefined ? { promptText: options.promptText } : {}),
  }, { allowMutating: true });
  this.activeDialogs.delete(tabId);
}
```

In `cleanup(tabId)`, add:

```ts
this.activeDialogs.delete(tabId);
```

- [ ] **Step 4: Dispatch dialog commands**

In `RuntimeDispatcher.dispatch`, add cases near `tab_url`:

```ts
case "tab_js_dialog_get":
  return ok(req.id, this.cdp.getDialog(await this.chromeTab(p.tabId, ctx!)));
case "tab_js_dialog_handle":
  await this.cdp.handleDialog(await this.chromeTab(p.tabId, ctx!), {
    accept: p.accept === true,
    promptText: p.promptText,
  });
  return ok(req.id, undefined);
```

- [ ] **Step 5: Run test and commit**

Run:

```powershell
npm test -- tests/runtime-dispatcher-response.test.mjs
```

Expected: PASS.

Commit:

```powershell
git add plugins/lume-chrome/src/extension/debugger/ChromeDebugger.ts plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts plugins/lume-chrome/tests/runtime-dispatcher-response.test.mjs
git commit -m "✨ feat(browser): 支持 JavaScript 对话框处理" -m "通过 debugger 事件追踪活动 JS dialog，并为 canonical getJsDialog wrapper 提供处理命令。" -m "Tested: npm test -- tests/runtime-dispatcher-response.test.mjs"
```

---

### Task 5: Coordinate Element Inspection Runtime

**Files:**
- Modify: `plugins/lume-chrome/src/extension/controllers/PlaywrightFacade.ts`
- Modify: `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`
- Test: `plugins/lume-chrome/tests/playwright-facade.test.mjs`

- [ ] **Step 1: Add facade test for coordinate hit testing**

In `playwright-facade.test.mjs`, add:

```js
test("coordinate elementInfo returns Codex-shaped selector metadata", async () => {
  const button = new FakeElement("button", {
    text: "Save",
    attributes: { "data-testid": "save", "aria-label": "Save changes" },
  });
  const root = new FakeElement("html", { children: [button] });
  const facade = new PlaywrightFacade({ screenshot: async () => ({ dataBase64: "cG5n" }) });

  await withFakePage(root, async () => {
    globalThis.document.elementFromPoint = () => button;
    const result = await facade.elementInfoAtPoint(1, { x: 12, y: 34 });

    assert.equal(result[0].tagName, "BUTTON");
    assert.equal(result[0].role, "button");
    assert.equal(result[0].ariaName, "Save changes");
    assert.equal(result[0].visibleText, "Save");
    assert.equal(result[0].testId, "save");
    assert.equal(result[0].selector.primary, '[data-testid="save"]');
    assert.deepEqual(result[0].selector.candidates, ['[data-testid="save"]', "button"]);
  });
});
```

Also add this getter to `FakeElement`:

```js
get id() {
  return this.getAttribute("id") ?? "";
}
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
npm test -- tests/playwright-facade.test.mjs
```

Expected: FAIL because `elementInfoAtPoint` does not exist.

- [ ] **Step 3: Implement coordinate element info**

In `PlaywrightFacade`, add:

```ts
async elementInfoAtPoint(tabId: number, options: { x: number; y: number; includeNonInteractable?: boolean }) {
  return evalInPage(tabId, (input) => {
    const rectOf = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const roleOf = (el: Element) => el.getAttribute("role") || ({
      A: "link",
      BUTTON: "button",
      INPUT: (el as HTMLInputElement).type === "checkbox" ? "checkbox" : (el as HTMLInputElement).type === "radio" ? "radio" : "textbox",
      TEXTAREA: "textbox",
      SELECT: "combobox",
      IMG: "img",
      OPTION: "option",
    } as Record<string, string>)[el.tagName] || null;
    const nameOf = (el: Element) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria;
      const labelled = el.getAttribute("aria-labelledby");
      if (labelled) return labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim() || null;
      const input = el as HTMLInputElement;
      if (input.labels?.length) return Array.from(input.labels).map((label) => label.textContent ?? "").join(" ").trim() || null;
      return el.getAttribute("alt") || el.getAttribute("title") || null;
    };
    const textOf = (el: Element) => ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim() || null;
    const candidatesFor = (el: Element) => {
      const testId = el.getAttribute("data-testid");
      const id = el.id;
      const candidates: string[] = [];
      if (testId) candidates.push(`[data-testid="${CSS.escape(testId)}"]`);
      if (id) candidates.push(`#${CSS.escape(id)}`);
      candidates.push(el.tagName.toLowerCase());
      return { primary: candidates[0] ?? null, candidates };
    };
    const start = document.elementFromPoint(input.x, input.y);
    if (!start) return [];
    const chain = [start, ...Array.from(function* ancestors(el: Element) {
      let current = el.parentElement;
      while (current && current !== document.documentElement) {
        yield current;
        current = current.parentElement;
      }
    }(start))].slice(0, input.includeNonInteractable ? 5 : 1);
    return chain.map((el) => ({
      tagName: el.tagName,
      role: roleOf(el),
      ariaName: nameOf(el),
      visibleText: textOf(el),
      testId: el.getAttribute("data-testid"),
      boundingBox: rectOf(el),
      selector: candidatesFor(el),
    }));
  }, [options]);
}

async elementScreenshotAtPoint(tabId: number, options: { x: number; y: number; includeNonInteractable?: boolean }) {
  const [info] = await this.elementInfoAtPoint(tabId, options);
  if (!info?.boundingBox) throw new Error("No element at coordinate");
  return this.cdp.screenshot(tabId, { clip: info.boundingBox });
}
```

- [ ] **Step 4: Dispatch coordinate commands**

In `RuntimeDispatcher`, replace the current `playwright_element_info` and `playwright_element_screenshot` cases with:

```ts
case "playwright_element_info":
  return ok(req.id, await this.pw.elementInfoAtPoint(await this.chromeTab(p.tabId, ctx!), p.options ?? p));
case "playwright_element_screenshot":
  return ok(req.id, await this.pw.elementScreenshotAtPoint(await this.chromeTab(p.tabId, ctx!), p.options ?? p));
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
npm test -- tests/playwright-facade.test.mjs tests/client-conformance.test.mjs
```

Expected: PASS.

Commit:

```powershell
git add plugins/lume-chrome/src/extension/controllers/PlaywrightFacade.ts plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts plugins/lume-chrome/tests/playwright-facade.test.mjs
git commit -m "✨ feat(browser): 对齐坐标元素检查" -m "将 elementInfo 和 elementScreenshot 调整为 Codex 的坐标输入语义，并返回稳定 selector metadata。" -m "Tested: npm test -- tests/playwright-facade.test.mjs tests/client-conformance.test.mjs"
```

---

### Task 6: CDP Capability Runtime

**Files:**
- Modify: `plugins/lume-chrome/src/extension/debugger/ChromeDebugger.ts`
- Modify: `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`
- Test: `plugins/lume-chrome/tests/runtime-dispatcher-response.test.mjs`
- Test: `plugins/lume-chrome/tests/client-conformance.test.mjs`

- [ ] **Step 1: Add client and dispatcher tests**

In `client-conformance.test.mjs`, after creating `tab`, add:

```js
fake.respond("tab_cdp_send", { ok: true });
fake.respond("tab_cdp_read_events", { cursor: 1, events: [], hasMore: false, truncated: false });
const cdp = await tab.capabilities.get("cdp");
assert.deepEqual(await cdp.send("DOM.getDocument"), { ok: true });
assert.deepEqual(await cdp.readEvents({ limit: 10 }), { cursor: 1, events: [], hasMore: false, truncated: false });
```

In `runtime-dispatcher-response.test.mjs`, add:

```js
test("dispatcher buffers and reads CDP events with cursor semantics", async () => {
  const { dispatcher, chrome } = await createDispatcherHarness();
  const ctx = { browserSessionId: "s", browserTurnId: "t", actor: "agent" };
  chrome.tabs.create.resolves({ id: 102 });
  chrome.debugger.sendCommand.resolves({ root: { nodeId: 1 } });

  const create = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "1",
    method: "create_tab",
    params: { context: ctx, options: { active: true } },
  });
  const tabId = create.result.tabId;
  chrome.debugger.emitEvent({ tabId: 102 }, "DOM.documentUpdated", {});

  const send = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "2",
    method: "tab_cdp_send",
    params: { context: ctx, tabId, method: "DOM.getDocument", params: {} },
  });
  assert.deepEqual(send.result, { root: { nodeId: 1 } });

  const read = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "3",
    method: "tab_cdp_read_events",
    params: { context: ctx, tabId, options: { limit: 10 } },
  });
  assert.equal(read.result.events[0].method, "DOM.documentUpdated");
  assert.equal(read.result.hasMore, false);
  assert.equal(read.result.truncated, false);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
npm test -- tests/client-conformance.test.mjs tests/runtime-dispatcher-response.test.mjs
```

Expected: FAIL because `tab_cdp_send` and `tab_cdp_read_events` are not handled yet.

- [ ] **Step 3: Buffer CDP events**

In `ChromeDebugger`, add:

```ts
private nextSequence = 1;
private events = new Map<number, Array<{ method: string; params?: Record<string, unknown>; sequence: number; source: { tabId?: number; extensionId?: string; sessionId?: string; targetId?: string } }>>();
private truncatedBefore = new Map<number, number>();
private readonly maxEventsPerTab = 1000;
```

Inside the debugger event listener after validating `source.tabId`, add:

```ts
const buffered = this.events.get(source.tabId) ?? [];
buffered.push({
  method,
  params,
  sequence: this.nextSequence++,
  source: {
    tabId: source.tabId,
    extensionId: source.extensionId,
    sessionId: source.sessionId,
    targetId: source.targetId,
  },
});
while (buffered.length > this.maxEventsPerTab) {
  const removed = buffered.shift();
  if (removed) this.truncatedBefore.set(source.tabId, removed.sequence);
}
this.events.set(source.tabId, buffered);
```

Add:

```ts
readEvents(tabId: number, options: { afterSequence?: number; limit?: number; methods?: string[] } = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit ?? 100), 1000));
  const after = Number(options.afterSequence ?? 0);
  const methodSet = options.methods?.length ? new Set(options.methods) : undefined;
  const all = this.events.get(tabId) ?? [];
  const filtered = all.filter((event) => event.sequence > after && (!methodSet || methodSet.has(event.method)));
  const events = filtered.slice(0, limit);
  const cursor = events.at(-1)?.sequence ?? after;
  return {
    cursor,
    events,
    hasMore: filtered.length > events.length,
    truncated: (this.truncatedBefore.get(tabId) ?? 0) > after,
  };
}
```

In `cleanup`, add:

```ts
this.events.delete(tabId);
this.truncatedBefore.delete(tabId);
```

- [ ] **Step 4: Dispatch CDP capability commands**

In `RuntimeDispatcher`, add:

```ts
case "tab_cdp_send":
  return ok(req.id, await this.cdp.send(await this.chromeTab(p.tabId, ctx!), p.method, p.params ?? {}, { allowMutating: p.allowMutating === true }));
case "tab_cdp_read_events":
  return ok(req.id, this.cdp.readEvents(await this.chromeTab(p.tabId, ctx!), p.options ?? {}));
```

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
npm test -- tests/client-conformance.test.mjs tests/runtime-dispatcher-response.test.mjs
```

Expected: PASS.

Commit:

```powershell
git add plugins/lume-chrome/src/extension/debugger/ChromeDebugger.ts plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts plugins/lume-chrome/tests/client-conformance.test.mjs plugins/lume-chrome/tests/runtime-dispatcher-response.test.mjs
git commit -m "✨ feat(browser): 实现 CDP capability" -m "为 tab.capabilities.get(\"cdp\") 提供 send/readEvents，并在 debugger 层维护有界事件缓冲。" -m "Tested: npm test -- tests/client-conformance.test.mjs tests/runtime-dispatcher-response.test.mjs"
```

---

### Task 7: Bot Detection Capability Runtime

**Files:**
- Modify: `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`
- Test: `plugins/lume-chrome/tests/runtime-dispatcher-response.test.mjs`
- Test: `plugins/lume-chrome/tests/client-conformance.test.mjs`

- [ ] **Step 1: Add tests**

In `client-conformance.test.mjs`, add:

```js
fake.respond("tab_bot_detection_report", { hostname: "example.com", status: "reported" });
const botDetection = await tab.capabilities.get("botDetection");
assert.deepEqual(await botDetection.report({ reason: "access_denied" }), {
  hostname: "example.com",
  status: "reported",
});
```

In `runtime-dispatcher-response.test.mjs`, add:

```js
test("dispatcher records bot detection reports without full URL", async () => {
  const { dispatcher, chrome } = await createDispatcherHarness();
  const ctx = { browserSessionId: "s", browserTurnId: "t", actor: "agent" };
  chrome.tabs.create.resolves({ id: 103, url: "https://example.com/private?token=secret" });
  const create = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "1",
    method: "create_tab",
    params: { context: ctx, options: { active: true } },
  });

  const response = await dispatcher.dispatch({
    jsonrpc: "2.0",
    id: "2",
    method: "tab_bot_detection_report",
    params: { context: ctx, tabId: create.result.tabId, reason: "access_denied" },
  });

  assert.deepEqual(response.result, { hostname: "example.com", status: "reported" });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
npm test -- tests/client-conformance.test.mjs tests/runtime-dispatcher-response.test.mjs
```

Expected: FAIL because report command is not handled yet.

- [ ] **Step 3: Add runtime command**

In `RuntimeDispatcher.dispatch`, add:

```ts
case "tab_bot_detection_report": {
  const allowed = new Set(["captcha_failed", "access_denied", "challenge_loop", "unexpected_bot_error"]);
  if (!allowed.has(p.reason)) throw new Error(`Unsupported bot detection reason: ${p.reason}`);
  const chromeTabId = await this.chromeTab(p.tabId, ctx!);
  const tab = await chrome.tabs.get(chromeTabId);
  const hostname = tab.url ? new URL(tab.url).hostname : null;
  await chrome.storage.local.set({
    [`BOT_DETECTION:${Date.now()}`]: {
      hostname,
      reason: p.reason,
      sessionId: ctx!.browserSessionId,
      at: Date.now(),
    },
  });
  return ok(req.id, { hostname, status: "reported" });
}
```

This stores only hostname, reason, session id, and timestamp. It must not store full URL, DOM, screenshot, cookies, or page text.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
npm test -- tests/client-conformance.test.mjs tests/runtime-dispatcher-response.test.mjs
```

Expected: PASS.

Commit:

```powershell
git add plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts plugins/lume-chrome/tests/client-conformance.test.mjs plugins/lume-chrome/tests/runtime-dispatcher-response.test.mjs
git commit -m "✨ feat(browser): 实现 botDetection capability" -m "为 Codex botDetection report 提供安全的 hostname-only 记录路径，避免持久化完整 URL 或页面内容。" -m "Tested: npm test -- tests/client-conformance.test.mjs tests/runtime-dispatcher-response.test.mjs"
```

---

### Task 8: Build Outputs, Coverage, And Final Verification

**Files:**
- Modify generated: `plugins/lume-chrome/dist/**`
- Modify generated: `plugins/lume-chrome/lume-browser-extension-v4.zip`
- Modify: `plugins/lume-chrome/docs/browser-api-matrix.md`
- Test: `plugins/lume-chrome/tests/plugin-packaging.test.mjs`

- [ ] **Step 1: Run full plugin tests**

Run:

```powershell
npm test
```

Expected: PASS for all `plugins/lume-chrome/tests/*.mjs`.

- [ ] **Step 2: Run command coverage**

Run:

```powershell
npm run check:coverage
```

Expected output includes:

```text
missing=[]
```

- [ ] **Step 3: Build generated plugin outputs**

Run:

```powershell
npm run build
```

Then run:

```powershell
npm run zip:extension
```

Expected: updated `dist/**` files and `lume-browser-extension-v4.zip`.

- [ ] **Step 4: Re-run packaging test**

Run:

```powershell
npm test -- tests/plugin-packaging.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```powershell
git status -sb
git diff --stat
```

Expected: only phase5 source, tests, docs, generated `dist/**`, and zip changes.

- [ ] **Step 6: Commit final generated outputs**

Commit:

```powershell
git add plugins/lume-chrome/dist plugins/lume-chrome/lume-browser-extension-v4.zip plugins/lume-chrome/docs/browser-api-matrix.md
git commit -m "🔧 chore(browser): 更新 canonical surface 构建产物" -m "刷新 phase5 browser capability 对齐后的 dist 和扩展 zip，确保安装包包含最新运行时代码与文档。" -m "Tested: npm test" -m "Tested: npm run check:coverage"
```

---

## Final Review Checklist

- `Tab.content` remains hidden only if the runtime still cannot expose the property safely; otherwise documentation must prefer `tab.content.export()`.
- `browser.tabs.content()` remains hidden because background temporary extraction is not implemented.
- `browserAuth` is not advertised by the descriptor or capability registry.
- No new dependencies were added.
- No non-Codex helper aliases were introduced.
- `npm test` passes.
- `npm run check:coverage` reports no missing handlers.
