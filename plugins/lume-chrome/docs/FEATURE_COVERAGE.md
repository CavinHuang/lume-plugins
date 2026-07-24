# Feature coverage v4

## Implemented

- Full-duplex Chrome Native Messaging ↔ Native Host ↔ authenticated current-user pipe bridge
- Native protocol hello/version and connection status notifications
- Browser backend discovery through Lume's canonical Browser Broker
- Browser/tab dynamic capabilities
- Session/turn/tab leases persisted in `chrome.storage.session`
- User tab listing/claiming, tab creation/get/selected/close/list
- Tab group naming, handoff, resume, finalize and intermediate-tab cleanup
- Broker-owned confirmation, backend selection, policy, and audit boundaries
- Navigation and load/network-idle waits
- Full-page, viewport, clip and element screenshots
- CUA mouse, scroll, drag, type and key input
- DOM CUA visible node inventory and actions
- Locator AST with role/text/label/placeholder/test-id/CSS/frame/filter/first/last/nth/and/or model
- Strict locator uniqueness, visibility/enabled checks and scoped actions
- External Chrome upload and Agent download fail closed as unavailable
- Content export, page assets, clipboard, raw CDP, credential transfer, upload, and Agent download routes fail closed
- External Chrome browserAuth is unavailable; credentials remain in Chrome/user control
- Popup health panel with native-host, permission, capability and diagnostic status
- Command declaration/dispatcher coverage test

## Partially implemented

- Frame locators: same-origin frames work; cross-origin OOPIF target/session routing needs dedicated CDP target management
- Playwright semantics: actionability is substantially modeled, but it is not a full Playwright browser engine
- Pipe configuration and OS credential-store pairing are installer-managed; signed release attestation and live macOS packaging validation remain release work

## Not implemented

- Chrome Web Store packaging/signing/update pipeline
- Complete WebMCP implementation
- CAPTCHA/payment automation; these are intentionally user handoff operations
- Full accessibility-tree locator engine across all cross-origin frames
- Original Codex proprietary code, executable internals, icons, prompts or branding
