# Browser Playwright Locator Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose and correctly implement the low-risk `PlaywrightLocator.and()`, `or()`, and `type()` APIs for the Lume Chrome extension backend.

**Architecture:** Keep the current public projection model. `BrowserClient.ts` sends a new `playwright_locator_type` command, `RuntimeDispatcher.ts` un-hides the three members and routes the new command to `PlaywrightFacade`, and `PlaywrightFacade.ts` resolves nested locator ASTs for `and/or` plus append-typing behavior for `type`.

**Tech Stack:** TypeScript, Chrome extension runtime, Node `node:test`, npm scripts in `plugins/lume-chrome`.

---

## File Structure

- `plugins/lume-chrome/src/client/BrowserClient.ts`: add the public `PlaywrightLocator.type(value, options)` method and send `playwright_locator_type`.
- `plugins/lume-chrome/src/shared/protocol.ts`: add `playwright_locator_type` to `BrowserCommandType`.
- `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`: stop hiding `PlaywrightLocator.and`, `PlaywrightLocator.or`, and `PlaywrightLocator.type`; include `playwright_locator_type` in the locator dispatcher group and map it to operation `type`.
- `plugins/lume-chrome/src/extension/controllers/PlaywrightFacade.ts`: replace the stubbed `and/or` resolver branch with recursive AST resolution and implement append-oriented `type`.
- `plugins/lume-chrome/tests/client-conformance.test.mjs`: prove projection and command payload for `and/or/type`.
- `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`: prove descriptor no longer hides the three members.
- `plugins/lume-chrome/tests/plugin-packaging.test.mjs`: prove API matrix documents the newly projected members.
- `plugins/lume-chrome/docs/browser-api-matrix.md`: document `and()`, `or()`, and `type()` as projected locator members.

---

### Task 1: Client Projection And Command Payload Red Test

**Files:**
- Modify: `plugins/lume-chrome/tests/client-conformance.test.mjs`

- [ ] **Step 1: Write the failing client conformance test**

In `plugins/lume-chrome/tests/client-conformance.test.mjs`, remove these three overrides from the fake extension backend descriptor:

```js
"PlaywrightLocator.and": false,
"PlaywrightLocator.or": false,
"PlaywrightLocator.type": false,
```

Add fake responses after the existing `cua_click` response:

```js
fake.respond("playwright_locator_type", undefined);
```

Replace the existing hidden assertions:

```js
assert.equal(locator.and, undefined);
assert.equal(locator.or, undefined);
assert.equal(locator.type, undefined);
```

with visible method assertions and a command-payload check:

```js
assert.equal(typeof locator.and, "function");
assert.equal(typeof locator.or, "function");
assert.equal(typeof locator.type, "function");
const andLocator = locator.and(tab.playwright.getByText("Save"));
const orLocator = locator.or(tab.playwright.getByText("Cancel"));
assert.equal(typeof andLocator.click, "function");
assert.equal(typeof orLocator.click, "function");
await locator.type(" appended", { timeoutMs: 123 });
const typeCall = fake.calls.find((call) => call.method === "playwright_locator_type");
assert.deepEqual(typeCall.params.locator, {
  version: 1,
  steps: [{ kind: "locator", selector: "button" }],
});
assert.equal(typeCall.params.text, " appended");
assert.equal(typeCall.params.timeoutMs, 123);
```

- [ ] **Step 2: Run the client conformance test and confirm red**

Run:

```powershell
npm test -- tests/client-conformance.test.mjs
```

Expected: FAIL because `PlaywrightLocator.type` is not implemented on the client and the runtime projection still hides `and/or/type`.

---

### Task 2: Descriptor Red Test

**Files:**
- Modify: `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`

- [ ] **Step 1: Write the failing descriptor expectation**

In `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`, remove these entries from the expected `apiSupportOverrides` object:

```js
"PlaywrightLocator.and": false,
"PlaywrightLocator.or": false,
"PlaywrightLocator.type": false,
```

