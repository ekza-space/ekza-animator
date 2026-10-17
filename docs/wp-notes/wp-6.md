# WP-6 — Graph Editor: build notes

Branch `wp/wp-6`, built against `dev` at `4bdbe5c` (M0: contracts, stubs, shared test kit). Scope: MVP-SPEC §7
WP-6 — `packages/curve-editor/` (except `src/timeline/`) and `packages/editor/src/panels/graph/`.

## What is in the work package

| §7 responsibility | Where | Tests |
|---|---|---|
| View transform `x = (frame − f0)·sx`, `y = H − (display − v0)·sy`, zoom/pan/fit, grid steps | `curve-editor/src/view/` | `test/view.test.ts` |
| Two stacked canvases (base / overlay), hi-DPI backing stores, dirty-layer redraws, `CurveRenderer` seam | `src/painters/renderer.ts`, `canvas.ts`, `graph/GraphEditorController.ts` | `controller.test.ts` (redraw scheduling), `painters.test.ts` |
| Exact Bézier painting (`bezierCurveTo` from the compiled handles), linear/step/stepNext spans, per-pixel fallback for dense curves, dotted infinity (constant, linear, cycle, cycle-offset, oscillate) | `src/painters/curves.ts`, `src/graph/geometry.ts` | pixel probes at DPR 1 and 2, infinity probes, dense fallback |
| Keys (5/7 px, selected yellow), handles (selected keys or prefs `all`; 40 px non-weighted, true length weighted; broken ends), selected segments, inactive curves at 40 %, locked curves dashed | `src/painters/keys.ts`, `curves.ts` | `painters.test.ts` |
| Hit-testing: selected handle > key > handle > curve > empty, 5/6/5/4 px; marquee range queries | `src/hit/hitTest.ts` | `hit-test.test.ts` |
| Selection: click (Shift toggle, Mod remove, Mod+Shift add) and marquee through `select.keys`; double-click curve → `select.curveKeys` | `GraphEditorController.pressDefault`, `graph/selection.ts` | `hit-test.test.ts`, `controller.test.ts`, `gestures.test.ts` |
| Key moves (LMB on selected key/handle, MMB anywhere), snapping, Alt = no snap, Shift axis lock after 4 px, collisions on commit, one history step, Esc cancels | `src/graph/gestures.ts` (`KeyMoveGesture`) | `gestures.test.ts`; `edits.test.ts` (needs WP-7a) |
| Handle drags (§4.11.4): angle-only for non-weighted / weight-locked, angle+length for free weighted (dt clamped to the span), Alt temp-break, one history step `Edit Tangent` | `HandleDragGesture`, `handleFromPointer` | `gestures.test.ts`; `edits.test.ts` (needs WP-7a) |
| Graph tools `select`, `move`, `insert` (registry); insert = `graph.key.insert` on the clicked curve frame | `src/tools/graphTools.ts` | `controller.test.ts`, `contributions.test.ts` |
| Navigation per profile (§4.11.18): Maya wheel (Shift value, Alt time), Alt+MMB pan, Alt+RMB zoom; Trackpad scroll pan, Ctrl+wheel pinch (Alt/Shift one axis); `mayaOneButton` Option+Cmd/Ctrl+LMB | `GraphEditorController.wheel`, `PanGesture`, `ZoomGesture` | `controller.test.ts` |
| F / A framing with 8 % padding (selection = selected keys, else whole curves) | `GraphEditorController.frame`, `graph/frame.ts` | `controller.test.ts` |
| `graph.frame`, `select.curveKeys`, tool registration | `src/graph/contributions.ts` | `contributions.test.ts` |
| Channel tree (character › control › channel, X/Y/Z swatches, clip curves, filter, only animated) | `src/channel-tree/` | `channel-tree.test.ts` |
| React Graph panel: toolbar (tools, tangent types incl. "More", break/unify, weighted, lock weight, pre/post infinity, Euler filter, Simplify, frame), numeric fields with expressions, virtualized channel list (eye, lock, swatch, filter, only animated), two canvases | `editor/src/panels/graph/` | `editor/test/panels/graph.test.tsx`, `graph-model.test.ts` |
| Redraw benchmark (report) | `curve-editor/test/bench.test.ts` | see below |

