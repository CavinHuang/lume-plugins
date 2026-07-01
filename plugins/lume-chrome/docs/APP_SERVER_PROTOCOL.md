# Lume App Server browser bridge

The Native Host maintains one full-duplex WebSocket connection to `appServerUrl`.

## Agent to extension

The App Server sends JSON-RPC requests, for example:

```json
{"jsonrpc":"2.0","id":"42","method":"browser_user_open_tabs","params":{"context":{"browserSessionId":"s1","browserTurnId":"t1","actor":"agent"}}}
```

The Native Host forwards the request to the Chrome extension. The extension returns a JSON-RPC result, which the host forwards unchanged to the App Server.

## Extension to App Server

The extension may initiate requests such as:

```json
{"jsonrpc":"2.0","id":"ext-123","method":"host.confirmation.request","params":{"reason":"Allow Lume to interact with example.com?"}}
```

The App Server must return:

```json
{"jsonrpc":"2.0","id":"ext-123","result":{"approved":true,"remember":"session"}}
```

It also receives notifications such as `browser.cdp.event`, `browser.auth.handoff`, `browser.auth.request`, and `host.status`.

## Local Native Host methods

`host.hello`, `host.ping`, and `host.asset.*` are handled locally and are not forwarded to the App Server.
