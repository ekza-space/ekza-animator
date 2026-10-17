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
| Hit-testing: selected handle > key > handle > curve > empty, 5/6/5/4 px; overlapping curves/keys resolve to the one drawn on top; marquee range queries | `src/hit/hitTest.ts` | `hit-test.test.ts` |
| Selection: click (Shift toggle, Mod remove, Mod+Shift add) and marquee through `select.keys`; double-click curve → `select.curveKeys` | `src/graph/press.ts`, `src/graph/selection.ts` | `hit-test.test.ts`, `controller.test.ts`, `gestures.test.ts` |
| Key moves (LMB on selected key/handle, MMB anywhere), snapping, Alt = no snap, Shift axis lock after 4 px, collisions on commit, one history step, Esc cancels | `src/graph/gestures.ts` (`KeyMoveGesture`), `press.ts` | `gestures.test.ts`; `edits.test.ts` (needs WP-7a) |
| Handle drags (§4.11.4): angle-only for non-weighted / weight-locked, angle+length for free weighted (dt clamped to the span), Alt temp-break, one history step `Edit Tangent` | `HandleDragGesture`, `handleFromPointer` | `gestures.test.ts`; `edits.test.ts` (needs WP-7a) |
| Graph tools `select`, `move`, `insert` (registry); insert = `graph.key.insert` on the clicked curve frame | `src/tools/graphTools.ts` | `controller.test.ts`, `contributions.test.ts` |
| Navigation per profile (§4.11.18): Maya wheel (Shift value, Alt time), Alt+MMB pan, Alt+RMB zoom; Trackpad scroll pan, Ctrl+wheel pinch (Alt/Shift one axis); `mayaOneButton` Option+Cmd/Ctrl+LMB | `GraphEditorController.wheel`, `PanGesture`, `ZoomGesture` | `controller.test.ts` |
| F / A framing with 8 % padding (selection = selected keys, else whole curves) | `GraphEditorController.frame`, `graph/frame.ts` | `controller.test.ts` |
| `graph.frame`, `select.curveKeys`, tool registration | `src/graph/contributions.ts` | `contributions.test.ts` |
| Channel tree (character › control › channel, X/Y/Z swatches, clip curves, filter, only animated) | `src/channel-tree/` | `channel-tree.test.ts` |
| React Graph panel: toolbar (tools, tangent types incl. "More", break/unify, weighted, lock weight, pre/post infinity, Euler filter, Simplify, frame), numeric fields with expressions, virtualized channel list (eye, lock, swatch, filter, only animated), two canvases | `editor/src/panels/graph/` | `editor/test/panels/graph.test.tsx`, `graph-model.test.ts` |
| Redraw benchmark (report) | `curve-editor/test/bench.test.ts` | see below |
| The Graph Editor steps of E2E-08…E2E-13 over the real packages (`createEditorApp`, memory store, AnimX, curve cache, kernel history) | — | `curve-editor/test/real-app.test.ts` (runs once WP-1/2/3/7a are merged) |

### Benchmark (ADR 0007 §9, reported, not a gate)

Google Chrome 155 (headless, Vitest browser mode) on an Apple M4 Pro, canvas 1440×400 CSS px at DPR 2, JS time of
`redraw` (median of 30; rasterization is asynchronous and not included):

| Scenario | Budget | Measured |
|---|---|---|
| 50 curves × 200 keys, full redraw (some keys selected) | ≤ 4 ms | 1.3 ms |
| 50k keys loaded, ~10k visible, pan/zoom redraw | ≤ 8 ms | 1.0 ms |
| 50k keys loaded, one curve edited (a drag update), commit + redraw | — | 9.4 ms with the test kit's naive store (it scans every key per query); 1.2 ms with WP-2's store and WP-3's curve cache (preview update + redraw, measured against those branches) |
| Hit-test on 50k keys | — | 0.02 ms |
| Hit-test with 50k keys selected (handles of the selection shown) | — | 0.2 ms (7.9 ms before fix round 1) |
| Tangent fields of 50k selected keys (`tangentFieldValues`, no early exit) | — | 2.5 ms (454 ms before fix round 1) |

Panel cost of an MMB drag of a large selection, measured in fix round 1 with the panel mounted over the real
packages (`wp/wp-1`, `wp-2`, `wp-3`, `wp-7a` merged into a scratch copy; development build, Chrome, M4 Pro; median
per pointer move):

| Selected keys | Kernel + store (`moveKeys` in the preview, WP-7a/WP-2) | Graph redraw (curve set rebuild + paint) | React (render + commit) | Total |
|---|---|---|---|---|
| 5k (5 curves × 1000) | 8 ms | 4 ms | 2 ms | 15 ms |
| 20k (20 × 1000) | 34 ms | 15 ms | 5 ms | 55 ms (≈ 125–260 ms before fix round 1) |
| 50k (50 × 1000) | 90 ms | 39 ms | 9 ms | 137 ms |

