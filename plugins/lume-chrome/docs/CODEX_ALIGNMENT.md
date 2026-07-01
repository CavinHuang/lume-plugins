# Clean-room alignment

The project aligns the observable architecture and public API shape of the Codex Chrome integration:

- Chrome extension + Native Messaging host
- existing user tabs/login state
- browser/user/tabs/tab object model
- session/turn/tab lease lifecycle
- tab groups, handoff, deliverable and finalization
- CUA, DOM CUA and restricted Playwright-like surfaces
- debugger/CDP control
- page assets and large asset transfer
- file chooser/download flows
- confirmation and host permission policy
- diagnostics and profile/native-host setup

The implementation is independently written for Lume. It deliberately avoids copying minified Codex extension code, the original browser-client bundle, the native executable, or OpenAI branding.
