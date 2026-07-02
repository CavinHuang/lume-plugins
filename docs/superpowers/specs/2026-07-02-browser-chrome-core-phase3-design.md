# Browser Chrome Core Phase 3 Design

## Goal

Make the Lume Chrome backend usable for ordinary agent browser work by aligning the next practical Codex Chrome behaviors: tab cleanup, Chrome tab claiming, and a conservative Playwright core projection.

## Scope

This phase implements only behavior that can be exercised through the existing extension runtime and Node REPL client. It does not implement secure credential handoff, bot-detection reporting, raw Codex CDP capability objects, file upload/download workflows, dialog handling, or full in-app-browser support.

## Design

The extension descriptor will stop hiding the API members that are already backed by stable runtime commands and tests. `Tabs.finalize`, `Tab.markDeliverable`, and `Tab.markHandoff` will become public so agents can keep the final tab and clean up temporary tabs. Chrome state APIs will stay limited to listing, claiming, selecting, and using current session tabs.

The Playwright surface will open only the core subset needed for common browsing: locator builders, click/fill/type/press/select/check operations, basic text/value/visibility/count readers, `domSnapshot`, `evaluate`, `elementInfo`, `elementScreenshot`, `waitForLoadState`, `waitForTimeout`, and `waitForURL`. The runtime will continue hiding file chooser, downloads, `waitForEvent`, frame locator behavior that is not implemented, dialogs, clipboard, content export, CUA, and raw dev/CDP.

Documentation will list the newly projected core APIs and still call out unavailable Codex Chrome capabilities. Tests will lock descriptor exposure, runtime projection, and cleanup commands before implementation.

## Verification

Use focused tests for descriptor projection and client object behavior first, then run `npm test` and `npm run check:coverage` in `plugins/lume-chrome`.
