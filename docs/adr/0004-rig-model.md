# ADR 0004 — Rig model: controls-only keying, zero pose = rest, normalized humanoid space

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [07](../research/07-rig-controls-math.md) D1–D10, §3–§5, §8–§10, §15, §19, §21;
  [01](../research/01-dcc-animation-features.md) §3.11, §5.8; [02](../research/02-formats-gltf-vrm.md) §4.1, §7–§8;
  [03](../research/03-ekza-reuse-audit.md) §5.2; [05](../research/05-landscape.md) §4; [08](../research/08-extensibility-modeling.md) §3–4, §9;
  [09](../research/09-ui-ux-spec.md) §5.7–5.9.

## Context

The owner wants DCC-style circle controls around bones, constrained to the bones, and animation through
controls. Exports must target raw glTF nodes (embedded clips) and normalized humanoid space (VRMA). Research 07
proposes a full rig (FK + IK + foot roll + spaces + constraints) for its MVP; the coordinator's MVP keeps FK only,
with constraint and IK slots in the kernel. The design review found that FK-only legs make every COG move slide
the feet, that `cog` without a pelvis control forces counter-animation of the spine, that bone-length sizing makes
finger and thigh controls overlap, and that "control local rotation = N_b" does not hold once the control and
bone hierarchies differ.

## Decision

1. **Curves live only on controls. Bones are never keyed.** A generic skinned GLB gets an auto-generated 1:1 FK
   rig, so "bone mode" runs through the same pipeline. Import maps bones → controls; export maps controls → bones.
2. **Zero pose = rest pose.** Each control stores its rest world transform `W_c⁰` (character space). The offset
   ("zero group") `O_c = (W_parent⁰)⁻¹ · W_c⁰` and the bind offset `K_cb = (W_c⁰)⁻¹ · W_b⁰` are derived at compile
   time. Default channel values (0 for t/r, 1 for s) reproduce the rest pose exactly (tested to 1e-9).
   Reset-to-rest is "set channels to defaults".
3. **Humanoid controls are world-aligned in canonical character space** (+Y up, +Z forward, left = +X). VRM 0.x
   models get a π-yaw `facing` on the character root (three-vrm `rotateVRM0` semantics, applied by us, never by
   calling it), never on bones. Mirroring is a sign flip (`rx, −ry, −rz`; `tx → −tx`) and pose paste works across
   avatars by control template key.
4. **Generic 1:1 controls are bone-aligned** (`W_c⁰ = W_b⁰`), so channels are rest-relative bone-local deltas.
5. **Evaluation is pure and stateless**: `pose = f(rigProgram, channels)`; channels = `f(curves, clipFrame)` ⊕
   session overrides. No dependence on the previous frame (no "No Flip" caches; IK seeded from rest), so
   scrubbing, baking, onion skins and collaborators all agree.
6. **The rig is compiled** (`compileRig(definition, skeleton)`) into a flat, topologically sorted schedule of ops
   over `Float64Array` buffers: `controlWorld`, `constraint` (slot), `solver` (slot), `bindBone`, `boneLocal`.
   Ties are broken by `(opKindPriority, id)` so every peer gets the same schedule. Dangling references disable the
   op with a warning; cycles are broken deterministically (drop the edge whose consumer id sorts greatest). The
   compiler never throws on document content.
7. **MVP op kinds**: `controlWorld`, `bindBone` (`rotate` | `translateRotate` | `full`), `boneLocal`.
   `constraint` and `solver` records exist in the schema (research 07 §19.1) and in the schedule, but the MVP op
   registry has no implementations, so they compile to *disabled* ops. The analytic two-bone IK of research 07
   §9.2 ships in M1 as a **pure function** (`solveTwoBoneIk`) used by *Plant Feet*; V1 registers it as the `ik2`
   solver op without schema changes.
8. **Kernel output** (normative formulas in MVP-SPEC §4.11.9): raw bone locals `L_b = W_parentBone⁻¹ · W_b` with
   the current parent world, `boneWorld`, `controlWorld`, the normalized humanoid rotations
   `N_b = D_hp(b)⁻¹ · D_b` computed **from bone world deltas** `D_b = q(W_b)·q(W⁰_b)⁻¹` (hp = nearest present
   humanoid ancestor; `N_hips = D_hips`), and the hips position. three-vrm's `q_raw = P⁻¹·N·P·B` is the special
   case in which every non-humanoid node between humanoid bones is at rest; the kernel never assumes it. The
   viewport loads VRMs with `autoUpdateHumanBones: false`; the kernel is the only writer of raw bones. The parity
   gate compares the kernel with `vrm.humanoid.update()` fed with `flipYaw(N_b)` for VRM 0.x (three-vrm's
   normalized space there faces −Z) and `N_b` for VRM 1.0, with secondary controls at default (≤ 1e-6).
