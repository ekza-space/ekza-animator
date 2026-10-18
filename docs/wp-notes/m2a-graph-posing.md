# M2a A4 — Graph Editor features, tween family, half-cycle mirror animation, M-1: build notes

Branch `m2a/graph-posing` (from `dev` with `m2a/contracts-foundation` merged). Scope:
[M2A-SPEC §8 A4](../M2A-SPEC.md#a4--graph-editor-features-tween-breakdown-display-mirror-animation-m-1). The spec
names this file `m2a-a4.md` (§3 rule 6, §5.21.1); the work package's task asked for `m2a-graph-posing.md`, so the
notes (and the M-1 frame profile) live here. Decision IDs below are `M2A-A4-<n>` for DECISIONS-OPEN §F.

## M-1 frame profile (first deliverable, before any optimisation)

Measured on `m2a/graph-posing` at the A0 merge (59b36e8), before any A4 change: production e2e build
(`NEXT_PUBLIC_EKZA_E2E=1 next build`), real Chrome 155 (Playwright `channel: 'chrome'`, headless), Apple M4 Pro, DPR 2,
1440×900. Load average 12–16 (1 min) from other agents' builds on the machine. Bench
`apps/web/e2e/bench/m2a-a4.bench.ts` (`M-1: …`): the `budgets.bench.ts` scenario (UAL `Idle_Loop` imported without
reduction, 1,000 keys of the first visible curves selected, vertical drag in the Graph Editor, one pointer move per
animation frame), 3 rounds × 40 moves after a warm-up drag; per move = the pointermove listeners plus every
requestAnimationFrame callback of the frame that renders it.

| | median | p95 |
|---|---|---|
| Baseline (3 runs) | 4.7–5.5 ms | 5.3–6.0 ms |

Frame split per move from a CPU profile of a fourth, identical drag (DevTools Profiler at 100 µs; only samples under
the editor's frame callbacks and pointermove listeners; categories by method name, innermost first):

| Category | ms per move | What it is |
|---|---|---|
| Store preview update (`previewUpdate`, `journalWrite`, `put`, query/reference `onWrite`, `revert`) | 1.95–1.98 | doc: revert 1,000 records, re-put 1,000 records (normalize, validate, journal), every storage write drops the curve's key group and relinks references, then deep-compares each record for the preview batch |
| Graph Editor redraw (`renderBase`/`renderOverlay`) | 1.03–1.11 | every curve, key and handle of the 30 visible curves repainted per frame |
| Other | 0.98–1.02 | the Graph panel's React re-render on every preview batch (key fields, toolbar and channel-tree doc queries, react-resizable-panels re-sorting its handles: 0.27 ms), the time slider's tick set (`tickSet`, 0.30 ms, A3's file), the curve cache's per-change invalidation (0.16 ms) |
| Viewport GL render | 0.18–0.23 | three.js draws of the panes (the pose changes: keys at the current frame move) |
| Pose evaluation | 0.13–0.24 | sampling + rig of the edited character |
| Graph Editor curve set | 0.14–0.16 | rebuilding the 30 edited curve entries |
| Viewport pose sync | 0.08–0.09 | |
| Curve compile | 0.04–0.06 | the 30 edited curves |

So the 1,000-key drag costs ≈ 2 ms in the store, ≈ 1 ms in the Graph Editor painters and ≈ 1 ms in React and the
time slider; the viewport and the evaluation are small because only one character's 30 curves change. The plan
follows: store and query fast paths (mechanisms 2–3), the cached static-curve layer (5), the curve cache's
once-per-batch invalidation (4), and no Graph panel re-render for a preview batch that changes nothing it shows.

## M-1 after the mechanisms (build round)

Same bench, same machine, after the six mechanisms (commits `5763657`, `f684f8d`), load average 6–12. These are the
A4 bench's **warm** drags (after a warm-up drag); the bench of record measures the first drag, see "M-1 on the bench
of record" below, which supersedes the "Met" verdicts here:

| | median | p95 | verdict |
|---|---|---|---|
| Graph Editor drag, 1,000 keys (gate p95 ≤ 4.0 ms) | 3.30 ms | 3.60 ms | **Met** (load 5.9) |
| same, after the doc second pass (below) | 3.00 ms | 3.50 ms | **Met** (load 6.8; at load 31: 3.50 / 4.30) |
| doc bench preview update, 1,000 keys (≤ 1.0 ms) | 0.76–0.88 ms (5 runs, load 7–10) | — | **Met** (second pass, below) |
| Tween slider drag, 60 channels (§5.22, ≤ 4 ms) | 2.90 ms | 3.30 ms | Met (load 10; 2.90 / 3.40 at load 7.5) |

Frame split per move after the mechanisms (profiled): store preview update 0.86 ms (was 1.95), Graph Editor redraw
0.69 ms (1.03; the bench drags 30 curves, all of them dynamic, so the static layer saves the grid, labels and the
other curves only), pose evaluation 0.22, viewport GL 0.21, curve set 0.11, pose sync 0.07, curve compile 0.04,
coalesced updates 0.01, other 1.00 ms. "Other" is now led by the time slider's `tickSet` (0.32 ms per move: the
tick list of every key of the band's curves rebuilt on every preview batch; `curve-editor/src/timeline`, A3's
file — an incremental tick set or one that skips preview batches would remove it) and `getBoundingClientRect`
(0.29 ms, layout reads of the panes).

The doc bench (`packages/doc/test/bench.test.ts`, unchanged: median of 10 updates of a fresh preview, patch path)
measured 2.09 ms before the mechanisms and 1.05–1.15 ms after them at load 3–4, still above the target. A Node CPU
profile of 600 updates showed what was left: storage lookups (18 %: a patch looked its 30k-entry table up four times,
the revert and the preview batch twice more), the preview batch's `deepEqual` (17 %, own-property checks per
field) and the revert. Second pass (commit `e594951`): a patch reads its stored entry once and hands it to the
partition, the journal and a `Storage.write` that skips the lookup; each journal original tracks what storage holds
for it (`JournalOriginal.current`, kept in step by the journal's writes, rollbacks and reverts; a preview's
conflicts change `original` only), so the revert and the batch look nothing up; `deepEqual` walks plain records
without own-property checks and falls back to the exact walk on an `undefined` field or differing key counts; the
query engine skips the stale-curve `Set` add for consecutive keys of one curve. Result: **0.76–0.88 ms** in five
runs at load 7–10 (commit 0.31–0.43 ms). Tests: `doc/test/preview-m1.test.ts` (a remote write under a record the
last update left committed; a failing update then a good one report what readers saw; a curve written again after
a query drops again; patch, soft delete and restore), `doc/test/diff.test.ts` (undefined fields and key counts,
property-based against JSON text); conformance suites unchanged and green.

## M-1 on the bench of record (fix round 1)

The gate is read on `budgets.bench.ts` `Graph Editor: drag 1,000 selected keys` (A5's file, the §14 table): the
**first** drag of a freshly opened editor, 30 moves of 3 px, p95 = the second-slowest move. After the build round it
measured p95 5.0–5.8 ms at load 6.4–10 (review): Miss. A per-move copy of that procedure with CPU profiles and traces
showed why the first drag differs from the warm drags the A4 bench timed:

- **Unoptimized code.** A fresh editor has run the drag path's per-frame code a handful of times, so the first moves
  execute in V8's interpreter and baseline tiers (`--always-sparkplug` alone took move 2 from 4.2 to 3.1 ms). Every
  loop over 1,000 keys or changes, every call and every boxed double costs several times its optimized price there;
  a `for…of` over an array or Map even allocates an iterator result per step.
- **Scavenges.** ≈ 1.5 MB allocated per move filled the young generation every 4–5 moves; a 0.6–1.0 ms scavenge
  landed on move 2 in every trace, on top of the coldest move after the first.
- **Waste per frame**: the viewport HUD rewrote its (unchanged) frame text on every batch, which replaced the text
  node and made the viewport's `getBoundingClientRect` force a layout mid-frame (0.26–0.29 ms); the time slider
  rebuilt its tick set and repainted on every value-only batch (0.46 ms); a dozen listeners each scanned the 1,000
  changes for their tables; the drag's `moveKeys` rebuilt every dragged curve's key projection on the reverted
  preview and allocated a placement per key, although a vertical drag moves no key in time; every put re-validated
  the whole key record (whose handle checker also deoptimized at the sixth move).

Changes (commits `70f63a7`, `fcccf3c`, `81f5695`, `f100176`, `954551e`; all behaviour-preserving, each with a test):

| Change | Where | Test |
|---|---|---|
| HUD writes text only when it changes | `editor/src/panels/viewport/PaneView.tsx` (A2's dir, 6 lines) | `editor/test/m2a-m1-hud.test.tsx` |
| Time slider ignores key updates that keep time and curve | `curve-editor/src/timeline/TimeSliderController.ts` (A3's dir, `onBatch` only) | `curve-editor/test/timeline/m2a-m1-ticks.test.ts` |
| `batchTables(batch)` / `batchTouches(batch, tables)`: one table scan per batch, cached per batch object (doc export, additive) | `doc/src/store/batchTables.ts`; used by `useDocQuery`, `committedQuery`, timeline `state.ts`, `ViewportManager`, `SceneSync`, rig clip sampler, character registry, time slider | `doc/test/batch-tables.test.ts` (property + one emit) |
| Listeners that walk changes skip same-curve/same-clip repeats and use indexed loops | Graph Editor `onBatch`, rig curve cache, kernel `affectedCharacters` | existing suites |
| Journal originals iterated by index (`Journal.ordered`, kept in step with the map) | `doc/src/store/{journal,memory}.ts` | `doc/test/journal-order.test.ts` (property), conformance (memory, doc-yjs) |
| References index: keys compare clip and curve directly | `doc/src/store/references.ts` | conformance |
| No re-validation of a key rewritten with only a new finite `t`/`v` | `doc/src/store/memory.ts` `checkValid` | `doc/test/preview-m1.test.ts` |
| Value-only drag path: curves whose shown keys are all dragged and whose keys stay in time get their values written directly (the writes `moveKeys` makes then) | `curve-editor/src/graph/gestures.ts` `KeyMoveGesture` | `m2a-graph.test.ts`: seven drags compared with `moveKeys` applied directly (whole and partial curves, −0 time, snapping and fractional keys, close keys, a time move) |
| Scene focus from the selected keys' curves cached per selection; curve-set entries reuse the key index when ids and order are unchanged | `curve-editor/src/graph/{GraphEditorController,curveSet}.ts` | existing suites |
| Painters: inline view transform and handle ends, one selection lookup per key, round handle ends as round-capped dots (not 2,000 arcs), runs of selected segments traced in one call | `curve-editor/src/painters/{keys,curves}.ts` | `m2a-graph.test.ts` (handle ends painted where hit-testing finds them, weighted and not, during a drag), `painters.test.ts` |

Results (Apple M4 Pro, real Chrome, DPR 2; the bench of record unchanged):

| Bench | Load (1 min) | median | p95 | Gate |
|---|---|---|---|---|
| `budgets.bench.ts` Graph Editor drag (first drag), 8 runs | 5.0–7.9 | 2.4–2.7 ms | 3.2, 3.5, 3.7, 3.6, 3.4, 3.4, 3.4, 3.4 ms | **Met** (≤ 4.0) |
| same, full `budgets.bench.ts` run | 6.9 | 2.50 ms | 3.30 ms | Met; undo 2.20 / redo 1.80 ms |
| same, at load > 8 (for reference, outside the gate's condition) | 8.0–8.6 | 2.1–2.7 ms | 3.2–4.3 ms | — |
| `m2a-a4.bench.ts` first (cold) drag, same procedure | 6.1–6.8 | 2.0–2.5 ms | 3.4 ms | Met |
| `m2a-a4.bench.ts` warm drags (120 moves) | 6.1–6.8 | 1.7–1.9 ms | 2.3–2.4 ms | — |
| Tween slider drag, 60 channels (§5.22) | 6.2–6.4 | 2.3–2.4 ms | 2.9–3.0 ms | Met (≤ 4) |
| doc bench preview update, 1,000 keys | 5.5 | 0.67–0.74 ms | — | Met (≤ 1.0) |

Frame split per warm move (profiled, A4 bench): Graph Editor redraw 0.50, store preview update 0.50, pose evaluation
0.22, viewport GL 0.17, pose sync 0.09, Graph Editor curve set 0.03, other 0.25 ms. What is left of the first drag's
extra cost is the engine's warm-up and the scavenges; the largest remaining allocator is anim-core's tangent
resolution (closures per key in `resolveTangents`), A5's file (§5.21.3 fast paths).

Mechanisms as built (M2A-SPEC §5.21.1):

1. **Coalescing**: the Graph Editor's key, handle and scale drags run on `beginKeyEditGesture`; the controller's
   redraw runs `app.flushScheduled()` first, so whichever of the GL frame loop and the canvas's own rAF runs first,
   a frame never shows the previous pointer position (tests: `m2a-graph.test.ts` "with a frame requester …").
2. **Store preview** (`doc/src/store/memory.ts`, `journal.ts`, `rows.ts`, `diff.ts`): the preview journal stays in
   place across updates (`JournalOriginal.shown` records what readers saw; one loop notes it and reverts, skipping
   records already at their committed entry), originals are indexed by table then id (no `rowKey` string per
   write), a patch makes one copy, clip-partitioned records keep their partition string, the preview batch compares
   with a reference check first and `deepEqual` compares primitive fields inline. A failing update restores the
   previous overlay and forgets the records it first wrote. Tests: `doc/test/preview-m1.test.ts`; the conformance
   suites (memory, `doc-yjs`) are unchanged and green.
3. **Query engine** (`doc/src/queries/engine.ts`): key writes mark their curve stale; the projection cache drops
   each stale curve's group once, before the next projection read. Curve writes still drop at once, so a deferred
   drop always finds the curve's current group.
4. **Scoped recompile and re-evaluation**: the rig's curve cache forgets each touched curve once per batch
   (`rig/src/sampler/cache.ts`); only characters whose clips changed re-evaluate (M1 kernel rule, kept).
5. **Cached static layer** (`curve-editor/src/painters/renderer.ts`): during a drag the controller passes the
   gesture's dynamic curves and a static version (bumped by any change the static layer shows: view, size, theme,
   selection, buffers, edits of other curves); the renderer paints everything else once into an offscreen canvas and
   per frame copies it and repaints the dynamic curves, keys and handles (test: one static repaint per drag).
6. **No change, no frame** (`editor-core/src/evaluation/service.ts`): a re-evaluation whose sampled channels are
   bit-identical to the last ones keeps the pose and publishes no pose change, so the viewport neither syncs nor
   renders (test: `m2a-a4-edit.test.ts` "no pose change …"). No change in `viewport/**` was needed: the viewport
   already renders only on pose events.

Beyond the six: the Graph panel's channel tree, key fields and toolbar re-read after committed changes only, not on
every drag preview batch (`panels/graph/committedQuery.ts`); during a drag the fields keep their pre-drag values. The
fix-round changes above (value-only drag path, per-batch table sets, HUD and time-slider repaints, store fast paths)
complete the set.

## What landed

| Spec | Where | Tests |
|---|---|---|
| §5.13 tween family | `editor-core/src/edit/tween.ts` (`tweenEdits`, plan/evaluate split, `beginTweenGesture`, `resolveTweenTarget`), `operators/builtin/tween.ts` (`key.tween`); key-edit gestures record the override change in their step (`edit/gesture.ts`) | `test/kernel/m2a-a4-edit.test.ts`, `test/builtin/m2a-a4-operators.test.ts` (incl. a slider drag that keys an overridden channel: undo restores override and pose, redo drops it, same as `key.tween`), `editor/test/panels/tween-bar.test.tsx`, E2E-M2A-13 |
| §5.12 breakdowns | `operators/builtin/breakdown.ts` (`key.convert`), Graph Editor ◇ glyphs (`painters/keys.ts`) | operators, `curve-editor/test/m2a-graph.test.ts` |
| Tween bar | `editor/src/panels/shared/TweenBar.tsx` (status line: compact, presets and overshoot in "⋯"; Graph Editor toolbar: full) with the `tween.<panel>` probe | `tween-bar.test.tsx`, E2E-M2A-13, the status-line slot in E2E-M2A-00 |
| §5.14 mirror animation | `editor-core/src/workflows/mirrorAnimation.ts`, `operators/builtin/mirrorAnimation.ts` | operators (channel rule, flip involution, side-C scope, secondary controls, locked channels, the half-cycle cases incl. 0/9/15/24 auto keys, cyclic infinities, odd ranges, weighted and spline curves with the AnimX engine, non-periodic warning), `test/builtin/m2a-a4-mirror-properties.test.ts` (§9.2 fast-check: the FR-POSE-05 gate on random periodic curves of every tangent type incl. step/stepNext, weighted, every infinity and range; cyclic infinities reaching into the clip; time order and in-range keys; the non-periodic flag; the remap applied twice; flip ∘ flip = id through the operator; stepped unit cases), `headless-tests/test/ops.m2a-a4.test.ts` (Seed-san), E2E-M2A-15 (fixme A1,A2) |
| §5.15.1 buffer curves | `operators/builtin/graphBuffer.ts`, the kernel's prune of deleted curves (`app/kernel.ts`), dashed painting (`painters/curves.ts`), toolbar Snapshot/Swap | operators, `m2a-graph.test.ts`, E2E-M2A-16 |
| §5.15.2 views | `curve-editor/src/graph/viewMode.ts`, mapping in `curveSet.ts`, `GraphEditorController` (`setViewMode`, `viewMode`, `onViewModeChange`), `graph.view.setMode` (`contributions.ts`), lanes in `painters/grid.ts`, persistence in `panels/graph/GraphPanel.tsx` | `m2a-graph.test.ts`, E2E-M2A-16 |
| §5.15.3 Scale tool | `curve-editor/src/graph/region.ts`, `tools/graphTools.ts` (`GRAPH_SCALE_TOOL`), `editor-core/src/edit/valueScale.ts` (`scaleKeyValues`), probe `screenOfRegionHandle` | `m2a-a4-edit.test.ts`, `m2a-graph.test.ts`, E2E-M2A-17 |
| §5.21.1 M-1 | above | above, bench `apps/web/e2e/bench/m2a-a4.bench.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M2A-A4-1 | Notes in `m2a-graph-posing.md` (the task's name), not `m2a-a4.md`. | The task named the file; A0 did the same. |
| M2A-A4-2 | **The tween plans once and evaluates per amount.** `tweenEdits` = `planTween` (neighbours, current values, defaults, ranges, read from the committed document and the session) + `evaluateTweenPlan`; the slider gesture plans when the drag starts, so its preview updates never read the overlay they replace ("captured when the gesture starts"). `key.tween` limits the amount to ±100 (±150 with `prefs.tweenOvershoot`) instead of refusing it; ease has no overshoot by its formula. | One code path for the operator, the gesture and the pure function; a keymap override with a preset amount should not fail when overshoot is off. |
| M2A-A4-3 | **The 'frame' target** tweens the key-target controls' keyable, unlocked TRS channels and keyable attributes (without `keyAll: false` ones), or exactly the selected Channel Box channels of those controls (then `keyAll: false` attributes too); a channel needs a curve with a key before and after the frame (`|Δt| ≥ 1e-6`), unlocked (curve and channel). The current value is curves ⊕ overrides at the character's current frame. The overrides of the tweened channels leave the session when the keys are written (`key.set` rule); the slider gesture removes them when the drag starts and puts them back on Esc. | §5.13 with §5.1 rule 4 and §4.11.1 rule 5. |
| M2A-A4-4 | **Runs** use the curve's visible keys (`keysOfCurve`); selection means the key part. Locked curves or channels are skipped. | §5.13; the Graph Editor's lock rule. |
| M2A-A4-5 | **The Tween bar's target toggle** writes `session.tools.tweenTarget` directly (U state, no operator exists for it); the overshoot toggle writes `prefs.tweenOvershoot` (one preference for every bar). The label ("Pose @ f21", "12 keys", "1 key") is written to the DOM from a session subscription, not rendered by React: it changes on every played frame, and an idle editor commits no React render for that (`shell.test.tsx`). The slider is a `role="slider"` element (a range input cannot run a key-edit gesture with Esc and a spring-back thumb). | §5.13, ARCHITECTURE §14 idle rule. |
| M2A-A4-6 | **Buffer curves**: targets are the given `curves`, else `targetCurves` (selected keys' curves, selected channels', selected controls', else the clip's); the Graph Editor's buttons pass the toolbar's target curves, which is the §5.15.1 set. Swap replaces keys (hidden duplicate keys of the channel too), `weighted`, `pre` and `post`; swapped key IDs leave the key selection; buffers of curves deleted by any batch (undo, load, remote) are dropped by the kernel. | §5.15.1. |
| M2A-A4-7 | **Mirror animation details**: the channels written are the union of the source's and the target's curves; a target channel whose source has no curve gets the mirrored default as a static value (its keys removed), so the target equals the source mirrored; locked target channels and curves are skipped and counted in the warning; handle `dv` of every stored handle maps (not only fixed ones: the stored handle of a computed side becomes the fixed handle when the type changes later); zeros stay +0. The count returned is the target channels written. The seam keys' `broken` is set where their two resolved slopes differ (relative 1e-12) or the source key was broken. | §5.14. |
| M2A-A4-8 | **Views**: a flat curve (range < 1e-9 in display units) draws at 0 in its own display units, so it stays editable; a stacked lane is 3 value units (the curve's −1…1 plus margins), at least 40 px; the stacked view keeps its lane height (the wheel and zoom drags change time only, the vertical scroll is clamped to the lanes); switching modes keeps the time axis and refits the value axis; F/A frame time and −1…1 (normalized) or time only (stacked). Ranges are frozen while any document preview runs (a drag here or in another panel) and recomputed afterwards. Value drags in mapped views (and on attribute curves whose display unit is not M1's) move time through `moveKeys` and apply the value delta in curve units per curve (Δv = Δy′/scale). The view mode persists per Graph Editor in its dockview panel parameters (`graphViewMode`). | §5.15.2. |
| M2A-A4-9 | **Scale tool**: edges and corners hit within 6 px; presses on keys, handles and curves select like the Select tool (inside or outside the box); inside the box off the keys a drag moves the keys (`Move Keys`); outside with keys selected a drag scales around the press point by `1 + dx/100 px` in time (≥ 0.01) and `1 − dy/100 px` in value, and a click clears the key selection; Shift locks the dominant axis after 4 px for corners and outside drags. A degenerate axis (one key time or one value) does not scale. Time scaling snaps with the time slider's setting (Alt off). | §5.15.3 leaves the outside rate open. |
| M2A-A4-10 | **E2E-M2A-17 factor**: Chrome delivers pointer coordinates as float32, so the value factor of a drag released at the exact midpoint is 0.5 only to ~1e-7. The scenario computes the factor from the delivered coordinates (`Math.fround`) as §9 says ("the spec computes the expected values from the pre-drag keys"), checks every value against it at 1e-9, −30° unchanged at 1e-9 and 30° → 0° at 1e-5. Choosing float32-exact press and release points does not help: the factor is `(60° + Δv)/60°` with `Δv = −Δy/sy`, and the view's `sy` (from framing) makes `30·sy` a non-float32 distance. **Open for the integration agent**: a contract PR to the E2E-M2A-17 row ("30° becomes 0° to the float32 pointer precision, 1e-5; every value equals the formula with the delivered factor at 1e-9"). | Exactness at 1e-9 is not reachable with float32 events. |
| M2A-A4-11 | **Contract additions (additive)**: editor-core exports `beginTweenGesture`, `resolveTweenTarget`, `clampTweenAmount`, `TWEEN_MODES`, `TWEEN_LIMIT`, `TWEEN_OVERSHOOT_LIMIT`, types `TweenGesture`, `ResolvedTweenTarget`, and `compileWithAppEngine` (buffer curves draw with the app's engine); curve-editor exports `GRAPH_SCALE_TOOL`, `graphViewModeOperator(focused)`, `nextViewMode`, `GraphEditorController.onViewModeChange` and `staticRenders`, an optional `layers` argument of `CurveRenderer.renderBase`, and `GraphToolHost.pressScale`; the editor's Graph test hooks gain `viewMode` and `screenOfRegionHandle`. A0's `GRAPH_VIEW_MODE_OPERATOR` stub constant is replaced by `graphViewModeOperator(focused)`: the operator acts on the focused controller, like `graph.frame`. | The contract PR to M2A-SPEC §8 A4 is the integration agent's. |
| M2A-A4-13 | **Half-cycle seam keys keep step flags.** §5.14 step 3 freezes the keys landed at s, m and e as `fixed`; a `step`/`stepNext` out type is not a handle but the interpolation flag of the span the key starts, and that span maps with the key (m's from s's, s's and e's from m's), so the flag is kept (also on a seam key inserted inside a step span, which takes the span's flag). Freezing it turned the spans after the seams into ramps (0.93–0.98 off on stepped curves). The in side and Bézier out sides are frozen as specified. Proposed spec wording for the integration agent: "…get their resolved handles as `fixed` (a `step`/`stepNext` out type stays)". | §5.14 "tangent types are copied"; FR-POSE-05 gate on stepped `@ikFk` and blocked walk cycles. |
| M2A-A4-14 | **Half-cycle working copy, two refinements of step 1.** (a) Weighted curves: frozen handles are the ones the engine started from (stored for `fixed` sides, a third of the span along the resolved slope otherwise), not the compiled ones, which carry AnimX's monotonic-X correction of overlong handles; that correction is not idempotent (a corrected handle sits ε inside the bound, where a second correction may take the other branch: 7.9e-6 off). (b) A `cycle`/`cycleOffset`/`oscillate` infinity that reaches into [s, e] is written out as copies of the key range before the seam inserts (values from the source curve's evaluation, resolved handles, step flags per span, reversed copies for odd oscillations; the original end keys frozen), because the shape-preserving insert cannot keep a cycle (its range changes). Known limits, documented in the code and the property tests: a `cycle` whose end values differ jumps at every cycle boundary (no keys can follow it); a reversed (oscillate) copy of a weighted span AnimX corrected is approximate (AnimX keeps a span's first handle); on corrected weighted spans anim-core's split and cycle mapping are accurate to a few 1e-9 (worst 6.2e-9 in 10⁵ random curves), so the property allows 1e-7 there and 1e-9 everywhere else (worst seen 1.6e-13). | FR-POSE-05 exactness for the curves §5.14 calls periodic. |
| M2A-A4-15 | **Key-edit gestures record override changes.** `beginKeyEditGesture` notes the session overrides and the active location when it begins; its commit records the override delta (when the location is unchanged) in the same history step, like the operator runner. So a Tween slider drag that keys overridden channels undoes to the override and the pose, and redo drops it again (MVP-SPEC §4.11.1 rule 5). | §4.11.1 rule 5, undo exactness. |
| M2A-A4-16 | **M-1 changes outside A4's directories** (all small, behaviour-preserving, tested; for the integration agent's merge order): `editor/src/panels/viewport/PaneView.tsx` (HUD text, A2), `curve-editor/src/timeline/TimeSliderController.ts` (`onBatch`, A3), `editor/src/panels/timeline/state.ts` (A3), `editor/src/hooks/useDocQuery.ts`, `viewport/src/manager/ViewportManager.ts` and `viewport/src/sync/SceneSync.ts` (store listeners, A2), `editor-core/src/characters/registry.ts` (store listener); `doc` exports `batchTables`/`batchTouches` (additive). | M2A-SPEC §5.21.1 gate; §8.1 ownership. |
| M2A-A4-17 | **Value-only key drags.** `KeyMoveGesture` writes `v + Δv` (and the key's own `t + 0`) on curves whose shown keys are all dragged, no two closer than 2e-3 frames, when the snapped time delta moves none of them; `moveKeys` writes exactly that there (no fixed neighbour to stop at, no keys to merge, its block shift turns −0 into +0). Other curves take `moveKeys` as before. | M-1; a test compares the document with `moveKeys` applied directly. |
| M2A-A4-12 | **Not done here (owners)**: `graph.keys.scale {valuePivot, valueFactor}` (A3's `graph.ts`, through `scaleKeyValues`); the Dope Sheet's Tween bar mount (A3); unit-aware Graph Editor key fields for `@attr` angle channels (display in `panels/graph/model.ts` and commit through `graph.keys.setFields`/`moveKeys` must change together: A2/A3); the time slider's per-batch `tickSet` (A3; fix round 1 made it skip value-only batches, M2A-A4-16). | §8.1 ownership. |

## Literal updates (§3 rule 8)

| Test | Literal | Contract row |
|---|---|---|
| `editor-core/test/builtin/m2a-operators.test.ts` | `key.tween`, `key.convert`, `pose.mirrorAnimation`, `graph.buffer.*` left the stub list | §4.9 |
| `editor-core/test/kernel/m2a-foundation.test.ts` | `tweenEdits` and `scaleKeyValues` no longer throw `not-implemented` | §4.5 |
| `curve-editor/test/contributions.test.ts`, `editor/test/panels/graph.test.tsx` | the Graph Editor tools include `scale`; "More ▾" has the two Convert items | §4.5 `GRAPH_TOOL`, §7 |
| `apps/web/e2e/acceptance-round1.spec.ts` ("More menu closes …") | "More ▾" holds 7 one-line items (was 5): the two Convert items | §7 Graph Editor toolbar, §4.8 `ge-convert-*` |
| `apps/web/e2e/m2a-00-foundation.spec.ts` | the four A4 operators left the stub list; `view.tool {graph, scale}` finishes; the status-line Tween bar's probe answers | §4.9, §4.5, §4.8 |

## Fix round 1

Review of `06a880e` found one blocker and three majors; all fixed:

| Finding | Fix | Commit |
|---|---|---|
| Blocker: M-1 gate missed on the bench of record (first drag p95 5.0–5.8 ms) | First-drag frame cuts above; `budgets.bench.ts` p95 3.2–3.7 ms in 8 runs at load 5.0–7.9 | `70f63a7`, `fcccf3c`, `81f5695`, `f100176`, `954551e` |
| Half-cycle mirroring broke stepped curves (0.93–0.98 off) | Seam keys keep `step`/`stepNext` out flags (M2A-A4-13); found by the new properties too: corrected weighted handles and cyclic infinities (M2A-A4-14) | `36af8bc` |
| Undoing a Tween slider drag lost the overrides it consumed | Key-edit gestures record the override delta in their step (M2A-A4-15) | `440ab06` |
| §9.2 fast-check properties for the mirror kernel missing | `m2a-a4-mirror-properties.test.ts`: gate on random periodic curves (400 runs; stressed with 6,000 ×3), cyclic infinities, order, non-periodic flag, twice = identity, flip ∘ flip = id through the operator | `36af8bc` |
| Minor: E2E-M2A-17 checks 30° → 0° at 1e-5 | Unchanged; why float32-exact pointer points cannot make the factor exact, and the contract PR left to the integration agent: M2A-A4-10 | — |

The A4 bench now also reports the gate's first (cold) drag next to the warm drags (`m2a-a4.bench.ts`).

## Gates (fix round 1)

At `954551e` plus these notes, 2026-10-18, worktree clean before the runs:

| Gate | Result |
|---|---|
| `pnpm run format:check` | clean (800 files) |
| `pnpm run lint` | clean (no diagnostics) |
| `pnpm run typecheck` | clean |
| `pnpm run check:deps` | 13 packages follow the rules |
| `pnpm exec turbo run test test:tooling --force` | 13/13 tasks: anim-core 642, rig 124, doc 189, doc-yjs 69, editor-core 586, viewport 86 (+1 skipped, M1), io 142, curve-editor 156 (+3 skipped, M1), editor 297 (+1 skipped, M1), ui 73, headless-tests 108, tooling 14 |
| `pnpm exec turbo run build --force` | green |
| `EKZA_E2E_PORT=3144 pnpm run test:e2e` | 70 passed, 4 skipped: E2E-M2A-15 (`test.fixme('A1,A2')`) and the three M1 stretch skips; E2E-M2A-13, 16, 17 and every M1 spec green |
| `budgets.bench.ts` (DPR 2, real Chrome), all 9 benches | green; Graph Editor drag 2.50 / 3.30 ms at load 6.9 (gate ≤ 4.0: **Met**; 8 single runs at load 5.0–7.9: p95 3.2–3.7 ms); idle 0 GL frames / 0 2D calls |
| `m2a-a4.bench.ts` | first drag 2.0–2.5 / 3.4 ms; warm 1.7–1.9 / 2.3–2.4 ms; Tween slider 2.3–2.4 / 2.9–3.0 ms (load 6.1–6.8) |
| Doc bench preview update (1,000 keys) | 0.67–0.74 ms (target ≤ 1.0: **Met**) |

## Gates (build round)

At `dbdab85` on `m2a/graph-posing` (A0 merged; `m2a/contracts-foundation` has nothing newer), 2026-10-18:

| Gate | Result |
|---|---|
| `pnpm run format:check` | clean (794 files) |
| `pnpm run lint` | clean (no diagnostics) |
| `pnpm run typecheck` | clean |
| `pnpm run check:deps` | 13 packages follow the rules |
| `pnpm run test` | 13/13 tasks: anim-core 642, rig 124, doc 185, doc-yjs 69, editor-core 574, viewport 86 (+1 skipped, M1), io 142, curve-editor 153 (+3 skipped, M1), editor 296 (+1 skipped, M1), ui 73, headless-tests 108, tooling 14 |
| `pnpm run build` | green |
| `EKZA_E2E_PORT=3144 pnpm run test:e2e` | 70 passed, 4 skipped: E2E-M2A-15 (`test.fixme('A1,A2')`) and the three M1 stretch skips; E2E-M2A-13, 16, 17 green; E2E-08…13 unchanged and green |
| Bench `m2a-a4.bench.ts` (DPR 2, real Chrome) | M-1 warm drags median 3.00 ms, p95 3.50 ms at load 6.8 (the bench of record's first drag missed: fix round 1); Tween slider 2.90 / 3.40 ms |
| Doc bench preview update (1,000 keys) | 0.76–0.88 ms (target ≤ 1.0: **Met**) |

The measuring machine was shared with five other agents' builds and e2e runs (load averages up to 66); the bench
waited for a 1-minute load below 7. Scratch logs of parallel agents share one scratchpad, so the gate logs of this
package were written to a directory of its own.
