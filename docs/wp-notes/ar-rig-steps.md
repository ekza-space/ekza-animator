# Auto-Rig D4 — `rig-steps`: ② Markers and ③ Rig — build notes

Branch `autorig/rig-steps` from `autorig/mvp` (`04e2c54`), with `autorig/wizard-shell` (D3) and `autorig/a-pose` (A0)
merged first (`2cca3c9`; two test conflicts resolved: `ar-00-foundation.spec.ts` and
`editor-core/test/autorig/composition.test.ts` keep D3's landed polls and A0's landed rest-pose operators). Scope:
[AUTORIG-SPEC §10 D4](../AUTORIG-SPEC.md#d4--rig-steps--markers--rig) with §5.3, §5.4, §4.5 (`autorig.rig`,
`autorig.cancel`), §4.3 (the `markers` and `rig` slices, `paintedSinceBind`), §6.1 (the two pose rows, the
non-humanoid notice), §8.1–§8.3 (keys, accessibility, devices). Decision IDs are `AR-D4-<n>`. The work-package prompt
named these notes `autorig-rig-steps.md`; the spec's D4 Dirs name `ar-rig-steps.md`, which this file follows (as D0,
D1 and D3 did).

## What shipped

| Part | Where |
|---|---|
| `autorig.rig {straighten?}`: Create Skeleton (`skel.quickRig.commit` with `quickRigCommitArgs`, refused with `quickRigCommitBlock`'s reason), Bind Skin (`skin.bind {meshes}` with the M6b defaults), and only for `straighten: true` A0's `skel.pose.applyAsRest {character, pose: 'tStance'}` — two or three undo steps, none of its own; `session.busy` "Rigging…" for its whole run (the bind shows its own "Binding skin…" with the meshes' fraction); §4.5's interruption stop (D0's `runComposition`: an undo or another run between the inner runs, or the subject gone); the M6b re-run (AR-D4-1) | `editor-core/src/operators/builtin/rig/wizard/rig.ts` (rig-workspace chunk) |
| `autorig.cancel`: the skin service's `cancel()`; a bind still preparing its inputs is cancelled as soon as its job reaches the service, while the app stays busy (AR-D4-5) | same |
| ② view: pane labels, the phone / portrait-tablet pane switch, M6b's compact `QuickRigPanelBody` (its commit row hidden) beside a body pictogram, the selected marker in cm, Fingers (None / Thumb + 1 / All five / Minimal skeleton → `skel.quickRig.setPreset`; locked on a re-run with "Changing fingers rebuilds the skeleton — Start over"), "Left side mirrors the right", Auto-Rig's notices (A-pose: "Auto-rig straightens it for you."; non-humanoid; re-run), footer *Auto-rig ▸* | `autorig/src/steps/markers/{MarkersStep.tsx,Pictogram.tsx,panes.tsx}` (lazy) |
| ② start (§4.2): `select.objects` + `skel.quickRig.start {meshes}` on the subject's scene meshes, or on the subject character's meshes (the M6b re-run); a session already open on the same meshes is kept; `startPose` recorded from the guess when the subject has none (§4.3) | `steps/markers/enter.ts` (lazy) |
| ② keys (§8.1): ↑ / ↓ in the marker list select (focus follows); arrows / Shift+arrows nudge the selected marker 1 cm / 1 mm in the two axes of the pane under the pointer (or the last ortho pane) through `skel.quickRig.setMarker`, screen directions from the pane camera, the hidden axis bit-equal; `G` guesses again | `keymap/steps/markers.ts`, `steps/markers/keys.ts` (lazy) |
| The `markers` slice: default and pane grid (eager), reducers `withPane` / `nudgePane` / `paneKind` (lazy) | `steps/markers/index.ts`, `steps/markers/slice.ts` |
| ③ progress sheet: a native modal `<dialog>` (the rest of the page inert, `Esc` does not close it), stages ✓ / ▸ / ○ in a polite live region, the bind's fraction bar, *Cancel* (focused) only during `skin` | `steps/rig/ProgressSheet.tsx` (lazy; shown from ② and ③) |
| Running the compositions from the wizard: `runAutoRig` (stages from the history's new top step and the bind's busy fraction; `check` painted for a frame; the subject named after the run; the rebind question of a re-run through the host's confirm; a cancelled bind → ③ with "Skeleton created; skinning cancelled — Bind again"), `rebind` (Done, Bind again) | `steps/rig/run.ts`, `steps/rig/ui.ts` (lazy) |
| ③ review: the motion test (Walk / Sword / Dance through `library.preview`; restarted after every committed change while on; reduced motion → *Play motion test*; `Space` toggles), FIX (*Adjust joints*, *Paint weights*, *Show weights*), the Validation summary (`skel.*` / `skin.*` / `xform.*`; errors with their Fix block *Animations ▸*; warnings in a disclosure; `skel.tpose` on a T-posed input → *Adjust joints* first, *Straighten to T-Pose* secondary, "An arm or shin is off its T-pose line — move the joint, or straighten the pose") | `steps/rig/{RigStep.tsx,motion.ts,keys.ts,mode.ts}` (lazy) |
| ③ *Adjust joints*: front │ side │ persp (a phone: 3D), Skeleton mode, *Go to Bind Pose*, the selected joint in cm, *Done* → Bind Skin `{confirm: true}` when the joints changed and no weight edit ran since the bind, else plain `skin.bind` (M6b's "Rebind replaces painted weights" in the shared dialog host); "Weights are recomputed on the straightened pose" for an A-posed subject | `RigStep.tsx`, `run.ts` |
| ③ *Paint weights*: Skin mode, C6's tool, `PaintWeightsControls` compact; a phone: "Painting needs a larger screen" | `RigStep.tsx` |
| The `rig` slice: default and pane grid (eager), reducers and constants (lazy), the `paintedSinceBind` listener (registry `onBeforeDocumentRun` + the history top changing; reference-counted, installed by the ② and ③ views) | `steps/rig/index.ts`, `steps/rig/slice.ts`, `steps/rig/painted.ts` |
| CR-AR-1: `PaintWeightsControls` extracted from the Paint Weights panel (props `app`, `meshes?`, `compact`); the panel renders it unchanged (same test ids) and keeps its empty state | `editor/src/panels/paintWeights/{index.tsx,PaintWeightsControls.tsx}` |
| `QuickRigPanelBody`'s additive `hideCommit` prop (AR-D4-6) | `editor/src/panels/quickRig/body.tsx` |
| Strings | `autorig/src/i18n/en/{markers,rig}.ts` |

## Decisions and deviations (for D7's sign-off)

| ID | Decision | Why / evidence |
|---|---|---|
| AR-D4-1 | **The M6b re-run through `autorig.rig`** (② after ③: Quick Rig seeded from the joints, `refit` set): the commit refits in place and rebinds a bound skeleton's meshes itself, so no second Bind Skin runs (one "Refit Skeleton" step); an unbound skeleton gets Bind Skin after it. A bound skeleton needs M6b's question: `autorig.rig` takes an **untyped extra argument `confirm`** (passed to the commit, as the commit's own `extraArgs`); without it the run fails with the commit's `confirm-required` "Rebind replaces painted weights", the shell asks (host confirm) and runs again with `confirm: true`. **For D7**: type `confirm?: boolean` on the `autorig.rig` row of `OperatorMap` (`args.ts` is D0's closed file) | §4.3 "going back to ② after ③ starts the M6b re-run"; the `OperatorMap` row has `{straighten?}` only |
| AR-D4-2 | A re-run straightens only while the character still has its `skel.tpose` row (an A-posed subject that was straightened is re-fitted on its T-pose rest) | `startPose` stays 'a' for the subject's life (§4.3); a second straighten of a T-posed rest would be a no-op step |
| AR-D4-3 | `autorig.rig`'s second poll (the runner polls again after `prepare`) passes for a prepared run although Quick Rig closed (a per-app flag set at the end of a successful `prepare`, cleared in `apply`) | `operators/runner.ts` polls twice |
| AR-D4-4 | The sheet's stages are derived by the shell from the operators: the history's new top step (Create Skeleton / Refit Skeleton → skin, Bind Skin → straighten or check, Straighten to T-Pose → check) and the bind's `session.busy.progress`; after the run `check` is painted for one frame (`requestAnimationFrame`) before the rows are read, so it is visible; `session.busy` (the wizard's) holds `{stage, fraction}` throughout | "Stages come from the operators" (§5.4); measured: `PREVIEW Walk` follows the end of Checking within the 300 ms of AS-AR-1 step 5 (asserted in E2E-AR-05) |
| AR-D4-5 | `autorig.cancel` also arms itself while the app is busy: a bind that has not reached the skin service yet (its inputs are still being prepared) is cancelled when its job arrives; disarmed when the app is no longer busy | a Cancel pressed right after the sheet showed `skin` otherwise did nothing (the bind had no job yet) — found by E2E-AR-05's cancel case; unit test in `rig.test.ts` |
| AR-D4-6 | `hideCommit` hides the body's whole commit row: Create Skeleton (with its rebind question) **and Cancel** | Cancel would close Quick Rig and leave ② without markers; *Auto-rig ▸* replaces the row (§5.3) |
| AR-D4-7 | `PaintWeightsControls` props are `app`, `meshes?` (default C6's `skinTargets(app)`) and `compact`; compact also shows Surface / Volume and *Front faces only*, because C6's hint (§5.4, M6B-AF-13) names them; *Mirror weights L→R* = `skin.weights.mirror {direction: 'positive-to-negative'}` (the character's left is +X) | D0's stub had `app`, `compact`; the panel computes the targets for its empty state and passes them |
| AR-D4-8 | `paintedSinceBind` is also cleared by `skel.quickRig.commit` (a refit of a bound skeleton rebinds its meshes) | §4.3 names `skin.bind`; the refit rebinds without one |
| AR-D4-9 | **Known gap, ticket AR-D4-T1 (DECISIONS-OPEN §M) for C3 / D7 (AS-AR-1 step 12):** moving the elbow joint back onto the arm line in *Adjust joints* (`D` + `W`) fixes the upper arm and forearm, but the `skel.tpose` row stays for the hands: C3's rest edit (Move Joint) does not re-aim the hand's `tail`, which the fit aimed along the 8°-rising forearm, so "hand → tail" stays ~8° off ±X (`rig/src/validate/index.ts` checks it). The user's way out today is the secondary Fix *Straighten to T-Pose*. E2E-AR-05 (`ar-05-rig-adjust`) records today's state inside a block marked `TODO(AR-D4-T1)` — known gap, not specified behaviour — with the assertions that replace it when C3's fix lands (the row gone, *Animations ▸* enabled). The fix belongs in C3's Move Joint (`rig/src/joints/move.ts`: when a joint-only move changes the direction moved → child, rotate the child's tail about the child by the same change) or in the fit, not in Auto-Rig | `e2e/ar-05-rig-adjust.spec.ts` |
| AR-D4-10 | *Show weights* in review: C6 draws the weight display only in Skin mode (`viewport/src/tools/rig/paint/runtime.ts` `weightMode()`), so review with *Show weights* on works in Skin mode with the **Select** tool (no brush; a click never paints) and the panes' display on greyscale; off → Object mode | §5.4 "Show weights toggles it in review too" |
| AR-D4-11 | `Space` (play / pause the motion test) is ③'s own listener, not a row of the frame's table, and acts only while the focus is on no control (and is prevented, so Studio never maximizes a pane) | a frame row would prevent `Space` on every focused button of ③ |
| AR-D4-12 | ② prevents the arrow keys while it is shown (the frame's listener prevents every matched row): in the list ↑ / ↓ select; Shift+arrows nudge everywhere; Fingers are toggle buttons (no radio group, whose arrows would be lost); the body's Template select keeps Space / Enter | §8.1's table |
| AR-D4-13 | The phone / tablet pane grid is computed from the window's width when the frame renders the panes (D3's `Panes` re-renders on session changes); the step's own overlays follow `resize`, so crossing 700 / 1024 px by resizing updates the panes at the next session change (pointer over a pane, a step change) | `stepPanes(session)` has no width input |
| AR-D4-14 | *Adjust joints* on a phone shows the 3D pane only (no pane switch) | §8.3 lists "③ review and adjust" for phones without a layout |
| AR-D4-15 | The Range test clip is not offered (D5's `library.preview` bytes source and `romClip()`, §5.4.1, optional in v1) | not landed |
| AR-D4-16 | **§4.5 exclusivity of the keyboard (fix round 1)**: the sheet carries `data-ar-exclusive` and an explicit `role="dialog"` (the host's `isInOverlay` matches the attribute, not a native `<dialog>`); a key guard (`steps/rig/exclusive.ts`) — one window `keydown` listener in the capture phase, installed when the eager `steps/rig/index.ts` is evaluated, i.e. before D3's controller adds its listener at mount, so it runs first — stops every key while an open sheet is in the document (`stopImmediatePropagation` + `preventDefault`): `Alt+1…5`, `Mod+Enter`, undo / redo, the step keys, `Delete`, `W`, `Esc`. `Tab` / `Shift+Tab` and `Enter` / `Space` on a button of the sheet (*Cancel*) keep their default but reach no other listener; a key aimed at another open dialog (the host's confirm) is left to it. Inside D4's Dirs: D3's controller is unchanged (its busy check on undo / redo stays as a second line). The shortcuts sheet (D3's `KeysSheet`) still lists only operator, primary and goto rows: the ② nudge rows are not listed (for D7) | §4.5 "turns off every Auto-Rig control except Cancel"; review fix round 1 reproduced `Alt+1` leaving ② mid-bind; E2E-AR-05 `ar-05-rig-cancel` presses the keys during the bind |
| AR-D4-17 | The step modules' eager parts are only the slice defaults and the pane grids; reducers, views, starts, keys and runners are lazy chunks (`steps/*/slice.ts` etc.) | `/autorig`'s first visit (Sizes) |
| AR-D4-18 | *Bind again* (after a cancelled bind, or a skeleton left unbound) on an **A-posed** input runs Straighten to T-Pose after the bind while the character holds `skel.tpose` (`rebind {straighten}` with `wantsStraighten`; the sheet lists Skinning, Straightening, Checking): the same "Bind Skin", "Straighten to T-Pose" steps as the first run, not a `skel.tpose` row the user fixes by hand. *Done* after *Adjust joints* never straightens (a `skel.tpose` row there is the joints' placement, §5.4) | review fix round 1 (minor); E2E-AR-05 `ar-05-rig-apose` second test |
| AR-D4-19 | One rule for what `autorig.rig` binds: `autoRigBindMeshes` (a character's live meshes with data) and `autoRigRefitBound` (the refit skeleton has live bound meshes) live in `editor-core/src/operators/builtin/rig/wizard/targets.ts`, exported from `@ekza-studio/editor-core` for the wizard's lazy runner and ③ view; the operator and the sheet's plan read the same helpers (the shell no longer counts deleted meshes) | review fix round 1 (minor); `editor-core/test/autorig/rig.test.ts` |

## Sizes (production build, `check:size`, gzip -9; same machine, base = `2cca3c9` built in a temporary worktree)

| Build | `/editor` (eager + First-run) | `/autorig` |
|---|---:|---:|
| base (D3 + A0 merged, `2cca3c9`) | 896,383 B | 669,084 B |
| D4 (this branch) | 896,386 B | 671,402 B |
| delta | **+3 B gzip, 0 B code** | +2,318 B |
| D4 fix round 1 (`543adff`) | 896,384 B | 671,858 B |
| delta vs base | **+1 B gzip, 0 B code** (AR-D4-S) | +2,774 B (the key guard, AR-D4-16: +456 B) |

`/editor`: the eager scripts have the **same raw bytes** (2,672,792 B and 4,744 B); the main chunk differs only in three
lazy chunk filenames (`Promise.all(["static/chunks/<hash>.js"])` of the rig-workspace chunk, the Export dialog and one
lazy group, whose contents changed: D4's operators and the extracted controls), which gzip to +3 B. No D4 code is in
`/editor`'s measured route; AR-B1 eager delta +698 B (≤ 2,048 B, enforced, pass). `/autorig`: +2,318 B, the ② and ③
string tables (§8.4: one eager table, ≈ 1.9 kB), the ② key rows and the two steps' slice defaults and pane grids;
everything else of D4 is lazy (AR-D4-17). `/autorig` stays reported over its 660,000 B gate (D3's AR-D3-G escalation
for D7 / the owner).

## Tests

- Unit, editor-core (Node): `test/autorig/rig.test.ts` — the T-posed Cube Lad: two steps, the committed joints equal
  the last preview bit for bit, the points bit-equal, no `skel.*` / `skin.*` / `xform.*` error, the second poll; the
  A-posed Polybot with `straighten`: three steps, no `skel.tpose`, every humanoid joint within 0.05 H of the T-pose
  truth, identity rest rotations, undo / redo of the straighten; the 8° elbow: two steps, bit-equal points, the
  `skel.tpose` error with its Straighten Fix; polls; an undo between the inner runs stops it (`COMPOSITION_INTERRUPTED`,
  the commit stays undoable); `autorig.cancel` mid-bind leaves one step; `autorig.cancel` before the bind job leaves
  one step and disarms; the re-run asks (`confirm-required`) then refits in one "Refit Skeleton" step. The P-C6 rows of
  `autorig.rig` / `autorig.cancel` are `checked` (keys hash unchanged).
- Unit, autorig (Node): `test/steps/markers/markers.test.ts` (slice reducers, pane grids per device class, the nudge's
  axes and screen directions, key rows, the pose class), `test/steps/rig/rig.test.ts` (slice reducers, pane grid,
  stages, the `paintedSinceBind` listener over a fake app).
- E2E-AR-04 (local Chrome): `ar-04-markers-steps.spec.ts` — AS-AR-1 steps 3–4 on the T-posed Polybot (front │ side │
  persp, the guess within 0.05 H, no undo step, Elbow dragged back in SIDE x bit-equal, Shift+↓ ×2 on Knee in FRONT z
  bit-equal, a nudge over persp acts in FRONT); fingers, ↑ / ↓, `G`; AS-AR-2 step 2 (A-pose truth, A0's and Auto-Rig's
  notices, *Auto-rig* enabled, no Create Skeleton row); AS-AR-12's ② part at 390×844 (one pane, the switch).
  `ar-04-markers-grid.spec.ts` — CR-AR-5's plain-grid test: a marker drag, a joint `W` drag and one paint stroke in the
  wizard's panes (no dockview).
- E2E-AR-05: `ar-05-rig-tpose.spec.ts` (AS-AR-1 steps 5–6: the sheet's stages without Straightening, two steps, 34
  joints = the last preview, within 0.05 H of the truth, clean weights, bit-equal points, no error or warning, PREVIEW
  Walk ≤ 300 ms after Checking with store version / history / keys hash unchanged, Sword and Dance move a hand point),
  `ar-05-rig-apose.spec.ts` (AS-AR-2 steps 2–5: Straightening shown, three steps, T-pose joints, identity rotations,
  `Mod+Z` → the import's points and `skel.tpose`, `Mod+Shift+Z` → the T-pose with bit-equal weights, Walk's hands ≥ 0.3
  arm lengths below the shoulders), `ar-05-rig-adjust.spec.ts` (AS-AR-1's negative case: 8° by keyboard nudges, two
  steps, bit-equal points, the row with *Adjust joints* first, `D` + `W` in Adjust, Done rebinds without a question;
  AR-D4-9), `ar-05-rig-fix.spec.ts` (Space, Show weights, a paint stroke sets `paintedSinceBind`, Done then asks
  "Rebind replaces painted weights" in the dialog host, without paint it does not; *Back* → the re-run, one "Refit
  Skeleton"; AS-AR-12's ③ part at 390×844: "Painting needs a larger screen"), `ar-05-rig-cancel.spec.ts` (AS-AR-7's ③
  part on the 84,672-triangle variant built in memory: the undo key does nothing while the sheet is up, Cancel leaves
  the skeleton step, "Skeleton created; skinning cancelled", *Bind again*).
- C6's and C3's panel e2e specs (`m6b-skin-02`, `m6b-rig-04`, `m6b-rig-01`, `m6b-skin-10`, `m6b-mvp-01`, `m6b-qr-01`,
  `m6b-qr-02`) unchanged and green.

**Shared files touched outside the D4 Dirs** (for D7's approval): `editor-core/test/m6b/keys-hash.test.ts` (the two D4
rows `checked`, as D3 did for its rows), `editor-core/test/autorig/composition.test.ts` and
`apps/web/e2e/ar-00-foundation.spec.ts` (`autorig.rig` / `autorig.cancel` refuse with their own polls instead of
"Arrives with Auto-Rig"), `apps/web/e2e/ar-12-layouts.spec.ts` (② is the markers panel, no longer a placeholder),
`autorig/test/contracts.test.ts` and `autorig/test/keys.test.ts` (the keymap now has step rows after the frame's: the
frame-row assertions filter to `steps: 'all'`), `autorig/src/shell/steps.ts` (two `as StepModule` assertions became
unnecessary once ② and ③ export a step module — the linter's error), and the merge resolution above. Fix round 1
adds two: `editor-core/src/index.ts` (one export line, `autoRigBindMeshes` / `autoRigRefitBound`, AR-D4-19) and the new
file `editor-core/src/operators/builtin/rig/wizard/targets.ts` beside D4's `wizard/rig.ts`; and `docs/DECISIONS-OPEN.md` §M gets two rows proposed
by D4 (AR-D4-T1, the C3 ticket; AR-D4-S, the lazy-chunk rename bytes), as D3 added its own.

## Gates

Local, on `autorig/rig-steps`, `EKZA_E2E_PORT=3165`, local Chrome (machine load average 90–330 from other agents during
the run):

- `pnpm run ci`: format:check, lint, typecheck, check:deps, check:fixtures, check:licenses green; `pnpm run test`: 15 of
  16 packages green (autorig 61, editor-core 1,524, viewport 274, headless 203, …); `@ekza-studio/editor` failed one
  test, `input.test.ts` "a focused dropdown keeps type-ahead only while hovered…" (a KeyboardAdapter timing case D4 does
  not touch), green alone (24/24) and in the package's full rerun (573 passed, 1 skipped).
- The remaining stages run once more after that: `clean:next`, production build, `check:size` (`/editor` 896,386 B,
  AR-B1 eager delta +698 B ≤ 2,048 B, enforced, pass; `/autorig` 671,404 B, reported) and the full e2e suite: **293
  passed, 24 skipped (the stretch `fixme`s), 2 failed** — E2E-07 (`07-wave-block-cycle`, a playback frame-wrap poll
  under load, untouched by D4) and `ar-05-rig-tpose` (the stage recorder stopped before the preview badge appeared
  under load: a test-helper race, fixed — the recorder keeps watching). Rerun after the fix: every Auto-Rig spec
  (`ar-00`, `ar-01-*`, `ar-03-*`, `ar-04-*`, `ar-05-*`, `ar-12`, `ar-a0`) and E2E-07: **42 passed, 0 failed**.
- D4's own specs while iterating: `ar-05-rig-cancel` `--repeat-each=3` 3/3; C6's and C3's panel specs (`m6b-skin-02`,
  `m6b-rig-04`, `m6b-rig-01`, `m6b-skin-10`, `m6b-mvp-01`, `m6b-qr-01`, `m6b-qr-02`) green.

### Fix round 1 (review of `5ffea0f`)

Fixed: the §4.5 keyboard exclusivity (AR-D4-16, blocker), *Bind again* on an A-posed input (AR-D4-18), one bind-target
rule (AR-D4-19), AS-AR-2 step 4's joint check (`ar-05-rig-apose`: the undone rest equals the last Quick Rig preview
bit for bit, the whole skeleton equal across another undo), the AR-D4-9 assertions marked as the known gap AR-D4-T1
and recorded with AR-D4-S in DECISIONS-OPEN §M. Gate on `543adff` (`EKZA_E2E_PORT=3165 pnpm run ci`, local Chrome):
format:check, lint, typecheck, check:deps, check:fixtures, check:licenses, `pnpm run test` 16 of 16 (autorig 65,
editor 573 + 1 skipped, viewport 274), `clean:next`, build, `check:size` (`/editor` 896,384 B ≤ 900,000 B; AR-B1 eager
delta +696 B ≤ 2,048 B, enforced, pass; `/autorig` 671,858 B, reported), full e2e **295 passed, 24 skipped, 1 failed**:
`m2a-demo-walkthrough` ("Character 'Polybot' has no runtime yet", an `/editor` M2a spec D4 does not touch), green
alone 3 of 3 (once and `--repeat-each=2`) — a flake under load. D4's specs (`ar-04-*`, `ar-05-*`) 12 of 12; a
throwaway probe (deleted) with real Playwright key presses on the 80k variant: `Alt+1`, `Alt+3`, `Esc` during the bind
keep ② and the sheet, `Enter` on *Cancel* cancels.

