# WP-3 — `@ekza-animator/rig`: build notes

Status: 2026-10-17. Every responsibility of MVP-SPEC §7 WP-3 is implemented, including the M1-stretch items
`convertRotateOrderKeys` (pose-preserving rotate-order change) and `remapRawClipByName` (stretch consumer).
Unit tests live in `packages/rig/test` (synthetic skeletons only); the fixture gates live in
`packages/headless-tests/test/rig.*.test.ts`.

## Module map (`packages/rig/src`)

| Directory | Contents |
|---|---|
| `humanoid/` | VRM 1.0 tables (`bones.ts`, from M0), buffer indices, side/stem/template-key helpers (`map.ts`), canonical rest worlds, `humanoidRestWorldPositions`, `flipYawHumanLocal` (`rest.ts`) |
| `autorig/` | `autoRig` entry, `readRigDefinition`/`writeRigDefinition` (`autoRig.ts`); humanoid FK template (`humanoid.ts`); generic 1:1 and secondary controls (`generic.ts`); sizes, offsets and shapes (`shapes.ts`); naming, order keys, L/R inference (`naming.ts`); control specs → records (`spec.ts`) |
| `compile/` | `compileRig` (graph, slots, repair; `compileRig.ts`), deterministic Kahn sort with cycle repair (`schedule.ts`), bone references (`bones.ts`), offsets/bind offsets/mirror/humanoid bookkeeping (`build.ts`), structural warnings (`warnings.ts`) |
| `kernel/` | the stateless evaluator (`program.ts`), compiled data shared with the solvers (`internals.ts`), op registry (`ops.ts`), `controlWorld` (`pose.ts`) |
| `math/xfa.ts` | structure-of-arrays (t, q, s) transforms used by the kernel and solvers (no allocation) |
| `sampler/` | `createCurveCache`, `createClipSampler` (`cache.ts`); channel slots, `read/writeControlChannels`, `applyOverrides` (`channels.ts`) |
| `inverse/` | `solveControlChannels`, `solveBoneChannels`, `controlForNode`, `nodeForControl`, `isHumanoidProgram` |
| `import/` | glTF sampler evaluation (`sample.ts`), shared solve/key/tangent/reduce machinery (`core.ts`), `importRawClip` (`raw.ts`), `importHumanoidClip` (`humanoid.ts`), `detectClipFps` (`fps.ts`), `remapRawClipByName` (`remap.ts`) |
| `ik/` | `solveTwoBoneIk` (`twoBone.ts`), `plantFeetChannels` (`plantFeet.ts`) |
| `mirror/`, `pose/`, `schedule/` | `mirrorPose`; pose clipboard and `convertRotateOrderKeys`; `computeStepSchedule` |

## Test status and gating

- `packages/rig`: 104 tests pass. Two are skipped until WP-1 lands (they probe for the anim-core stub and turn on
  by themselves): import reduction (`reduceKeys`) and rotate-order conversion of unsynchronized curves
  (`curveEngine`).
- `packages/headless-tests/test/rig.definition.test.ts`, `rig.sampler.test.ts`: run now against the shared test
  kit (`createNaiveStore`, `naiveCurveEngine`), convention 12.
- `packages/headless-tests/test/rig.fixtures.test.ts` (zero pose on the three fixtures, three-vrm parity with the
  vrm0 mapping, Seed-san secondary filtering, generic rig on UAL, UAL `Idle_Loop` import vs three's
  `GLTFLoader`, UAL reduction, Polybot Plant Feet, Seed-san bench): `describe.skipIf` on a probe of WP-4's
  `parseGlb`/`skeletonFromGltf`/`readAnimations` stubs (vitest has no `test.fixme`; the probe flips the gate when
  WP-4 merges, MVP-SPEC §8.1 step 4). The reduction gate also probes WP-1's `reduceKeys` and `curveEngine`.
