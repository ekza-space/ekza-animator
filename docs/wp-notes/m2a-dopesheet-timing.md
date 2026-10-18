# M2a A3 — Dope Sheet, time-slider extras, global-region ripple, breakdown retiming: build notes

Branch `m2a/dopesheet-timing` (from `dev`, with `m2a/contracts-foundation` merged). Scope:
[M2A-SPEC §8 A3](../M2A-SPEC.md#a3--dope-sheet-time-slider-extras-ripple-breakdown-retiming), §5.9–§5.12, §5.22.
The spec names this file `m2a-a3.md` (§3 rule 6); the work package's task asked for `m2a-dopesheet-timing.md`, as
A0's did, so the notes live here. Decision IDs below are `M2A-A3-<n>` for DECISIONS-OPEN §F.

## What landed (by spec responsibility)

| A3 item | Where |
|---|---|
| §5.11 global-region ripple | `editor-core/src/edit/keys.ts` (`rippleMovePlan`, `rippleScalePlan`, `rippleMoveShift`; `moveKeys`/`scaleKeys` take `KeyEditOptions.ripple` and a `RippleScope`), `editor-core/src/edit/ripple.ts` (new: `RippleScope`, `registerRippleControls`, `rippleScopeOf`, `defaultRippleControls`, `rippleCurves`) |
| §5.12 breakdown retiming | `place` → `retimeBreakdowns` in `edit/keys.ts`, inside `moveKeys` and `scaleKeys` (ripple and band edits included) unless `retimeBreakdowns: false` |
| `copyKeys`, `insertTime`, `keysInRemovedTime` | `edit/keys.ts` (replace A0's stubs) |
| Operators | `operators/builtin/time.ts`: `key.toggleRipple`, `time.setFrame {carry}` (one "Carry Pose" step), `time.insertTime`, `time.deleteTime`; `operators/builtin/graph.ts`: `graph.keys.move`/`scale` `ripple` with the panel default, `valueFactor ≠ 1` poll-fails until A4, `graph.keys.paste {mode: 'insert'}`, `graph.keys.copyTo` |
| §5.9 time slider | `curve-editor/src/timeline/**`: Mod+drag copy of the band (`Copy Keys`), ripple band move/scale, MMB carry scrub, green breakdown ticks, `timelineTicks`/`screenOfBand` probe members, RMB items Ripple Edit (checkbox), Insert Frame, Remove Frame, Delete Time; `editor/src/panels/timeline/**`: MMB forwarding, `←`/`→` nudge (`graph.keys.move {dFrames: ±1, dValue: 0}`, ripple when on), the probe registration |
| §5.10 Dope Sheet | `curve-editor/src/dopesheet/**`: `DopeSheetController` (the §8 public API), `buildDopeSheetRows`, `holdIntervals`/`aggregateHolds`, `registerDopeSheetContributions` (`dopeSheet.frame`, the Select/Move/Scale tools, the ripple control set), painter, theme, layout; `editor/src/panels/dopesheet/**`: the eager wrapper with the `React.lazy` body, toolbar (`ds-show`, `ds-tool-*`, `ds-ripple`, `ds-snap`, `ds-frame-all`, the Tween bar slot), virtualized row labels (`ds-row-*`, `ds-expand-*`), focus tracking, the `dopeSheet` probe (null while the tab is hidden, A0's test-API rule) with `screenOfDopeKey`/`screenOfDopeRegion` |
| E2E | `apps/web/e2e/m2a-08…12`, `m2a-14` (fixme A2), helpers `e2e/helpers/m2a-timing.ts` |
| Benches (§5.22, report) | `curve-editor/test/dopesheet/bench.test.ts`, `apps/web/e2e/bench/m2a-a3.bench.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M2A-A3-1 | **Ripple control sets are registered per panel kind** (`registerRippleControls(app, panel, provider)`, newest wins, in the new `edit/ripple.ts`). The Dope Sheet registers the controls it shows (its `ds-show` set); the time slider uses the default rule (the selected controls of the clip's character, all when none). `graph.keys.move`/`scale`/`paste` take `ripple` from the argument, else `tools.ripple` when the run comes from the Dope Sheet or the time slider; the Graph Editor never ripples (M2A-D9). | Operators run from the keymap (the arrow nudge, paste insert) must ripple over what the focused panel shows (§5.11 "Scope curves") without the operator knowing the panel's controller. |
| M2A-A3-2 | **Paste insert is the default with ripple on** from the Dope Sheet or the time slider; an explicit `mode` wins. Keys of the §5.11 scope curves at or after the paste frame first shift by the clipboard span `t_last − t_first + 1`, later keys first. | §5.10 "with ripple on the paste inserts". |
| M2A-A3-3 | **`time.insertTime`/`time.deleteTime` target**: `'selected'` (default, the time slider's targets) or `'character'`; locked curves are skipped. Remove Frame poll-fails with the first doomed key ("A key at frame 11 would be deleted: use Delete Time"); `removeKeys: true` deletes them, and a curve losing its last key keeps its value at the current frame as `staticValue` (the `deleteKeys` rule). Delete Time without `range` uses the band (or the current frame) and clears the band, whose frames are gone. | §5.9; A0's contract (M2A-A0-1). |
| M2A-A3-4 | **Retiming details** (§5.12): non-edited breakdowns float during the clamp (they neither move with a run nor stop it) and are placed afterwards; when snapping would put two retimed breakdowns of one span on one frame, that span keeps exact times; when retiming would cross an edited breakdown, the curve keeps its unretimed placement with breakdowns as ordinary neighbours (the M1 clamp). | "Order is preserved" holds in every case; the property tests check it. |
| M2A-A3-5 | **The key-by-key scale clamp keeps a run's order** when one key would land on a neighbour while a later one overshoots it: both stop on the same whole frame before it (found by the new property test). | An overshoot must never delete a key (acceptance round 2) nor swap keys. |
| M2A-A3-6 | **`copyKeys` collisions**: a copy landing on a non-copied key's time replaces it, also in the drag preview (the preview shows the result); a copy landing on one of the copied keys' own times is not made. | §5.9 "on release a copy landing on a non-copied key's time replaces it". |
| M2A-A3-7 | **A press on a glyph whose keys are all selected keeps the selection** so it can be dragged; a click without a drag then narrows the selection to those keys (Shift toggles them off), the Graph Editor rule (INT-34). | Dragging a multi-glyph selection by one of its glyphs is the common Dope Sheet move. |
| M2A-A3-8 | **Region-bar handles** reach `REGION_HANDLE_PX` (6 px) outside the bar and at most a quarter of its width inside, so the middle of a narrow bar (a 1–3 frame selection at a zoomed-out view) can still be grabbed — the time slider's band rule. Before, a bar narrower than 12 px had no middle. | Found by the e2e bench, whose 1,000-key selection spans two frames. |
| M2A-A3-9 | **The Dope Sheet panel's lazy boundary**: the eager wrapper registers the contributions (so `dopeSheet.frame` and the D-scope tools exist before the first show) and mounts the `React.lazy` body once its box first has a size (dockview keeps an inactive tab mounted with its content detached). Show and the rows' expansion persist with the layout in the dockview panel parameters (`params.dopeSheet`). | §5.21.2 lazy boundary 4 (A5 verifies it); §5.10 "persisted with the layout". |
| M2A-A3-10 | **MMB carry** records one editor-history step labelled `Carry Pose` at the release frame (before: no overrides, after: the carried values); `Mod+Z` drops the carried pose and keeps the frame. | §5.9, the stated exception to MVP-SPEC §4.11.0 runner rule 7. |
| M2A-A3-11 | **`moveKeys`/`scaleKeys` place only the slice of a curve an edit can change**: the moving keys' time span widened over the adjacent breakdowns to the first non-breakdown key on each side. Keys outside it can neither move, stop a run, collide nor anchor a retimed breakdown, so the results are unchanged: a differential fuzz (8,000 runs of moves, scales, ripple, retiming, snapping, drag and final updates on curves of up to 24 keys) matched the full placement before the full path was removed. | A Dope Sheet drag of a few keys on hundreds of dense curves paid a pass over every key (§5.22). |
| M2A-A3-12 | **Dope Sheet row data** is cached per list of row curves (the summary and character rows share theirs): glyph times and counts and the holds rebuild only when one of the row's curves changed; selected counts come from the selected keys (hidden duplicates excluded), not a selection lookup per key; a key move keeps the rows (no label re-render per drag frame); glyph diamonds are rects in a 45°-rotated frame (Chrome built the four-line polygon paths at ≈ 5 µs per glyph). `collectTicks` (time slider) counts whole-frame keys in dense arrays and takes selected ticks from the selected keys. | §5.22 redraw and drag budgets. |

## Gated on other packages (§3 rule 4)

- **A2**: E2E-M2A-14 (`Alt+S` is A2's `key.set {breakdown}`; `key.convert` is A4's) and E2E-M2A-10b (a control
  hidden by the IK/FK rule is listed dimmed) are `test.fixme('A2')`. The dimmed-row rendering and the rule-1 case
  (session-hidden controls) are covered by `curve-editor/test/dopesheet/rows-holds.test.ts`.
- **A4**: `graph.keys.scale` with `valueFactor ≠ 1` poll-fails "Scaling key values is not available yet" until
  `scaleKeyValues` lands; the Dope Sheet toolbar mounts `<TweenBar panel="dopeSheet" />`, which renders A0's empty
  stub until A4's component lands. Preferred merge order: after A4 and A2 (§10.1).

## Shared files touched (additive)

`editor-core/src/index.ts` and `curve-editor/src/index.ts` (exports), `editor-core/src/edit/ripple.ts` (new),
`apps/web/e2e/m2a-00-foundation.spec.ts` (A0's: the A3 operators are no longer stubs and refuse with their own
reasons on a rig without keys; the Dope Sheet tab shows `ds-canvas`).

## Literal updates (§3 rule 8)

| Test | Literal | Contract row |
|---|---|---|
| `curve-editor/test/timeline/time-slider.test.ts`, `editor/test/panels/timeline/timeline-panel.test.tsx` | the RMB menu items and counts (10 → 14: Ripple Edit, Insert Frame, Remove Frame, Delete Time); the M1 "ignores MMB" case now scrubs with carry | §5.9 |
| `editor-core/test/builtin/m2a-operators.test.ts`, `editor-core/test/kernel/m2a-foundation.test.ts` | the A3 operators and kernel functions are no longer listed as stubs | §4.9 |
| `apps/web/e2e/m2a-00-foundation.spec.ts` | as above | §4.9, §5.10 |

## Tests added

| Package | File | What |
|---|---|---|
| editor-core | `test/kernel/m2a-timing.test.ts` | ripple scale with mixed per-curve bounds (`cog` 0/4/10, arm 0/6, ×2 → every later key +10), the band region, the global Δ < 0 stop (drag margin, whole-frame stop, landing), values untouched, default and registered scopes; retiming rules (ratio, half-up rounding inside `[t_a′+1, t_c′−1]`, exact time when no frame fits, unmoved anchors, `retimeBreakdowns: false`, edited and converted breakdowns, one anchor, scale and ripple, rounding collisions); the edited slice of a long curve (sparse move, run stops, scale); `copyKeys` collisions; `insertTime` (a breakdown before the insert point stays, removal, `keysInRemovedTime`); fast-check: retiming keeps order and values, one ripple offset, `insertTime` a uniform shift |
| editor-core | `test/builtin/m2a-timing-operators.test.ts` | the A3 operators: poll, apply, undo/redo, labels, panel ripple defaults, paste insert, `copyTo`, Remove Frame refusal, Delete Time, carry |
| curve-editor | `test/dopesheet/rows-holds.test.ts` | rows for the wave rig's groups, expansion, Show, dimmed rows, generic rigs; glyph aggregation and fractional merging; hold bars (channel rule, overshoot, the aggregate rule's cases, E2E-M2A-10's case, `holdIntervals`), stepped spans; row caching (a key move keeps the rows; selected counts follow moves and merged fractional times) |
| curve-editor | `test/dopesheet/controller.test.ts` | hit-testing and probe points, the narrow region bar, glyph clicks with modifiers, marquee, Mod+A, row double-click, key drags as one step (glyph, region middle and ends, MMB, Move/Scale tools), Esc and Alt, ripple (E2E-M2A-11), scrub, wheel per profile, Alt+MMB/RMB, framing, tools, painting at DPR 1 and 2, zero size |
| curve-editor | `test/timeline/m2a-time-slider.test.ts` | Mod+drag copy, ripple band move/scale/stop, MMB carry, ticks with breakdown and selection flags (whole frames and merged fractional times), band points, the menu |
| curve-editor | `test/dopesheet/bench.test.ts` | §5.22 benches (report) |
| editor | `test/panels/dopesheet.test.tsx`, `test/panels/timeline/m2a-timeline.test.tsx` | the lazy body, toolbar, labels, probe and persistence; MMB, nudge, probe members |
| apps/web | `e2e/m2a-08…12.spec.ts`, `m2a-14.spec.ts` | E2E-M2A-08…12 green; 14 and 10b `test.fixme('A2')` |

## Budgets (§5.22, report only)

Measured 2026-10-18 on the development Mac (Apple Silicon, real Chrome, DPR 2) while other agents built in parallel
(load average 11–35, so the numbers are noisy).

| Scenario | Budget | Result |
|---|---|---|
| Dope Sheet redraw, 450 curves × 200 keys (the 50 × 9 × 200 of the budget; unit bench on the production kernel, all frames shown) | ≤ 4 ms | view change median 0.20 ms, selection change 0.40 ms, one edited key 1.0–1.1 ms |
| Dope Sheet redraw in the editor (e2e bench: Seed-san, 165 keyed curves, 33,000 keys, 64 rows) | ≤ 4 ms | wheel-zoom frame median 0.40 ms (p95 0.60); a 100-key selection change frame (every panel that reacts) median 3.3–4.2 ms |
| Dope Sheet drag, 1,000 selected keys (unit bench, 450 × 200, 334 curves move every frame) | ≤ 4 ms per pointer frame | median 20–23 ms per frame: preview update 5.4–6.3 ms and compiling the moved curves 10.8–12.3 ms (both the shared M-1 path, §5.21.1), **the Dope Sheet's own redraw 3.8–4.5 ms** |
| Dope Sheet drag in the editor (e2e bench, 165 curves) | ≤ 4 ms per pointer frame | median 19.7–23.6 ms, p95 24–27 ms (pointermove handlers + the rendered frame) |

A CPU profile of the e2e drag (60 moves, sampling profiler on) splits a move into: pose evaluation 7.4 ms (the
sampler recompiling the 165 moved curves), store preview update 5.4 ms, the time slider 2.5 ms (≈ 2.2 ms of it the
store's key re-projection, which the first reader after an update pays), the Dope Sheet 2.1 ms, viewport render
1.4 ms. Before the A3 performance pass the Dope Sheet's redraw during the unit drag was 19.8 ms (diamond paths
13 ms, a selection lookup per key per row) and the time slider's ticks ≈ 4 ms per move (an object and a sort per
key). **The remaining miss is the shared M-1 path** (store preview update and projection, per-batch recompiles and
re-evaluation: §5.21.1 mechanisms 2–4 and 6, A4); the Dope Sheet's own share is at or under the budget.

Rerun: `pnpm --filter curve-editor exec vitest run test/dopesheet/bench.test.ts` and
`EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m2a-a3` (writes
`.acceptance/budgets/dope-sheet-redraw.json` and `dope-sheet-drag-1000.json`).

## Gates

`pnpm run format:check`, `lint`, `typecheck`, `check:deps`, `test` (all packages, browser mode included) and `build`:
green. The whole e2e suite on port 3143 (`EKZA_E2E_PORT=3143 pnpm run test:e2e`, real Chrome): 72 passed, 5 skipped
(E2E-M2A-14 and 10b `test.fixme('A2')`, three M1 stretch fixmes); E2E-23 (M1 time-slider retime) unchanged.
