# AUTORIG A0 — `a-pose` (the A-pose path in Studio)

Branch `autorig/a-pose` from `autorig/mvp` with `autorig/contracts` (D0) merged first. Spec: AUTORIG-SPEC §10 A0
(binding), M6B-SPEC §5.7, §5.8, §5.17, §0.4.2.

## What landed

| Part | Where | Notes |
|---|---|---|
| `tStancePose(joints, skeleton)` | `rig/src/joints/rest.ts` | per side, root-first, exactly `skel.tpose`'s four segments (upper arm → lower arm, lower arm → hand, hand → tail to ±X; lower leg → foot to −Y); a turn about Z only at the segment's start joint, inherited by its subtree; thighs never turned; within 0.1° untouched; returns the pose deltas M_j (W_j(P) = M_j·W⁰_j) and the turn per start joint |
| `applyPoseAsRest(joints, boneWorld)` | same (the `joints/index.ts` stub replaced by its re-export) | §5.7 record rule: `restPosition` posed; `restRotation` identity kept for identity-rest joints, else q(W_j(P)); `tail` = M_j × old tail; a joint whose delta is within 1e-12 of identity keeps its record (bit-equal) |
| `restWorldOf`, `posedWorldOf`, `poseDeltaOf`, `isIdentityMat4`, `T_STANCE` | same, exported from `rig` | |
| A-pose guess calibration | `rig/src/quickrig/guess.ts` | see "Contract PR to M6B §0.4.2" below |
| `bakeSkinnedPoints`, `bakeSkinnedMesh` | `mesh-core/src/skin/pose/` | v′ = v + Σ (wₖ/S)(Mₖ·v − v): points at rest bit-equal; float32 positions; `normal.custom` and `morph:*` turned by the blended linear part; every other array (skin layers included) shared |
| `skel.pose.tStance {character?}` | `editor-core/.../rig/restPose.ts` | the T-Stance solved into control channels (`solveBoneChannels` on the rest pose) as the test pose (one 'Test Pose' step); an IK limb it bends gets `@ikFk = 0`; view → Test |
| `skel.pose.applyAsRest {character?, pose?}` | same | one undo step ("Straighten to T-Pose" for `pose: 'tStance'`, "Apply Pose as Rest" for the test pose); prepare: `prepareAutoRig()`, the pose deltas; apply (one transaction): LBS bake of every bound mesh, the joint records, the test pose cleared, `writeAutoRigUpdate` |
| `skel.tpose` Fix | `editor-core/src/rig/validation/rows.ts` | `skel.pose.applyAsRest {character, pose: 'tStance'}`, label "Straighten to T-Pose" |
| checklist ② | `editor-core/src/rig/validation/checklist.ts` | "A-posed: Bind Skin, then Straighten to T-Pose" while `skel.tpose` is the only `skel.*` error |
| `A_POSE_NOTICE` | `quickRigSession.ts` | "A-posed arms: the skeleton follows them; after Bind Skin, Straighten to T-Pose makes the rest a VRM T-pose" |
| Skeleton menu | `editor/src/shell/menus/rig.ts` | T-Stance · Apply Pose as Rest · Straighten to T-Pose (group `pose`, between Build and Update Control Rig) |
| Clips confirm | `editor/src/dialogs/ApplyPoseAsRestDialog.tsx` | replaces D0's stub; `DialogHost.tsx` untouched |

## Design notes

- **Undo restores the test pose.** The test pose is session state; the runner records only the document and override
  parts of an operator's step. `restPose.ts` keeps, per app, the test pose a straighten cleared keyed by the step it
  recorded (a history listener matches the new top step by label after the run); the step's undo puts that pose back
  (`testPose.set(…, {record: false})`, Rig & Skin only) and its redo clears it again. So one undo step restores rest,
  points and test pose; `pose: 'tStance'` from the bind view has an empty pose either way.
