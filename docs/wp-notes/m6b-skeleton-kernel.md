# M6b C2 — skeleton kernel: build notes

Branch `m6b/skeleton-kernel` (from `m6b/mvp` at `22b0e11`, `m6b/rig-contracts` merged at `ea3bbc3`; spec v1.3).
Scope: [M6B-SPEC §9.0 C2](../M6B-SPEC.md#c2--skeleton-kernel) with §0.4.2 (Quick Rig v2), §0.4.3, §5.2–§5.7 (MVP
subset), §5.21 (`skel.*`, `xform.*`). Decision IDs below are `M6B-C2-<n>`. READY flag `c2` is set in the four
`test/m6b-ready.ts` files.

## What landed

| Item | Where |
|---|---|
| `TriangleBvh` (median-split AABB tree, ≡ the reference) | `mesh-core/src/query/bvh.ts`; the per-triangle tests both use in `query/triangle.ts`; the brute force kept as `ReferenceTriangleBvh` (`query/reference.ts`); barrel line `export { ReferenceTriangleBvh, TriangleBvh } from './query'` |
| CR-2 `humanoidBodyRig(params)` | `mesh-core/src/templates/humanoidBodyRig.ts`, its line in `templates/index.ts` and the B13 barrel line of `mesh-core/src/index.ts` |
| §5.2 templates (Lite 17 / Core 21 / Standard 33 / Full 52 + helper `root`, standard and bigHead, finger table, rest flexion) | `rig/src/templates/{index,build,presets,records}.ts`: `skeletonTemplate`, `placeTemplate`, `assembleTemplate`, `minimumBend`, `hingeBend`, `PRESET_BONES`, `templateJointRecords` (§5.2 identities), `refitTemplateJoints` (re-run in place) |
| Quick Rig v2 kernel | `rig/src/quickrig/{fit,guess,checks,raster,index}.ts`: `fitTemplate`, `fitQuickRig` (the sizing preview and commit share), `guessMarkers` (`aPose`, the chin tie rule), `quickRigStartChecks` (CR-AR-3), `markersFromJoints` (re-run seeding), `projectedCenter`, the silhouette raster |
| MVP joint edits (pure, over records) | `rig/src/joints/{move,orient,mirror,humanoid,util}.ts`: `moveJoints` (W, D+W, E, D+E, symmetry), `setJointRest`, `orientJoints` (+ `convertBoneAlignedRotation`, `frameQuat`), `mirrorJoints`, `setHumanBone`, `renameJoint`, `flexJoints`, `addMissingBones`, `JointIndex`; the deferred ones keep their C0 stubs |
| `checkSkeleton` | `rig/src/validate/index.ts` (`skel.required-bones`, `unique-names`, `unique-human-bone`, `parent-map`, `multiple-roots`, `tpose`, `hinge-bend`, `symmetry`, `grounded`, `facing`, `orientation-mixed`, `xform.scale`, `xform.not-frozen`) |
| Operators | `editor-core/src/operators/builtin/rig/skeleton.ts`: `skel.template.create`, `skel.template.addMissing`, `skel.joint.move`, `.rotateRest`, `.setRest`, `.orient`, `.mirror`, `.setHumanBone`, `.rename`, `.flex`, `skel.symmetry.set`, `select.joints` (+ the shared helpers below); `quickRig.ts`: `skel.quickRig.commit`, `skel.quickRig.center`, `skel.quickRig.faceForward` |
| Helpers for C3 | `quickRig.ts`: `quickRigFit(app, view, {preset, markers, meshes, flexion})` (the live preview: Create Skeleton calls the same function with the same inputs), `quickRigStartInfo(app, view, meshes)` (checks, guess or re-run seeding, the failed-guess reason), `markersArg`, `CHECK_REASONS`, `REBIND_CONFIRM`, `previewKeys`; `skeleton.ts`: `rigTarget`, `rigGeometry` (one cached world-space `TriangleBvh` per mesh set and revision), `updateControlRig`, `writeJointEdit`, `upsertRecord` |
| Test API (C2 group) | `editor/src/test-api/m6b/skeleton-kernel.ts`: `quickRigGuess(meshes)`, `quickRigFit(args)`, `skeletonChecks(character)`, `templateJoints(preset, height)` |
| Tests | `rig/test/m6b-skeleton/{bvh,templates,quickrig,joints,validate}.test.ts` (+ `support.ts`: the three fixtures from their GLBs and truth files); `editor-core/test/m6b/skeleton-kernel/{quick-rig,joint-ops,gated}.test.ts`; `editor/test/m6b-skeleton-kernel-test-api.test.ts` |
| Benches (report only) | `rig/bench/m6b-skeleton.bench.ts`, `mesh-core/bench/m6b-query.bench.ts` |