9. **Humanoid auto-rig (MVP)**: `root` (floor, translate+rotate, pure space) → `cog` (**pure space**,
   translate+rotate, drives nothing) → `fk.hips` (pelvis: drives the hips bone with `translateRotate`, rotate
   keyable) and `fk.spine` (parented to `cog`, so pelvis tilt does not swing the torso) → chest/upperChest/neck/
   head/jaw; shoulders → arms → hands → 30 finger controls; `fk.upperLeg` parented to `fk.hips` → lower leg → foot →
   toes. Only bones present get controls (missing optional bones collapse to the nearest existing ancestor). Eyes
   are not rigged. Non-humanoid skin joints that are not spring-bone joints or `VRMC_node_constraint`
   destinations get hidden-by-default **secondary** FK controls parented to the control that drives the nearest
   driven ancestor bone. Rotate orders follow research 07 §5.2 (`zxy` root/cog/hips/torso/head, `yxz`
   shoulder/upper arm, `xzy` lower arm, `xyz` hand/fingers, `yzx` legs). Imports put hips motion on `cog` and
   leave `fk.hips` at rest.
10. **Control shapes are `SplineSet` geometry** from a shape registry (`circle`, `halfCircle`, `square`, `cube`,
    `sphere`, `diamond`, `arrow4`, `star`, `cross`, `lollipop`; extensions add more) — the same data type future
    spline modeling uses (research 08 D9). **Sizes come from the skinned mesh** (research 07 §5.4): radius =
    1.25 × P90 distance from the bone segment of bind-pose vertices whose dominant weight (≥ 0.5) is that joint,
    computed headlessly from `POSITION`/`JOINTS_0`/`WEIGHTS_0`; bone-length fallbacks for compressed meshes;
    per-group minimum clamps (fingers 0.006·H) and default shape offsets (limbs 0.25·ℓ down the bone; fingers as
    lollipops above the hand). Colours from tokens: L `#4f8dff`, R `#ff5f69`, C `#ffd84d`; selected white, lead
    light green, hover lighter (research 09 §5.7). Table: MVP-SPEC §4.11.15.
11. **Rig edits never create keys** (Rive's design/animate split). MVP rig editing: per-control display size and
    visibility; rotate order is read-only until the pose-preserving conversion (M1-stretch) lands.
12. **Leg IK is not in M1; Plant Feet is.** M1 legs are FK. `Pose → Pin Feet` stores the foot bone worlds;
    `Pose → Plant Feet` re-solves the upper/lower leg and foot with `solveTwoBoneIk` (hip from the current pose,
    target and foot rotation from the pin, pole from the current bend plane) and writes FK channels through the
    normal value-edit path — one undo step. M1 therefore supports weight shifts and crouches by planting feet on
    each key; feet can still slide between keys. **Leg IK controls (`ik.leg`, `pole.leg`, the `ik2` op, IK/FK
    switch and match) are the first item of M2a.**

## Alternatives

| Alternative | Why not |
|---|---|
| Keying bones directly (bone mode) | Two evaluation paths; non-portable channels; no zero pose on VRM 1.0 (51/52 bones have non-identity rest rotations in a real fixture). |
| Bone-aligned humanoid controls | Channels mean different things per avatar; mirroring needs per-bone tables. Optional per-control orientation stays possible later (02 §6.2). |
| `cog` drives the hips directly (v0.1) | Hip sway and pelvis tilt force counter-animating the spine on every key; the standard desktop-DCC COG/hips/torso split costs one control. |
| `N_b` = FK control local rotation (v0.1 shortcut) | Wrong once `fk.spine` is parented to `cog`, and wrong when a non-humanoid node between humanoid bones (Seed-san's twist and palm nodes) is posed. |
| Bone-length-only sizing (v0.1) | ~3 cm circles on 1.8 cm finger spacing, torso circles buried in the mesh, thigh circles overlapping the pelvis. |
| IK legs in M1 (review's preferred option, research 07 §21.1, 05 §4) | About 5 agent-days (IK and pole controls, `ik2` op, IK/FK visibility, import of IK channels from sampled feet, pole annotation) on top of an M1 that already grew in the review; the coordinator scoped IK to V1. The solver math and its tests ship in M1, so M2a adds controls and the op only. Owner may pull it in: DECISIONS-OPEN Q-RIG-5. |
| three.js `CCDIKSolver`, `TransformControls` driving bones | Index-addressed, mutating, history-dependent (07 §9.5). |
| A generic desktop-DCC-style dependency graph (DG) of plugs | Too heavy; typed ops with declared dependencies cover constraints and solvers (08 trap 2). |

## Consequences

- The kernel never touches `Object3D`; it runs in Node tests and workers.
- `SkeletonDesc` is extracted from glTF JSON and BIN alone (no three.js), including VRM humanoid maps, spring-bone
  joints, node constraints, bone radii and height.
- Importing a clip that animates spring-bone joints, node-constraint destinations or non-rigged nodes drops those
  channels with a warning.
- Generic skeletons with non-uniform or negative scale display but warn. *Amended at the v0.3 integration
  (WP-3 R-4)*: world composition uses float64 **similarity transforms** (t, q, s) — allocation-free and exact for
  uniform scale (every humanoid rig and the fixtures' driven bones); a driven bone under non-uniform scale is
  approximated and `compileRig` warns `non-uniform-scale`. Undriven bones output their rest locals exactly, so
  skinning is unaffected. A per-node 4×4 matrix path is V1 if a real asset needs it.
- The README, the demo script and the first-run "Getting started" card say plainly that M1 legs are FK with Plant
  Feet.
