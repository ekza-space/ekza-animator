# M2a A1 — Rig IK: build notes

Branch `m2a/rig-ik` (from `dev`, with `m2a/contracts-foundation` merged). Scope:
[M2A-SPEC §8 A1](../M2A-SPEC.md#a1--rig-ik-packagesrig-the-io-skeleton-reader). The spec names this file `m2a-a1.md`
(§3 rule 6); the work package's task asked for `m2a-rig-ik.md`, so the notes live here (as A0's do). Decision IDs
below are `M2A-A1-<n>` for DECISIONS-OPEN §F.

## What landed (by spec responsibility)

| A1 item | Where |
|---|---|
| §5.2 records, `autoRig` `ik` option (`AUTORIG_VERSION` of IK rigs '0.3.0') | `rig/src/limb/{records,template}.ts`, `rig/src/autorig/autoRig.ts` |
| §5.2.3 foot parameters, `validateFootParams`, `footprintShape` | `rig/src/limb/foot.ts`; the support function in `io/src/skeleton/{support,radii,read}.ts` |
| §5.3 `ik2` op (foot roll in the foot frame, blend, follow and toes rules, `false` at ikFk 0), rest-exact solver | `rig/src/limb/ik2.ts`, `rig/src/ik/core.ts` (allocation-free `TwoBoneCore`), `solveTwoBoneIk` with `restReach` in `rig/src/ik/twoBone.ts` |
| §5.4 compile rules, `RigProgram.limbs`, `registerBuiltinRigOps` registers `solver:ik2` | `rig/src/compile/compileRig.ts`, `rig/src/kernel/{ops,program,internals}.ts` |
| §5.6 matching (`limbOfControl`, `evaluateWithLimbMode`, `matchFkToIk`, `matchIkToFk`, `ikControlForEndWorld`, `footPivotWorlds`) | `rig/src/limb/match.ts` |
| §5.8 import to IK with the fidelity check and the per-limb FK fallback | `rig/src/import/{ik,core,raw,humanoid}.ts` |
| §5.8 Plant Feet on IK legs | `plantFeetChannels(…, channels?)` in `rig/src/ik/plantFeet.ts` |
| §5.8 influencing curves (`computeStepSchedule`, `computeInfluenceKeyTimes`) | `rig/src/schedule/{influence,steps}.ts` |
| §5.8 mirroring and the pose clipboard with attributes | `rig/src/mirror/mirrorPose.ts`, `rig/src/pose/clipboard.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M2A-A1-1 | **Knee hinge from the lower leg** (deviation of §5.2.1): legs use `x̂⁰` = the rest direction of the lower leg (`normalize(x̂⁰_L × (0, 0, −1))`), arms keep the upper arm. Straight legs give the same hinge; the R07 table still applies when the cross product is short. | Polybot's thighs splay 28.6° outward over vertical shins. The upper-bone formula tilted Polybot's knee hinge by 28.6° in the frontal plane, so knee flexion about x — the FK controls' and the normalized humanoid convention — was no hinge motion: E2E-M2A-06's clip kept Polybot's left leg FK at 11.0° (spec: IK). With the lower leg it imports as IK (0.05°, 0.003 mm). The spec's own rationale ("the shin swings back") names the lower bone. |
| M2A-A1-2 | **Match pole rule relative to the IK's own knee** (refinement of §5.6): β is the spec's `smoothstep(2°, 10°, θ)·smoothstep(0, 0.5, m̂·h)`, but the blend turns `h` about `x̂` by `β·ψ`, where ψ is the signed angle from the knee offset the IK produces with the pole along `h` to the FK knee offset `m` (one extra evaluation). The pole sits at `b + p̂·D − (m − (m·p̂)p̂)`, so its offset from the hip–ankle line points along `p̂` (the op's twist aligns the hinge-implied direction with that offset). | `normalize((1 − β)h + βm̂)` assumes `m̂ = h` for every hinge pose, which holds only when the rest bend lies exactly in the hinge plane. Seed-san's knees are 0.7° off it, so the literal rule left a 0.22° / 0.06 mm error on hinge poses (gate: 1e-6); Polybot's splayed legs are far off it. With ψ every hinge pose gives ψ = 0 (exact M1-style pole on both fixtures), an off-hinge knee (mocap ab-duction or twist) turns the IK bend plane to contain the actual knee, near-straight and hyperextended limbs (β = 0) use `h`, and the direction stays continuous (≤ 1e-3 rad for 1e-4 rad input changes, unit gate). |
| M2A-A1-3 | **Amendment B always, plus amendment C** (`ik/core.ts`): the op's twist always aligns the hinge-implied direction `x̂ × k` with the pole (the spec does it only for `|m| ≤ 1e-3·L`; `m` is used when `x̂ ∥ k`), and the bend about the hinge may go below 0 down to the rest's own bend (`min(0, β⁰)`). | For rests bent about their hinge both choices agree. Rests that bend off the hinge (Polybot) would swing the knee sideways as the leg flexes if `m` were aligned with the pole. Hyperextended rests (Seed-san's elbows −1.4°, Polybot's −4.9°) are reached at rest without flipping; closer targets flex the normal way. Rest exactness holds within 1e-7 on both fixtures, all four limbs. |
| M2A-A1-4 | **Rest pole** = `b⁰ + h⁰·(l1 + l2) − m⁰_off` with `m⁰_off` the part of the rest bend outside the hinge plane (`limb/records.ts`). | Equals §5.2.2's `b⁰ + p̂⁰·(l1 + l2)` for rests bent about the hinge or straight; keeps the rest twist exactly zero for off-hinge rests (pole in front of the knee, not beside it). |
| M2A-A1-5 | **Foot region of the mesh**: the rig measures the support of the foot node's whole subtree (toes and helper joints such as Seed-san's `heel.L`, which carries the heel), and the io reader counts a humanoid lower leg's vertices below its foot's rest position for the foot (contract comment of `SkeletonDesc.boneSupport` amended). | Polybot skins its heel 100 % to the shin, so the foot-dominant vertices all lie in front of the ankle and the heel fell back to the guess (8.2 cm instead of the mesh's 5.7 cm). Now both fixtures meet the 3 mm gates against three.js skinning. |
| M2A-A1-6 | **`matchIkToFk` matches the IK side only** (IK control and pole); `fk.toes` keeps its channels. With a ball roll the IK toes stay planted by the toes rule, so they differ from the FK toes by the ball roll (and the toes joint, above the ground ball pivot, moves by about its height × roll). Errors (`endErrorM`, `midErrorM`, `maxRotationErrorRad`) cover the three chain bones. | §5.6 lists only the IK control, twist and pole; keying `fk.toes` in a switch would change the FK pose at `f − 1` (seamless rule) and `matchRange` keys "the side controls and nothing else". |
| M2A-A1-7 | **Influencing curves skip ik2 limbs inactive over the clip** (`clipOpActivity`): a limb whose `@ikFk` has no keyed curve and a static value or default ≤ 0, or a stepped curve without linear extrapolation whose every key value is ≤ 0, adds nothing (its op writes nothing in that clip). Any other `@ikFk` curve counts conservatively. | §5.7: an M1 rig upgraded with `rig.addLimbIk` exports byte-identical files. Without this, the op's reads (e.g. `fk.lowerLeg` for the thigh track) made stepped tracks LINEAR. Headless gate: bake into the model, VRMA and animation GLB byte-identical. Also the import FK fallback (one stepped `@ikFk` 0 key) keeps the M1 schedule. |
| M2A-A1-8 | **Plant Feet on IK legs**: `plantFeetChannels(program, pose, pins, reference, channels?)` gives a leg whose `ikFk ≥ 0.5` IK control channels (`W_ik = Pin · K_end⁻¹ · F⁻¹`, `solveControlChannels`, eulerNear the reference); FK legs get the M1 solve. Attributes come from `channels`, else from the `'@name'` entries of `reference` (missing ones at their defaults). An IK pin out of the leg's reach warns like the FK path. | The operator (`pose.plantFeet`, A2) passes `currentValues` (TRS only today): **A2 passes the evaluated channel buffer, or merges `evaluation.attrValues` into the reference.** Until then a leg reads its default (legs 1), which is right unless a clip keys `@ikFk` or the roll. |
| M2A-A1-9 | **Import to IK details**: the IK keys sit at the union of the key times of the FK chain controls and their control ancestors (hips and cog motion moves the foot); their tangents are `step` when every contributing group is stepped, `auto` when any is auto or Hermite, else `linear` (IK keys are derived values, never Hermite); rotation channels that stay at rest are not written (M1 rule); `@twist` is not keyed. Rows and warnings follow `LIMB_IDS` order. Arms at their default ikFk 0 are not considered. | §5.8; deterministic reports. |
| M2A-A1-10 | **A second ik2 solver on the same limb** warns (`duplicate-binding`); the first in solver-id order owns the limb's state. A rest bent > 2° against the hinge warns `asymmetric-rest` ("L Arm: the rest pose bends the elbow 4.9° against its hinge (hyperextended); IK bends it the normal way for targets closer than the rest"). | §5.2.1, §5.4 rule 4. |
| M2A-A1-11 | **Toes rule at `0 < w < 1`**: `C_w = K_end⁻¹ · Ball(w·ballRoll)⁻¹ · K_end`. | Equals §5.3 step 6's `slerp(I, C, w)` with the same pivot, without a slerp per frame. |
| M2A-A1-12 | **No allocation per evaluation**: per-frame numbers pass through buffers (a double argument or return value of a call the optimizer does not inline is boxed), the kernel's read-back of op-written worlds uses indexed loops, and `xfaFromMat4` uses `Math.sqrt` instead of `Math.hypot`. The unit bench evaluates an IK rig 60,000 times without a young-generation collection. | §8 A1 DoD. `xfaFromMat4` also serves the inverse solvers, whose last bits may differ from M1 (Plant Feet, matching); exports do not use it. |
| M2A-A1-13 | **Pole continuity gate** (§8 A1): "pole curves move by ≤ 0.05·L between consecutive frames" does not hold for a 24 fps walk with the pole L in front of the knee: on UAL `Walk_Loop` the pole travels 0.16·L per frame at mid-swing, smoothly (the leg swings ~9° per frame). The headless gate checks the intent instead: per frame the pole's direction from the knee turns no more than the thigh and shin do (+0.05 rad; measured −0.015 rad), and reports the travel. The synthetic unit walk (36 frames per cycle at 30 fps) keeps the literal 0.05·L. | A flip would turn the pole by ~180° in one frame. |

## Spec findings for other packages

| For | Finding |
|---|---|
| A2 (E2E-M2A-05) | Seed-san's arms are a straight T-pose: after `cog ty −0.05` the hand is 2.6 mm out of reach (the IK does not stretch) and moves 3.0 mm, so "the hand world is unchanged (1e-6)" cannot hold. Bend the arm first (e.g. the IK hand 8 cm towards the body, as the headless gate does) or move the cog towards the hand. |
| A2 (E2E-M2A-02) | Polybot's knee sits 9 cm outward of the hip–foot line (a frontal-plane rest bend), so `pole.leg.L tx +0.3` turns the knee cap outward and the knee moves 25 mm back and 8 mm **inward** (x −0.0083); on Seed-san the knee moves +4.1 mm in x. "Knee world x increased by > 5e-3" fails on both; the foot stays (1e-16). Suggested: the knee offset ⊥ hip→foot turns towards the pole by > 5°, or the knee moves by > 5e-3. |
| A2 (Plant Feet) | M2A-A1-8: pass the channel buffer (or attribute values) to `plantFeetChannels`. |
| A2 (E2E-M2A-06) | Holds at the rig level with M2A-A1-1 (headless `rig.ik.import`: left leg IK, right leg FK with the warning, positions within 1e-4 m of an FK-only Polybot, rotations within 1e-3 rad). |
| A5 (keep set) | `computeInfluenceKeyTimes` is ready (READY.a1); it applies M2A-A1-7 per clip. |

## Tests

- rig unit: `limb-records` (records, controls, attributes, `Ik2Params`, `rig.addLimbIk` mode, skips and warnings,
  hinge and rest pole, foot parameters from synthetic support data and the fallback, `validateFootParams`,
  `footprintShape`), `limb-op` (rest exactness, ikFk 0 bit-identical property, FR-RIG-11, reach and soft
  monotonicity, pole plane and twist, end rotation, `solveTwoBoneIk` with and without `restReach`, blend at 0.5,
  follow and toes rules, the foot-roll gates on both feet with both bank signs, mirrored bank and roll (1e-9), the
  15° toed-out rig, compile rules, `LimbDesc`, allocation), `limb-match` (FK → IK → FK round trips on three rests,
  foot roll, hyperextension −2°/−5° on knees and an elbow, pole continuity on non-hinge poses, the pole basis, the
  off-hinge knee, Plant Feet on IK legs), `limb-import` (raw and humanoid clips through IK legs, FK fallback,
  `ik: 'none'`, `ikTolerance`, pole continuity), `limb-influence` (IK control, pole, attribute, cog, fk.hips and
  spine keys; STEP on cog; activity rule; upgraded M1 rig = M1 sets), `limb-clipboard`; `attributes.test.ts`
  expects the `ik2` registration.
- io unit: `skeleton-support.test.ts` (support samples, dominant weights, the foot-region rule, the fixtures' heels).
- headless: `rig.ik.fixtures` (rest exactness 1e-7 with four IK limbs on Seed-san and Polybot, FR-RIG-11, fingers
  under arm IK, ikFk 0 bit-identical to the M1 rig, foot parameters against three.js skinning within 3 mm and the
  fallback, the foot-roll gates with E2E-M2A-04's numbers and the mirror, match and hyperextension on the fixtures,
  Plant Feet on IK legs, the bench), `rig.ik.import` (Seed-san humanoid clip ≤ 1e-5 rad / 1e-6 m, E2E-M2A-06's clip
  on Polybot, UAL `Walk_Loop` on a humanoid-mapped UAL), `rig.ik.export` (upgraded M1 rig exports byte-identical,
  a switched limb changes the bake). The M1 rig gates are unchanged (they call `autoRig` without `ik`).
- Bench (report, best of 8 interleaved rounds under a load average of ~45): Seed-san with four IK limbs 0.043 ms
  per evaluation (target ≤ 0.06 ms), the same rig at ikFk 0 0.029 ms, the M1 rig 0.027 ms.

No e2e scenario belongs to A1 (§8: E2E-M2A-01…07 and 25 are A2's, E2E-M2A-15 A4's); they stay `test.fixme` until
A2 merges.
