# Restricted Playwright facade

Expose a small, audited subset of Playwright-like operations, not the raw page object.

Recommended flow:

1. `tab.playwright.domSnapshot()` or `tab.dom_cua.get_visible_dom()`
2. choose a stable locator or node id
3. perform one action
4. re-snapshot after failures
5. avoid loops over raw DOM/body text

`evaluate()` must be treated as read-only. Do not allow network, storage, cookie, beacon, or mutation APIs inside evaluate.