## Calibration spike (§0.4.2: Cube Lad, generated body, T-posed Polybot)

Synthesized markers = the truth markers (Cube Lad and Polybot: their truth files; the generated body: the CR-2 joints
by the Polybot rule of M6B-C0-3). Errors in H (the model's height); gates: fit ≤ 0.03 H, guess ≤ 0.05 H.

| Fixture | Fit, worst joint | Guess, worst marker | Guess time |
|---|---:|---:|---:|
| Cube Lad (1.70 m, 192 tris) | 0.0084 H (thumb, M6B-C2-3) | 0.0148 H (elbow) | 0.4 ms |
| Generated body, smooth (1.60 m, 494 tris) | 0.0104 H | 0.0409 H (elbow) | 0.6 ms |
| Generated body, segmented (560 tris) | 0.0104 H | 0.0428 H (elbow) | 0.6 ms |
| Polybot T-pose (1.064 m, 2,130 tris) | 0.0270 H (thumb metacarpal) | 0.0371 H (elbow) | 0.5 ms |
| Polybot A-pose (not an MVP gate) | — | arm angle 43.0° vs 44.5° truth, `aPose` true | — |

The Cube Lad's `chin` lands on the topmost neck row (1.481 vs 1.48). Before calibration, the §0.4.2 text failed on
Polybot (fit 0.058 H at the upper legs; guess 0.37 H: its head is wider than the torso) and the segmented body (no
guess: the gaps between shells). The changes, each a contract-PR candidate for §0.4.2 / §5.8 (INT owns the spec):

| # | §0.4.2 / §5.8 text | Calibrated | Why |
|---|---|---|---|
| M6B-C2-1 | fit: `rightUpperLeg.x = knee.x` | `−0.6 ×` the half-width of the central (pelvis) run of the front silhouette at the upper leg's height; `knee.x` when there is none (`FIT.upperLegInPelvis`) | Polybot's thighs slant (hip 0.05, knee 0.107): 0.057 H off with `knee.x`, 0.021 H now; the Cube Lad (0.096 vs 0.1) and the generated body (0.09) stay well inside |
| M6B-C2-2 | guess: wrist = the extreme point pulled back by 0.25 × 0.08 H | pulled back by **1.0** × 0.08 H (`GUESS.wristPullBack`) | 0.25 put the wrist on the finger tips (Cube Lad 0.062 H, Polybot 0.088 H off) |
| M6B-C2-3 | fit: thumb metacarpal 0.20 h forward of the hand (§5.2 table) | 0.30 h in Quick Rig's fit only (`FIT.thumbForward`); templates keep the §5.2 0.20 h | Polybot's mitten thumb sits 0.54 h forward: 0.036 H off at 0.20 h, 0.027 H at 0.30 h |
| M6B-C2-4 | shoulder row = the highest row wider than the torso by 0.05 H | the contiguous band of such rows around the **widest** row above the groin; its top is the shoulder row | a head wider than the torso (Polybot) was taken for the shoulders |
| M6B-C2-5 | arm root = the arm line ∩ the torso edge measured from the groin band | the torso edge of the row under the arm band (the armpit), else the groin-band edge | the elbow (midway between wrist and root) moved from 0.049 H to 0.041 H off on the body |
| M6B-C2-6 | knee midway between groin and 0.05 H | the right leg run's sharpest width step (≥ 3 columns between two rows) between 0.25 and 0.85 of the way from the ankle up to the groin; else 0.57 of the way (`GUESS.kneeBand`, `kneeStep`, `kneeAlongLeg`) | boxy and segmented legs show the knee (Cube Lad 0.46 exact, Polybot 0.254 vs 0.26); midway put Polybot's knee 0.063 H off; 0.57 matches the smooth body |
| M6B-C2-7 | every marker's z = the slab midpoint at the marker | the ankle's z is the shin's slab midpoint 0.05 H above it | at 0.05 H the front ray runs along Polybot's foot (0.094 H off) |
| M6B-C2-8 | groin = highest row with x = 0 outside and both sides inside | from the lowest such row up while x = 0 stays outside, rows with nothing inside included; the groin is the top of the last row holding both legs | the gaps between the segmented body's shells ended the split early (no guess) |
| M6B-C2-9 | — | elbow and wrist y: the centre of the arm's vertical run at their column (else the line's y); head top: a downward ray on x = 0 at the top row's slab z | exact heights on T-poses; slanted arms keep the marker on the arm's axis |