The React share used to dominate: the tangent fields scanned each selected key's curve (O(selected × keys per
curve)), and the selected-keys array was a prop of three components, which React's development build enumerates
when it diffs changed props for its performance track. Selections of a few hundred keys were barely affected, and
the channel list and the curve view do not re-render for key edits. What remains is the kernel's per-key work and the
redraw of every edited curve (painting ~40k handles at 20k selected keys is ~7 ms of it).

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
2. **Test API (§4.8) — prerequisite of E2E-08…E2E-13, not wired on any branch yet.** `graph()`, `screenOfKey`,
   `screenOfHandle`, `screenOfCurve` are implemented by `graphTestHooks(app)` (page CSS px, focused editor, pending
   redraws flushed first); its shape is exactly WP-8's `GraphProbe`. Nothing publishes it: `wp/wp-8` does not
   contain any `wp/wp-6` commit (an earlier report said otherwise; `git branch --contains` lists only `wp/wp-6`),
   and `useTestProbe` exists only on `wp/wp-8`, so this branch cannot call it. Whoever merges `wp/wp-6` with
   `wp/wp-8` (WP-10's integration, WP-8 notes item 5) adds, in `panels/graph/GraphPanel.tsx`:

   ```ts
   import { useDocQuery, useSession, useTestProbe } from '../../hooks';
   import { graphTestHooks } from './testHooks';
   // in GraphPanel, after the controller state:
   useTestProbe('graph', useMemo(() => graphTestHooks(app), [app]));
   ```

   Checked in fix round 1 on a scratch merge of `wp/wp-6` with `wp-1`, `wp-2`, `wp-3`, `wp-7a` and `wp-8`: it
   typechecks, and with a mounted panel WP-8's `createTestApi` returns `graph().visibleCurves`, `screenOfKey` and
   `screenOfCurve`, and `graph()` is null again after unmount. WP-8's alternative (`shell.probes.set('graph',
   graphTestHooks(app))` once per app in `createShell`) works too, since the hooks always follow the focused Graph
   Editor; do one, not both. Without it `screenOfKey` & co. stay null. `screenOfHandle` is null until the key has a
   selected part (handles are not shown otherwise); `screenOf*` return null when the point is outside the canvas.
3. **History**: key and handle drags commit their preview and call `history.record({ label, docTxId })`.
   WP-7a's kernel also records every local commit by itself (its decision 3); `record` with the same `docTxId`
   merges into that step, so the explicit call is harmless there and keeps "one drag = one step" if the
   auto-capture is not adopted.
4. **Redraws** are self-scheduled with `requestAnimationFrame` (coalesced, nothing while idle). Hosts may still
   call `redraw()` from `addAfterEffect`; it draws only dirty layers.
5. **Input**: the panel's canvas adapter turns DOM events into `ToolPointerEvent`s (own double-click counter:
   400 ms / 4 px, because `pointerdown.detail` is not a click count in every browser), normalizes wheel
   `deltaMode`, suppresses the context menu, MMB autoscroll and pinch page-zoom, and listens to `keydown`/`keyup` on
   `window` (capture) only while hovered or dragging, so Esc cancels a drag before the shell's `edit.escape` runs.
   Hotkeys (1–7, B, U, F, A, S, Q/W/I, Delete, Mod+C/V) reach operators through the shell's keymap with scope
   `graph` (the panel registers `keyScope: 'graph'`).
6. **Data-testids** (§4.8) are on: `ge-canvas` (overlay canvas, the pointer surface), `ge-field-*`,
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
  weight-locked handles keep the resolved `dt`; free weighted handles have `dt` clamped to the span). Every gated
  test in `curve-editor/test/edits.test.ts` passes against `wp/wp-7a`.
- **WP-7a (keymap)**: `MAYA_KEYMAP` must carry the scope-`graph` rows of §4.10 (`F`/`A` → `graph.frame`,
  `Q`/`W`/`I` → `view.tool {panel:'graph'}`, …). Done on `wp/wp-7a`.
- **WP-7a (edit kernel, G-21)**: in `setKeyHandle`'s free-weighted branch, clamp `dt` to the span and keep `dv`
  (§4.11.4 "dt is clamped to (0, span]") instead of scaling `(dt, dv)` together, so scripted callers get what a
  drag gets. No Graph Editor change is needed either way.
- **WP-7b (operators, G-14)**: optional — a per-key scale in `KeyFieldsArgs` (e.g. `relative: 'add' | 'scale'`)
  would let `*=2` / `/=2` apply to every key of a mixed selection, as Maya's stats fields do. Until then the panel
  refuses them on mixed values.
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
| G-5 | The Move tool (`W`) behaves like Select (§4.11.18 does not distinguish them; Maya's Move Keys tool neither) and only changes the cursor. `GraphToolHost.press(e, { empty: 'move' })` (an LMB drag on empty space moves the selection) is available to extension tools. | Keeps the normative §4.11.18 behaviour; the variant is one option away for a trackpad-friendly tool later. |
| G-6 | A single click on a curve segment behaves like empty space (clears the key selection); a double-click selects the curve's keys (`select.curveKeys`, Shift toggles them as a group). A double-click on a key also selects its curve. | There is no separate curve-selection state in the MVP selection model. |
| G-7 | A marquee that contains no key selects the shown handles inside it. | Maya behaviour; makes handle-only selections possible. |
| G-8 | Locked curves (`CurveRecord.locked` or the channel's `ControlRecord.locked`) are drawn dashed with dimmed keys and cannot be hit, selected or dragged. The list's lock button runs `channel.toggleLock` (there is no operator for `CurveRecord.locked`). | §4.9 has no curve-lock operator; the channel lock is the Maya-visible one. |
| G-9 | Clicking channel rows writes `session.selection.channels` directly. | §4.9 has no channel-selection operator; it is U state shared with the Channel Box. |
| G-10 | Unselected keys closer than 3 px on average are not drawn (the curve shows them); selected keys always are. Keys stay hittable. | Dense imported curves otherwise turn into a solid band of squares. |
| G-11 | Alt+MMB pan and Alt+RMB zoom work in every navigation profile; the `mayaOneButton` graph bindings (Option+Cmd+LMB pan, Option+Ctrl+LMB zoom) are implemented although the profile is M1-stretch. | Trackpad-profile users with a mouse keep Maya habits; cheap for the graph. |
| G-12 | `GraphHit.value` (curve and none) is a display value (degrees for rotations), matching `GraphViewState`'s value axis. | The view mixes channels of different units. |
| G-13 | `keyPoint`, `handlePoint`, `curvePoint` return null when the point is outside the canvas; `handlePoint` is null when the key's handles are not shown. | Callers (e2e) never click outside the editor or on an invisible handle. |
| G-14 | Field text is parsed with editor-core's `parseNumericInput` (a leading `=` is accepted, research 09 §6.4). With a common current value the expression is evaluated against it. With mixed values `+=x`/`-=x` apply to every key (`relative: true`), a plain value is set on every key, and `*`, `/`, `*=`, `/=` are refused with "× and ÷ need a common value: the selected keys differ (use += or -=)" — `KeyFieldsArgs` has no per-key scale, and evaluating against 0 zeroed every key (fix round 1). The angle and weight fields fall back to "Tangent fields unavailable" when the curve engine throws (try/catch in `keyFieldValues`; not-implemented stays silent); frame/value stay usable. `KeyFields` receives the derived `KeyFieldValues`, never the selected keys (see the drag benchmark). | `tangentFields` (WP-1) and `parseNumericInput` (WP-7a) are stubs at the base commit; a stub must not take the panel down. A per-key scale is a contract change for WP-7b (requested below). |
| G-15 | `packages/editor/vitest.config.ts` pre-bundles `react-resizable-panels` and `@tanstack/react-virtual`. | Otherwise Vite discovers them mid-run and reloads the page under a running test (same reason as B-21); WP-9's virtualized lists need it too. |
| G-16 | `packages/curve-editor/vitest.config.ts` drops `passWithNoTests` (the package has tests now). | Its comment asked for that. |
| G-17 | Where curves or keys overlap, hit candidates within 0.5 px of the nearest resolve to the one drawn on top: focused curves (with selected keys or channels) above the others, then the later curve in list order; selected keys above unselected ones. | Flat channels cross a wave at its zero (E2E-08 double-clicks `rz` at 7.5 where `rx`/`ry` sit at 0°); before, flattening noise picked a hidden flat curve. What is hit is what is seen. |
| G-18 | A weighted span whose handle times lie within 1e-6 (normalized) of the thirds is drawn with the thirds. | AnimX evaluates such spans linear in time (`fLinear`); WP-1's `segmentControlPoints` does the same, and the drawn curve stays the evaluated one (cross-checked over 24 seeded random curves). |
| G-19 | The curve set is updated per edited curve: key and curve changes rebuild only the touched curves; a key is located through its record's `curve` and that entry's index (no set-wide key map). Control, clip, layer, project and load batches rebuild everything. | A drag update on 50k loaded keys cost ~6 ms before the redraw (real packages). |
| G-20 | Shift during a handle drag locks the handle end to the dominant axis after 4 px, like key moves. | ADR 0007 §6 / §4.11.3 constrain MMB and LMB moves of "a selected key or handle" (fix round 1). |
| G-21 | A free weighted handle dragged past its neighbour keeps the pointer's height and has only `dt` clamped to the span ("clamp x, keep y", the Maya habit and §4.11.4's wording "dt is clamped to (0, span]"); the angle follows the pointer. | WP-7a's `setKeyHandle` instead scales `(dt, dv)` together onto the span (keeps the angle). The Graph Editor clamps first, so its input never reaches that branch and the two agree for every drag; for other callers the kernel should clamp `dt` alone (requested below). |
| G-22 | Handle hit candidates (click, hover, marquee) are the keys `paintHandles` draws, restricted to those within one handle length of the probed point or rectangle, in drawing order. | Before, with handles shown for the selection, every selected key was tested on each pointer move (~8 ms with 50k selected); now the cost follows the keys near the pointer. |

## Integration check against the sibling branches

`wp/wp-1`, `wp/wp-2`, `wp/wp-3` and `wp/wp-7a` merge cleanly with this branch (checked in a scratch copy built with
`git merge-tree`, nothing written to other worktrees). With them every curve-editor and editor test passes,
including the gated ones (key moves, handle drags, the engine cross-check and `real-app.test.ts`); only the
"stubbed kernel" fallbacks skip. That run found two bugs fixed here (G-17, G-18) and one test that assumed the
test kit's engine honoured weights (it does not; the locked-weight check now compares with the resolved handle,
which is what the kernel keeps). A dev server over that copy (`/dev/panels?panel=graph`, real Chrome, real mouse
input) showed key selection, pen-handle drags with live curve updates, MMB moves, the marquee and wheel zoom
working through the real kernel.

Fix round 1 repeated it at the new head (a scratch clone, `git merge` of `wp-1`, `wp-2`, `wp-3`, `wp-7a`, then
`wp-8`, all without conflicts): curve-editor 93 pass / 2 skip, editor 41 pass / 1 skip (the skips are the
"stubbed dependency" fallbacks), `tsc -b` clean. The new gated cases ran there: the Shift-locked handle drag
(`edits.test.ts`), field text through WP-7a's `parseNumericInput`, and the tangent fields through WP-1's
`tangentFields`. The drag benchmark above and the probe wiring of integration note 2 come from the same copy.

## Tests waiting for other work packages (auto-enabled)

Browser tests probe the stubs and skip with the blocking WP in the title; they run as soon as the dependency lands,
without edits (MVP-SPEC §8.1):

- `curve-editor/test/edits.test.ts` — **WP-7a** (`moveKeys`, `setKeyHandle`, `selectionSnapshot`): MMB move with
  one history step and exact undo, LMB drag + Alt no-snap + Shift axis lock, collision commit, Esc rollback,
  unified/broken/Alt handle drags (E2E-09/13), weighted free vs locked (E2E-10).
- `curve-editor/test/geometry.test.ts` — **WP-1**: drawn geometry vs `segmentControlPoints` / `evaluateAnimCurve`.
- `editor/test/panels/graph.test.tsx` — **WP-7a** (`parseNumericInput`): typed fields; **WP-1** (`tangentFields`):
  angle/weight display. `graph-model.test.ts` — **WP-7a**: field text evaluated against common and mixed values.
- `curve-editor/test/edits.test.ts` also holds the Shift-locked handle drag (G-20), **WP-7a**.
- `curve-editor/test/real-app.test.ts` — **WP-1, WP-2, WP-3, WP-7a** (`createEditorApp` over the real packages):
  E2E-08 double-click and tangent types, E2E-09/13 pen handle with exact undo/redo, E2E-10 free and locked weights,
  E2E-11 Insert tool, MMB collision. It registers stand-ins for `select.keys` and `graph.key.insert` only while
  WP-7b's builtins do not provide them.

Each of these has a counterpart that runs while the stub is in place (failed edits report a toast and leave the
document untouched; the tangent fields show their fallback).

## Not done (out of M1 scope or stretch)

Tangent marking menu (RMB), pen add-key off the curve and pen-drag tangents, scale (`R`) tool, normalized/stacked
views, buffer curves, playhead scrubbing inside the graph view, cycle-aware auto tangents and plateau (WP-1
stretch). E2E-07…E2E-13 belong to WP-10 and need the shell, the kernel and the operator catalog.

## Gates (run in this worktree)

Fix round 1, at the final commit of the round: `format:check`, `lint`, `typecheck`, `check:deps`, `test` (all
packages; curve-editor 78 pass / 17 skip and editor 39 pass / 3 skip until WP-1/2/3/7a land, anim-core 88,
editor-core 51, doc 23, io 8), `build`, and `test:e2e` on port 3106 (00-webgl, dev-panels ×2, tailwind-smoke):
all pass. With the sibling branches merged (see the integration check) the skips drop to the stubbed-dependency
fallbacks. WP-6 owns no e2e spec of its own; E2E-07…E2E-13 are WP-10's and need integration note 2.