### Benchmark (ADR 0007 §9, reported, not a gate)

Google Chrome 155 (headless, Vitest browser mode) on an Apple M4 Pro, canvas 1440×400 CSS px at DPR 2, JS time of
`redraw` (median of 30; rasterization is asynchronous and not included):

| Scenario | Budget | Measured |
|---|---|---|
| 50 curves × 200 keys, full redraw (some keys selected) | ≤ 4 ms | 1.3 ms |
| 50k keys loaded, ~10k visible, pan/zoom redraw | ≤ 8 ms | 1.0 ms |
| Hit-test on 50k keys | — | 0.02 ms |

## Public API beyond §7 (additive)

`@ekza-animator/curve-editor` keeps every §7 signature and adds:

- `GraphEditorController`: `host` (the `GraphToolHost` tools receive), `curves` (shown CurveIds), `size`, `busy`,
  `stats` (redraw counters for idle checks), `cursor()`, `cancel()` (Esc/blur/pointercancel), `pointerLeave()`.
- `GraphToolHost`, `GRAPH_TOOLS`, `GRAPH_SELECT_TOOL`, `GRAPH_MOVE_TOOL`, `GRAPH_INSERT_TOOL`, `builtinGraphTool`
  (a plugin tool for panel `graph` receives the host and can reuse the default press behaviour).
- `graphFrameOperator`, `SELECT_CURVE_KEYS_OPERATOR`, `channelNodes`, `channelColor`, `channelLabel`,
  `applyKeySelection`, `selectModeFor`, `channelDisplayScale`, `DEFAULT_VIEW`, `DEFAULT_GRAPH_THEME`,
  `GRAPH_METRICS`, type `CurveRenderer`.

`packages/editor/src/panels/graph` exports `registerGraphPanel`, `GraphPanel`, `focusedGraphEditor(app)` and
`graphTestHooks(app)`.

## Integration notes (for WP-8 / WP-10)

1. **Contributions are registered by the panel.** The first mounted Graph panel calls
   `registerGraphContributions(app, focused)` and the last one to unmount removes them (per app, ref-counted in
   `panels/graph/focus.ts`). The shell must not call it again (the registries refuse duplicates; the panel then
   only logs a warning). `graph.frame` polls "no Graph Editor is open" while none is mounted.
2. **Test API (§4.8)**: `graph()`, `screenOfKey`, `screenOfHandle`, `screenOfCurve` are implemented by
   `graphTestHooks(app)` (page CSS px, focused editor, pending redraws flushed first); the shell's test API can
   delegate to it. `screenOfHandle` is null until the key has a selected part (handles are not shown otherwise).
   `screenOf*` return null when the point is outside the canvas.
3. **Redraws** are self-scheduled with `requestAnimationFrame` (coalesced, nothing while idle). Hosts may still
   call `redraw()` from `addAfterEffect`; it draws only dirty layers.
4. **Input**: the panel's canvas adapter turns DOM events into `ToolPointerEvent`s (own double-click counter:
   400 ms / 4 px, because `pointerdown.detail` is not a click count in every browser), normalizes wheel
   `deltaMode`, suppresses the context menu, MMB autoscroll and pinch page-zoom, and listens to `keydown`/`keyup` on
   `window` (capture) only while hovered or dragging, so Esc cancels a drag before the shell's `edit.escape` runs.
   Hotkeys (1–7, B, U, F, A, S, Q/W/I, Delete, Mod+C/V) reach operators through the shell's keymap with scope
   `graph` (the panel registers `keyScope: 'graph'`).
