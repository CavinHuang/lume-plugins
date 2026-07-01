# Native host

Chrome extensions cannot directly connect to arbitrary local processes. The native host is the bridge:

```text
Chrome Extension <-> Chrome Native Messaging stdio <-> lume-chrome-host <-> Lume Desktop/Sidecar
```

Responsibilities:

- implement Chrome Native Messaging 4-byte length framing
- validate protocol versions
- find or start Lume app/server
- proxy JSON-RPC messages
- stream large tab assets through asset chunks
- report diagnostic state to the extension

It must not own Agent decisions or browser policy.