- **Pre-merge evidence for the fixture gates.** Before WP-4 exists, the same assertions were run with a throwaway
  `SkeletonDesc`/animation extractor written in the test (built on `readGlbJson`/`skeletonNodeOrder` from
  `io/testing`; not committed, because it would be a private stand-in for WP-4's readers). Result on this branch:
  all gates pass — zero pose ≤ 1e-9 on Seed-san, Polybot and UAL; three-vrm parity ≤ 1e-6 on Seed-san and
  Polybot; secondary filtering on Seed-san; generic 1:1 rig on UAL; UAL `Idle_Loop` at 24 fps on frames 0…60
  within 1e-5 rad / 1e-5 m of three's `AnimationMixer`; Polybot feet back on their pins within 1e-4; **Seed-san
  evaluate 0.030 ms/pose** (92 controls, 147 nodes; budget 0.5 ms). Only the reduction gate (needs WP-1) was not
  exercised.

## Deviations and interpretations (smallest sane choices; recorded, not silent)

| # | What | Why | Where |
|---|---|---|---|
| R-1 | Finger lollipops are emitted as `shape.kind: 'custom'` with an explicit `SplineSet` (stick + 24-segment head circle, in shape units scaled by `size`), oriented so local +X follows the finger and +Y the dorsal normal. | §4.11.15 fixes the stick length to `(0.02 + 0.008·joint)·H` while the head radius `size` is clamped from mesh radii; their ratio varies per joint and per model, which a rigid unit `lollipop` registry shape cannot express (a non-uniform `offset.s` would distort the head). | `autorig/shapes.ts` |
| R-2 | The root's "`arrow4` + `circle`" is one `custom` shape: a 48-segment unit circle with four closed arrows reaching 1.5 units out along ±X/±Y, laid on the floor. | A `ControlShape` has a single `kind`. | `autorig/shapes.ts` |
| R-3 | The jaw (absent from the §4.11.15 size table) uses the hands/feet rule (`max(0.15·ℓ, 0.04·H)`, clamp 0.03–0.1·H, centred 0.5·ℓ down the bone). | Keeps the jaw circle inside the head circle. | `autorig/shapes.ts` |
| R-4 | The kernel composes **similarity transforms (t, q, s) in float64**, not 4×4 matrices (ADR 0004 "Consequences" mentions matrices). Exact for uniform scale (all humanoid rigs and the three fixtures' driven bones except Polybot's secondary joints `bag_rope_*` and `hair_E`); with non-uniform scale on a **driven** bone it approximates the matrix product and `compileRig` warns `non-uniform-scale`. Undriven bones always output their rest locals exactly, so skinning is unaffected; only control placement and `humanLocal` under such bones differ from three's matrices. | Allocation-free, quaternion-native evaluation that decomposes without shear noise; the zero-pose and parity gates are exact. A matrix path can be added per node if a real asset needs it. | `math/xfa.ts`, `kernel/program.ts`, `compile/warnings.ts` |
| R-5 | Sided controls without a counterpart get the warning code `asymmetric-rest` (message "no mirror counterpart"). | `RigWarning.code` has no dedicated code; `asymmetric-rest` is the closest. Request below. | `compile/warnings.ts` |
| R-6 | `createClipSampler` keeps one curve per `(control, channel)` of the base layer — the smallest `CurveId` — even if the store's `curvesOfClip` lists duplicates. | ARCHITECTURE §4.2 projection rule; the `DocQueries.curvesOfClip` contract does not say whether duplicates are listed (the test kit hides them, WP-2 may not). Request below. | `sampler/cache.ts` |
| R-7 | Rig functions accept any `RigProgram` implementation: compiled data is looked up by identity (`WeakMap`) and derived once from `program.controls`/`skeleton` (slot order = `controlIds`) for programs `compileRig` did not create (e.g. the test kit's naive program). | Convention 12 lets other WPs test with the kit's program while using real rig solvers. | `kernel/internals.ts`, `compile/build.ts` |
| R-8 | Registered rig ops (`registerRigOp`, V1 extension point) overwrite worlds in `pose.controlWorld`/`pose.boneWorld`; the kernel re-reads the declared written entries before scheduling anything downstream. An op is scheduled after every world it reads or writes and before the children of what it writes; ops touching the same worlds run in `(kind, id)` order. A second registration of the same `kind:type` throws `EkzaError('unsupported')`; an op whose `reads`/`writes` throws, references missing controls/nodes or closes a cycle is disabled with a warning. | ADR 0004 §6–7 leaves the slot semantics to the implementation. | `kernel/ops.ts`, `compile/compileRig.ts` |
| R-9 | CUBICSPLINE translation/scale import: the `fixed` Hermite handles take the one-sided time derivatives of the **solved control channels** (second-order differences, h = 1e-5 s) at each key, converted to slope per frame (`· den / num`), with `dt = ±span/3`. | For a 1:1 control chain this equals the source tangent mapped through the rig (the §4.11.6 rule), and it stays correct when the control frame differs from the node frame (cog, world-aligned controls). | `import/core.ts` |
| R-10 | Curves that are constant at the channel default are detected with the reduction tolerance of their kind, or 1e-6 when `reduce` is null (float32 source noise on constant scale tracks is ~1e-7). | §4.11.6 "within tolerance". | `import/core.ts` |
| R-11 | `autoRig(…, { kind: 'humanoid' })` without the 15 VRM-required bones throws `EkzaError('unsupported')`; `importHumanoidClip` onto a non-humanoid program throws `EkzaError('unsupported')`. Neither throws on document content. | Invalid caller input (convention 6). | `autorig/autoRig.ts`, `import/humanoid.ts` |
| R-12 | Not rigged: eyes, humanoid bones that are `VRMC_node_constraint` destinations, spring-bone joints, and non-humanoid joints with no driven ancestor (no control could carry them). Their imported motion is dropped with a warning. | §4.11.9, ADR 0004 §9 ("never controlled"). | `autorig/humanoid.ts`, `autorig/generic.ts` |
| R-13 | `mirrorPose` `leftToRight`/`rightToLeft` leave centre controls untouched; `flip` mirrors them in place. Generic and secondary (bone-aligned) controls mirror their local transform in character axes, `L' = R'⁻¹·M·(R·L·R⁻¹)·M·R'` with the two rest rotations (exact involution). | §4.11.20 defines `flip` for centre controls only. | `mirror/mirrorPose.ts` |
| R-14 | Humanoid step schedule (`target: 'humanoid'`): the influencing controls of humanoid track `h` are the chain of the control driving `h` (or its nearest driven ancestor) plus the chain of the control driving `h`'s normalized parent. | §4.11.10 step 3 names the raw case ("parent bone"); `N_b` depends on the normalized parent instead. | `schedule/steps.ts` |
| R-15 | Plant Feet treats non-humanoid nodes between the upper leg, lower leg and foot (twist bones) as rigid at their rest relation. | Matches the FK-leg scope of §4.11.19; a posed twist bone would otherwise move the solve target. | `ik/plantFeet.ts` |

## Requests for cross-package / contract decisions

1. **`DocQueries.curvesOfClip` and duplicates** (WP-2, §4.2): state whether duplicate curves of one channel are
   listed or only the canonical one. Rig is safe either way (R-6).
2. **Lollipop shape** (WP-1/WP-5, §4.11.15): either accept `custom` lollipops (R-1) or give the registry
   `lollipop` a stick-length parameter. WP-5 must draw `custom` shapes scaled by `size` like built-in shapes (the
   finger lollipops and the root rely on it).
3. **`RigWarning.code`** (§4.3): add `'unpaired-mirror'` for sided controls without a counterpart (R-5).
4. **ADR 0004 "Consequences"** says world composition uses 4×4 matrices; the kernel uses similarity transforms with
   a warning on non-uniform scale (R-4). Either amend the sentence or keep it as a V1 item.

5. **Facing check threshold** (§4.11.9, E2E-03 — WP-8/WP-10): `f = normalize((W(leftUpperLeg) − W(rightUpperLeg)) ×
   (W(head) − W(hips)))` also measures how far the head sits forward of the hips. On Polybot (correct facing) the
   head is 2.8° ahead, so `f · (0, 0, 1) = 0.99882` and the `> 0.999` bound fails; Seed-san gives 0.99917.
   Suggest testing the horizontal part (`f.z / hypot(f.x, f.z) > 0.999`; both fixtures ≈ 1.0) or lowering the bound
   to 0.998 — a wrong facing gives −1 either way. `rig.fixtures.test.ts` checks both of these.

## Dependencies on other WPs

- WP-1: `curveEngine` (default engine of `createCurveCache`, `convertRotateOrderKeys`), `reduceKeys` (import
  reduction), `getControlShape` is not used (shapes are built in `autorig/shapes.ts`).
- WP-2: the memory store replaces the test kit's naive store in `rig.sampler.test.ts`/`rig.definition.test.ts`
  (only the factories change).
- WP-4: `parseGlb`, `skeletonFromGltf` (must produce the B-16 node order, `boneRadii`, `springJoints`,
  `constrainedNodes`, VRM 0.x thumb aliases) and `readAnimations` turn on `rig.fixtures.test.ts`.
