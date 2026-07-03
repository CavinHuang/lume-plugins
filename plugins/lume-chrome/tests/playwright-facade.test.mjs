import assert from "node:assert/strict";
import test from "node:test";

import { PlaywrightFacade } from "../dist/extension/controllers/PlaywrightFacade.js";

class FakeElement {
  constructor(tagName, { text = "", value = "", attributes = {}, children = [], rect = { x: 0, y: 0, width: 80, height: 24 } } = {}) {
    this.tagName = tagName.toUpperCase();
    this.textContent = text;
    this.innerText = text;
    this.value = value;
    this.rect = rect;
    this.attributes = Object.entries(attributes).map(([name, attrValue]) => ({ name, value: attrValue }));
    this.attributeMap = new Map(Object.entries(attributes));
    this.children = children;
    this.disabled = false;
    this.checked = false;
    this.selectionStart = value.length;
    this.selectionEnd = value.length;
    this.events = [];
    for (const child of children) child.parent = this;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  getAttribute(name) {
    return this.attributeMap.get(name) ?? null;
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView() {}

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }

  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

class FakeInputElement extends FakeElement {}
class FakeSelectElement extends FakeElement {}
class FakeIFrameElement extends FakeElement {}

function matches(element, selector) {
  if (selector === "*") return true;
  if (selector === "button") return element.tagName === "BUTTON";
  if (selector === "input") return element.tagName === "INPUT";
  if (selector === "input,textarea,select,button") return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(element.tagName);
  if (selector === "[placeholder]") return element.getAttribute("placeholder") !== null;
  if (selector.startsWith("[data-testid=")) {
    return element.getAttribute("data-testid") === selector.slice(14, -2);
  }
  return false;
}

async function withFakePage(root, callback) {
  const previous = {
    chrome: globalThis.chrome,
    CSS: globalThis.CSS,
    document: globalThis.document,
    Element: globalThis.Element,
    Event: globalThis.Event,
    getComputedStyle: globalThis.getComputedStyle,
    HTMLIFrameElement: globalThis.HTMLIFrameElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLElement: globalThis.HTMLElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    InputEvent: globalThis.InputEvent,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  globalThis.CSS = { escape: (value) => String(value).replaceAll('"', '\\"') };
  globalThis.document = {
    documentElement: root,
    createElement(tagName) { return new FakeElement(tagName); },
    elementFromPoint() { return root.pointElement ?? null; },
    elementsFromPoint() { return root.pointElements ?? (root.pointElement ? [root.pointElement] : []); },
    execCommand() { return true; },
  };
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeInputElement;
  globalThis.HTMLTextAreaElement = FakeInputElement;
  globalThis.HTMLSelectElement = FakeSelectElement;
  globalThis.HTMLIFrameElement = FakeIFrameElement;
  globalThis.Event = class {
    constructor(type) { this.type = type; }
  };
  globalThis.InputEvent = class {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.chrome = {
    scripting: {
      async executeScript(details) {
        return [{ result: await details.func(...details.args) }];
      },
    },
  };

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

test("PlaywrightFacade resolves locator and/or as intersection and deduplicated union", async () => {
  const root = new FakeElement("html", {
    children: [
      new FakeElement("button", { text: "Save" }),
      new FakeElement("button", { text: "Cancel" }),
      new FakeElement("button", { text: "Help" }),
    ],
  });
  const facade = new PlaywrightFacade({});
  const locator = {
    version: 1,
    steps: [
      { kind: "locator", selector: "button" },
      { kind: "and", locator: { version: 1, steps: [{ kind: "text", text: "Save" }] } },
      { kind: "or", locator: { version: 1, steps: [{ kind: "text", text: "Cancel" }] } },
    ],
  };

  await withFakePage(root, async () => {
    assert.deepEqual(await facade.operation(1, locator, "allTextContents", {}), ["Save", "Cancel"]);
  });
});

test("PlaywrightFacade type appends text without clearing the existing value", async () => {
  const input = new FakeInputElement("input", { value: "hello" });
  const root = new FakeElement("html", { children: [input] });
  const facade = new PlaywrightFacade({});

  await withFakePage(root, async () => {
    await facade.operation(1, { version: 1, steps: [{ kind: "locator", selector: "input" }] }, "type", { text: " world" });
  });

  assert.equal(input.value, "hello world");
  assert.deepEqual(input.events, ["input", "change"]);
});

test("PlaywrightFacade returns element metadata at coordinates", async () => {
  const button = new FakeElement("button", {
    text: "Save",
    attributes: { id: "save", "aria-label": "Save item", "data-testid": "save-button" },
    rect: { x: 10, y: 20, width: 120, height: 32 },
  });
  const root = new FakeElement("html", { children: [button] });
  root.pointElement = button;
  const facade = new PlaywrightFacade({});

  await withFakePage(root, async () => {
    const [info] = await facade.elementInfoAtPoint(1, { x: 15, y: 25 });
    assert.deepEqual(info, {
      tagName: "BUTTON",
      role: "button",
      ariaName: "Save item",
      visibleText: "Save",
      testId: "save-button",
      boundingBox: { x: 10, y: 20, width: 120, height: 32 },
      selector: {
        primary: "#save",
        candidates: ["#save", '[data-testid="save-button"]', "button"],
      },
    });
  });
});

test("PlaywrightFacade screenshots the element found at coordinates", async () => {
  const link = new FakeElement("a", {
    text: "Open",
    rect: { x: 5, y: 6, width: 70, height: 18 },
  });
  const root = new FakeElement("html", { children: [link] });
  root.pointElement = link;
  const screenshotCalls = [];
  const facade = new PlaywrightFacade({
    async screenshot(tabId, options) {
      screenshotCalls.push({ tabId, options });
      return { dataBase64: "abc" };
    },
  });

  await withFakePage(root, async () => {
    assert.deepEqual(await facade.elementScreenshotAtPoint(1, { x: 8, y: 9 }), { dataBase64: "abc" });
  });

  assert.deepEqual(screenshotCalls, [
    { tabId: 1, options: { x: 8, y: 9, clip: { x: 5, y: 6, width: 70, height: 18 } } },
  ]);
});
