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

## M-1 after the mechanisms

Same bench, same machine, after the six mechanisms (commits `5763657`, `f684f8d`), load average 6–12:

| | median | p95 | verdict |
|---|---|---|---|
| Graph Editor drag, 1,000 keys (gate p95 ≤ 4.0 ms) | 3.30 ms | 3.60 ms | **Met** (load 5.9) |
| doc bench preview update, 1,000 keys (≤ 1.0 ms) | 1.03–1.19 ms at load 15–21 | — | see below |
| Tween slider drag, 60 channels (§5.22, ≤ 4 ms) | 2.90 ms | 3.30 ms | Met (load 10) |

Frame split per move after the mechanisms (profiled): store preview update 0.86 ms (was 1.95), Graph Editor redraw
0.69 ms (1.03; the bench drags 30 curves, all of them dynamic, so the static layer saves the grid, labels and the
other curves only), pose evaluation 0.22, viewport GL 0.21, curve set 0.11, pose sync 0.07, curve compile 0.04,
coalesced updates 0.01, other 1.00 ms. "Other" is now led by the time slider's `tickSet` (0.32 ms per move: the
tick list of every key of the band's curves rebuilt on every preview batch; `curve-editor/src/timeline`, A3's
file — an incremental tick set or one that skips preview batches would remove it) and `getBoundingClientRect`
(0.29 ms, layout reads of the panes).

The doc bench (`packages/doc/test/bench.test.ts`, unchanged: median of 10 updates of a fresh preview, patch path)
measured 2.09 ms before and 1.03–1.19 ms after at load averages 15–21 (other agents' builds); a Node CPU profile of
600 updates puts the update at ≈ 1.1 ms with the profiler. The ≤ 1.0 ms target is for an idle measuring machine
(load < 8); re-measure there (`pnpm --filter @ekza-animator/doc exec vitest run test/bench.test.ts`).

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
every drag preview batch (`panels/graph/committedQuery.ts`); during a drag the fields keep their pre-drag values.

## What landed

| Spec | Where | Tests |
|---|---|---|
| §5.13 tween family | `editor-core/src/edit/tween.ts` (`tweenEdits`, plan/evaluate split, `beginTweenGesture`, `resolveTweenTarget`), `operators/builtin/tween.ts` (`key.tween`) | `test/kernel/m2a-a4-edit.test.ts`, `test/builtin/m2a-a4-operators.test.ts`, `editor/test/panels/tween-bar.test.tsx`, E2E-M2A-13 |
| §5.12 breakdowns | `operators/builtin/breakdown.ts` (`key.convert`), Graph Editor ◇ glyphs (`painters/keys.ts`) | operators, `curve-editor/test/m2a-graph.test.ts` |
| Tween bar | `editor/src/panels/shared/TweenBar.tsx` (status line: compact, presets and overshoot in "⋯"; Graph Editor toolbar: full) with the `tween.<panel>` probe | `tween-bar.test.tsx`, E2E-M2A-13, the status-line slot in E2E-M2A-00 |
| §5.14 mirror animation | `editor-core/src/workflows/mirrorAnimation.ts`, `operators/builtin/mirrorAnimation.ts` | operators (channel rule, flip involution, side-C scope, secondary controls, locked channels, the half-cycle cases incl. 0/9/15/24 auto keys, cyclic infinities, odd ranges, weighted and spline curves with the AnimX engine, non-periodic warning), `headless-tests/test/ops.m2a-a4.test.ts` (Seed-san), E2E-M2A-15 (fixme A1,A2) |
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
| M2A-A4-10 | **E2E-M2A-17 factor**: Chrome delivers pointer coordinates as float32, so the value factor of a drag released at the exact midpoint is 0.5 only to ~1e-7. The scenario computes the factor from the delivered coordinates (`Math.fround`) as §9 says ("the spec computes the expected values from the pre-drag keys"), checks every value against it at 1e-9, −30° unchanged at 1e-9 and 30° → 0° at 1e-5. | Exactness at 1e-9 is not reachable with float32 events. |
| M2A-A4-11 | **Contract additions (additive)**: editor-core exports `beginTweenGesture`, `resolveTweenTarget`, `clampTweenAmount`, `TWEEN_MODES`, `TWEEN_LIMIT`, `TWEEN_OVERSHOOT_LIMIT`, types `TweenGesture`, `ResolvedTweenTarget`, and `compileWithAppEngine` (buffer curves draw with the app's engine); curve-editor exports `GRAPH_SCALE_TOOL`, `graphViewModeOperator(focused)`, `nextViewMode`, `GraphEditorController.onViewModeChange` and `staticRenders`, an optional `layers` argument of `CurveRenderer.renderBase`, and `GraphToolHost.pressScale`; the editor's Graph test hooks gain `viewMode` and `screenOfRegionHandle`. A0's `GRAPH_VIEW_MODE_OPERATOR` stub constant is replaced by `graphViewModeOperator(focused)`: the operator acts on the focused controller, like `graph.frame`. | The contract PR to M2A-SPEC §8 A4 is the integration agent's. |
| M2A-A4-12 | **Not done here (owners)**: `graph.keys.scale {valuePivot, valueFactor}` (A3's `graph.ts`, through `scaleKeyValues`); the Dope Sheet's Tween bar mount (A3); unit-aware Graph Editor key fields for `@attr` angle channels (display in `panels/graph/model.ts` and commit through `graph.keys.setFields`/`moveKeys` must change together: A2/A3); the time slider's per-batch `tickSet` (A3, 0.32 ms of the M-1 frame). | §8.1 ownership. |

## Literal updates (§3 rule 8)

| Test | Literal | Contract row |
|---|---|---|
| `editor-core/test/builtin/m2a-operators.test.ts` | `key.tween`, `key.convert`, `pose.mirrorAnimation`, `graph.buffer.*` left the stub list | §4.9 |
| `editor-core/test/kernel/m2a-foundation.test.ts` | `tweenEdits` and `scaleKeyValues` no longer throw `not-implemented` | §4.5 |
| `curve-editor/test/contributions.test.ts`, `editor/test/panels/graph.test.tsx` | the Graph Editor tools include `scale`; "More ▾" has the two Convert items | §4.5 `GRAPH_TOOL`, §7 |
| `apps/web/e2e/m2a-00-foundation.spec.ts` | the four A4 operators left the stub list; `view.tool {graph, scale}` finishes; the status-line Tween bar's probe answers | §4.9, §4.5, §4.8 |

## Gates

Recorded at the end of the package (see the final section).
