# AUTORIG D7 — `integration` (merges, the AS-AR scripts, budgets, OMOBA runs, docs)

Branch `autorig/integration` from `autorig/mvp` (worktree `_workspace/worktrees/animator/ar-integration`). Spec:
AUTORIG-SPEC §10 D7 (binding), §11, §7. Gate port 3168, local Chrome with the GPU (never the SwiftShader project,
never `CI=1`).

## Merges

The dependency branches were merged with `--no-ff` in the §10.0 order; the earlier packages arrive through them
(D0 `contracts` is in every branch, A0 `a-pose` through `rig-steps`, D1 `studio-host` through `entry-chooser`,
`wizard-shell` and the step branches, D3 `wizard-shell` through D4/D5/D6):

| Merge | Head merged | Conflicts (all union resolutions) |
|---|---|---|
| `autorig/entry-chooser` (D2, with D0 and D1) | `5a7ddd0` | none |
| `autorig/rig-steps` (D4, with A0 and D3) | `ced2e48` | none |
| `autorig/animations` (D5) | `fa7b903` | the "landed ids" rows of `ar-00-foundation.spec.ts` and `editor-core/test/autorig/composition.test.ts` (D4's ③ rows and D5's ④ row both kept); `packages/autorig/src/shell/steps.ts` (the step modules without casts — every step now has its real module); two test comments (`contracts.test.ts`, `keys.test.ts`) |
| `autorig/export` (D6) | `b8b2329` | the same three files: D6's `autorig.export` row added beside D5's; `export: exportStep` without a cast |

