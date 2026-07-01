# Validation

The TypeScript extension and Browser Client compile successfully with the bundled Chrome ambient stub. The command-coverage test verifies that every command declared in `BrowserCommandType` is handled by the runtime dispatcher or bootstrap path.

```text
declared commands: 114
handled commands: 114
missing commands: 0
```

The extension ZIP was checked for:

- `manifest.json`
- `popup.html`
- `dist/extension/background.js`
- `dist/extension/content/overlay.js`
- `dist/extension/content/dom-agent.js`
- valid non-empty 16/32/48/128 PNG icons

The Native Host must still be compiled and tested with Cargo on Windows/macOS/Linux.
