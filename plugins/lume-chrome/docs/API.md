# Browser API

The public Agent-facing API is exposed inside Lume through the built-in
`mcp__node_repl__js` tool. The `control-browser` skill starts the node_repl
bridge and creates `agent.browsers`.

```ts
const browser = await agent.browsers.get("extension");
const tabs = await browser.user.openTabs();
const tab = await browser.user.claimTab(tabs[0]);
await tab.playwright.domSnapshot();
await tab.dom_cua.get_visible_dom();
await tab.cua.click({ x: 100, y: 120 });
await browser.tabs.finalize({ keep: [{ tabId: tab.tabId, status: "handoff" }] });
```

Always call `browser.tabs.finalize()` at the end of a browser turn.