- [ ] **Step 2: Run the descriptor test and confirm red**

Run:

```powershell
npm test -- tests/runtime-dispatcher-descriptor.test.mjs
```

Expected: FAIL because `RuntimeDispatcher.extensionCaps()` still hides `PlaywrightLocator.and`, `PlaywrightLocator.or`, and `PlaywrightLocator.type`.

---

### Task 3: Runtime Resolver Red Test

**Files:**
- Modify: `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`

- [ ] **Step 1: Add a dispatcher-level test for `and/or/type`**

Append this test to `plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs`:

```js
test("playwright locator and/or/type resolve through the page facade", async () => {
  const calls = [];
  const dispatcher = createDispatcher();
  dispatcher.leases.get = async () => ({ chromeTabId: 77 });
  dispatcher.pw.operation = async (tabId, locator, operation, payload) => {
    calls.push({ tabId, locator, operation, payload });
    return operation === "allTextContents" ? ["value"] : undefined;
  };

  const locator = {
    version: 1,
    steps: [
      { kind: "locator", selector: "button" },
      { kind: "and", locator: { version: 1, steps: [{ kind: "text", text: "Save" }] } },
      { kind: "or", locator: { version: 1, steps: [{ kind: "text", text: "Cancel" }] } },
    ],
  };

  await dispatch(dispatcher, "playwright_locator_type", {
    tabId: "lume-tab:1",
    locator,
    text: " appended",
    timeoutMs: 250,
  });

  assert.deepEqual(calls, [
    {
      tabId: 77,
      locator,
      operation: "type",
      payload: { tabId: "lume-tab:1", locator, text: " appended", timeoutMs: 250 },
    },
  ]);
});
```

- [ ] **Step 2: Run the dispatcher test and confirm red**

Run:

```powershell
npm test -- tests/runtime-dispatcher-descriptor.test.mjs
```

Expected: FAIL because `playwright_locator_type` is not handled by `RuntimeDispatcher`.

---

### Task 4: Implement Client, Protocol, And Descriptor Projection

**Files:**
- Modify: `plugins/lume-chrome/src/client/BrowserClient.ts`
- Modify: `plugins/lume-chrome/src/shared/protocol.ts`
- Modify: `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`

- [ ] **Step 1: Add `playwright_locator_type` to the protocol**

In `plugins/lume-chrome/src/shared/protocol.ts`, add `playwright_locator_type` after `playwright_locator_press`:

```ts
  | "playwright_locator_click" | "playwright_locator_dblclick" | "playwright_locator_fill" | "playwright_locator_press" | "playwright_locator_type"
```

- [ ] **Step 2: Add the client method**

In `plugins/lume-chrome/src/client/BrowserClient.ts`, add this method next to `press(...)`:

```ts
type(value:string, options:{timeoutMs?:number}={}): Promise<void> { return this.send("playwright_locator_type", {...options, text:value}); }
```

- [ ] **Step 3: Update runtime descriptor and locator dispatch**

In `plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts`, remove these false overrides from `extensionCaps()`:

```ts
"PlaywrightLocator.and":false,
"PlaywrightLocator.or":false,
"PlaywrightLocator.type":false,
```

Add `case"playwright_locator_type":` to the locator command group and extend the operation-name mapping:

```ts
case"playwright_locator_click":case"playwright_locator_dblclick":case"playwright_locator_fill":case"playwright_locator_press":case"playwright_locator_type":case"playwright_locator_select_option":case"playwright_locator_set_checked":case"playwright_locator_check":case"playwright_locator_uncheck":case"playwright_locator_get_attribute":case"playwright_locator_inner_text":case"playwright_locator_text_content":case"playwright_locator_input_value":case"playwright_locator_is_visible":case"playwright_locator_is_enabled":case"playwright_locator_is_checked":case"playwright_locator_count":case"playwright_locator_all_text_contents":case"playwright_locator_read_all":case"playwright_locator_wait_for":{
  const op=String(req.method).replace("playwright_locator_","").replace("dblclick","dblclick").replace("set_checked","setChecked").replace("get_attribute","getAttribute").replace("inner_text","innerText").replace("text_content","textContent").replace("input_value","inputValue").replace("is_visible","isVisible").replace("is_enabled","isEnabled").replace("is_checked","isChecked").replace("all_text_contents","allTextContents").replace("read_all","readAll").replace("wait_for","waitFor").replace("select_option","selectOption");
  return ok(req.id,await this.pw.operation(await this.chromeTab(p.tabId,ctx!),p.locator,op,p));
}
```