After the merges: format, lint, typecheck and check:deps green at once; the unit suites green (a first `turbo` run hit
io's `project.test.ts` 30 s timeout under a load average of 82 from other agents; green alone and in later runs).

## Approvals of the packages' shared-file edits (§10.0 rule)

Every path a package touched outside its Dirs, as listed in its wp-notes, is **approved** by D7 as recorded there:
D0 (`ar-contracts.md`, "Shared files touched outside the D0 Dirs"), A0 (`ar-a-pose.md`, "Deviations and touches
outside A0's Dirs" — the third Skeleton item, the test-API import in E2E-AR-A0, the stub-asserting tests updated to the
landed operators), D1 (`ar-studio-host.md`: `.oxlintrc.json`, AR-D1-15 `state().storeVersion` in the test-API contract),
D2 (`ar-entry-chooser.md`: `dialogs/entryChoice.ts` and the lazy `shell/autoRigSwitch.ts`, AR-D2-11), D3
(`ar-wizard-shell.md`: `ui/styles.css` `@source`, the composition test rows, the viewport hook, DECISIONS-OPEN §M rows),
D4 (`ar-rig-steps.md`: `editor-core/test/m6b/keys-hash.test.ts` rows and the rest of its list), D5 (`ar-animations.md`,
"Outside the Dirs"), D6 (`ar-export.md`, "Outside the Dirs": the landed-id rows and the cast removal). None of them
widened a contract outside D0's commit.

## Decisions and deviations of D7 (recorded in DECISIONS-OPEN §M as AR-D7-*)

| ID | Decision | Why |
|---|---|---|
| AR-D7-1 | **AR-D3-G approved and landed**: the host's `TooltipProvider` moved from `StudioHost` (D1) into `StudioShell` (`editor/src/shell/EditorShell.tsx`). Studio's tooltips keep one provider; a tooltip outside it (a host dialog, Auto-Rig) makes its own (the `Tooltip` primitive's documented fallback); Auto-Rig's chrome uses `title`. `/autorig` −13.5 kB, `/editor` −38 B | the measured lever D3 found; the `/autorig` gate is never raised silently (§7.2) |
| AR-D7-2 | **Per-step string tables.** `i18n/en/index.ts` keeps the frame's and ①'s tables eager; ②–⑤'s tables register themselves when their step code loads (`steps/<step>/strings.ts`, imported by every module of the step that reads `messages().<step>`; the files are listed in the package's `sideEffects`, so bundlers keep the bare import). The typed `Messages` shape is unchanged; `contracts.test.ts` checks the eager two sections, then all six after the step modules load. `/autorig` −3.2 kB | D5's and D6's proposal (their tables rode the first visit through D0's closed index) |
| AR-D7-3 | **The `/autorig` gate is recorded and enforced**: `size-baseline.json` `routes.autorig` `{gate 660,000, target 620,000, enforce true, total 658,122}`; `apps/web/test/ar-size.test.ts` now asserts it enforced and the recorded total under the gate | D1 could not record it (over the gate after D3); with AR-D7-1/2 the route is 1,878 B under it |
| AR-D7-4 | **A character handed over from Studio continues on ④.** On ①'s *From Studio* card, taking a character sets the frame's pending step to `animations`, which the frame takes once reachable (`steps/model/Report.tsx`, D3's file); scene meshes stay on ① for their report (D3's E2E unchanged) | AS-AR-3: *Help › Switch to Auto-Rig* → "④ shows Walk gone"; before, the wizard stayed on ① with every step reachable, unlike an imported VRM, which lands on ④ |
| AR-D7-5 | **AS-AR-6's texture half is a known gap, kept as `test.fail`** in `ar-as-06-parts.spec.ts` (and D6's `test.fixme` stays): C10's writer writes palette textures only, so an adopted image texture does not reach the VRM (`io/src/character`) | a C10 writer change, not Auto-Rig's (§6.1); the scenario's other checks pass; `test.fail` turns red when C10 is fixed |
| AR-D7-6 | **Space keeps its default on a focused Auto-Rig control** (button, radio, checkbox, switch). The host's Studio keyboard adapter takes a plain Space as its tap-hold key and prevents it, which cancelled the control's own activation — ⑤'s licence radio could not be checked from the keyboard. The Auto-Rig controller stops a plain Space on such a control in the capture phase (`spaceActivates`, `shell/controller.ts`; never inside ③'s exclusive sheet, which routes its keys itself) | §8.2 (WCAG 2.2 AA for the wizard chrome); found by AS-AR-11, the keyboard-only script |
| AR-D7-7 | **AS-AR-1 step 12's last check is a known gap (AR-D4-T1), kept as `test.fail`**: moving the elbow back with *Adjust joints* leaves `skel.tpose` on the hand's tail. D4's proposed C3 fix (re-aim a moved joint's child tail) contradicts M6b's P-J1 tests ("D + W: the feet stay bit-equal", "Move (joint only): only the joint moves"), so it is an owner / C3 decision, not an integration fix. The rest of step 12 passes through the UI; *Straighten to T-Pose* (the secondary Fix) clears it | §M AR-D4-T1 stays open with this disposition |
| AR-D7-8 | **AS-AR-3's arrival from Studio takes one click.** D3's *From Studio* card asks before it adopts Studio's subject ("nothing is replaced without a click"); the script clicks it, then lands on ④ (AR-D7-4) | D3's design (AR-D3-*), kept: it never replaces a wizard subject silently |
| AR-D7-9 | **AS-AR-2 step 8 re-enters the meta.** Undoing to before "Straighten to T-Pose" also undoes ⑤'s thumbnail, author and licence steps (they came after it), so after the Fix (one step, the row ✓) Download needs the meta again; the script refills it and checks Download enabled. Step 6's FR-AR-12 comparison runs `file.exportCharacter` on the same page before the undo | the spec's step order |
| AR-D7-10 | **AS-AR-1 step 7's playback-equals-preview check holds the preview clock.** The script holds `performance.now()` (C12's preview clock) at ten instants, lets a frame draw each, reads the displayed hand and the preview's time in one task, and compares with `boneWorld` of the added clip at the same clip frame (≤ 1e-5 m). Without the hold, the display and the clock are a frame apart (6.5e-5 m) | the spec's 1e-5 at 10 frames needs one sample time |
| AR-D7-11 | **Sign-offs of the packages' smaller deviations**: AR-D3-1 (`WizardPane`, not `PaneView`: approved — the measured +1,444 B on `/editor` rules `PaneView` out; ③ shows the joint values in its own panel, AR-D4); AR-D3-S (Preferences shows every row, the middle button tracks, *Upright* without the feet band: approved); AR-D3-23 (a shared `placementsAfterDelta` helper for C2 and D3: open, a refactor of two owners' files for after the release); AR-D3-15 (C2's *Center and Ground* leaves z: open, C2's; AS-AR-5 measures the guess against the truth moved by the body's z); AR-D4-S (a renamed lazy chunk moves `/editor` by a few bytes: approved — such renames are not an allowance breach of a 0 B package, they stay in the enforced total); AR-D5-10 (Play/Stop, not Play/Pause: approved — C12's preview has no pause) | the packages' wp-notes |
| AR-D7-12 | **e2e storage namespaces**: an e2e page without `&ns=` gets a private autosave namespace per load, so a reload (AS-AR-9) or a second tab (AS-AR-3's new-tab handoff) uses an explicit shared `&ns=` (as D1's and D3's specs do) | the e2e isolation rule; production pages share one namespace |
| AR-D7-13 | **First motion-test frame in the bench: a report-only miss** (340 ms from the bench's "③ done" read, the step entry included); the spec's interval (sheet end → `PREVIEW` badge) is asserted ≤ 300 ms in E2E-AR-05 and AS-AR-1 step 5, green | the bench and the e2e measure different starts |
| AR-D7-14 | **A helper file for the scripts**: `apps/web/e2e/helpers/ar-as.ts` (D7's, beside the step owners' helpers): the landing start, a real drop, the network log of §8.5, the step drivers, the idle rule, the written file's rest directions | the scripts share them; no step owner's helper was edited |

## The AS-AR scripts (§11), all through the UI

| ID | File | What runs | Result |
|---|---|---|---|
| AS-AR-1 (E2E-AR-08) | `ar-as-01-static.spec.ts` | steps 1–10 on `polybot-unskinned-tpose.glb` and, parameterized, `cube-lad.glb`; step 12 negative on the Cube Lad; step 12's last check (`test.fail`, AR-D7-7) | green; known gap held |
| AS-AR-2 (E2E-AR-13) | `ar-as-02-apose.spec.ts` | steps 1–8 on the A-posed Polybot | green |
| AS-AR-3 | `ar-as-03-studio.spec.ts` | Open in Studio (same page, `Mod+Z` undoes Use Clip Walk), Switch to Auto-Rig → ④ without Walk, the new-tab handoff | green |
| AS-AR-4 | `ar-as-04-vrm.spec.ts` | `polybot.vrm` → ④, Walk, ⑤ Space bake byte-equal to `file.export` | green |
| AS-AR-5 | `ar-as-05-placement.spec.ts` | Z-up ×100 off-centre Cube Lad, three fixes, ② guess within 0.05 H | green |
| AS-AR-6 | `ar-as-06-parts.spec.ts` | the sword unticked, the body rigged and exported clean, the sword a scene mesh; the texture (`test.fail`, AR-D7-5) | green; known gap held |
| AS-AR-7 | `ar-as-07-heavy.spec.ts` | 262,848 triangles refused with the hint; 84,672 warns, Cancel mid-bind leaves "Create Skeleton", Bind again | green |
| AS-AR-8 | `ar-as-08-chooser.spec.ts` | Remember → `/autorig`, `?chooser=1`, `/editor` deep link, blocked storage | green |
| AS-AR-9 (E2E-AR-09) | `ar-as-09-reload.spec.ts` | after step 5, reload → Continue → ③ with the same document | green |
| AS-AR-10 (E2E-AR-10) | `ar-as-10-idle.spec.ts` | 0 frames over 2 s on ① empty, ① model, ② markers, ③ review (motion test off), ④ (preview stopped), ⑤ | green: 0 everywhere |
| AS-AR-11 (E2E-AR-11) | `ar-as-11-keyboard.spec.ts` | AS-AR-1 without a pointer event (Choose file… by Enter, `Mod+Enter`, the list and nudges, `/` + Tab + Enter + `A`, the radios, Download by `Mod+Enter`); every request same-origin GET | green after AR-D7-6 |
| AS-AR-12 | `ar-as-12-devices.spec.ts` | 1024×768 touch: steps 2–7 by taps and a one-finger CDP drag; 390×844 touch: Studio first, ② pane switch and bottom sheet, `autorig.rig` after the Studio visit, the paint notice | green |

E2E-AR-08…11 and E2E-AR-13 are these scripts (the `ar-{08,09,10,11,13}-*` names of the Dirs were not needed: each
E2E id is in its script's header and title).

## The rule test (§4.1, §4.5)

`packages/autorig/test/rule.test.ts` greps `packages/autorig/src` (comments stripped): no `.transact(`, no `tx.*`,
no `app.session.setState`, no `app.store` mutators, no history writes; no value import (static, re-export, bare or
dynamic) of `mesh-core`, `rig`, `io`, `mesh-view` — type imports only (a probe case checks the matcher); no direct call
of a solver or the writer; the operator registry used. And `editor-core/src/operators/builtin/rig/wizard/`: only
`autorig.*` ids in `defineOperator`, the index exports `WIZARD_OPERATORS`, no `undo: true`, no transaction, no inner
run inside an `apply` body. It targets `autorig.` and `wizard/` only (never the bare word `autoRig`). 9 tests, green.

## OMOBA validator runs (§11; local, never in `ci`)

`node tooling/omoba-validate.mjs` (OMOBA's `validate-runtime-vrm`, `omoba-bevy` read-only, its shared cargo cache A)
on the files the scripts wrote to `apps/web/test-results/autorig/` in one run of `ar-as-01` and `ar-as-02`:

| File | SHA-256 | Exit | Line |
|---|---|---|---|
| `as-ar-1-polybot.vrm` (AS-AR-1 step 11) | `5bd59c04…22d31` | 0 | Compatible local humanoid: VRM 1.0, 35 nodes, 33 semantic bones, 2 scene-0 roots. |
| `as-ar-1-cube-lad.vrm` (AS-AR-1 step 11, the Cube Lad run) | `20c7d6bb…22ace2` | 0 | Compatible local humanoid: VRM 1.0, 35 nodes, 33 semantic bones, 2 scene-0 roots. |
| `as-ar-2-polybot-apose.vrm` (AS-AR-2 step 7) | `24a43314…aeb9dd` | 0 | Compatible local humanoid: VRM 1.0, 35 nodes, 33 semantic bones, 2 scene-0 roots. |

**Admission only.** The T-pose of the AS-AR-2 file is proven by `skel.tpose` (no row after the straighten) and the
read-back directions of the written file (upper arm → hand within 5° of ±X, lower leg → foot within 5° of −Y, step 6).
Cargo printed "failed to clean entries from the global cache … Permission denied" (its global-cache housekeeping under
the sandbox); the validator ran and exited 0. Playwright clears `test-results/` per run, so the three files are
written by one run of the two specs and validated right after.

## Budgets (§7)

**Bundle** (production build, `check:size`, gzip -9, final):

| Route | Measured | Gate | Notes |
|---|---|---|---|
| `/editor` first visit (eager 889,765 B + First-run 6,978 B) | **896,743 B** | 900,000 B; AR-B1 limit 897,736 B | Auto-Rig delta **+1,055 B** of the 2,048 B allowance (enforced) |
| `/autorig` first visit | **658,122 B** | **660,000 B, enforced (AR-D7-3)**; target 620,000 B | was 674,563 B after the merges; AR-D7-1 −13.5 kB, AR-D7-2 −3.2 kB, AR-D7-6 +0.2 kB |

Boundaries: `autorig-shell` absent from `/editor`; `dockview`, `curve-editor`, `studio-shell`, `rig-workspace` and the
other lazy groups absent from `/autorig`'s initial scripts.

**Runtime** (`apps/web/e2e/bench/autorig.bench.ts`, e2e build, local Chrome with the GPU, 1440×900 at DPR 2, Apple M4
Pro shared with other agents; report-only except the two gates):

| Row (§7.3) | Budget | Measured |
|---|---|---|
| `/autorig` first visit to an interactive ① | ≤ 1.5 s | 461–555 ms ✓ |
| ② first entry (chunks + guess), Cube Lad | ≤ 1.0 s | 144–158 ms ✓ |
| *Auto-rig* (commit + bind), Cube Lad / 9,408-triangle body | ≤ 1.0 s / ≤ 2.5 s | 108–462 ms ✓ / 223–578 ms ✓ |
| First motion-test frame after rigging | ≤ 300 ms after `check` | 340–343 ms from "③ done" to the preview state (the bench's clock starts at the progress read, the step entry included) — **report-only miss** (AR-D7-13); the e2e measure of the spec's interval (sheet end → `PREVIEW` badge) is asserted ≤ 300 ms in E2E-AR-05 and AS-AR-1 step 5, green |
| Idle in every step, no preview | 0 frames / 2 s (gate) | **0** ✓ (E2E-AR-10 on six states; bench on ⑤) |
| Export of the Cube Lad VRM | ≤ 500 ms | `autorig.export` 14–18 ms; Download click to saved file 79–110 ms ✓ |
| *Straighten to T-Pose*, A-posed Polybot (1,184 points) | ≤ 200 ms | 20 ms median of 3 ✓ |
| dockview on `/autorig` (§7.2) | never fetched (gate) | **0 files** over AS-AR-1; 1 file after *Open in Studio* ✓ |

Bytes fetched per step over AS-AR-1 (encoded bodies, e2e build — it carries the 74.8 kB test API): first visit 718.7
KiB JS + 67.6 KiB other; ① on the first file 662.2 KiB JS (`rig-workspace`, the mesh kernel, the import path); ②
126.6 KiB (mesh view); ③ 130.9 KiB JS + 34.5 KiB (the skin worker, the character runtime, the motion clip); ④ 8.1 KiB
(the clip library); ⑤ 36.2 KiB (the export path).

## Gates

Recorded at the end of this file (the final run).

## Open for the owner

- AS-AR-1 and AS-AR-2 by hand in Chrome, timed (§10 D7 DoD); the owner demo below.
- Q-AR-17 (AR-B1 re-baseline: `/editor` +1,055 B of +2,048 B) and the `/autorig` gate as recorded (AR-D7-3).
- AR-D4-T1 / AR-D7-7 (Move Joint and the hand tail), AR-D7-5 (C10 textures), AR-D3-15 (C2 Center and Ground leaves
  z): owners' fixes, not Auto-Rig's.

### Owner demo (≈ 10 minutes)

1. Open `/` — the chooser; tick *Remember*, *Start Auto-Rig*.
2. Drop `fixtures/models/polybot-unskinned.glb` (A-posed): the Pose row says "A-pose (arms N° down)".
3. *Next*: markers on the body; drag one in the side view; *Auto-rig*: the sheet shows Straightening; the character
   walks at once; `Mod+Z` shows the A-posed rest, `Mod+Shift+Z` the T-pose.
4. *Animations ▸*: search "walk", Speed 1.2, In place, *Add*; add Idle.
5. *Export ▸*: author, CC0, *Download* `polybot.vrm`; run `node tooling/omoba-validate.mjs ~/Downloads/polybot.vrm`.
6. Header *Open in Studio ▸*: Animate with the clips; `Mod+Z` still undoes; *Help › Switch to Auto-Rig*.