5. **Data-testids** (§4.8) are on: `ge-canvas` (overlay canvas, the pointer surface), `ge-field-*`,
   `ge-tangent-<type>` (auto, spline, clamped, linear, flat, step, and in "More": stepNext, fixed, plateau,
   autoEase, autoMix), `ge-break`, `ge-unify`, `ge-weighted`, `ge-lock-weight`, `graph-infinity-pre/post` (native
   `<select>`, use `selectOption`), `ge-euler-filter`, `ge-simplify`. Extra: `ge-tool-<id>`, `ge-frame-all`,
   `ge-frame-selection`, `ge-row-<id>`, `ge-eye-<id>`, `ge-lock-<id>`, `ge-channel-filter`, `ge-only-animated`.

## Requests to other work packages

- **WP-7a (evaluation)**: `evaluation.compiledCurve(id)` must reflect an active preview (preview batches invalidate
  the cache) and be index-aligned with `store.query.keysOfCurve(id)`; the Graph Editor draws and hit-tests from it
  and skips a curve whose key count disagrees.
- **WP-7a (edit kernel)**: the Graph Editor passes `dValue` in display units, `snap` already resolved (snapping
  off with Alt during an LMB drag) and, for handles, a handle whose angle follows the pointer (non-weighted and
  weight-locked handles keep the resolved `dt`; free weighted handles have `dt` clamped to the span). A temporary,
  uncommitted kernel built from §4.11.3/§4.11.4 made every gated test in `curve-editor/test/edits.test.ts` pass.
- **WP-7a (keymap)**: `MAYA_KEYMAP` must carry the scope-`graph` rows of §4.10 (`F`/`A` → `graph.frame`,
  `Q`/`W`/`I` → `view.tool {panel:'graph'}`, …).
- **WP-7b (operators)**: with no key and no channel selection, curve-level operators (`graph.infinity.set`,
  `graph.curve.setWeighted`, `graph.curves.simplify`, `graph.tangent.set`) should act on the curves of the selected
  controls (all animated controls of the active character when none is selected) — that is what the Graph Editor
  shows, and E2E-07 sets post-infinity right after keying through the Channel Box, with no curve selected.
- **WP-8 (ui)**: the panel uses local controls (`panels/graph/controls.tsx`) and token CSS variables with fallbacks
  (`--bg-field`, `--bg-hover`, `--bg-pressed`, `--bg-selected`, `--bg-popover`, `--danger`, `--locked-badge`); the
  canvases read `--bg-field`, `--range-outside`, `--grid-minor/major`, `--text-3`, `--key-default`,
  `--key-selected`, `--tangent*`, `--playhead`, `--sel-hover` when defined. Swap to the shared primitives and icons
  when they land.

## Deviations and decisions