- [ ] **Step 4: Run projection tests and confirm green**

Run:

```powershell
npm test -- tests/client-conformance.test.mjs tests/runtime-dispatcher-descriptor.test.mjs
```

Expected: the client and descriptor tests pass, but resolver semantics are not complete until Task 5.

---

### Task 5: Implement Recursive Locator Resolver And Append Type

**Files:**
- Modify: `plugins/lume-chrome/src/extension/controllers/PlaywrightFacade.ts`

- [ ] **Step 1: Replace stubbed `and/or` handling with recursive resolution**

Inside the `evalInPage` callback in `locatorOperation`, replace the current loop-local `and/or` block with a helper-driven resolver. The helper should keep the existing matching functions and use this shape:

```ts
const resolveAst = async(input:any):Promise<Element[]> => {
  let roots:Element[]=[document.documentElement];
  let current:Element[]=[];
  for(const step of input.steps as any[]){
    if(step.kind==="frame"){
      const frames=allDesc(roots,step.selector).filter(e=>e instanceof HTMLIFrameElement) as HTMLIFrameElement[];
      roots=frames.flatMap(f=>{try{return f.contentDocument?.documentElement?[f.contentDocument.documentElement]:[];}catch{return[];}});
      current=[];
      continue;
    }
    const scope=current.length?current:roots;
    if(step.kind==="css"||step.kind==="locator") current=allDesc(scope,step.selector);
    else if(step.kind==="role") current=allDesc(scope,"*").filter(el=>role(el)===step.role&&(!step.name||textMatches(accessibleName(el),step.name,step.exact)));
    else if(step.kind==="text") current=allDesc(scope,"*").filter(el=>textMatches(el.textContent||"",step.text,step.exact)&&!Array.from(el.children).some(c=>textMatches(c.textContent||"",step.text,step.exact)));
    else if(step.kind==="label") current=allDesc(scope,"input,textarea,select,button").filter(el=>textMatches(accessibleName(el),step.text,step.exact));
    else if(step.kind==="testId") current=allDesc(scope,`[data-testid="${CSS.escape(step.testId)}"]`);
    else if(step.kind==="filter") current=current.filter(el=>(!step.hasText||textMatches(el.textContent||"",step.hasText))&&(!step.hasNotText||!textMatches(el.textContent||"",step.hasNotText)));
    else if(step.kind==="first") current=current.slice(0,1);
    else if(step.kind==="last") current=current.slice(-1);
    else if(step.kind==="nth") current=current.slice(step.index,step.index+1);
    else if(step.kind==="and"){const nested=await resolveAst(step.locator);current=current.filter(el=>nested.includes(el));}
    else if(step.kind==="or"){const nested=await resolveAst(step.locator);current=unique([...current,...nested]);}
  }
  return unique(current);
};
let current = await resolveAst(inputAst);
```

Remove the old top-level `roots` variable and old `for(const step of inputAst.steps...)` loop so there is only one resolver path.
Keep the existing input-hint locator branch unchanged in the same relative
position between `label` and `testId`.

- [ ] **Step 2: Implement append-oriented `type`**

Add `"type"` to the action preflight list:

```ts
if(["click","dblclick","fill","press","type","selectOption","setChecked","check","uncheck"].includes(op)){
```

Add this branch after `press`:

