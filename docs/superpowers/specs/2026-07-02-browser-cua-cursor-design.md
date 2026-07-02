# Browser CUA Cursor Phase Design

## Goal

Align the Lume Chrome plugin with Codex Chrome's coordinate CUA surface enough
for agents to visibly move the cursor before coordinate-based actions.

## Scope

Expose `tab.cua` for the extension backend and keep `tab.dom_cua` hidden. The
public CUA surface includes coordinate `move`, `click`, `double_click`, `drag`,
`scroll`, `type`, and `keypress`. `downloadMedia` remains hidden because
download confirmation and return-value behavior are not part of this phase.

## Runtime Behavior

The Chrome extension continues to execute trusted input through CDP. Before
coordinate mouse actions, the dispatcher injects the existing overlay content
script and sends `LUME_CURSOR_MOVE` to show the agent cursor at the target
coordinate. CDP remains the source of the actual mouse event.

`cua_move` updates both the visual overlay and the browser mouse position.
`cua_click`, `cua_double_click`, `cua_drag`, and `cua_scroll` update the visual
cursor before the CDP action. Keyboard and typing commands remain unchanged.

## Out Of Scope

Playwright locator actions are not converted to animated mouse actions in this
phase. The existing locator path uses DOM interaction semantics and should stay
stable until a separate design handles target coordinate calculation and
performance impact.

DOM CUA remains hidden because its action path currently calls page DOM methods
without cursor animation or a Codex-shaped visible DOM contract review.

## Tests

Client conformance verifies `tab.cua` is projected while `tab.dom_cua` and
`CUAAPI.downloadMedia` remain hidden. Dispatcher tests verify overlay cursor
messages are sent before mouse actions and that CDP still receives the expected
coordinates.