| # | Decision | Why |
|---|---|---|
| G-1 | Painters and hit-testing read the compiled curve's resolved handle arrays (`t, v, in/out Dt/Dv, slopes, segment`) and evaluate the drawn Bézier themselves (`graph/geometry.ts`) instead of calling anim-core's `segmentControlPoints` / `evaluateAnimCurve`. | §4.1 documents those arrays as "used by painters and editors"; the result is the same cubic by construction, and it keeps the Graph Editor working before WP-1. `test/geometry.test.ts` holds a cross-check against `segmentControlPoints` and `evaluateAnimCurve` that runs once WP-1 lands. |
| G-2 | Display units come from `channelDisplayScale` (degrees for `rx/ry/rz`) in curve-editor, not editor-core's `toDisplayValue` (a stub). | §4.7 fixes the graph's units; the painter needs a multiplicative scale. |
| G-3 | The playback-range shading maps scene → clip frames locally (§4.11.8 formula) instead of doc's `sceneToClipFrame` (a stub). | Keeps the editor drawing in the harness; same formula. |
| G-4 | With no control selected, the channel list shows every animated control of the active character (Maya shows nothing). | Same rule as the time slider's ticks (§4.11.17); e2e scenarios that only seed a clip see the curve. |
| G-5 | Move tool (`W`): an LMB drag on empty space moves the current selection (Maya's MMB drag); a drag with nothing selected draws a marquee. | Gives one-button mice and trackpads the "drag anywhere" move; the Select tool keeps the marquee. |
| G-6 | A single click on a curve segment behaves like empty space (clears the key selection); a double-click selects the curve's keys (`select.curveKeys`, Shift toggles them as a group). A double-click on a key also selects its curve. | There is no separate curve-selection state in the MVP selection model. |
| G-7 | A marquee that contains no key selects the shown handles inside it. | Maya behaviour; makes handle-only selections possible. |
| G-8 | Locked curves (`CurveRecord.locked` or the channel's `ControlRecord.locked`) are drawn dashed with dimmed keys and cannot be hit, selected or dragged. The list's lock button runs `channel.toggleLock` (there is no operator for `CurveRecord.locked`). | §4.9 has no curve-lock operator; the channel lock is the Maya-visible one. |
| G-9 | Clicking channel rows writes `session.selection.channels` directly. | §4.9 has no channel-selection operator; it is U state shared with the Channel Box. |
| G-10 | Unselected keys closer than 3 px on average are not drawn (the curve shows them); selected keys always are. Keys stay hittable. | Dense imported curves otherwise turn into a solid band of squares. |
| G-11 | Alt+MMB pan and Alt+RMB zoom work in every navigation profile; the `mayaOneButton` graph bindings (Option+Cmd+LMB pan, Option+Ctrl+LMB zoom) are implemented although the profile is M1-stretch. | Trackpad-profile users with a mouse keep Maya habits; cheap for the graph. |
| G-12 | `GraphHit.value` (curve and none) is a display value (degrees for rotations), matching `GraphViewState`'s value axis. | The view mixes channels of different units. |
| G-13 | `keyPoint`, `handlePoint`, `curvePoint` return null when the point is outside the canvas; `handlePoint` is null when the key's handles are not shown. | Callers (e2e) never click outside the editor or on an invisible handle. |
| G-14 | The angle and weight fields render inside an error boundary with a "Tangent fields unavailable" fallback; frame/value fields stay usable. Field text is parsed with editor-core's `parseNumericInput`; with mixed values `+=x`/`-=x` apply relatively (`relative: true`) and a plain value is set on every key. | `tangentFields` (WP-1) and `parseNumericInput` (WP-7a) are stubs at the base commit; a stub must not take the panel down. |
| G-15 | `packages/editor/vitest.config.ts` pre-bundles `react-resizable-panels` and `@tanstack/react-virtual`. | Otherwise Vite discovers them mid-run and reloads the page under a running test (same reason as B-21); WP-9's virtualized lists need it too. |
| G-16 | `packages/curve-editor/vitest.config.ts` drops `passWithNoTests` (the package has tests now). | Its comment asked for that. |

## Tests waiting for other work packages (auto-enabled)

Browser tests probe the stubs and skip with the blocking WP in the title; they run as soon as the dependency lands,
without edits (MVP-SPEC §8.1):

- `curve-editor/test/edits.test.ts` — **WP-7a** (`moveKeys`, `setKeyHandle`, `selectionSnapshot`): MMB move with
  one history step and exact undo, LMB drag + Alt no-snap + Shift axis lock, collision commit, Esc rollback,
  unified/broken/Alt handle drags (E2E-09/13), weighted free vs locked (E2E-10).
- `curve-editor/test/geometry.test.ts` — **WP-1**: drawn geometry vs `segmentControlPoints` / `evaluateAnimCurve`.
- `editor/test/panels/graph.test.tsx` — **WP-7a** (`parseNumericInput`): typed fields; **WP-1** (`tangentFields`):
  angle/weight display.

Each of these has a counterpart that runs while the stub is in place (failed edits report a toast and leave the
document untouched; the tangent fields show their fallback).

## Not done (out of M1 scope or stretch)

Tangent marking menu (RMB), pen add-key off the curve and pen-drag tangents, scale (`R`) tool, normalized/stacked
views, buffer curves, playhead scrubbing inside the graph view, cycle-aware auto tangents and plateau (WP-1
stretch). E2E-07…E2E-13 belong to WP-10 and need the shell, the kernel and the operator catalog.
