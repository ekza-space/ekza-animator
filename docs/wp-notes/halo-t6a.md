# Halo T6a — the input grammar (`halo/t6a-grammar`)

Work package T6a of [STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §21 (v0.2, [ADR 0023](../adr/0023-studio-touch-ui.md)):
the touch shell itself — §4 anatomy, §5 input (gestures, Pencil routing, the Thumb key, numbers, the session bar,
keys), §6 the Halo (grammar rules, verbs → petals, More, breadcrumb, verb → target, kernel questions), §8 search, over
the foundation T0–T5c. Branch from `dev` `b58356a5`; `origin/dev` merged at `054b8789` (SIZE-1) and `ce66bd1e` (C2).
Decisions: [DECISIONS-OPEN §P](../DECISIONS-OPEN.md#p-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24) rows
`ST-T6A-1` … `ST-T6A-20`.

## What landed

Everything under `packages/halo/src` (T2's empty `HaloShell` is replaced; `index.ts` re-exports the shell and keeps the
frozen contract):

| Part | Files | What |
|---|---|---|
| Shell | `shell/{HaloShell,Frame,TopBar,Tray,Sheets,ProjectMenu}.tsx`, `shell/{controller,store,context,stage,mirror,keys,targets,prefetch,entry,coach,hooks}.ts` | The frame of §4.1 at three size classes by container width (§4.6): top bar (project menu with the unsaved dot, the Path, `⌕ Do or find…`, `Share ⤴`, `▤ Pro layout`), the single pane, the off-hand column (↶, the Thumb key) and the View puck on the other side, the tray (empty space's verbs docked, Make's selection level), sheets, search, toasts; Regular puts the Path on a second row, Compact makes it a bottom tab bar and docks the Halo as a verb bar. The controller: arrival (`?stage=`, Pro's workspace and the finer stage of P-T3-4, the session mirror), `host.mount({kind:'halo', leave, haloState})`, the shell-wide touch policy, the stage switch (commit, `edit.escape`, `workspace.set`, the stage's display overlay and default tool), the `halo` key scope, the dialog watcher, idle prefetch with `loadUiWrappers`, the lazy input chunk, the test API's `halo()` |
| Canvas | `canvas/{HaloPane,ViewPuck}.tsx`, `canvas/overlay.ts` | `pane-single` registered like Auto-Rig's wizard pane (Pro's camera memory); stage lighting through `setDisplayOverlay`; the puck (tap frames the selection, double-tap frames all, drag orbits, long-press the View sheet) |
| Input | `input/{arbiter,install,claims,thumb,situation,modifierMap,manipScale}.ts`, `input/ThumbKeyView.tsx` | T1's arbiter with Halo's config (§5.4 numbers, mouse multi-tap 500 ms, quick pinch unless *Reduce gestures*, palms) in a lazy chunk; whose a drag is (§5.1); the mouse's own override and right-click as the ring (the marking-menu seam); `gesturechange` ignored at two touches (C15); the Thumb key's modifier map, controller and view; the manipulator's touch scale with hysteresis (ST-T1-5) |
| Halo | `halo/{grammar,run,verbSource,geometry}.ts`, `halo/{HaloLayer,Breadcrumb,MoreSheet,TargetMode,icons}.tsx` | The grammar of §5.2 / §6.1 (below), the verb runner (forms, Echo chips, the reduced Halo, stage verbs), the stand-in verb source, the selection's on-screen box, the breadcrumb, the arc / ring / bar, the Loupe, Reselect, verb → target, the stand-in More list |
| Chips | `chips/{EchoChips,FormChips,NumpadPanel}.tsx` | After-run chips over `edit.adjustLast`; pre-run forms over `@ekza-studio/editor-core/forms` (lazy); the numpad (lazy) |
| Sessions | `session/{sessions.ts,SessionBar.tsx}` | `✕ Cancel · tool · hint · ✓ Done` (+ ⌫, − n +); built in: the extrude cap, pivot edit, Multi-Cut, Loop cut, Weld to…, Slide; `registerSession` for the stage packages; **leaving commits** (stage, ▤ Pro layout, Share, Home) |
| Dialogs | `dialogs/{map,watcher,answers}.ts`, `dialogs/ConfirmCard.tsx` | Every `UiDialog` → a Halo surface (§6.7): inline confirm cards (Bind again, Unbind, Use as rest pose), sheets, pickers, Home, Pro, deferred |
| Search | `palette/Palette.tsx` | Halo's own touch view over the host palette's data and ranking (`./overlays`), every operator in every stage (*switches to Rig*), things by name |
| Home | `home/Home.tsx` | The stub of §4.2 A (T11 builds the real one) |
| Words | `i18n/en.ts` | The only catalogue; the vocabulary lint is `test/rules.test.ts` |

### The grammar, as built

- **Tap** (finger, Pencil): the arbiter's `onTap` returns `'select'`, so the active tool gets the press as a click and
  selects exactly as in Studio Pro; the grammar then opens the Halo (an arc beside the selection's box) when the
  selection settles. A tap on the selected thing reopens it; on empty space it clears (Make and Rig record the undo
  step, Animate shows **Reselect** for 4 s, C9); with the Thumb key's Select more on, the open Halo updates in place
  (C8). Colliding candidates open the **Loupe**; *Next ›* on the breadcrumb steps through them.
- **Long-press** (450 ms): the same verbs as a compass ring at the finger (empty space's verbs on nothing; a thing is
  selected first); a flick — moving onto a slot and lifting — runs it; *Reduce gestures* leaves the ring open instead.
  The mouse: right-click opens the ring at the cursor, a right drag flicks.
- **Double-tap** frames (all, on empty space); the tool never sees the second tap (C17). **Two-finger tap** undoes one
  step with a toast that names it and offers Redo; **quick pinch** frames all; both are off with *Reduce gestures*, and
  their twins are ↶ and the puck's double-tap.
- **Drag**: what is selected, a handle, or — with a brush — the mesh (a stroke after 10 pt or 120 ms) is the tool's;
  anything else orbits (ST-5). The mouse: a left drag on empty space orbits, a still click there clears, Alt falls
  through to the user's profile (§4.5).
- **Halo opens on** (`halo.input`, §4.5): *auto* (a finger or the Pencil opens it on every tap, a mouse click only
  selects and the breadcrumb shows *⋯ Verbs*), *tap*, or *right-click or hold*.
- **The Thumb key** (§5.5): hidden while it would change nothing; tap = the next action, double-tap = lock (chip and
  canvas tint), hold = while held; slide up = the chooser. Its tap meaning reaches the tools on a tap and its drag
  meaning on a drag, through `setModifierSource`; Select more / Pick or unpick / Unselect are the select tool's
  add / toggle / remove (`selectModeOf`). A latched hold is handed again to a tool activated meanwhile (T1's note).
- **Numbers** (§5.6): after an adjustable run the chips of its primary value, its counts and its plain-named values
  (three at most, ST-T6A-7) float beside the result; a scrub or a numpad value is one Adjust Last (the step replaced,
  not added); after Pull / Inset / Bevel a reduced Halo stays (*Pull again · Bevel · Inset*). A non-adjustable
  operator with a form (or ParamDefs) opens its form first; ✓ runs it.
- **Verb → target** (§6.4): *Parent to…* (v1) waits for a tap on the target, draws a line from the subject to the
  finger, runs `scene.parent` and gives the subject its selection back; ✕ Cancel.

## Exit test (§21 T6a)

| Check | Result |
|---|---|
| Grammar e2e green on `chrome-touch` | `ha-02` (7 touch tests), `ha-03` (4), `ha-04` (3), `ha-13` (1): **green** with real touch through CDP (tap, ring and flick, double-tap, orbit, two-finger undo and Redo, quick pinch, More, Make objects, verb → target; the Thumb key once / locked / held; selection undo in Make, Reselect in Animate; Echo chips with the numpad, the reduced Halo, forms, the session bar committing on a stage switch and on the way to Pro; Reduce gestures with every visible twin) |
| … the mouse on `chrome` | `ha-02` mouse test: a click selects (*⋯ Verbs*), right-click opens the ring, a right drag flicks, a still click on empty space clears, a left drag there orbits |
| Booting on `webkit-ipad` | `ha-02` WebKit test: `/app` boots on Home, *Try a sample* by touch loads Polybot, a Path tab by touch switches the stage and the workspace; `ha-12` and `ha-00` on WebKit green |
| Visible-target counter in the test API (ST-37) | `halo().visibleTargets`; at rest **14** (Animate, Polybot) — ≤ 22; with a Halo open **24–25** (Animate, iPad landscape and portrait), **33** (Make with Pull's chips, reduced Halo and the session bar) — ≤ 36. Asserted in `ha-02` (≤ 22 at rest, ≤ 36 with a Halo) and on WebKit |
| Unit (Node) | `packages/halo/test`: 53 tests — the grammar over T1's real arbiter state machine, the modifier map against the select tool's modes and `HOLD_CODES`, every `UiDialog` (AS-ST-20), the key scope, the mirror, the remembered entry, the vocabulary lint, the no-document-writes rule, the target counter, the manipulator scale; `packages/viewport/test/halo-t6a-manip-xray.test.ts` (2) |

Screenshots (production e2e build, Chrome with touch @2x):
`t6a-ipad-landscape-{home,animate-halo,ring,make-face,make-pull-chips}.png`, `t6a-ipad-portrait-*.png`,
`t6a-phone-*.png` (in the session's scratchpad `halo/`, not committed).

## Measurements

SIZE-1 (owner, 2026-10-24) made every gate 5,000,000 B and the targets report-only; nothing was trimmed. The lazy
boundaries hold: no Halo module is in `/editor`'s or `/autorig`'s scripts (`ekza-halo-shell` boundary), and neither
dockview nor the curve editor is in `/app`'s initial scripts. Production build, `check:size`, gzip -9:

| Route | `dev` `ce66bd1e` (same build, no Halo grammar) | T6a at the gate (`c745859e`) | Δ |
|---|---|---|---|
| `/app` | 639,822 B | **685,639 B** | +45,817 B (report-only; target 660,000 B) |
| `/editor` | 896,090 B | **896,620 B** | +530 B (no Halo module; see below) |
| `/autorig` | 657,175 B | **657,694 B** | +519 B (no Halo module; see below) |

What the `/app` bytes are (attribution, eager): the touch kit 11.5 kB, the Halo layer 8.6 kB, the shell 7.9 kB, the
catalogue 2.8 kB, input 1.9 kB, sessions 1.5 kB, chips 1.5 kB; the arbiter, the Thumb key's controller, search, the
forms, the numpad, the project menu, More and the kernel's bind answers are lazy chunks, prefetched at idle (S23).

**Why `/editor` and `/autorig` grow ≈ 0.5 kB with no Halo code in them** (ST-T6A-20): about 465 B of it (measured on
source-map builds before the dev merges: +465 / +469 B) is this — Turbopack emits a shared
module once, with every export any chunk of the app uses. Halo's lazy forms chunk imports
`@ekza-studio/editor-core/forms`, whose `formProblems` (param-lint's helper) uses anim-core's `assertParams`, which no
route used before — so anim-core's `params` module grew by its `assertParams` (+1,280 B raw) in every route's eager
copy. Splitting `formProblems` into its own module (`forms/problems.ts`, re-exported) removes it; measured, then
reverted after SIZE-1 because it is T5a's file and bytes no longer gate (patch **P-T6A-6** below, optional). The rest
(≈ 60 B) are the viewport lines every route carries: `setManipulatorScale` and the x-ray opacity in the shading keys.

## Gate

`EKZA_E2E_PORT=3181 pnpm run ci` at `c745859e` (`dev` `ce66bd1e` merged), local Chrome, load average 60–100: **green**
(exit 0) — format, lint, typecheck, check:deps, fixtures, licences, 23 / 23 test tasks (halo 53, viewport 341 + 1
skipped, editor 674 + 1 skipped, editor-core 1,797, headless-tests 225, mesh-view 83, autorig 115, web 105, …), the
production build, check:size (all three routes OK under SIZE-1's 5,000,000 B) and **the e2e suite: 432 passed, 68
skipped, 0 failed, 0 flaky** in 6.8 min (`chrome`, `chrome-touch`, `webkit-ipad`). The skips are `dev`'s stretch
`test.fixme`s and the per-project skips (the touch specs on `chrome` and `webkit-ipad`, the mouse spec on the touch
projects). `m6a-19` B11 (a known `dev` failure another agent fixes) did not fail in this run.

Two earlier runs: the first stopped in the unit step at load average ~100 — 8 editor browser files (`input`, `shell`,
`ui-primitives`, the clips, graph, attributes, kit and outliner panels) and 2 headless files (`ops.export`,
`rig.ik.fixtures`) timed out; all 10 passed when rerun alone (120 + 1 skipped, 49). The second was green up to e2e,
where `ar-12-layouts` › *phone 390×844 touch › the frame on ① and on ②* failed once on `chrome-touch` (an Auto-Rig
layout race: its poll passes, the next read sees the sheet mid-move); alone it passed 5/5, 14/15 with four workers and
8/8 serially. The third run is the green one.

## Deviations and lines outside the row

- **The verb source is a stand-in** (`halo/verbSource.ts`, ST-T6A-1): the curated table, the noun resolver and the
  derived More list are T6b's (`verbs/**`, `manifest/**`); the grammar codes against one seam (`VerbSource`: `noun`,
  `petals`, `more`) with a few real operators per noun in §6.2's slot order. Likewise the Path tabs (`PathTabs` in
  `TopBar.tsx`, no readiness glyphs), the tray (empty space's verbs) and the sheets (`registerHaloSheet`; a sheet not
  registered offers *Open in the Pro layout ▸*).
- **`viewport`** (ST-T1-5, unblocked by SIZE-1): `ViewportManager.setManipulatorScale(scale)` and the two `configure`
  calls multiply by it; `manager/shading.ts` reads the x-ray opacity in force (T1's patch for T6a / T9); `mesh/index.ts`
  and `mesh/display.ts` carry an overlay's `xrayOpacity` to mesh-view. **`mesh-view`**: `MeshPaneDisplay.xrayOpacity?`
  (`types.ts`) and the surface opacity reads it (`internal/base.ts`). Test: `viewport/test/halo-t6a-manip-xray.test.ts`.
- **`apps/web/e2e/ha-12-round-trip.spec.ts`** (T2's): `halo()` now answers (Home on an empty document); the Pro switch
  names its workspace (`ws=`, §16.1); a coarse-only device answers the one line first. New: `e2e/helpers/halo.ts`.
- **Session writes**: the dialog watcher sets `session.dialog` to null in the same notification (a UI field; the
  kernel's question stays for the answer, ST-T6A-8). Every document write is an operator run (unit-tested).

## Patches for other packages

| # | File (owner) | Patch | Why |
|---|---|---|---|
| P-T6A-1 | `packages/halo/src/halo/verbSource.ts` (T6b, integration) | Point the grammar at `verbs/{nouns,table,derive}` (keep the `VerbSource` shape or adapt the three calls in `halo/grammar.ts`, `HaloLayer.tsx`, `Tray.tsx`, `MoreSheet.tsx`); `Verb.target` marks verbs that wait for a target (§6.4); `Verb.run` may be `{ stage }` | the stand-in goes |
| P-T6A-2 | `packages/halo/src/shell/{TopBar,Sheets}.tsx` (T6b) | `path/Path.tsx` replaces `PathTabs` (readiness glyphs, the status corner); T6b's sheets register through `registerHaloSheet(id, body)` (more, numbers, scene, view, settings, health, help, about) and the stand-in `halo/MoreSheet.tsx` goes; Settings › Input writes `store.input` and `writeInput` (`halo.input`: routing, Halo opens on, Reduce gestures, quick pinch, Thumb key, handedness) | the seams are in place |
| P-T6A-3 | `packages/halo/src/manifest/**` (T6b) | `halo.proOnlyKey` (registered by the shell while mounted) is a `plumbing` entry; `PARAM_SURFACES` lists the chips of `chips/EchoChips.tsx` (`echoParams`) and the forms of `halo/run.ts` | parity |
| P-T6A-4 | stage packages (T7–T9, T11) | trays replace `shell/Tray.tsx` per stage; handles in the pane claim drags with `addHaloClaim` (`input/claims.ts`; T8's cap handle, T9's rig dots, a selected joint by id); modal sessions register with `registerSession` (`session/sessions.ts`: the rig dots, weight painting, the test pose); T11 replaces `home/Home.tsx` and installs `provideRecoveryHook(app, {firstRun: false, offer})` for Home › Continue; T7 applies Rec (`store.rec`) as the `shell` override; T10's History ribbon is ↶'s long-press | the grammar's seams |
| P-T6A-5 | `packages/halo/src/shell/entry.ts` + `apps/web/test/entry-contract.test.ts` (T12) | `HALO_ENTRY` is a third copy here (the switch's remembered-entry write, §1.2): flip it with the other two and pin it in the entry contract | ST-T3-5's reverse write |
| P-T6A-6 | `packages/editor-core/src/forms/index.ts` (T5a, optional) | move `formProblems` into `forms/problems.ts` and re-export it | −465 B on `/editor` and `/autorig` (ST-T6A-20); report-only since SIZE-1 |
| P-T6A-7 | `docs/STUDIO-TOUCH-SPEC.md` §20.2 (T12) | the files as built: `input/{install,claims,situation,manipScale}.ts`, `halo/{grammar,run,verbSource,geometry}.ts`, `halo/TargetMode.tsx`, `shell/{coach,entry,mirror,keys,targets}.ts`; §20.7: CDP's `touchEnd` lists the points that lift (the held Thumb key test) | the spec follows the code |
| P-T6A-8 | `apps/web/e2e/helpers/touch.ts` (T1's) | its comment says a touch event's points are the fingers down after it; for `touchEnd` CDP lifts the listed points (ha-03 sends the event itself) | a helper for two-finger releases |

## Follow-ups

- The Echo chips' Options (the full option box, *Make default*) and the chip menus are T6b's (§6.3).
- Pencil hover (the ghost Halo, the brush ring) and contact-size palms need a device (D14); the routing switch to
  *Pencil edits* on the first pen press and its toast are built.
- `select.mesh.loop` needs a picked edge, so *Select ▾* offers Ring · Shell · Grow · Shrink; Loop is T8's.