```ts
if(op==="type"){
  const text=String(p.text??"");
  el.focus?.();
  if("value" in el){
    const input=el as HTMLInputElement|HTMLTextAreaElement;
    const start=input.selectionStart??input.value.length;
    const end=input.selectionEnd??start;
    input.value=`${input.value.slice(0,start)}${text}${input.value.slice(end)}`;
    const caret=start+text.length;
    input.setSelectionRange?.(caret,caret);
    input.dispatchEvent(new InputEvent("input",{bubbles:true,data:text,inputType:"insertText"}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return undefined as any;
  }
  if((el as HTMLElement).isContentEditable){
    document.execCommand?.("insertText",false,text);
    el.dispatchEvent(new InputEvent("input",{bubbles:true,data:text,inputType:"insertText"}));
    el.dispatchEvent(new Event("change",{bubbles:true}));
    return undefined as any;
  }
  throw new Error("Element is not typeable");
}
```

- [ ] **Step 3: Run tests and confirm green**

Run:

```powershell
npm test -- tests/runtime-dispatcher-descriptor.test.mjs tests/client-conformance.test.mjs
```

Expected: PASS.

---

### Task 6: Documentation Matrix

**Files:**
- Modify: `plugins/lume-chrome/docs/browser-api-matrix.md`
- Modify: `plugins/lume-chrome/tests/plugin-packaging.test.mjs`

- [ ] **Step 1: Write failing documentation assertions**

In `plugins/lume-chrome/tests/plugin-packaging.test.mjs`, add these assertions near the existing locator assertions:

```js
assert.match(matrix, /and\(\)/);
assert.match(matrix, /or\(\)/);
assert.match(matrix, /type\(\)/);
```

- [ ] **Step 2: Run packaging test and confirm red**

Run:

```powershell
npm test -- tests/plugin-packaging.test.mjs
```

Expected: FAIL if the API matrix does not yet list `and()`, `or()`, and `type()`.

- [ ] **Step 3: Update the matrix**

In `plugins/lume-chrome/docs/browser-api-matrix.md`, add `and()`, `or()`, and `type()` to the `tab.playwright.locator(...)` row:

```md
| `tab.playwright.locator(...)` | `click()`, `dblclick()`, `fill()`, `press()`, `type()`, `selectOption()`, `setChecked()`, `check()`, `uncheck()`, `getAttribute()`, `innerText()`, `textContent()`, `inputValue()`, `isVisible()`, `isEnabled()`, `isChecked()`, `count()`, `all()`, `allTextContents()`, `filter()`, `and()`, `or()`, `first()`, `last()`, `locator()`, `nth()`, `waitFor()` |
```

- [ ] **Step 4: Run packaging test and confirm green**

Run:

```powershell
npm test -- tests/plugin-packaging.test.mjs
```

Expected: PASS.

---

### Task 7: Final Verification And Commit

**Files:**
- All files touched by Tasks 1-6.

- [ ] **Step 1: Run full plugin tests**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run command coverage**

Run:

```powershell
npm run check:coverage
```

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

```powershell
git add plugins/lume-chrome/src/client/BrowserClient.ts plugins/lume-chrome/src/shared/protocol.ts plugins/lume-chrome/src/extension/runtime/RuntimeDispatcher.ts plugins/lume-chrome/src/extension/controllers/PlaywrightFacade.ts plugins/lume-chrome/tests/client-conformance.test.mjs plugins/lume-chrome/tests/runtime-dispatcher-descriptor.test.mjs plugins/lume-chrome/tests/plugin-packaging.test.mjs plugins/lume-chrome/docs/browser-api-matrix.md
git commit -m "✨ feat(browser): 对齐低风险 locator 能力" -m "开放 PlaywrightLocator.and、or 和 type，补齐 locator resolver 的交集、并集和追加输入语义，同时继续隐藏下载、上传、CDP、dialog 等高风险能力。" -m "Constraint: 不新增依赖或 host protocol" -m "Rejected: 同批开放下载和上传 | 权限和返回值契约需要单独阶段" -m "Tested: npm test" -m "Tested: npm run check:coverage"
```
