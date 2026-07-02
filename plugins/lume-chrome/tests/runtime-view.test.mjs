import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeView } from "../dist/client/runtime-view.js";

class Browser {
  constructor(tabs) {
    this.browserId = "browser-1";
    this.tabs = tabs;
  }

  documentation() {
    return { title: "ordinary response" };
  }
}

class Tabs {
  constructor(tab) {
    this.finalize = () => "hidden";
    this.tab = tab;
  }

  get() {
    return this.tab;
  }

  list() {
    return [this.tab];
  }

  selected() {
    return Promise.resolve(this.tab);
  }
}

class Tab {
  constructor(id = "tab-1") {
    this.id = id;
    this.markHandoff = () => "hidden";
  }

  title() {
    return `title:${this.id}`;
  }

  goto(other) {
    return { thisIsRaw: this instanceof Tab, argumentIsRaw: other instanceof Tab };
  }
}

const PrototypeMethodTab = class Tab {
  constructor(id = "tab-1") {
    this.id = id;
  }

  markHandoff() {
    return "hidden";
  }

  title() {
    return `title:${this.id}`;
  }
};

class FileChooser {
  isMultiple() {
    return true;
  }

  setFiles() {
    return "hidden";
  }
}

class BrowserRegistry {
  list() {
    return [];
  }

  get() {
    return "visible";
  }
}

test("hidden members disappear from property and reflection APIs", () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const tab = project(new Tab());

  assert.equal(tab.markHandoff, undefined);
  assert.equal("markHandoff" in tab, false);
  assert.equal(Reflect.ownKeys(tab).includes("markHandoff"), false);
  assert.equal(Object.getOwnPropertyDescriptor(tab, "markHandoff"), undefined);
});

test("freeze attempts fail without breaking later proxy operations", () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const tab = project(new Tab());

  assert.throws(() => Object.freeze(tab), TypeError);
  assert.throws(() => Object.preventExtensions(tab), TypeError);
  assert.equal(tab.markHandoff, undefined);
  assert.deepEqual(Reflect.ownKeys(tab), ["id"]);
  assert.equal(tab.title(), "title:tab-1");
});

test("defineProperty attempts fail without mutating the proxy target", () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const tab = project(new Tab());

  assert.throws(() => {
    Object.defineProperty(tab, "extra", { configurable: false, value: 1 });
  }, TypeError);
  assert.deepEqual(Reflect.ownKeys(tab), ["id"]);
  assert.equal(tab.markHandoff, undefined);
  assert.equal(tab.title(), "title:tab-1");
});

test("hidden non-configurable own members do not violate proxy invariants", () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const raw = new Tab();
  Object.defineProperty(raw, "markHandoff", {
    configurable: false,
    value: () => "hidden",
    writable: false,
  });
  const tab = project(raw);

  assert.equal(tab.markHandoff, undefined);
  assert.equal("markHandoff" in tab, false);
  assert.equal(Reflect.ownKeys(tab).includes("markHandoff"), false);
  assert.equal(Object.getOwnPropertyDescriptor(tab, "markHandoff"), undefined);
});

test("hidden prototype methods do not leak through the proxy prototype", () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const tab = project(new PrototypeMethodTab());

  assert.equal(tab.markHandoff, undefined);
  assert.equal("markHandoff" in tab, false);
  assert.equal(Object.getPrototypeOf(tab).markHandoff, undefined);
  assert.equal(tab.title(), "title:tab-1");
});

test("known current constructor names map to public contract names", () => {
  const project = createRuntimeView(new Set(["PlaywrightFileChooser.setFiles"]));
  const fileChooser = project(new FileChooser());

  assert.equal(fileChooser.setFiles, undefined);
  assert.equal("setFiles" in fileChooser, false);
  assert.equal(Object.getPrototypeOf(fileChooser).setFiles, undefined);
  assert.equal(fileChooser.isMultiple(), true);
});

test("BrowserRegistry constructor name maps to Browsers contract", () => {
  const project = createRuntimeView(new Set(["Browsers.list"]));
  const browsers = project(new BrowserRegistry());

  assert.equal(browsers.list, undefined);
  assert.equal("list" in browsers, false);
  assert.equal(Object.getPrototypeOf(browsers).list, undefined);
  assert.equal(browsers.get(), "visible");
});

test("visible methods still work and repeated reads are stable", () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const tab = project(new Tab("visible"));

  assert.equal(tab.title(), "title:visible");
  assert.equal(tab.title, tab.title);
});

test("projecting an already proxied object preserves identity", () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const raw = new Tab();
  const tab = project(raw);

  assert.equal(project(raw), tab);
  assert.equal(project(tab), tab);
});

test("proxy arguments passed into methods are unwrapped to raw targets", () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const left = project(new Tab("left"));
  const right = project(new Tab("right"));

  assert.deepEqual(left.goto(right), { thisIsRaw: true, argumentIsRaw: true });
});

test("nested object fields are projected while ordinary responses are not proxied", () => {
  const project = createRuntimeView(new Set(["Tabs.finalize"]));
  const tabs = new Tabs(new Tab());
  const browser = project(new Browser(tabs));
  const ordinary = browser.documentation();

  assert.equal(browser.tabs, project(tabs));
  assert.equal(browser.tabs.finalize, undefined);
  assert.equal(project(ordinary), ordinary);
  assert.equal("title" in ordinary, true);
});

test("Promise and array results are projected", async () => {
  const project = createRuntimeView(new Set(["Tab.markHandoff"]));
  const rawTab = new Tab();
  const tabs = project(new Tabs(rawTab));

  const promisedTab = await tabs.selected();
  const listedTabs = tabs.list();

  assert.equal(promisedTab, project(rawTab));
  assert.equal(promisedTab.markHandoff, undefined);
  assert.equal(Array.isArray(listedTabs), true);
  assert.equal(listedTabs[0], project(rawTab));
  assert.equal(listedTabs[0].markHandoff, undefined);
});
