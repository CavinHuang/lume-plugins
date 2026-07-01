# Security model

- Chrome Extension executes browser APIs.
- Native host is only a local bridge.
- Agent-facing SDK exposes a restricted Browser API, not raw Chrome API.
- All mutating actions pass through BrowserActionPolicy.
- Browser history requires request-scoped confirmation.
- Host allowlist/blocklist should be persisted per profile.
- Large data uses assets, not raw JSON payloads.
