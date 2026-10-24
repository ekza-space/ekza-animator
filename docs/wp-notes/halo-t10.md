# Halo T10 — Curves and History (`halo/t10-curves`)

Work package T10 of [STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §21 (v0.2, [ADR 0023](../adr/0023-studio-touch-ui.md)):
§10.3 (the ruler), §10.5 (Curves), §6.2 *History step*, §12.9, §14 (Ask), §20.3 item 18 (the focus registry), §9 J4 and
J8, §22 (ha-07, ha-J4, ha-J4f, ha-J8, AS-ST-4, AS-ST-5). Branch off `dev` `22b007b6` (T0–T7); `origin/dev` `b045af2f`
(T11: Home, intake, Share) merged at `dc7bb263`. Decisions:
[DECISIONS-OPEN §P · T10](../DECISIONS-OPEN.md), rows `ST-T10-RULER` and `ST-T10-1` … `ST-T10-20`.

## What landed

| Part | Files | What |
|---|---|---|
| The ruler (owner, first priority) | `halo/src/thread/strip/{model.ts,ThreadStrip.tsx}` | ST-T10-RULER, owner 2026-10-24: "a tick on every frame". The classic animation time slider, read the way Studio Pro's time slider reads: a tick on every frame (every 2nd, then 5th … below 3 px a frame), taller numbered ticks every 5th or 10th frame by the zoom (every frame zoomed in, half-height ticks between numbers), the first and last frame always numbered, numbers that never overlap, the playhead on whole frames with its number in a box, the selection's keys as red marks (white selected, green in-betweens), no beat ticks; under *Seconds* the ticks stay on frames and the numbers read seconds. `rulerMarks` is pure |
| Curves, layer 2 | `halo/src/thread/curves/{CurvesLayer.tsx,CurveHalo.tsx,KeyChips.tsx,model.ts,probe.ts}` | Pro's `GraphEditorController` behind the new adapter, shown 1.8× (the Keys layer's scale), in the shared focus registry; header (the active animation, the listed part, channel chips, *Only keyed* and a filter for several parts, ⇆ Before), tools (*Select · Move · Insert · Scale*, ⟨Axis⟩, the docked key Halo), the curves with their own time axis (frames by default, ST-T7-UNIT), foot (⟨Time⟩ ⟨Value⟩ ⟨In⟩ ⟨Out⟩ (+ weights) and the curve's Halo: *Ease all ▾ · Fewer keys · Fix flips · Cycle ▾ · Insert key · ⋯*). A lazy chunk; rows scroll sideways on a phone |
| The graph adapter | `curve-editor/src/adapters/graph.ts` | `attachGraphEditorTouch`: fingers and the Pencil (marquee, key and handle drags on one axis, a long-press for the key's menu, two-finger pan and per-axis pinch, double-tap framing through `graph.frame`), the mouse as Pro's; §5.4's radii per pointer type, divided by the scale, the mouse's restored on detach |
| The focus registry | `curve-editor/src/focus.ts` (moved), `editor/src/panels/graph/focus.ts` (Pro's one-line re-export) | §20.3 item 18: Pro's Graph panels and Halo's Curves share one registry; `GraphEditorHandle.scale?` |
| History | `halo/src/sheets/history/{HistorySheet.tsx,AiGroupCard.tsx,actions.ts,model.ts,requests.ts,index.ts}`, `halo/src/history/{probe.ts,undoPress.ts}` | The History ribbon: ↶'s long-press (and project menu › History); redo on top, *Now*, the steps; selection steps folded into the next step; an AI run as one group titled with its request; *Undo to here*, *Redo to here*, *Compare* (hold), *Revert this*, *Adjust*, *Show*, ⋯ More; a group's *Undo all* (M-AI-INT-7), *Compare*, *Steps ▾*; *Copy as text* |
| Ask | `halo/src/sheets/ask/{AskSheet.tsx,index.ts}`, `editor/src/agent.ts` (widened) | Search › *Ask AI*: the request, the connection, the pairing card with plain grants and *Allow*, confirm prompts inline, the activity line, the latest AI group (*Undo all*), *Take back every AI change*, *Restore the project as it was before the AI*; Safari says the assistant runs on a computer and offers the recipes |
| T7 patches | P-T7-1 `editor-core/src/operators/builtin/uiWrapperChunk.ts` (`loadReachSolver`) + `stages/animate/reach.ts`; P-T7-2 `manifest/sheets.ts` (`touch`), `shell/Sheets.tsx`, `stages/animate/start.ts`, `sheets/library/LibrarySheet.tsx`; P-T7-3 `test/rules.test.ts`; P-T7-4 (this package); P-T7-8 `anim-core/src/params/types.ts` + M6A-SPEC §4.1 (`ParamDef.time`), `editor-core/src/forms/defs.ts`, `chips/{EchoChips,FormChips}.tsx` | Reach previews the solved limb while dragging; sheets count touches through the frame; the vocabulary lint covers the Animate words; frame-count chips read Settings › Time |
| Manifest | `manifest/{types,sheets,sheetLoaders}.ts`, `searchOnly.baseline.json` | `BUILT_OWNERS` + T10; History's and Ask's sections and lazy loaders (prefetched with the others); the baseline lowered to 41 |
| Tests | `halo/test/{t10-curves-history,curves-journey}.test.ts`; `curve-editor/test/{graph-touch-adapter,focus}.test.ts`; `apps/web/e2e/{ha-07-curves,ha-J4-curves,ha-J8-ask}.spec.ts`, `e2e/helpers/halo-curves.ts`; ha-06 gains the ruler and the Reach preview | below |

### The touches, as counted

| Journey | Target (AS-ST-4) | Measured | Steps |
|---|---|---|---|
| J4 Fix foot sliding and polish a walk with curves (ha-J4, the Pencil where it fits) | ≤ 10 | **10** | the L foot's control · *Curves* · *Move Y* (3); a marquee over the contact keys · *Ease ▾* · *Flat* · ⟨Value⟩ numpad 0 (4); hold *⇆ Before* · *Cycle ▾* · *Repeat* (3) |
| J4 finger-only (ha-J4f) | ≤ 10 | **10** | the same with fingers |
| J8 Ask the AI agent, then review or undo its steps (ha-J8) | 4–5 | **5** | search · the request (its first letter) · *Ask AI* (3); the agent claims the code (a fake session) · *Allow* (1); five AI steps · *Undo all* (1) |

## Exit test (§21 T10)

| Check | Result |
|---|---|
| J4 ≤ 10, finger-only, from a fresh project with the real defaults | **10** (ha-J4f), 10 with the Pencil (ha-J4): Seed-san from `file.loadSample` with the library's Walk (`library.useClip`, setup), nothing curated |
| *Revert this* and *Undo all* on AI groups (J8) | ha-J8: *Undo all* in the Ask sheet takes the agent's five steps back (one `edit.revertSteps`; the clips and counts equal the ones before); a second run, reviewed in the History ribbon (↶'s long-press): *Steps ▾* › the pose at frame 30 › *Revert this* (`Revert AI step: … f30`; the keys at 45 stay), then *Undo all* there |
| ha-07, ha-J4, ha-J4f, ha-J8 on `chrome-touch`, booting on `webkit-ipad` | Green in the final gate on `chrome-touch`: ha-07 (4 tests: the layer and its chips, Select more, the axis in frames, the focus registry; a time-locked key drag as one step, pinch, double-tap, long-press, the Insert tool, the axis strip; the curve's Halo and ⇆ Before; the axis and the Time chip in seconds), ha-J4, ha-J4f, ha-J8; `webkit-ipad` boots Curves and taps a chip (ha-07, ha-J4) and shows Ask's honest card (ha-J8) |
| Exports byte-equal to Pro's for J4's operator sequence (AS-ST-5) | `curves-journey.test.ts` (headless, production kernel, Seed-san + Walk): Halo's calls built by its own modules (the chip's `select.channels`, the key Halo's *Ease ▾ › Flat*, the ⟨Value⟩ chip's `graph.keys.setFields {value: 0}`, the curve Halo's *Cycle ▾ › Repeat*) export the same VRMA bytes as Pro's Graph Editor's (toolbar Flat, the Value field's "0", Pre and Post infinity as two runs) |
| `searchOnly` at or below the T10 target | **41** (target 41): explicit 4, pending 37; 303 reachable without search (from 289) of 352 live; regenerated by `ha-parity` (`EKZA_HALO_PARITY_WRITE=1`) after the T11 merge. Targets left: T8 25, T9 20 |

## Measurements

Production build of the final gate (`check:size`, gzip -9, first visit), against merged `dev` (T7 + T11) measured the
same way:

| Route | Merged dev | T10 | Gate (SIZE-1) | Target (report-only) |
|---|---|---|---|---|
| `/editor` | 897,482 B | **898,843 B** (+1,361) | 5,000,000 B — OK | 850,000 B |
| `/autorig` | 657,839 B | **657,840 B** (+1) | 5,000,000 B — OK | 620,000 B |
| `/app` | 722,865 B | **726,555 B** (+3,690) | 5,000,000 B — OK | 660,000 B |

- `/app`: the ruler, ↶'s press, the History probe, *Ask AI* in search and the History and Ask words; Curves, History and
  Ask are lazy chunks.
- `/editor`: the Graph Editor controller's three switches and the curve editor's graph modules gaining a second
  importer (Halo's Curves chunk), which costs `/editor` bytes as AR-D3-1 found; no Halo module loads on `/editor`.

The curve editor stays a lazy chunk on `/app` (ha-12's first test: an empty `/app` never loads it); the Curves layer,
History, Ask (and the agent module inside it, `import()` only) are lazy chunks.

## Gate

`EKZA_E2E_PORT=3187 pnpm run ci` on the branch head: format, lint, typecheck, deps, fixtures, licences, unit tests
(Halo 210, curve editor 26 files, editor-core 1,821, headless 225), the production build, `check:size` and e2e —
**green, 521 passed, 132 skipped, 0 failed**. The first run stopped at the unit tests while another worktree's e2e
held the machine (load average 48): `halo-t5c-subpaths` was real (it pins `./agent`'s exports; updated for
ST-T10-13), and the rest — the editor's shell, dialogs, input and outliner click timeouts and rig's 30 s allocation
test — passed alone and in the second run.

## Lines outside the row

The row is `halo/src/thread/curves/**`, `curve-editor/src/adapters/graph.ts`, `curve-editor/src/focus.ts` (with
Pro's one-line re-import), `halo/src/sheets/history/**`, the e2e specs and the test-API slice. The coordinator added
`halo/src/thread/strip/**` (the ruler). Outside them, each the smallest seam-shaped change:

| File (owner) | Lines | Why |
|---|---|---|
| `curve-editor/src/graph/GraphEditorController.ts`, `graph/scene.ts`, `painters/grid.ts` | `setFrameLabels`, `setShowBuffers`, `navigate`; the scene's `frameLabels?`; the grid skips its frame numbers when told | ST-T10-3 (Pro's defaults unchanged) |
| `curve-editor/src/index.ts` | export lines | the barrel |
| `editor/src/agent.ts` (T5c) | export lines (runtime, session, `pillView`, `AGENT_SHOW`) | ST-T10-13, Ask and History |
| `editor-core/src/operators/builtin/uiWrapperChunk.ts`, `editor-core/src/index.ts` | `loadReachSolver`, `ReachSolver` | P-T7-1 |
| `anim-core/src/params/types.ts` + `docs/M6A-SPEC.md` §4.1 | `ParamDef.time?: 'frames'` | P-T7-8, ST-T10-17 |
| `editor-core/src/forms/defs.ts` (T5a) | `time: 'frames'` on five form params | P-T7-8 |
| `halo/src/chips/{EchoChips,FormChips}.tsx` (T6a) | `chipOf(param, time)`; the forms' read-only time in Settings › Time's unit | P-T7-8 |
| `halo/src/stages/animate/{AnimateDock,DockedHalo,ui,slice,start,reach}.ts(x)` (T7) | the Curves layer in place of the stand-in, the dock's DockedHalo / Animations row give way in Curves; a key count in the key Halo's title; its ⋯ More opens the frame's More; the `curves` probe in the slice; the Library's wrapper registration removed; Reach's preview | P-T7-4, P-T7-1, P-T7-2 |
| `halo/src/sheets/library/LibrarySheet.tsx` (T7) | `CountingSheetContext` is the frame's context | P-T7-2 |
| `halo/src/i18n/{animate,en}.ts` | the Curves, History, Ask and *Ask AI* words | the catalogues |
| `halo/src/manifest/{types,sheets,sheetLoaders}.ts`, `searchOnly.baseline.json` (T6b) | `BUILT_OWNERS` + T10; `HaloSheetContext.touch` / `openMore`; History's and Ask's sections and loaders; the baseline | P-T6B-5, P-T7-2 |
| `halo/src/shell/Sheets.tsx` (T6-INT) | the stage sheets render from their loaders; `touch` and `openMore` | P-T7-2 |
| `halo/src/shell/{Frame,TopBar}.tsx` (T6a) | ↶'s long-press (`useUndoPress`); the search pill counts | P-T6A-4, J8 |
| `halo/src/shell/controller.ts` (T6a, T11) | the `history` slice | the test API |
| `halo/src/halo/HaloLayer.tsx` (T6a) | the breadcrumb stays above the dock | Keys and Curves unfold over a selected foot |
| `halo/src/palette/Palette.tsx` (T6a, T11) | *Ask AI* for any query; the query's first letter counts | §8, §14, J8 |
| `halo/src/history/{probe,undoPress}.ts` (new) | eager seams: the History probe and ↶'s press | the test API, P-T6A-4 |
| `halo/test/rules.test.ts` (T6-INT) | the vocabulary lint over `animateWords`; the Ask grant's words | P-T7-3 |
| `halo/test/animate-model.test.ts`, `apps/web/e2e/ha-06-thread-keys.spec.ts`, `e2e/helpers/halo-animate.ts` (T7) | the ruler's tests; the Reach preview test; the probe's type | ST-T10-RULER, P-T7-1 |
| `docs/STUDIO-TOUCH-SPEC.md` | §10.3 *Scale and units*, key marks, playhead; §10.5 as built; J4 (*Cycle ▾ › Repeat*, measured), J8 (measured) | the spec follows the code |

## Patches for T12

| # | File (owner) | Patch | Why |
|---|---|---|---|
| P-T10-1 | `docs/STUDIO-TOUCH-SPEC.md` §20.2 (T12) | The files as built: `thread/curves/{CurvesLayer,CurveHalo,KeyChips,model,probe}`, `sheets/history/{HistorySheet,AiGroupCard,actions,model,requests}`, `sheets/ask/AskSheet`, `history/{probe,undoPress}` | the spec follows the code |
| P-T10-2 | frame (T12, owner) | Numbers pinned beside the curves at ≥ 1180 pt (§10.5, wireframe D) needs a second slot or a column component (ST-T10-20) | not built |
| P-T10-3 | `shell/TopBar.tsx` (T12) | §14's live activity line under the search pill: Ask shows it; the top bar could read the agent's `pillView` through an eager slot like the probes | the agent module is lazy |
| P-T10-4 | `editor/src/agent/session.ts` (M-AI) | The session never fills `beforeAgent`; Halo keeps its own snapshot at *Allow* for *Restore before the AI*. Taken by the session before an agent's first edit, Pro's panel could offer it too | ST-T10-12 |
| P-T10-5 | `curve-editor/src/timeline/layout.ts` (owner decision) | Pro's time slider keeps its 1-2-5 numbers and 6 px minor ticks; the owner's rule (ST-T10-RULER) could become Pro's too | both shells read the same today, not identically |
| P-T10-6 | `docs/FEATURES.md` (T12) | §15.8 rows 8.16–8.21 (Curves), 12.7 and 12.9 (History), 13.x (Ask) are Simple-layout surfaces now | FEATURES refresh |
| P-T10-7 | Halo (T12, optional) | *Open in the Pro layout ▸* from Curves arriving on Pro's Polish preset (`then: preset`): Halo offers the More sheet's generic hand-off | §10.5 convenience |

## Follow-ups

- The graph's framing follows the canvas's height when the shown set changes; a later height change (the docked row
  appearing on a phone) keeps the view, as Pro's does.
- Phone (best-effort): Curves fit with sideways-scrolling rows; the curves get about 100 pt.