- **The in-transaction control rig equals a fresh one.** `writeAutoRigUpdate` measures control shapes (radii, height)
  through `app.meshes`, whose runtimes take a revision written in a transaction only once it settles, so it would size
  them on the A-posed mesh. `applyAsRest` passes it an `app` view whose `meshes.get(id).data()` returns the baked
  revisions (`withRevisions`, a Proxy), and the rig equals a fresh `rig.autoRig.update` afterwards (tested: the
  controls, solvers and rig tables are bit-equal).
- **Clips confirm.** A UI run (`keyboard`, `menu`, `toolkit`, …; not `card` or `api`) on a character with clips (test
  clips excluded) records no step, sets `dialog: 'applyPoseAsRest'` and remembers its character and pose; the dialog's
  Apply re-runs `{confirm: true}`, which takes them (the step label comes from `tx.annotate`). Headless runs never ask.
  The dialog counts the Rig & Skin character's clips: the operator makes the asked character the Rig & Skin character
  when it asks (editor-core's root barrel is not in A0's Dirs, so the dialog cannot import a request reader).
- **Refusals.** No model character ("Make a character from your model first"), an imported avatar (M6b's
  `ASSET_CHARACTER_REFUSAL`; imported avatars are where a `modification: prohibited` licence lives), no skeleton, any
  character mesh unbound ("Bind Skin first: the mesh follows the skeleton only once it is bound"), `pose: 'test'`
  without a test pose ("Pose the character first (T-Stance)"). T-Stance needs Rig & Skin.
- **Size.** T-Stance finds the FK limb inline: importing rig's `limbOfControl` from the lazy chunk made the eager
  module export its binding (+52 B on `/editor`). Measured with `clean:next` + production build: base (29fd7b0)
  `/editor` 895,732 B, `/autorig` 134,011 B; A0 `/editor` 895,728 B, `/autorig` 134,011 B → **eager delta ≤ 0 B**
  (−4 B: chunk-name hashes).

## Contract PR to M6B §0.4.2 (guess thresholds; A-posed arms only)

C2's guess on A-posed Polybot missed the §5.8 gate: shoulder 0.067 H, wrist 0.076 H. Two constants for arms whose
angle exceeds `aPoseAngle` (15°), T-posed arms bit-identical to M6b (every `m6b-skeleton` test unchanged):

- `GUESS.aPoseWristPullBack = 1.5` hand lengths (T-pose keeps 1.0): a hanging arm's outer ends reach past the hand
  along the arm line. Swept 1.3–1.7; 1.5 balances wrist and elbow (1.6 moves the shoulder past 0.017 H).
