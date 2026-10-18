# M2a integration — merge, gates, acceptance, budgets, docs: build notes

Branch `m2a/integration` (from `dev` at `eea476c`, M2A-SPEC v0.2). Scope:
[M2A-SPEC §8 Integration](../M2A-SPEC.md#integration-after-a1a5) and [§10](../M2A-SPEC.md#10-integration-plan-and-m2a-definition-of-done).
Decision IDs below are `M2A-INT-<n>` for DECISIONS-OPEN §F.

## Merge

In the §10.1 order, `--no-ff`, signed off: A0 `m2a/contracts-foundation` (`0357037`), A4 `m2a/graph-posing`
(`271e242`), A5 `m2a/platform-perf` (`09f1944`), A1 `m2a/rig-ik` (`0a48807`), A2 `m2a/ik-editor` (`f8126af`), A3
`m2a/dopesheet-timing` (`d064b59`). Every package's other worktree was clean; no package branch was changed.

| Merge | Conflicts | Resolution |
|---|---|---|
| A0 | — | — |
| A4 | — | — |
| A5 | `apps/web/e2e/m2a-00-foundation.spec.ts`, `editor-core/test/builtin/m2a-operators.test.ts` (A0's stub lists), `docs/ROADMAP.md` (status rows) | both packages' removals kept; each package's own status row |
| A1 | — (clean) | — |
| A2 | `editor-core/src/workflows/importModel.ts` (imports), `viewport/src/sync/SceneSync.ts` (imports), the stub list, ROADMAP | as A2's and A5's merge notes say: A2's `importLimbWarnings` import, A5's names import without `nameKey`; the union of A4's `batchTables` and A2's visibility imports |
| A3 | `curve-editor/src/timeline/TimeSliderController.ts` (imports), the stub lists, `editor-core/test/kernel/m2a-foundation.test.ts`, ROADMAP | union of the imports; **A4's value-only skip of key updates gained the breakdown flag** (M2A-INT-6); every former stub is implemented |

After the merges, A2's merge note for A1's `headless-tests/test/rig.ik.export.test.ts` was applied (the upgraded-M1-rig
export test imports with `prefs.autoRigIk` off, M2A-A2-18).

## Gates turned into failures (§3 rule 4, MVP-SPEC INT-55)

| Gate | Now |
|---|---|
| `editor-core/test/builtin/m2a-operators.test.ts` stub list | every §4.9 operator resolves and **none** poll-fails "not available yet" (the list of runs is the whole M2a catalog) |
| `editor-core/test/kernel/m2a-foundation.test.ts` "contract stubs" | the former stubs (`scaleKeyValues`, `tweenEdits`, `copyKeys`, `insertTime`) run without `not-implemented` |
| `editor-core/test/ready.ts` (`READY.a1`) | removed. The two before-A1 cases of `m2a-a2-ik.test.ts` now script the rig's `not-implemented` stub through the limb seam (`setLimbKit`), so the "not available yet" fallback stays covered; the with-A1 case runs unconditionally |
| `headless-tests` `READY_A1` (`ops.ik.test.ts`, `ops.export-reduce.test.ts`) | removed; the IK operators on the fixtures and the keep set's influence term always run |
| `editor-core/src/workflows/export.ts` `influenceKeepFrames` | no longer turns a `not-implemented` rig into an empty influence term (a regression fails the export) |
| e2e `gateOnA1` (`helpers/m2a-a2.ts`, 8 specs) | `expectLimbIk`: an assertion naming A1 |
| e2e `test.fixme`: E2E-M2A-10b, -14, -15, -22b, -25 | ordinary tests (22b and 25 assert the piece and its owner) |
| `apps/web/e2e/m2a-00-foundation.spec.ts` stub loop | A3's operators refuse with their own reasons on a rig without keys; no stub is left |

The only `test.fixme` tests left are the stretch items of `apps/web/e2e/stretch.spec.ts` (MVP-SPEC §1.2 and
M2A-SPEC §1.2), as at M1.

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M2A-INT-1 | **E2E-M2A-23: the hips are lowest at the contacts** (`cog` ty −0.05/−0.02/−0.05/−0.02/−0.05 at 0/6/12/18/24; v0.2: 0/−0.03/0/−0.03/0). Every assertion of §9.1 is kept. | Polybot's legs are 0.32 m long and nearly straight at rest (hip→foot 0.314 m of 0.324 m). With the hips at rest an IK foot 0.15 m forward is 3 cm out of reach: the foot lifts 3 cm off its target (measured y 0.085 vs 0.054), so no planted-foot assertion can hold. Lowering the hips by ≥ 2.8 cm at the contacts brings the targets inside the reach; down at contact and up at passing is also the usual walk. |
| M2A-INT-2 | **E2E-M2A-24: the attack starts and ends in a ready stance** (`cog` ty −0.05 at 0 and 20; v0.2: rest). | Seed-san's legs are straight at rest (reach 0.730 m = the hip height above the foot), so the front foot 0.2 m forward is out of reach with the hips at rest: frames 0–2 and 18–20 missed by up to 23 mm (measured). |
| M2A-INT-3 | **E2E-M2A-23's reduced VRMA: never more samples, within the per-node tolerances** (v0.2: "fewer samples than an unreduced export"). | A smooth 30 fps walk keeps every sample at R02's tolerances on Polybot: dropping any one interior sample moves the hips translation by ≥ 2.6e-4 m (tolerance 9.4e-5 m = 0.2 mm × 0.795/1.7) and the leg rotations by 1.0e-3–3.7e-3 rad (tolerances ≤ 9e-4 rad). Constant tracks are already 2 samples in the M1 writer. Same finding as M2A-A5-3 on the wave; the ≥ 3× gate stays on linear blocking (E2E-M2A-21b). The scenario also checks the dialog's "N → M samples" toast and the read-back tolerances. Owner item with M2A-A5-3. |
| M2A-INT-4 | **M-2 target 850,000 B for M2a** (§5.21.2 allows it with the reason). Production build of the merged branch: first visit **843,270 B** (6 scripts; eager 836,738 B + First-run dialog 6,487 B), gate 900,000 B: 56,730 B headroom. The bench's network capture of the e2e build matches `check:size` to the byte (844.6 / 838.1 kB, 0.00 %). `check-size.mjs` `TARGET_BYTES` (report only) and the bench's report line follow the new target. | A5's branch measured 785,248 B; A1…A4 add ≈ 58 kB of eager code. Attribution of the merged route (gzip -9): three 174.4 kB, next 127.4 kB, dockview 82.9 kB, **editor-core 75.4 kB**, editor 74.8 kB, R3F 52.7 kB, **rig 39.4 kB** (the IK rig, ik2, matching, influence), **curve-editor 28.7 kB** (Dope Sheet contributions and controller, Graph Editor views and the Scale tool), viewport 28.5 kB, doc 19.7 kB, io 13.5 kB, anim-core 13.2 kB, camera-controls 9.5 kB; top modules editor-core `operators` 30.9 kB and `workflows` 16.4 kB (IK, tween, mirror, ripple, buffer operators), editor `panels` 48.9 kB (Channel Box attribute rows, Limb section, Tween bar); A5's attribution of the merge base before its own cuts had
editor-core 52.4, rig 28.0 and curve-editor 22.1 kB, which A5's lazy import pipelines and export path then reduced.
Cuts for M2b, by size: the IK operator and workflow bodies behind `prepare` like the import pipelines (≈ 18 kB raw), the Dope Sheet controller behind its panel's lazy boundary, Next's client navigation (≈ 47 kB raw, one route), `camera-controls` until the first tumble (9.5 kB). |
| M2A-INT-5 | **`moveKeys` writes no key at −0** (`editor-core/src/edit/keys.ts`, A3's placement): a snapped move of a key at 0 by less than half a frame to the left gave `Math.round` −0, and A3's clamp skips a zero block shift, so the key was written at −0 when its value changed. M1 always added the shift (−0 + 0 = 0); A4's value-only drag path writes +0, so `curve-editor/test/m2a-graph.test.ts` "a key drag writes exactly what moveKeys writes" failed on the merge. Placements normalise −0 at creation. | Found by A4's differential test. Test: `editor-core/test/kernel/m2a-integration.test.ts` (fast-check over sub-half-frame moves with and without ripple and breakdowns; fails without the fix). |
| M2A-INT-6 | **The time slider rebuilds its ticks when a key's breakdown flag changes in place** (`curve-editor/src/timeline/TimeSliderController.ts`, in the A3 merge): A4's M-1 cut skips key updates that keep time and curve, but A3's breakdown ticks are green, so `key.convert` would have left a stale tick colour. | Test: `curve-editor/test/timeline/m2a-integration-ticks.test.ts` (fails without the flag). |
| M2A-INT-7 | **E2E-M2A-14 ran for the first time here** (it was `test.fixme('A2')` on A3's branch) and failed: its Graph Editor drags were a click then a press on the same key, and the second scenario's click landed on the first scenario's pixel within the panel's 400 ms multi-click window (a double-click selects the whole curve, by design); its key point was read once before the panel drew it; its third drag started from a key the previous drag had left beyond the view. Now one press-drag per key (selects and moves it), the point is polled, and `A` frames all before the third drag. Assertions unchanged. | Test robustness; the product behaves as specified (press.ts: "the second press of a double-click … on a key … release without a drag selects the curve"). |
| M2A-INT-8 | **`clickOutlinerRow` (M1 helper) lets the Outliner's reveal scroll settle.** In `chromium-swiftshader` E2E-27 failed every run on the merged build: after a selection change the Outliner scrolls the lead's row into view over several frames (slow under SwiftShader, ≈ 300 ms), and the row the helper had found was swapped out mid-scroll ("Element is not attached to the DOM"). The helper waits until the scroll position holds for three frames and finds a swapped-out row again. Real Chrome passed before and after. | Test robustness; the click and the assertions are unchanged. |
| M2A-INT-9 | **anim-core property flakes (A2 open issue 3) fixed in the tests**: both reported seeds reproduce; `t0 + (t1 − t0)·n/n` rounds one ulp past the last key, which on a curve with a cyclic post infinity is the next cycle (the first key's value). The properties clamp their samples to `t1`; the two counterexamples are explicit cases (t exactly at the last key is the last span's value, one ulp past it the next cycle). The engine is unchanged. | Decision asked by A2: `t = last key` belongs to the last span (it always did); the sampling was the defect. |
| M2A-INT-10 | **Contract PRs ratified** into M2A-SPEC v0.3 and DECISIONS-OPEN §F: A1 C-1…C-7 (C-8 needed no change), A2's E2E-M2A-02/-05 rows, the seamless hold keys at `f − 1` (M2A-A2-19), the same-mode refusal (A2-23) and the switch curves' constant infinities (A2-24), A2's and A4's additive package exports (A2-11, A4-11), A4-10 (E2E-M2A-17 at the float32 pointer precision), A4-13/14 (half-cycle seam step flags and working-copy refinements), A5-3 (the reduction gate on linear blocking). The `TwoBoneIkInput.restReach` contract comment names amendments A, B and C. | §3 rule 1: A1…A5 could not approve their own contract changes. |
| M2A-INT-11 | **Ball roll and the seamless switch (A2 open issue 1)**: decided as §5.6's stated exception (the match keeps the chain exact, warns with the measured toes difference, `f − 1` stays exact); the alternatives (the IK-side match also sets `fk.toes` or zeroes the roll; the toes rule pivots the toes about their own joint) are owner items. | Both alternatives change behaviour a user already sees in the warnings; the exception is what is built and tested (E2E-M2A-03's ball-roll case, `ops.ik.test.ts`). |
| M2A-INT-12 | **Cyclic curves that already had keys and the switch (A2 open issue 4)**: left as §5.23's keying rule (an `@ikFk` curve keyed once at 0 on a loop clip cycles over its key range after a switch at 10). Owner item: make `@ikFk` curves never cycle, or cycle over the clip range. | Changing it is a §5.23 contract change; no scenario depends on it. |
| M2A-INT-13 | **Dope Sheet drag of 1,000 keys: Miss (§5.22, report only), recorded as M-4.** On 213 curves (Seed-san, e2e bench) a drag frame costs median 21.2 ms, p95 26.1 ms (unit bench, 450 curves: 19.0 ms = store preview 4.6 + compiling the moved curves 10.9 + the Dope Sheet's own redraw 3.4 ms). The Graph Editor's M-1 gate drags 1,000 keys on 30 curves (2.5 / 3.1–3.4 ms); spread over 200+ curves the per-curve recompile and re-evaluation dominate. Owner: the shared M-1 path (store, curve cache, evaluation), next step for M2b: recompile only the moved span of a curve and defer pose re-evaluation of curves outside the current frame's segment. | §5.22 rows are recorded, not gated (§10.2). |
| M2A-INT-14 | **README GIFs** are recorded from the e2e build by `apps/web/scripts/record-readme-media.mjs` (test-API setup, real pointer input for the action, ffmpeg palette GIFs, 800 px, 12 fps) into `docs/media/`: the IK walk (E2E-M2A-23's clip played), a Dope Sheet ripple retime and the status-line Tween bar, all on Polybot (CC0). Not part of any gate. | §8 Integration "GIFs … recorded from the e2e build". |

## Open items not changed here (owners named)

- A2 open issue 5 (A1's counted allocation test failed once under parallel load): not reproduced in the full runs here.
- A5's M2A-A5-10 (lazy chunks offline): owner decision, unchanged.
- M-2 cuts of M2A-INT-4 and the Dope Sheet drag (M-4): M2b.

## Acceptance scenarios (E2E-M2A-23, -24)

`apps/web/e2e/m2a-23-24-acceptance.spec.ts`, one test each, fresh pages, real input for every authoring step and
assertions through the test API:

- **E2E-M2A-23 (walk)**: Polybot, clip `walk` (0…24, loop, slot `walk`, in place); `ik.leg.L` picked in the viewport
  and keyed with Channel Box typing and `S` at 0/12/18/24; a Shift-drag band over 0…12 on the time slider and `4`
  make those keys linear; `cog` (Outliner) keyed at 0/6/12/18/24; Pose › Mirror Animation › Left → Right (half
  cycle) with `ik.leg.L` selected; in the Dope Sheet the `cog` glyphs at 6 and 18 (click, Shift+click) dragged to 5
  and 17; an empty click clears the key selection; `cb-name-ty`, frame 21, the status-line Tween bar from 0 to 50;
  two Export-dialog VRMA exports (reduced, unreduced). Asserted: left foot over 0…12 and right foot over 12…24 with
  x, y fixed (1e-6 m), z linear (second differences ≤ 1e-6 m) and no rotation (1e-6 rad), while the hips move; the
  mirror rule at every frame (1e-9) and `ik.leg.L` unchanged by it; "Pose @ f21"; the breakdown at 21 = 0.015 and no
  other key at 21; every curve `cycle`/`cycle`; `curveSlope(cog tx)` C¹ at the seam (1e-9, with velocity); pose at 24
  = pose at 0 (bones 1e-6, every channel 1e-6); both VRMAs valid, the reduced one no larger and within the per-node
  tolerances; an undo walk back to the clip setup (17 steps: no `Plant Feet`, the expected operations), then redo
  restores the curves.
- **E2E-M2A-24 (attack)**: Seed-san, clip `attack` (0…20, slot `attack`, contact 12); both IK feet keyed once at 0
  (Outliner, Channel Box, `S`); `cog` at 0/12/20; `fk.upperArm.R` and `fk.lowerArm.R` at 0/8/12/20 in degrees; the
  windup keys moved 8 → 9 with the Dope Sheet's summary glyph. Asserted: both foot worlds identical at every frame
  0…20 (1e-6 m, 1e-6 rad) while the hips travel > 0.1 m; VRMA valid with `contactSeconds` 12/30 and slot `attack`;
  the bake has no new validator errors; the undo walk (23 steps, 13 `Set Key`, no `Plant Feet`).

Both pass in real Chrome (3 × 2 repeats) and in `chromium-swiftshader`.

## Owner demo script (M2A-SPEC §10.3)

The script is the owner's to run; every step is exercised by an e2e scenario on this branch, so it should play as
written:

| Step | Covered by |
|---|---|
| 1. Polybot: IK feet and knee poles, FK leg circles hidden | E2E-M2A-01 (`limbs()`, `controls()` visibility) |
| 2. Lower `cog` with `W`, feet stay; drag the IK foot; move the pole; roll 20° and −15° | E2E-M2A-01, -02, -04 |
| 3. Seamless FK switch at 10 and back; arm to IK, lower `cog`, the hand stays | E2E-M2A-03, -05 |
| 4. Block a 24-frame walk with IK feet and `cog`; mirror half a cycle; play | E2E-M2A-23 (and the walk GIF) |
| 5. Dope Sheet retime with ripple, undo, region-bar scale | E2E-M2A-10, -11 (and the Dope Sheet GIF) |
| 6. Tween a breakdown with the slider; `Alt+S`, move a neighbour, the breakdown keeps its ratio | E2E-M2A-13, -14, -23 (and the tween GIF) |
| 7. Buffer snapshot/edit/swap; normalized and stacked views; `R` scale | E2E-M2A-16, -17 |
| 8. MMB carry and `S`; Shift-drag a band, Mod-drag to copy | E2E-M2A-09, -08 |
| 9. Pick-walk; key a hand by body part; MMB scrub in the Channel Box | E2E-M2A-18, -19 |
| 10. Export VRMA with reduction (size shown); reload with unsaved work and recover | E2E-M2A-21, -23, -20 |

## Budgets (re-measured on the merged branch)

2026-10-18, Apple M4 Pro, real Chrome 155 with the GPU, the e2e build at DPR 2 (`pnpm --filter web bench:budgets`
and the package benches), load average 5.8–10.8 from the host (a VM and other services; no other agent build ran).

| Scenario | Budget | Measured | Verdict |
|---|---|---|---|
| Idle editor | 0 / 0 | 0 GL frames / 0 2D calls over 2 s (empty; Seed-san + wave, split and quad) | Met |
| Pose evaluation, 1 humanoid | ≤ 0.5 ms | 0.035 ms in the app (51 controls, 147 curves) | Met |
| Pose evaluation, 1 humanoid with 4 IK limbs (§5.22) | ≤ 0.5 ms (target ≤ 0.06) | 0.0419 ms (Seed-san; same rig at ikFk 0 0.0277 ms, M1 rig 0.0272 ms) | Met |
| Scrub | same frame | 40 / 40 | Met |
| Playback, 1 VRM, 4 panes | ≤ 8 ms CPU/frame | rAF mean 0.75 ms, p95 2.40 ms; task time 1.94 ms per frame; viewport bench 0.42 / 0.80 ms | Met |
| Graph Editor 50k keys / 10k visible | ≤ 8 ms | median 0.80 ms | Met |
| Graph Editor 50 × 200 full redraw | ≤ 4 ms | median 1.10 ms | Met |
| **M-1** Drag 1,000 selected keys (gate p95 ≤ 4.0 ms) | ≤ 4 ms | median 2.50 ms; p95 3.10, 3.20, 3.40, 3.30 ms (4 runs, load 5.9–10.8); A4 bench first drag 2.40 / 3.30, warm 2.10 / 2.40 ms | **Met** |
| Doc preview update, 1,000 keys | ≤ 1.0 ms | 0.69 ms (commit 0.35 ms) | Met |
| Undo/redo one gesture | ≤ 5 ms | 1,000-key drag 2.10 / 1.80 ms; key step 0.30 / 0.30 ms | Met |
| Open Seed-san to interactive | ≤ 3 s | median 116.2 ms (runs 170.5, 116.2, 115.6); page ready 410 ms | Met |
| Bake + write VRMA, 10 s @ 30 fps | ≤ 200 ms | median 16.3 ms (runs 2–5); first run +24.1 ms (the export chunk) | Met |
| Autosave write, Seed-san × 10 clips (§5.22) | ≤ 50 ms | median 11.5 ms, max 12.6 ms | Met |
| Dope Sheet redraw (§5.22) | ≤ 4 ms | unit 450 × 200: view 0.20, selection 0.40, one edited key 1.00 ms; editor (213 curves, 42,600 keys): zoom 0.40 / 0.60 ms, selection change 2.70 / 3.90 ms | Met |
| Dope Sheet drag, 1,000 keys (§5.22) | ≤ 4 ms | editor 21.2 / 26.1 ms (213 curves); unit 19.0 ms (450 curves) | **Miss** (M-4, M2A-INT-13) |
| Tween slider drag, 60 channels (§5.22) | ≤ 4 ms | median 2.70 ms, p95 3.20 ms | Met |
| **M-2** Editor route JS (first visit) | ≤ 900 kB, target 850 kB (M2A-INT-4) | 843,270 B (production); e2e build 844.6 kB, bench = `check:size` (0.00 %) | **Met** (gate), target met at 850 kB |
| **M-3** anim-core 2,200 curves at one frame | mean ≤ 0.20, p75 ≤ 0.25 ms | mean 0.154 ms, p75 0.159 ms (load 6) | **Met** |

## Gates

Final run on the branch head after the last code change (`b5856ea`), 2026-10-18, load average 6–10:

| Gate | Result |
|---|---|
| `pnpm run format:check`, `lint` (oxlint --type-aware), `typecheck` (tsc -b) | clean |
| `check:deps`, `check:fixtures`, `check:licenses` | 13 packages follow the rules; 4 fixtures match; 173 production packages allowed |
| `turbo run test test:tooling --force` (uncached) | 13/13 tasks: anim-core 648, doc 189, doc-yjs 69, rig 202, io 163, editor-core 733, viewport 98 (+1 skipped, M1), curve-editor 207 (+3 skipped, M1), editor 348 (+1 skipped, M1), ui 73, headless-tests 164, web 9, tooling 14 |
| `pnpm run build`, `pnpm --filter web check:size` | green; 843,270 B first visit (gate 900,000 B, target 850,000 B met) |
| `EKZA_E2E_PORT=3146 pnpm run test:e2e` (real Chrome) | 98 passed, 3 skipped (the M1-stretch `test.fixme`) |
| the same suite with `--project=chromium-swiftshader` (CI's) | 98 passed, 3 skipped |
| E2E-M2A-23/24, -14 and E2E-27 repeated (5 × each, 7 workers) | 20 / 20 |
| `pnpm --filter web bench:budgets` and the A3/A4/package benches | see Budgets |
