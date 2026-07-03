# Feature coverage v4

## Implemented

- Full-duplex Chrome Native Messaging ↔ Native Host ↔ App Server WebSocket bridge
- Native protocol hello/version and connection status notifications
- Chunked asset create/append/finish/abort/remove with local files
- Browser backend discovery with explicit unavailable IAB/CDP entries
- Browser/tab dynamic capabilities
- Session/turn/tab leases persisted in `chrome.storage.session`
- User tab listing/claiming, tab creation/get/selected/close/list
- Tab group naming, handoff, resume, finalize and intermediate-tab cleanup
- Site session allow, persistent allow and block decisions
- Runtime confirmation request forwarding to Lume App Server
- Correct browser navigation history and load/network-idle waits
- Full-page, viewport, clip and element screenshots
- CUA mouse, scroll, drag, type and key input
- DOM CUA visible node inventory and actions
- Locator AST with role/text/label/placeholder/test-id/CSS/frame/filter/first/last/nth/and/or model
- Strict locator uniqueness, visibility/enabled checks and scoped actions
- File chooser interception and absolute-path upload
- Download event waiting, download path and media download helpers
- Clipboard operations
- Content export and GSuite-oriented visible content export
- Page asset inventory, download, inline SVG export and manifest generation
- CDP event subscriptions and developer log buffer
- Secure browserAuth request/fill/submit flow with status-only tool result
- Popup health panel with native-host, permission, capability and diagnostic status
- History/bookmark/top-sites/reading-list/session wrappers
- Command declaration/dispatcher coverage test

## Partially implemented

- Frame locators: same-origin frames work; cross-origin OOPIF target/session routing needs dedicated CDP target management
- Locator `and/or`: represented in the AST, but the page resolver intentionally does not yet recursively combine nested AST results
- Playwright semantics: actionability is substantially modeled, but it is not a full Playwright browser engine
- GSuite export: visible-content heuristic rather than product-specific internal model extraction
- Confirmation: protocol and persistence exist; Lume desktop approval UI is external
- App Server discovery: command launch and WebSocket reconnect exist; installed-version/channel discovery is Lume-product-specific

## Not implemented

- Chrome Web Store packaging/signing/update pipeline
- Complete WebMCP implementation
- CAPTCHA/payment automation; these are intentionally user handoff operations
- Full accessibility-tree locator engine across all cross-origin frames
- Original Codex proprietary code, executable internals, icons, prompts or branding