- The shoulder of a hanging arm slides along the shoulder → elbow line to the middle of the armpit gap (the torso's edge
  and the arm's inner edge in the band's topmost row where the arm is separated from the torso) instead of the torso-
  edge clamp (which put Polybot's shoulder 0.04 m inside its true position).

| A-posed Polybot, One-Click guess vs the A-pose truth markers (H = 1.064 m) | M6b | A0 |
|---|---|---|
| headTop / chin / pelvis | 0.0001 / 0.0341 / 0.0314 | same |
| shoulder / elbow / wrist | **0.0671** / 0.0403 / **0.0763** | 0.0109 / 0.0293 / 0.0242 |
| knee / ankle / toe | 0.0268 / 0.0133 / 0.0316 | same |
| arm angle (truth 44.5°, shoulder → wrist) | 43.0° | 43.0° |

The fit on the synthesized A-pose markers: every humanoid joint within 0.027 H (thumb metacarpal; P-J4's 0.03 H).
After straightening, every humanoid joint within 0.05 H of the T-pose truth: truth markers max 0.037 H, One-Click
guess max 0.043 H (thumb metacarpal; the other arm joints ≤ 0.031 H).

## Gates

| Gate | Where | Result |
|---|---|---|
| (1) guess ≤ 0.05 H, arm angle ≤ 5°, bit-identical | `rig/test/autorig-a0/apose.test.ts` | max 0.0341 H, 1.6° |
| (2) fit ≤ 0.03 H | same | max 0.027 H |
| (3) operator: one step, `skel.tpose` gone, joints ≤ 0.05 H of T truth, hand tails ≤ 5° of ±X, tails = M × old (1e-9), thighs and weights bit-equal, template rotations identity, control rig = fresh update, baked = LBS (1e-6), undo restores rest, points, test pose; keys hash unchanged | `editor-core/test/autorig-a0/rest-pose.test.ts` (+ the rig-level twins in `rig/test/autorig-a0/`) | green |
| (4) P-J5 | `rig/test/autorig-a0/tstance.test.ts` | green (aimed chain under the hand: local +X on the child, 1e-9) |
| (5) `tStancePose` units | same | green (0.1° untouched, depth 1e-9 rad, left = mirror(right) bit for bit, deterministic) |
| (6) 35° Cube Lad straightens and exports | rig test + `headless-tests/test/autorig-a0.vrm.test.ts` | green |
| (7) headless VRM: `vrm.*` clean, validators 0 errors, read-back arms ≤ 5° of ±X, shins ≤ 5° of −Y; file | `autorig-a0.vrm.test.ts` → `test-results/autorig-a0/polybot-apose.vrm` | green |
| (8) P-S7 on A-posed Polybot unchanged | `mesh-core/test/autorig-a0/bake.test.ts` | 74.2 % exact, ≥ 98 % within one joint |
| OMOBA validator (admission, local) | `node tooling/omoba-validate.mjs test-results/autorig-a0/polybot-apose.vrm` | **exit 0**: "Compatible local humanoid: VRM 1.0, 35 nodes, 33 semantic bones, 2 scene-0 roots." (sha256 1a079563…f7725f, 461,592 B; cargo printed a harmless global-cache cleanup permission warning) |
| `/editor` eager delta 0 B | `check:size` | ≤ 0 B (above) |
| E2E-AR-A0 | `apps/web/e2e/ar-a0-apose.spec.ts` | 3 tests green (Fix path + export, menu path + undo, clips confirm) |
| M6b A-pose suites unchanged | E2E-QR-02, E2E-RIG-08 | green: they still assert the notice (prefix "A-posed arms") and `skel.tpose` before straightening |

## Deviations and touches outside A0's Dirs (for D7's approval)

- **Three Skeleton items, not two**: T-Stance, Apply Pose as Rest (the test pose) and Straighten to T-Pose. The spec
  names "Straighten to T-Pose (Apply Pose as Rest)" and an E2E "T-Stance + Apply Pose as Rest menu path with the test
  pose"; one static item cannot do both, so both are listed (same file, same group).
- **E2E import**: Studio has no "Create › Import Static Model…" menu item; E2E-AR-A0 imports through the test API
  (`mesh.importStatic`, as E2E-SKIN-01 does). Everything after the import is UI (checklist ①/③, Validation Fix,
  Skeleton menu, the dialog).
- Tests that asserted the D0/M6b stubs of the two operators, updated to the landed operators (no assertion weakened:
  each stub expectation became the real poll or moved to the A0 tests):
  `rig/test/m6b/contracts.test.ts` (the `applyPoseAsRest` not-implemented row), `editor-core/test/m6b/foundation.test.ts`
  (the ids move from DEFERRED to the MVP list with their real poll reasons),
  `editor-core/test/m6b/keys-hash.test.ts` (rows marked pending for A0; the keys hash is asserted in
  `test/autorig-a0/rest-pose.test.ts`), `editor-core/test/autorig/composition.test.ts` (D0's "the moved stubs are
  unchanged" check → not the stub reason, flags `{undo: true}`), `editor/test/m6b-rig-shell.test.tsx` (Skeleton menu
  labels), `apps/web/e2e/ar-00-foundation.spec.ts` (the stub refusal → "Make a character from your model first").
- `rig/src/joints/index.ts`' header comment still lists Apply Pose as Rest among the deferred stubs (only the stub line
  was A0's).

## Observed

- `editor-core/test/builtin/m2a-a4-mirror-properties.test.ts` (a property test) failed once under the full parallel
  editor-core run and passes alone and on the base commit: load-sensitive, unrelated to A0.