Thresholds stay in `FIT`, `GUESS` and `START_CHECKS` (`rig/src/quickrig`), one place each.

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6B-C2-10 | **Silhouette raster by cross-sections**: a raster row marks the columns covered by the x (front) or z (side) projections of the triangles' cross-sections with the plane y. The samples equal those of a `raycastAll` grid; the cost is O(triangles × rows they span). | §5.8 names `raycastAll` per sample; 256 × 256 rays at 10k triangles would not meet ≤ 50 ms. Projected centres still use `raycastAll`. |
| M6B-C2-11 | **Facing check** (§0.4.2 "the toes' front extent — the mean z of the inside samples of the lowest 0.05 H band — lies in front of the band's slab midpoint"): the mean z of the side-view inside samples of the band against the midpoint of the z extent of the band's top row (the ankles). | Box feet are symmetric about their own centre; the shin above them is the reference that tells front from back (the Cube Lad and its 180° copy). |
| M6B-C2-12 | **Minimum bend slack**: `δ ≥ 0.999 · δmin` leaves the joint bit-equal. | Re-applying the rule to its own result (a re-run's seeded markers, `skel.joint.flex` on a template) would move a bent hinge again by O(δ²/a²) ≈ 1e-6 m (the bent lengths give a larger δmin). Straight limbs still get exactly δmin. |
| M6B-C2-13 | **`skel.tpose` (MVP)** checks the arms (upper arm → lower arm → hand), the hands' tails and the shins (lower leg → foot) within 5°; thighs may splay. | Polybot's thighs slant 29° (M6B-C2-1): with the thighs in the lint, E2E-SKIN-01's "no error row" on T-posed Polybot could not hold; §0.4.2 ties `skel.tpose` to A-posed arms. |
| M6B-C2-14 | **`skel.hinge-bend`** measures the bend as `δ·(a + b)/(a·b)` (the angle the minimum-bend rule uses) on the hinge side; `skel.facing` compares the toes' (or the foot tail's) z with the foot's; `skel.grounded` the meshes' world min y; `xform.*` only for meshes with a skin. | One definition shared with the fit. |
| M6B-C2-15 | **Character creation composes C1's `char.fromModel`**: its definition's `poll` and `prepare` run in the commit's `prepare`, its `apply` in the commit's `apply` (same transaction, one step); the composing operator re-annotates its label ('Create Skeleton', 'Skeleton Template') because C1's apply annotates its own. C1's `createModelCharacter(app, tx, …)` (its branch) is the direct core; INT may switch the two call sites (`applyFromModel`, `prepareFromModel` in `skeleton.ts`) to it so the derived ids use this run's seed. | C1 ran in parallel; the composition needs nothing from C1 but the §6 contract (`{objects, name}` → `{character, skeleton}`). Tests register a stand-in before the chunk loads (`test/m6b/skeleton-kernel/support.ts`); the real path is `READY.c1`-gated. |
| M6B-C2-16 | **The control-rig update inside every skeleton edit** is `updateControlRig(app, tx, character)`: `skeletonFromDoc` (io) → `updateAutoRig` (rig) → upsert of the rig record, controls (parents first), solvers and constraints, soft deletes of vanished controls. IK choice: a new rig gets legs IK, arms FK (Q-RIG-2); later updates keep the current choice (`ik.leg.*` / `ik.arm.*` controls). | §5.16 "inside every skeleton-editing transaction"; the cores are C0 baselines here and C1's after its merge (no call-site change). The `rig.autoRig.update` operator stays C1's. |
| M6B-C2-17 | **Re-run on a bound character**: without `confirm: true` the commit fails with `EkzaError('confirm-required', 'Rebind replaces painted weights')`; C3 shows the `rebindSkin` confirm and re-runs with `confirm: true` (C4's `skin.bind` uses the same arg). Confirmed, the commit refits the joints in place and rebinds every bound mesh with its stored `SkinBindRecord` (`kernel.bindSkin` over `skinSkeletonOf` of the refitted records, synchronously in `prepare`), all in the "Refit Skeleton" step. `skinSkeletonOf` takes H from the joints' heads and tails like C4's `rig/skinService.ts`; INT may replace it with C4's when both are merged. | §0.4.2 Re-run; C4's own Bind runs from the stored joints, which are the pre-refit ones in this prepare. `READY.c4`-gated test. |
| M6B-C2-18 | **Re-run refusals**: a changed preset is refused ("changing the template needs a new skeleton"); the start checks also gate a re-run (the adopted meshes keep the model where it was). | §0.4.2: the preset select is locked. |
| M6B-C2-19 | **E (subtree rest rotation) keeps identity rests identity** (World-oriented humanoid joints; the §5.7 Apply Pose as Rest rule); other rests take the delta. `D` + `E` (joint only) re-orients whatever the rest. `skel.joint.rotateRest` on a bound skeleton refuses the subtree mode (bound `E` is C3's test pose). | §5.2: humanoid joints stay World-oriented. |
| M6B-C2-20 | **Orient key conversion** converts the rotation keys of bone-aligned controls (`drives.bone` by name) when the three `rx`/`ry`/`rz` curves of a clip are keyed at the same times (the `S`-key layout), with Euler continuity; other layouts get a warning toast and keep their keys. Humanoid controls are world-aligned and never convert. | No MVP flow makes bone-aligned controls (the Joint tool is deferred); the full union-of-times resampling waits for the Joint tool. |
| M6B-C2-21 | **Mirror Joint Behavior** is `q′ = q_X(π)·q` as §5.6.1 writes it; the mirrored aim chain's local X lies along its bone **toward the parent** (Maya's behavior mirror). P-J3 is asserted as "X collinear with the bone (1e-9)" plus the formula; §5.26's "+X points at its child" holds for the source chain. Mirror `direction: 'auto'` reads the root's side (x < 0 or side R → right-to-left); a centre root mirrors its sided descendants of the source side. | The formula and the P-J3 sentence disagree; the formula is normative. |
| M6B-C2-22 | **Add Missing Bones** uses the skeleton's preset (Standard 33 for `custom`) scaled to the joints' height on their ground; an unmapped deforming joint within 0.05 H is mapped, else the bone is added as `<skeletonId>:<bone>` (restoring a soft-deleted record of that id) under the joint of its nearest present template parent, with the mirror links of its partner. | §6.1 row. |
| M6B-C2-23 | **Joint records are written with `upsertRecord`**: new ids are put; existing ones (restored when soft-deleted) are patched with their changed fields only (stores with `strictPut` refuse a put over an existing record). | Small undo entries; works on the strict test stores. |
| M6B-C2-24 | **`select.joints`** writes `selection.joints` (replace / toggle / add / remove, `all` = the active skeleton) without a selection history part. | §5.6 selection undo in Rig & Skin is C3's/C7's UI work. |
| M6B-C2-25 | **CR-2 pre-fit** (`skel.template.create` on a mesh whose `generator` is `humanoidBody` with live parameters): the generator's joints through the source's world placement replace the table; tails and fingers follow the fit rules; `proportions: 'auto'` resolves through the One-Click chin (< 0.72 H → bigHead). | §5.2 "Fitting at creation". |
| M6B-C2-26 | **Start-check fixes** move only meshes not parented under another target; Center and Ground translates by (−centre x, −min y, 0), Rotate to Face +Z by `T(c)·R_y(π)·T(−c)` around the bounds' x/z centre; both refuse character meshes ("Works on scene meshes, before Create Skeleton"). | §0.4.2: placements, one step each. |
| M6B-C2-27 | **mesh-core values in editor-core go through the kernel loader** (`requireKernel()` = `meshKernel()` after `loadMeshKernel()` in `prepare`): `TriangleBvh`, `humanoidBodyRig`, `readSkin`, `bindSkin`, `skinGeometryOf`, `withSkin`. | ARCHITECTURE §3: the kernel is a lazy chunk. |

## Shared files and owner edits outside the C2 dirs

- Barrels (C2's own lines, extended): `rig/src/index.ts` (the `joints`, `quickrig`, `templates`, `validate` blocks;
  `sideFromName`, `humanChainChildren`, `mirrorHumanBone` re-exported through `joints/index.ts`),
  `mesh-core/src/index.ts` (the query line; `humanoidBodyRig` added to B13's templates line for CR-2).
- C0 tests, literal updates only (§3 rule 9): `rig/test/m6b/contracts.test.ts` drops the stub rows of the eight
  symbols C2 landed (each is tested in `rig/test/m6b-skeleton/`); `editor-core/test/m6b/foundation.test.ts` lists the
  C2-landed §0.6 ids (they poll for real; the rest keep "not available yet") and uses the deferred
  `skel.joint.create` for the "chunk id before the chunk loaded" case; `editor-core/test/m6b/keys-hash.test.ts` turns
  the C2 rows into runs (records-only setup in `skeleton-kernel/records.ts`) and now also asserts that a checked row
  **finishes** (a refused run would leave the hash unchanged trivially). The four mesh-dependent rows
  (`skel.template.create`, `skel.quickRig.commit`, `.center`, `.faceForward`) need the mesh kernel `opsApp` lacks;
  `skeleton-kernel/quick-rig.test.ts` asserts their keys hash.
- New test files outside the listed dirs (no other owner): `editor-core/test/m6b/skeleton-kernel/**`,
  `editor/test/m6b-skeleton-kernel-test-api.test.ts`.
- C0's `READY` flag files: `c2: true` in mesh-core, rig, io and editor-core.

- E2E-M6B-00 (C0's spec), literal update: its MVP sample holds three C2 ids (`skel.template.create`,
  `skel.joint.orient`, `skel.joint.mirror`); with nothing selected they now refuse with their real reasons ("Select the
  meshes to rig", "Select joints first") instead of "not available yet" (`LANDED` map in the spec).

## Benches (report only; reference Mac under load average ≈ 20–90 from other agents)

| Row | Cube Lad (192 tris) | Polybot T (2,130) | body ×16 (7,904) | body ×64 (31,616) |
|---|---:|---:|---:|---:|
| `guessMarkers` (budget ≤ 50 ms at 10k) | 0.42 ms | 0.52 ms | 0.58 ms | 1.0 ms |
| `fitQuickRig` (one preview frame) | 0.025 ms | 0.035 ms | 0.067 ms | 0.19 ms |
| `quickRigStartChecks` | 0.004 ms | 0.017 ms | 0.051 ms | 0.18 ms |
| `TriangleBvh` build | 0.07 ms | 1.8 ms | 7.6 ms | 41 ms |

`m6b-query.bench.ts` (64 rays / points): sphere 9,800 tris — build 12 ms; `raycastAll` 0.042 ms (reference 11.4 ms);
`closestPoint` 0.46 ms (reference 21.7 ms); torus 25,600 tris — build 35 ms; `raycastAll` 0.045 ms (reference 30 ms).
The build sorts each node's triangles (n log² n); Quick Rig caches the geometry per revision, so it runs once per
session start or model edit.

## Gates (local, real Chrome; port 3162)

`EKZA_E2E_PORT=3162 pnpm run ci` on `340ac9e` + the E2E-M6B-00 literal update, machine load average 70–100 (other
agents' runs):

- format:check, lint (`oxlint --type-aware`), typecheck, check:deps (15 packages), check:fixtures, check:licenses: pass.
- test (turbo 15/15) pass on the second run. The first run had two unrelated timeouts under load (io
  `project.test.ts` "round-trips a snapshot…" 30 s and mesh-core `bevel/clamp.test.ts` property case 30 s); both pass
  alone (11/11, 7/7).
- build: pass. check:size: route 890,865 B (gate 900,000 B); **M6b MVP eager delta +1,296 B** (C0 measured +1,535 B
  on its branch: C2 adds no eager bytes; all its code is in the `rig-workspace` chunk, 36.8 kB, and the e2e test-API
  chunk).
- test:e2e (project `chrome`): 217 passed, 23 skipped, 2 failed — E2E-M6B-00 (the literal above, fixed) and
  E2E-MOD-30 (the Seed-san outline ratio 0.166 vs < 0.1, a known load flake, C0 notes); both specs rerun alone on
  3162 after the fix: 5/5 passed. The 3162 server was Playwright's own and stopped with each run; the port is free.
- New C2 suites: rig `m6b-skeleton` 62 tests; editor-core `m6b/skeleton-kernel` 18 (+ 3 gated on `c1`/`c4`); editor
  test-API 2; the P-C6 table runs 10 C2 rows.

## Not done / left to others

- P-J2 runs on the Standard 33 template skeleton with a world-delta pose (skinning matrices within 1e-9) and the
  key-conversion identity; Seed-san-as-records needs C1's `skeletonFromDoc` over an asset and is not in this suite.
- The P-C6 rows of `skel.template.create`, `skel.quickRig.commit`, `.center`, `.faceForward` stay `pending` in the
  table (no mesh kernel in `opsApp`); their keys hash is asserted in `skeleton-kernel/quick-rig.test.ts`.
- `skel.joint.rename` is built (the optional §0.3 item).
- E2E owned: none (C3 owns the Quick Rig and joint UI scenarios).
