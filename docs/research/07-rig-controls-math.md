# 07 — Control rig, constraints, IK and animation math

Status: research and design proposal, 2026-10-17. Audience: implementers of the `rig`, `math` and `bake` packages.

This document covers the following:

- the control-rig data model, including Maya-style shape controls with offset (zero) transforms
- auto-rigging VRM humanoids and generic skeletons
- picking and visibility
- constraints and their evaluation order
- FK, IK, IK/FK switching and matching
- space switching, foot roll and root motion
- how rotations are represented in curves
- baking to glTF and VRMA, and importing existing clips back onto controls
- mirroring, the pose clipboard and onion skin
- a serializable, CRDT-friendly rig definition format

Out of scope: graph-editor tangent math and UI (other research docs), container writing (see `03-ekza-reuse-audit.md`, §5–6), collaboration transport.

---

## 0. Decisions at a glance

| # | Decision | Reason |
|---|---|---|
| D1 | **Curves live only on controls. Bones are never keyed.** A model with no recognised humanoid gets an auto-generated 1:1 FK rig, so "bone mode" runs through the same pipeline. | One evaluation path. Import (bones → controls) and export (controls → bones) are symmetric. |
| D2 | **Zero pose = rest pose.** Every control has an offset (zero) transform, so default channel values reproduce the rest/bind pose exactly. | Maya offset groups / `offsetParentMatrix`. Makes reset, mirroring, pasting and retargeting trivial. |
| D3 | **Evaluation is a pure, stateless function** `pose = f(rigDoc, curves, t)`. Nothing depends on history: no Maya "No Flip" orient caches, no IK seeded by the previous frame. Spring bones are preview-only. | Random-access scrubbing, deterministic baking, the same result for every collaborator, safe to run in a worker. |
| D4 | A rig is **compiled** into a flat, topologically sorted schedule of ops over typed-array buffers. The kernel is framework-free TypeScript: no React, no `Object3D` graph. | A humanoid has ≈70 controls (≪1 ms). The kernel runs in workers and Node tests. |
| D5 | Humanoid rigs evaluate in **VRM normalized space**: world-aligned rest frames, +Z forward. Raw-node output uses three-vrm's own formula `R = P⁻¹·N·P·B`. | This is the space of VRMA, the Ekza shared clip library and OMOBA motion. Mirroring becomes a sign flip. It agrees with 03 §5.2. |
| D6 | **Rotation curves are Euler per control, each with its own rotate order** (Maya semantics). The editor provides an Euler filter, continuity-aware keying and a gimbal display. Evaluation and every export use quaternions. | Graph-editor tangents need scalar curves. "Independent Euler" is Maya's default. |
| D7 | IK uses our own **analytic two-bone solver** (hinge axis, pole vector, soft IK) and our own FABRIK/CCD for chains. three.js `CCDIKSolver` is not used in the rig core. | `CCDIKSolver` addresses `SkinnedMesh` bones by index, mutates them in place and applies absolute (not rest-relative) Euler limits (§9.6). |
| D8 | MVP constraints are parent, point, orient and aim, plus the pole vector (an IK input). They support multiple weighted targets and use deterministic quaternion averaging. | Covers the 90% case of Maya usage. |
| D9 | **Bake** samples integer frames at the document fps (default 30). It enforces quaternion hemisphere continuity and writes `LINEAR` (`STEP` for blocked clips), with optional key reduction. Each export target has its own channel set. | glTF 2.0, VRMA and OMOBA rules (§15). |
| D10 | **Rig definition JSON** uses flat id-keyed maps and parent pointers. The auto-rig produces deterministic ids, and values are small and atomic, so it maps onto CRDTs (Yjs). Curves live in a separate document, keyed `controlId/channel`. | Ready for collaboration. Rig edits are rare and curve edits frequent. |

---

## 1. Conventions

### 1.1 Space, units, facing

- glTF 2.0: *"glTF uses a right-handed coordinate system. glTF defines +Y as up; the front side of a glTF asset faces +Z, the left side of a glTF asset faces +X. The units for all linear distances are meters. All angles are in radians."* ([glTF 2.0 §3.4](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)). three.js uses the same handedness and up axis, so the app needs no axis conversion internally. Z-up or centimetre sources (FBX, BVH) are converted at the import boundary only.
- **Canonical character space** is VRM 1.0: +Y up, the model faces +Z, its left is +X. The [VRM T-pose spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/tpose.md) says the body is "oriented along the +Z axis, symmetrical on the X axis", arms are "parallel to the X axis", palms face −Y, feet are parallel to Z, and the model is grounded at Y = 0.
- **VRM 0.x faces −Z.** We apply a π yaw on the *character root*, never on bones. That is exactly what three-vrm's `VRMUtils.rotateVRM0` does: `vrm.scene.rotation.y = Math.PI` when `metaVersion === "0"`. Exports for VRM 0.x targets conjugate by that yaw (`x → −x, z → −z` on quaternion and position), which is Ekza's `flipYawQuaternion` / `flipYawPosition` in `ekza-avatar-renderer`.
- Data stores radians. The UI shows degrees, as Maya does.
- **Scale.** VRM requires that *"All node transforms must be in a positive uniform scale"*, and OMOBA rejects non-uniform or negative scale (see 03 §2.4). The rig kernel therefore uses **similarity transforms** (translation, quaternion, uniform scale). Generic glTF rigs with non-uniform bone scale still display, but rig bindings over them raise a warning. A general `Matrix4` path is deferred.
- **Rest rotations are arbitrary.** Inspecting the VRM 1.0 test fixture in `ekza-avatar-renderer` shows **51 of its 52 humanoid bones have non-identity rest rotations**. Four CC0 VRM 0.x samples from the opensourceavatars set have **0**, because VRM 0.x exporters forced identity rest rotations. The rig must never assume identity rest rotations.

### 1.2 Algebra notation (matches three.js)

- Column vectors. `A·B` means apply `B` first. This equals `a.clone().multiply(b)` for three.js `Matrix4` and `Quaternion`. three.js composes `matrixWorld = parent.matrixWorld · matrix`, with `matrix = T·R·S`.
- A transform is `X = (t, q, s)`, with uniform `s`.
  - Composition: `X₁·X₂ = (t₁ + s₁ (q₁ ⊗ t₂), q₁q₂, s₁s₂)`
  - Inverse: `X⁻¹ = (−(1/s)(q⁻¹ ⊗ t), q⁻¹, 1/s)`
- `q ⊗ v` rotates a vector. `axisAngle(k, θ)` builds a quaternion. `shortestArc(u, v)` is the minimal rotation taking `û` to `v̂`.
- `signedAngle(u, v, k) = atan2(k·(u×v), u·v)`.
- `W_x` is the world transform of `x` (always in **character space**: the character instance's local space). The superscript `⁰` marks rest (zero pose).

### 1.3 Rotation order: Maya/Blender vs three.js

Maya defines `R = RX * RY * RZ` for rotate order `xyz` with row vectors (`P' = P × WM`, "matrices are post-multiplied in Maya"), so **X is applied first** ([MTransformationMatrix](https://help.autodesk.com/cloudhelp/2016/ENU/Maya-SDK/cpp_ref/class_m_transformation_matrix.html)). three.js `Matrix4.makeRotationFromEuler` for order `'XYZ'` builds `Rx·Ry·Rz` for column vectors (verified in source: `te[8] = sin(y)`, `te[9] = −sin(x)cos(y)`), so **Z is applied first**.

The rule is therefore: **DCC (Maya/Blender) order `"xyz"` ≡ three.js `'ZYX'`**:

```ts
const toThreeOrder = (dcc: DccRotateOrder) =>
  dcc.toUpperCase().split("").reverse().join("") as THREE.EulerOrder;
```

| DCC (stored, shown in UI) | three.js `Euler.order` | applied first (inner) | middle (gimbal axis) | applied last (outer) |
|---|---|---|---|---|
| `xyz` | `ZYX` | X | Y | Z |
| `yzx` | `XZY` | Y | Z | X |
| `zxy` | `YXZ` | Z | X | Y |
| `xzy` | `YZX` | X | Z | Y |
| `yxz` | `ZXY` | Y | X | Z |
| `zyx` | `XYZ` | Z | Y | X |

Rig data stores DCC semantics, because animators and every DCC exchange format think that way. The conversion happens at exactly one boundary, the math package. A unit test pins the table above.

---

## 2. Architecture of the rig subsystem

```
 RigDoc (JSON, CRDT)                 AnimDoc (curves keyed "controlId/channel")
        │ compile (on rig change)            │ sample(t)
        ▼                                    ▼
 RigProgram ── buffers + schedule ──► evaluate(t) ──► Pose
   (offsets, bind offsets,                          ├─► viewport sync (three.js Bones, control overlays)
    per-space offsets, mirror map,                  ├─► baker (glTF / VRMA / Ekza tracks)
    topo-sorted ops)                                └─► onion skin, trails, mirror, clipboard, IK/FK match
```

| Package (proposal) | Contents | Dependencies |
|---|---|---|
| `@ekza-animator/math` | Similarity transforms, quaternion helpers, Euler ↔ quaternion for all 6 orders, continuity conversion, Euler filter, angle unwrap | none (three types optional) |
| `@ekza-animator/rig` | `RigDoc` types and validation, auto-rig generators, compiler, evaluator, constraints, IK solvers, foot roll, spaces, mirroring, pose clipboard, import-to-controls | math. three only in thin adapters (skeleton extraction, mesh measurements) |
| `@ekza-animator/bake` | Sampling loop, continuity, constant collapse, key reduction, per-target channel selection, track builders. The writers are glTF Transform for plain glTF/VRMA and an append-only patcher for VRM (03 §5.1). | math, rig |

This layering mirrors Ekza Space's `src/engine` boundary in the `core` repo (a pure engine with no app dependencies; hosts adapt its outputs). The viewport only *reads* `Pose` buffers. Gizmos write channel values through the same API the graph editor uses.

**Pose buffer layout.** All buffers are `Float64Array`, structure-of-arrays, indexed by compiled bone and control indices:

- `boneLocal[10·i]` holds `t(3), q(4), s(3)`. This is raw glTF node space, ready for `bone.position`/`quaternion`/`scale`.
- `boneWorld[8·i]` holds `t(3), q(4), s(1)`.
- `humanoidN[4·k]` holds the normalized local rotation of each humanoid bone, plus `hipsPos(3)`.
- `controlWorld[8·j]` drives overlay drawing.

`evaluate` never allocates.

---

## 3. Control transform model (offset / zero groups)

Maya background: animators expect a fresh control to read `0, 0, 0` while sitting on the bone. Riggers get this with *offset groups*, or since Maya 2020 with the transform's `offsetParentMatrix` ([transform node](https://help.autodesk.com/cloudhelp/2025/ENU/Maya-Tech-Docs/Nodes/transform.html)). Joints do the same with `jointOrient`: the joint matrix is `[S]·[RO]·[R]·[JO]·[IS]·[T]` ([MFnIkJoint](https://help.autodesk.com/cloudhelp/2016/ENU/Maya-SDK/cpp_ref/class_m_fn_ik_joint.html)). These formulas use Maya's row-vector order.

Our model, per control `c`, in column-vector order:

```
L_c    = T(t_c) · R_ρc(r_c) · S(s_c)          // channels; zero channels → identity
W_c    = W_space(c) · O_{c,s} · L_c           // O = offset ("zero group"), s = active space
O_{c,s}= (W_s⁰)⁻¹ · W_c⁰                      // derived at compile, one per allowed space
K_cb   = (W_c⁰)⁻¹ · W_b⁰                       // bind offset: control → bone (derived)
W_b    = W_c · K_cb                            // bone world driven by the control
L_b    = (W_parent(b))⁻¹ · W_b                 // bone local → three.js Bone.position/quaternion/scale
```

**Invariant.** When all channels are at their defaults, `W_c = W_c⁰`, so `W_b = W_b⁰` and `L_b` equals the rest local exactly. A unit test asserts this for every auto-rig, with tolerance 1e-9.

**What is stored vs derived.** `RigDoc` stores each control's **rest world transform `W_c⁰`** in character space, not `O`. Re-parenting a control then keeps it where it is (Maya's "preserve position" parenting) without rewriting numbers. Concurrent edits to different controls never conflict.

**Binding modes**

| Mode | Formula | Use |
|---|---|---|
| `rotate` (FK default) | `q_b,world = q_c,world · q_K`; bone translation keeps the rest local `t_b⁰`; `q_b,local = q_parent,world⁻¹ · q_b,world` | Limbs and spine. Bone lengths are preserved, as VRMA requires. |
| `translateRotate` | Full `W_b = W_c · K` without scale | `cog → hips`, generic 1:1 roots |
| `full` | With uniform scale | Generic glTF props only. Never humanoid bones (VRMA forbids scale). |

**Control axis frames** (the rotation part of `W_c⁰`)

| Frame | `W_c⁰.q` | What `rx/ry/rz` mean | Default for |
|---|---|---|---|
| **world-aligned** (normalized) | identity in character space | Character axes at rest (X = character left, Y = up, Z = forward). Same meaning on every avatar. | All VRM humanoid controls, IK controls, root, COG |
| bone-aligned | `W_b⁰.q` | The bone's own rest axes (Blender pose-bone / Maya joint feel) | 1:1 generic FK rigs |
| custom | arbitrary, e.g. a relaxed A-pose for arms | An idle pose sits near zero, which keeps Euler values away from gimbal lock | Optional per control |
| behavior-mirrored (right side) | `q_R⁰ = q_X(π) · q_L⁰`, with position mirrored | The same channel values give a mirrored pose. Translation values must be negated, as in Maya behavior mirroring. | Later option |

Derivation of the behavior frame: the mirror is `M = diag(−1, 1, 1)`. The reflected left frame `M·Q_L` is left-handed. Negating all its axes gives `−M·Q_L = R_X(π)·Q_L`, a proper rotation. Conjugating any local rotation by `R_X(π)` maps the quaternion `(x, y, z, w) → (x, −y, −z, w)`, which is the mirror of a rotation (§16).

---

## 4. Rest-relative rotations and normalized humanoid space

Three equivalent ways to apply a rest-relative rotation to a bone:

```
// (a) bone-local delta (Blender pose bone, Maya joint rotate after jointOrient)
q_local = q_restLocal · Δ                         // Δ is expressed in the bone's rest frame

// (b) world-aligned / VRM normalized local rotation N
q_local = P⁰⁻¹ · N · P⁰ · q_restLocal             // P⁰ = rest WORLD rotation of the bone's raw parent node

// (c) world-space delta D (rotation part of W_b · (W_b⁰)⁻¹)
q_world = D · W_b⁰.q ;  q_local = q_parentWorld(evaluated)⁻¹ · q_world
```

(b) is exactly three-vrm's `VRMHumanoidRig.update()` (three-vrm-core 3.5.5):

```js
boneNode.quaternion.copy(rigBoneNode.quaternion)   // N
  .multiply(parentWorldRotation)                    // · P
  .premultiply(invParentWorldRotation)              // P⁻¹ ·
  .multiply(boneRotation);                          // · B (rest local)
```

It is also the VRM consortium's [pose-transform guidance](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md): `N = W·L⁻¹·R·W⁻¹`, with `W` the bone's world rest and `L` its local rest. Since `W = P·L`, this gives `N = P·R·L⁻¹·P⁻¹ ⇔ R = P⁻¹·N·P·L`. The normalized chain multiplies to the world delta: `D_b = N_hips · … · N_parent · N_b`.

**Hips translation.** In three-vrm the normalized hips position is a character-space offset. Raw local is `parentWorld⁻¹ · worldPos`, as in the same `update()` source. For retargeting, the VRM guidance scales by `y_dst / y_src` (hips rest heights). The Ekza shared clip format stores hips normalized by rest height, as `humanoidRetarget.ts` does.

**Missing optional bones** (`chest`, `upperChest`, `neck`, shoulders, toes): the normalized parent is the nearest existing ancestor. That is a walk over `VRMHumanBoneParentMap`, the same as Ekza's `resolveDrivenParentBone`. When exporting to a target that lacks a bone, its rotation is folded into the children, per the VRM guidance.

**Policy** (agrees with 03 §5.2):

- For VRM models the rig's authoritative output is `N_b` plus the hips position. Raw bone locals for display and for GLB baking come from formula (b).
- The kernel writes raw bones itself. Keep `autoUpdateHumanBones: false`, which `ekza-avatar-renderer` already uses, so three-vrm never applies the pose twice. A parity test compares the kernel's raw output against `vrm.humanoid.update()` on the VRM 0 and VRM 1 fixtures.
- Non-humanoid bones (hair, skirt, tail, accessories) get bone-aligned 1:1 FK controls, or they are driven at preview time by spring bones and node constraints.

**`VRMC_node_constraint`** ([spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_node_constraint-1.0/README.md)) has roll, aim and rotation constraints. All are rest-relative, and `weight` slerps "from the rest rotation of the destination". Its stated use is twist bones, sleeves and sub-arm bones.

- Preview: evaluate them *after* our bone write, using `@pixiv/three-vrm-node-constraint`.
- VRM exports: never bake them, because the runtime recomputes them.
- Plain-glTF exports: bake them on request.
- They are runtime constraints in the model, distinct from our authoring constraints (§7).

---

## 5. Auto-rig

### 5.1 Inputs and measurements (computed once per model)

- **Skeleton rest.** Node TRS, parents, world rest. Humanoid map from the VRM 0 `VRM.humanoid.humanBones[]` or the VRM 1 `VRMC_vrm.humanoid.humanBones{}`. VRM 0 thumbs are aliased one joint up (`leftThumbProximal → leftThumbMetacarpal`, …), using the table in `ekza-avatar-renderer`'s bake script.
- **Skinned mesh in bind pose.** For each bone, the vertices whose dominant weight is ≥ 0.5.
- **Character frame for generic rigs**, the same as OMOBA's `RetargetBasis` (03 §2.4): `up = head − hips`, `side = leftHand − rightHand`, `forward = side × up`. If `forward·(0,0,1) < 0`, set a facing correction of π.
- `H` is the skinned bounds height. `ℓ_b = |p_child⁰ − p_b⁰|` is the bone length. A leaf bone takes the extent of its weighted vertices along the bone direction, or `0.5·ℓ_parent`.

### 5.2 Humanoid control set (VRM 0/1)

| Control id | Shape | Side | Default space (parent) | Drives | Rot. order | Keyable |
|---|---|---|---|---|---|---|
| `root` | Circle with 4 arrows on the floor, r ≈ 0.35 H | C | rig root | Character placement (folded into hips on export, §13) | `zxy` | t, r |
| `cog` | 8-point star at hips height, horizontal, r ≈ 0.18 H | C | `root` | `hips` t + r (`translateRotate`) | `zxy` | t, r |
| `fk.spine`, `fk.chest`, `fk.upperChest` | Circle, normal = bone dir | C | `cog` → chain | Rotation | `zxy` | r |
| `fk.neck`, `fk.head` | Circle | C | Chain. Head space options: neck (default) / chest / cog / root | Rotation | `zxy` | r |
| `fk.jaw` (if present) | Small arc | C | head | Rotation | `zxy` | r |
| `fk.shoulder.L/R` | Half circle above the clavicle | L/R | upperChest → chest → spine (first existing) | Rotation | `yxz` | r |
| `fk.upperArm`, `fk.lowerArm`, `fk.hand` `.L/R` | Circle | L/R | Chain | Rotation | `yxz` / `xzy` / `xyz` | r |
| `ik.arm.L/R` | Cube at the wrist, world-aligned | L/R | Space enum: root (default) / world / cog / chest / head | `ik2` end target | `zxy` | t, r |
| `pole.arm.L/R` | Wire octahedron, distance `l₁+l₂` behind the elbow, with a dashed line to the elbow | L/R | root / `ik.arm` / chest | `ik2` pole | – | t |
| `switch.arm.L/R` | Small cross next to the hand (follows the hand bone) | L/R | hand bone | Attr `ikFk` 0..1 (default 0 = FK) | – | attrs |
| Fingers `fk.<finger><joint>.L/R` (thumb: Metacarpal/Proximal/Distal; others: Proximal/Intermediate/Distal) | Small circle | L/R | hand **bone** (so fingers follow IK) → chain | Rotation | `xyz` | r |
| `fk.upperLeg`, `fk.lowerLeg`, `fk.foot`, `fk.toes` `.L/R` | Circle | L/R | hips (via `cog`) → chain | Rotation | `yzx` | r |
| `ik.leg.L/R` | Foot-footprint rectangle on the ground, world-aligned | L/R | root (default) / world / cog | `ik2` + `footRoll` | `zxy` | t, r, attrs `roll, bank, heelTwist, toeTwist, ikFk` (default 1 = IK) |
| `pole.leg.L/R` | Wire octahedron, distance `l₁+l₂` in front of the knee | L/R | root (default) / `ik.leg` ("follow foot") | `ik2` pole | – | t |
| `lookAt` (later) | Two circles plus an outer ring, 0.5 m in front of the eyes | C | head (default) / world | VRM lookAt yaw and pitch | – | t |

Defaults: legs IK, arms FK. Each limb gets both FK and IK controls. Only the active set is drawn at full opacity; the other is drawn ghosted at 25% or hidden (a user preference).

**Hinge axes and pole sides.** Hinge axes are in character space at rest and are stored converted into the mid bone's local frame. A positive hinge rotation means flexion.

| Joint | Bend direction of the distal segment (T-pose) | Hinge `k = normalize(boneDir × bendDir)` | Pole side (mid joint moves toward it) |
|---|---|---|---|
| Left elbow | +Z (forearm swings forward) | `(1,0,0)×(0,0,1) = (0,−1,0)` | −Z (behind) |
| Right elbow | +Z | `(−1,0,0)×(0,0,1) = (0,1,0)` | −Z |
| Knees | −Z (shin swings back) | `(0,−1,0)×(0,0,−1) = (1,0,0)` | +Z (in front) |

The VRM T-pose has straight limbs, so the hinge cannot be inferred from the rest bend. The table is therefore the default. If a generic skeleton has a measurable rest bend (more than 2°), use `k = normalize(u⁰ × v⁰)` instead.

**Default rotate orders** are heuristics, to be validated by the autotune in §14.5. In world-aligned frames the gimbal axis (middle) should be the one that rarely reaches ±90°:

| Group | DCC order | inner / middle / outer | Reasoning |
|---|---|---|---|
| root, cog, spine, neck, head, IK hand, IK foot | `zxy` | roll / pitch / yaw | Yaw (turning) is outermost and never gimbals. Pitch rarely reaches 90° per segment. |
| shoulder, upper arm | `yxz` | fwd swing / twist / raise-lower | From the T-pose, lowering the arm is about 70–90° about Z, so Z must be outer. Twist is middle. |
| lower arm | `xzy` | twist / – / elbow hinge (Y) | The hinge is outer, twist (pronation) is inner. |
| hand, fingers | `xyz` | twist / deviation-spread / flex-curl | Deviation and spread have a small range. |
| upper leg, lower leg, foot, toes | `yzx` | twist / abduction / flexion | Flexion (X) reaches ≥90° when sitting or kicking, so it must not be middle. |

### 5.3 Generic skeletons

1. **Humanoid inference.** Run name patterns (table in §16.3) plus topology checks: chain lengths, left/right symmetry (`|M·p_L − p_R| < 0.02 H`), and the hips found as the common ancestor of legs and spine. This produces a *proposed* VRM map that the user confirms in a mapping dialog, the same idea as UniVRM's humanoid setup. Once confirmed, the humanoid auto-rig runs.
2. Otherwise, build a **1:1 FK rig**: one bone-aligned control per joint, with circles sized by bone length. `root` sits at the skeleton root projected to the floor. The skeleton root's control is `translateRotate`.

### 5.4 Shapes, sizes, colours, rendering

- **Shape data.** Each shape is a set of polylines in control-local space; the Maya equivalent is degree-1 or degree-3 NURBS CVs. Library: `circle` (48 segments), `square`, `cube`, `sphere` (3 circles), `diamond`, `arrow4`, `star`, `foot` (footprint), `cross`, `custom`. A shape has its own `offset` transform, so it can be moved without moving the pivot. Example: limb circles are drawn `0.25·ℓ` down the bone, so consecutive joints don't overlap.
- **Radius.** `r_b = clamp(1.25 · P90{ dist(v, segment_b) : w_b(v) ≥ 0.5 }, 0.02 H, 0.25 H)`. The fallback is `0.15·ℓ_b`. Circle normal: `n = normalize(p_child⁰ − p_b⁰)`, which gives the Maya-style circle around the bone.
- **Colours.** Conventions vary between studios. For example, [one rigging course](https://courses.cs.washington.edu/courses/cse458/07au/projects/project6/rigging_tutorial/controls.htm) uses left red, right blue, centre green. We default to what the owner asked for, which matches the common Maya index colours blue (6), red (13) and yellow (17). The palette is a theme token map:

  | Role | Left | Right | Centre |
  |---|---|---|---|
  | primary (FK, IK) | `#2F6BFF` | `#FF3B3B` | `#FFD400` |
  | secondary (fingers, pole, switch) | `#7FB2FF` | `#FF8C8C` | `#FFA500` |
  | selected / hover | `#FFFFFF` / primary +30% lightness | ← | ← |

- **Rendering.** Use `Line2`/`LineSegments2` with `LineMaterial` from three.js `examples/jsm/lines`, because WebGL line width is effectively 1 px. Defaults: 2 px, 3 px when selected.
  - `LineMaterial.resolution` must be set for **each viewport** before it renders, because the Maya-like split view has several viewports.
  - Two passes give an x-ray that stays depth-cued:
    1. depth-tested at 100% opacity
    2. occluded parts (`depthFunc = GreaterDepth`, `depthWrite = false`) at 30% opacity
  - Pole vectors draw a dashed annotation line from the mid joint to the pole, as Maya does.
  - Controls live on a dedicated layer (three.js `Layers`) in an overlay scene, so the fixed camera view can hide them.

---

## 6. Picking, selection, visibility

| Feature | Implementation |
|---|---|
| Click-pick controls | **GPU id picking.** Render the overlay scene into a small render target (e.g. 9×9 px) around the cursor using `camera.setViewOffset`, encoding each control's index as a flat colour, with lines widened by +4 px. Read the pixels and pick the non-zero id nearest the centre. Fallback: `Raycaster` with `params.Line2.threshold` (supported by `LineSegments2.raycast`). |
| Click the mesh → control | Raycast the `SkinnedMesh`. three.js applies skinning in `SkinnedMesh.raycast` via `applyBoneTransform`. For the hit face, sum `skinWeight × barycentric` per bone over its 3 vertices, then take the dominant bone. Map it through the inverse binding (bone → FK control, or → IK control when the limb's `ikFk > 0.5`). This is fast and forgiving for dense hands. |
| Marquee | Project each control's shape sample points to screen space. A control is selected if any point is inside the rectangle (Maya selects curves the marquee crosses). Shift adds, Ctrl toggles. |
| Pickwalk | Arrow keys move along the control hierarchy (up = parent, down = first child, left/right = mirror pair or sibling), as Maya `pickWalk` does. |
| Selection sets | `RigDoc.selectionSets`, e.g. "left arm", "all fingers", "body". Shown in a quick picker panel. |
| Visibility | Bones are **hidden by default** (no `SkeletonHelper`). Toggles: show joints (debug), show FK/IK/both, show by group (body / fingers / face / secondary), isolate selection. With a rig present, bones are never pickable. |
| Channel box | Shows the selected controls' keyable channels and custom attributes. Locked or non-keyable channels are hidden. Editing several controls at once is relative per control. |

---

## 7. Constraints

**Design rule.** A constraint on a *control* drives that control's **space** (its offset parent), not its channels. The control therefore stays animatable on top of the constraint, which is Maya best practice for constraining the offset group. A constraint can also drive a bone directly; generic rigs use this for prop attachment.

| Type | Output | Formula (targets `i`, normalized weights `ŵ_i = w_i / Σw`) |
|---|---|---|
| **parent** | t + r | `C_i = W_ti · Off_i`; `t = Σ ŵ_i t(C_i)`; `q = normalize(Σ ŵ_i σ_i q(C_i))` |
| **point** | t | `t = Σ ŵ_i (t(W_ti) + t(Off_i))` (translation offset only) |
| **orient** | r | `q = normalize(Σ ŵ_i σ_i (q(W_ti)·q(Off_i)))` |
| **aim** | r | See below |
| **pole vector** | – | Not a separate node. It is the `pole` input of `ik2` (§9.2). |
| scale (later) | s | `s = Π s_i^{ŵ_i}` (geometric mean) |

- `Off_i = (W_ti⁰)⁻¹ · W_x⁰` when `maintainOffset` is on. It is computed **from the rest pose at compile time**, which keeps it deterministic. If the user creates the constraint while posed, the captured offset is stored explicitly in the doc.
- `σ_i = sign(q(C_0) · q(C_i))` aligns hemispheres to the first target. That makes the weighted average equal to Maya's "Average" interpolation. For exactly two targets, use `slerp(q_0, q_1, ŵ_1)` (Maya "Shortest").
- **Excluded:** Maya's `No Flip` and `Cache` interp types. Maya's docs say No Flip "is dependent on the previous frame, it requires a runup … or a cache" ([orientConstraint](https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Tech-Docs/Nodes/orientConstraint.html)). That violates D3.
- **Blend with own animation:** `W = interp(W_unconstrained, W_constrained, blend)`, with lerp for `t` and slerp for `q`. `blend` is an animatable attribute (Maya's `blendParent`). If `Σw = 0`, the constraint is ignored.

**Aim constraint math.** Inputs:

- `a`: aim axis, in local space
- `u`: up axis, in local space (Gram–Schmidt `u` against `a` at compile time)
- `T`: target position
- `P`: the constrained object's position
- world-up `w`, by type:
  - `vector`: a fixed vector
  - `object`: `w = normalize(p_up − P)`
  - `objectRotation`: `w = q_up ⊗ v`
  - `none`: use the previous axis-free shortest arc from rest

```
f  = normalize(T − P)
u⊥ = w − (w·f) f ;  if |u⊥| < 1e-6: u⊥ = (q_rest ⊗ u) − ((q_rest ⊗ u)·f) f   // stateless fallback
u⊥ = normalize(u⊥)
R  = [ f | u⊥ | f × u⊥ ] · [ a | u | a × u ]ᵀ        // 3×3, maps local (a,u) onto world (f,u⊥)
q_world = quat(R) · q(Off)                            // Off = identity unless maintainOffset
q_local = q_parentWorld⁻¹ · q_world
```

---

## 8. Dependency graph and evaluation order

**Op kinds** (each reads world transforms produced by earlier ops):

| Op | Reads | Writes |
|---|---|---|
| `SampleChannels` (vectorised, before the graph) | curves, `t` | `L_c` for all controls, attribute values |
| `SpaceSelect(c)` | space targets' worlds, `space` attr | `W_space(c)`, `O_{c,s}` |
| `Constraint(k)` | targets' worlds, attrs | `W_space(x)` or `W_b` |
| `ControlWorld(c)` | `W_space(c)`, `L_c` | `W_c` |
| `FKBind(b)` | `W_c` | `W_b,fk` |
| `IK2(s)` / `FootRoll(s)` / `Chain(s)` | parent bone world, IK and pole control worlds, attrs | `W_b,ik` for the chain, pivot worlds |
| `IKFKBlend(limb)` | `W_b,fk`, `W_b,ik`, `ikFk` | Final chain locals and worlds |
| `BoneLocal(b)` | `W_parent(b)`, `W_b` | `L_b` (uncontrolled bones: `W_b = W_parent · L_b⁰`) |
| `Attach(c)` | a bone world | `W_space(c)` for controls that ride on bones (fingers, switch, "pole follows foot") |

**Compile** (runs only when the `RigDoc` or the skeleton changes):

1. Resolve ids and `BoneRef`s. A dangling reference disables the constraint or solver with a warning and never throws.
2. Create a node per op and add an edge `producer(X) → consumer` for every world transform `X` an op reads. A space-switchable control gets edges to **all** its candidate spaces, so the graph is static and does not depend on which space is active.
3. Kahn topological sort. Ties are broken by `(opKindPriority, id)` so every peer gets the same schedule.
4. **Cycles.** Report the cycle path. CRDT merges can create cycles (two users re-parent concurrently). For those, deterministically drop the edge whose consumer id sorts greatest, and flag it in the UI. The `VRMC_node_constraint` sample algorithm likewise rejects circular dependencies.
5. Emit a flat `Op[]` with integer buffer offsets, plus precomputed `O_{c,s}`, `K_cb`, hinge axes, rest lengths and mirror pairs.

**Evaluate(t)** is `SampleChannels` followed by one linear pass over `Op[]`. Interactive dragging re-runs the full pass, which is cheap. Partial re-evaluation (only the dragged control's downstream ops, precomputed per control) is a later optimisation.

**Budget** (target, to be benchmarked): a humanoid has about 70 controls, 55 bones and ~400 ops of a few hundred flops each, so a single evaluation should take ≪ 0.5 ms in V8. At 60 fps that leaves room for 2–4 characters (the collaboration scenario) plus onion-skin ghosts. Baking 1,000 frames should take ≪ 1 s and can run in a worker with the same kernel.

**Determinism note.** The schedule and math are identical on every peer. JS `Math.sin`/`acos` may differ in the last ulp between engines, so evaluation is *reproducible* but not bit-identical across browsers. That is fine, because peers exchange curves, not poses, and one client performs an export bake.

---

## 9. FK and IK

### 9.1 FK

FK controls are parented control → control along the bone chain. With `rotate` binding, `W_b = W_c · K` and bone translation stays at rest, so lengths are preserved. Fingers attach to the **hand bone** (`Attach`), not the hand FK control, so they follow in IK mode.

### 9.2 Analytic two-bone IK with hinge and pole vector (stateless)

```
// Inputs (character space, this frame):
//   Pa        world transform of the upper bone's parent (already evaluated)
//   qU0,qM0   rest LOCAL rotations of upper and mid bones; tU0, tM0, tE0 rest local translations
//   l1=|tM0|·s, l2=|tE0|·s                    rest lengths (uniform scale s)
//   hingeL    unit hinge axis in the mid bone's local frame (+ = flexion), §5.2 table
//   t         end target = position of (W_ikCtrl · K_end)
//   p         pole control world position;  τ = twist attr;  soft = softness (m, 0 = off)
function solveTwoBone():
  // 1. Seed from REST under the current parent (never from the previous frame → stateless, D3)
  qU = Pa.q · qU0;  a = Pa · tU0
  qM = qU · qM0;    b = a + qU ⊗ (s·tM0);   c = b + qM ⊗ (s·tE0)

  // 2. Reach distance, clamped, optionally softened
  dRaw = |t − a|;  x̂ = (t − a)/dRaw   (if dRaw < 1e-9: x̂ = normalize(c − a))
  L = l1 + l2
  d = soft > 0 && dRaw > L − soft ? (L − soft) + soft·(1 − exp(−(dRaw − (L − soft))/soft)) : dRaw
  d = clamp(d, |l1 − l2| + ε, L − ε)          // ε = 1e-5·L

  // 3. Bend: rotate the MID bone about its hinge only (no twist → no candy-wrapper elbows)
  k   = qM ⊗ hingeL                              // world hinge axis
  β0  = signedAngle(b − a, c − b, k)             // current bend (0 = straight)
  θ   = acos(clamp((l1² + l2² − d²)/(2·l1·l2), −1, 1))   // interior angle at the mid joint
  β1  = π − θ
  qM  = axisAngle(k, β1 − β0) · qM;   c = b + qM ⊗ (s·tE0)

  // 4. Aim: swing the chain so the end lies on the target ray
  qS = shortestArc(c − a, x̂)        // antiparallel (target straight behind): rotate π about k, not a random axis
  qU = qS · qU;  qM = qS · qM;   b = a + qU ⊗ (s·tM0);  c = b + qM ⊗ (s·tE0)

  // 5. Pole: twist about the chain axis so the mid joint lies in the (a, t, p) plane
  m = (b − a) − ((b − a)·x̂) x̂
  n = (p − a) − ((p − a)·x̂) x̂
  φ = (|m| > 1e-9 && |n| > 1e-9) ? atan2(x̂·(m × n), m·n) : 0
  qT = axisAngle(x̂, φ + τ);   qU = qT · qU;  qM = qT · qM

  // 6. End effector orientation follows the IK control (Maya "orient to IK handle")
  qE = (W_ikCtrl.q) · K_end.q

  // 7. Locals for the blend/output stage
  qU_local = Pa.q⁻¹ · qU;   qM_local = qU⁻¹ · qM;   qE_local = qM⁻¹ · qE
```

Properties:

- The end reaches `a + d·x̂` exactly when the target is reachable.
- The mid joint only ever rotates about its hinge axis, so the knee can't bend sideways.
- The pole defines the plane.
- The result depends only on the current inputs.
- Near full extension `|m|` is small but its direction is still defined by the hinge, because the ε clamp keeps `β1 > 0`.

Step 5 is the classic Maya rotate-plane (RP) solver decomposition. Steps 3–4 are the law-of-cosines solver described by [D. Holden, "Simple Two Joint IK"](https://theorangeduck.com/page/simple-two-joint), but with a fixed hinge axis instead of a cross product, which removes the straight-leg instability Holden mentions.

- **Soft IK** (`soft` > 0) removes the "pop" near full extension. It follows the same idea as Softimage soft IK and [Spine's IK softness](https://en.esotericsoftware.com/spine-ik-constraints). The exponential form above is the common formulation.
- **Stretch** (later, generic glTF only): `σ = max(1, dRaw/L)` scales `tM0` and `tE0`. This produces translation tracks on non-hips bones, which VRMA forbids, so it is disabled for humanoid export profiles.

### 9.3 Chains: FABRIK and CCD (tails, tentacles, ponytails; spine later)

FABRIK ([Aristidou & Lasenby 2011, *Graphical Models* 73(5)](https://www.andreasaristidou.com/FABRIK)) works on joint positions:

```
fabrik(p[0..n], d[0..n−1], t, tol = 1e-4·Σd, maxIter = 12):
  root = p[0]
  if |t − root| ≥ Σd:                                   // unreachable → straighten toward t
    for i in 0..n−1: λ = d[i]/|t − p[i]|;  p[i+1] = (1−λ)·p[i] + λ·t
    return
  for iter in 1..maxIter while |p[n] − t| > tol:
    p[n] = t                                            // backward pass
    for i = n−1 … 0: λ = d[i]/|p[i+1] − p[i]|;  p[i] = (1−λ)·p[i+1] + λ·p[i]
    p[0] = root                                         // forward pass
    for i = 0 … n−1: λ = d[i]/|p[i+1] − p[i]|;  p[i+1] = (1−λ)·p[i] + λ·p[i+1]
```

**Positions → rotations.** Go top-down. For each bone `i`:

- `q_i,world = shortestArc(q_i,world,seed ⊗ dirRest_i, p[i+1] − p[i]) · q_i,world,seed`
- the seed is the rest pose under the evaluated parent, which keeps twist deterministic
- an optional per-chain `pole` or up vector fixes the bend plane for planar chains

CCD rotates each joint `j`, from the end towards the root, by `shortestArc(e − p_j, t − p_j)`, clamped per step, then applies **rest-relative** limits. Use CCD only where per-joint limits matter. FABRIK distributes motion more naturally and converges faster. Both are seeded from rest and run a fixed iteration count, so they are stateless.

### 9.4 Joint limits

- MVP: hinge-only knees and elbows (above), plus optional soft UI clamps per channel, like Maya's transform limits.
- Later: swing–twist cones expressed in the *rest-relative* frame (`Δ = q_restLocal⁻¹ · q_local`, split into swing and twist about the bone axis).

### 9.5 Why not three.js `CCDIKSolver` for the rig core

Checked against three r185 source and the [r186 docs](https://threejs.org/docs/pages/CCDIKSolver.html):

| Property | Consequence for us |
|---|---|
| `target`, `effector` and `links[].index` are **indices into `mesh.skeleton.bones`**, so the target must be a bone of the skinned mesh | Fake bones would have to be injected into user assets. IK controls are not bones. |
| Mutates `link.quaternion` in place and calls `link.updateMatrixWorld(true)` per link | Couples IK to the scene graph and to the previous pose, which breaks D3 and D4 |
| `rotationMin`/`rotationMax` clamp `link.rotation` (absolute local Euler, three's order) | Wrong for VRM 1.0 bones with non-identity rest rotations (§1.1) |
| `limitation` = projection onto one rotation axis | A useful idea (hinge), which we adopt |
| `blendFactor` slerps from the initial pose | We blend IK/FK ourselves (§10) |

Verdict: fine for MMD-style data, not for an authoring rig. We reuse ideas, not code.

---

## 10. IK/FK blend and matching (snap)

**Blend.** Per limb attribute `ikFk ∈ [0, 1]`, keyable with stepped tangents by default. For each chain bone, top-down, in **parent-relative local space**:

```
q_local = slerp(q_fk,local, σ·q_ik,local, ikFk)   with σ = sign(q_fk · q_ik)
```

Lengths never change, and the end bone blends the same way.

**Match FK to IK** (before switching IK → FK):

```
for c_i in [fk.upper, fk.mid, fk.end] (top-down; re-evaluate parents after each):
  W_target = W_b_i(current, IK result) · K_i⁻¹
  L_i      = (W_space(c_i) · O_{c_i})⁻¹ · W_target
  r_i      = eulerNear(L_i.q, order_i, current r_i)        // §14.4
```

**Match IK to FK** (before switching FK → IK):

```
W_ik   = W_end(FK) · K_ik⁻¹                      // K_ik = (W_ik⁰)⁻¹ · W_end⁰
L_ik   = (W_space(ik) · O_{ik,s})⁻¹ · W_ik
x̂ = normalize(c − a);  m = (b − a) − ((b − a)·x̂) x̂
pole   = |m| > 1e-3·(l1+l2) ? b + normalize(m)·D                // D = pole distance attr, default l1 + l2
                            : b + (q_mid,world ⊗ poleSideLocal)·D // straight limb: rest pole side
L_pole = (W_space(pole) · O_pole)⁻¹ · T(pole);   twist τ = 0
```

**Key policy.** "Match" alone changes the current values. "Match & key" also keys the new channels and `ikFk` at frame `f`. "Seamless switch" additionally keys frame `f − 1` with the old evaluated values and a stepped `ikFk` key, so no blend pop occurs.

---

## 11. Space switching

- A switchable control has an enum attribute `space`, keyed with **stepped** interpolation only. Its options are an append-only list of `SpaceDef` ids: `world`, `root`, `cog`, chest, head, `ik.leg`, any control or bone.
- `O_{c,s} = (W_s⁰)⁻¹ · W_c⁰` is precomputed per option, so zero channels mean rest in *every* space.
- **Switch with matching at frame f:**

  ```
  W  = W_c(f)  evaluated with the old space s
  L' = (W_{s'}(f) · O_{c,s'})⁻¹ · W
  key  space(f) = s' (stepped),  channels(f) = L'
  if preservePrevious: key channels(f−1) = old values, space(f−1) = s
  ```

- Curves are intentionally discontinuous at switch frames. The graph editor draws vertical markers there, and the Euler filter must not unwrap across them, since it treats segments between space keys separately.
- Weighted (blended) spaces come later: `W_space = average(W_s)` with weights from attributes (lerp `t`, averaged `q`).

---

## 12. Foot roll (IK leg)

**Pivot hierarchy** under `ik.leg`, all in the control's rest frame:

```
ik.leg → bankOuter → bankInner → heel → toeTip → ball → ankleTarget
                                         └──────────→ toes (excludes ball, so toes stay planted)
```

**Pivot auto-placement** uses the foot and toe vertices `V_f` (dominant weight on foot or toes) in rest character space, with ground at `y = 0`:

| Pivot | Position |
|---|---|
| heel | `(p_ankle.x, 0, min_z V_f)` |
| toeTip | `(p_ankle.x, 0, max_z V_f)` |
| ball | `p_toes⁰` (VRM `leftToes`/`rightToes`). Without toes: `heel + 0.72·(toeTip − heel)` at `y = 0.25·p_ankle.y` |
| inner / outer | `(min_x / max_x of V_f near the ball, 0, ball.z)`. Inner = towards the centre (smaller `x` for the left foot, larger `x` for the right). |

**Attributes and formulas.** Angles are in radians, `β` is the break angle (default 30°) and `σ` the straighten angle (default 60°). Roll rotates about the control's lateral X axis, bank about Z, twists about Y.

```
heelRoll  = min(roll, 0)                                    // about heel
// "simple" (MVP default)
ballRoll  = clamp(roll, 0, β)
toeRoll   = max(roll − β, 0)
// "straighten" variant (toe takes over between β and σ, continuous at both ends)
s         = clamp((roll − β)/(σ − β), 0, 1)
ballRoll  = clamp(roll, 0, β)·(1 − s);   toeRoll = max(roll, 0)·s
bankIn    = max(bank·side, 0)  about inner;   bankOut = min(bank·side, 0) about outer   // side = +1 L, −1 R
heelTwist about heel (Y);   toeTwist about toeTip (Y)
pivotRot(p, q) = T(p) · R(q) · T(−p)
W_ankleTarget = W_ik · Bank · Heel(heelRoll, heelTwist) · Toe(toeRoll, toeTwist) · Ball(ballRoll) · K_ankle
W_toes        = W_ik · Bank · Heel · Toe · K_toes        // ball excluded → toes bend by −ballRoll
```

---

## 13. Root motion

**Control topology:** `root` (floor placement) → `cog` (drives hips) → body. The character instance transform (world ← character) is outside the rig. In collaboration, two characters are two instances with their own rigs.

**Export modes** are stored per clip, as `rootMotion` in the 03 §7.1 metadata:

| Mode | Formula | Targets |
|---|---|---|
| `hips` (default) | Fold `root` into hips: evaluate hips world in character space, then `L_hips = W_hipsParent⁰⁻¹ · W_hips`. Non-humanoid ancestors stay unanimated. | VRMA (only hips may translate), embedded VRM clips for Ekza Space, Ekza shared clips |
| `in-place` (lock) | `h'_x = h⁰_x, h'_z = h⁰_z`, keep `h_y` | OMOBA presets. OMOBA keeps "hips X/Z at zero" for derived clips and never animates the authoritative player root. |
| `in-place` (detrend) | `v = (h_xz(t₁) − h_xz(t₀))/(t₁ − t₀)`; `h'_xz(t) = h_xz(t) − v·(t − t₀)`. Keeps sway, removes travel. Store `v` as `extras.ekza.rootMotion.velocity` (m/s) so games can match speed and avoid foot sliding. | Locomotion cycles |
| `extracted` | Root track = (detrended XZ trajectory, heading `θ(t)`) on a separate root node; hips is re-expressed relative to it | Generic glTF/DCC only, where a root node is allowed |

- Heading: `f = q_hips ⊗ (0, 0, 1)`, then `θ = atan2(f_x, f_z)`, unwrapped over time. Yaw removal rotates the whole pose about +Y through the hips by `−(θ(t) − θ(t₀))`.
- **Loop closure** for clips flagged cyclic: require the pose at `t₁` to equal the pose at `t₀` (rotation error < 0.5°, hips error < 1 mm after detrending). The last frame duplicates the first, so three.js `LoopRepeat` and OMOBA's loop processing behave (03 §6.4).

---

## 14. Rotation representation, gimbal and Euler filter

### 14.1 Options

| Representation | Graph editor | Gimbal and flips | Maya equivalent | Verdict |
|---|---|---|---|---|
| **Independent Euler curves** (3 scalar curves, own keys) | Natural: per-axis tangents (flat, linear, stepped, auto) | Gimbal lock at middle ±90°; ±2π wraps | Default "Independent Euler-Angle Curves" | **MVP default** |
| Synchronized Euler (keys locked across x/y/z) | Same, with shared key times | Same | "Synchronized Euler-Angle Curves" | Option (cheap: a key-time lock flag) |
| Quaternion curves (slerp/squad between keys) | No per-axis editing; Maya's quaternion modes ignore tangents | No gimbal, shortest path | "Synchronized Quaternion" (Slerp / Cubic / Tangent Dependent) | Later, per-control opt-in for problem controls |
| Rotation vector / log-map curves | Editable scalars, but unintuitive axes | No gimbal below π | – | No |

Sources: Maya's [animated rotation](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-Animation/files/GUID-CBD30A0A-1166-4076-A564-1ADC946A15F3.htm) and [animation settings preferences](https://help.autodesk.com/cloudhelp/2016/ENU/MayaLT/files/GUID-0817C74B-C95C-4E5F-BCFA-26DEE1D7747F.htm).

**Recommendation.** Use Euler curves per control with a per-control `rotateOrder` (DCC semantics). Curve values are in radians, displayed as degrees. Evaluation converts each Euler triple to a quaternion right after sampling. Every downstream stage (constraints, IK, blending, bake, export) uses quaternions only. Euler is an *authoring* representation and never leaves the project file.

### 14.2 Euler filter (Maya Graph Editor → Curves → Euler Filter)

Maya applies it to whole curves, to fix mangled rotation curves after mocap import ([Maya: fix corrupted curves](https://help.autodesk.com/cloudhelp/2016/ENU/Maya/files/GUID-10782D86-F2BC-418B-8076-DE02725AFED8.htm), [Curves menu](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-Animation/files/GUID-619CAE9C-107D-4504-A769-227DDC847153.htm)).

The identity behind it holds for **every** Tait–Bryan order (`i, j, k` distinct). Proof: conjugating by `R_i(π)` flips `R_j`, and `R_i(π)R_k(π) = R_j(±π)`.

```
R_i(a)·R_j(b)·R_k(c) = R_i(a + π)·R_j(π − b)·R_k(c + π)
```

So every rotation has two Euler triples (plus 2π multiples). The filter picks, key by key, the variant nearest the previous key. This is also Blender's "two solutions, pick the one with minimal difference" approach ([Blender commit](https://projects.blender.org/archive/blender-archive/commit/fbca69c6)).

```ts
const TAU = 2 * Math.PI;
const unwrap = (a: number, ref: number) => a + TAU * Math.round((ref - a) / TAU);
const unwrap3 = (e: V3, ref: V3): V3 => [unwrap(e[0], ref[0]), unwrap(e[1], ref[1]), unwrap(e[2], ref[2])];
// e = [inner, middle, outer] angles in DCC role order (any of the 6 orders)
const alternate = (e: V3): V3 => [e[0] + Math.PI, Math.PI - e[1], e[2] + Math.PI];
const dist = (a: V3, b: V3) => Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);

function eulerFilter(keys: V3[]): void {          // keys on synchronized times; split at space-switch keys
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1];
    const a = unwrap3(keys[i], prev);
    const b = unwrap3(alternate(keys[i]), prev);
    keys[i] = dist(a, prev) <= dist(b, prev) ? a : b;
  }
}
```

For independent (unsynchronized) curves, the filter samples all three curves at the union of their key times, filters those samples, and writes back only the values at each curve's own keys. Tangents are recomputed by their tangent type.

### 14.3 Quaternion → Euler nearest to a reference (gizmo input, IK→FK match, import, rotate-order change)

```ts
function eulerNear(q: Quat, order: DccRotateOrder, ref: V3): V3 {
  // 1. one solution from three.js (order mapped via §1.3), re-labelled into DCC role order
  let e = fromThree(new THREE.Euler().setFromQuaternion(q, toThreeOrder(order)), order);
  // 2. gimbal: only (outer ± inner) is defined → keep the reference INNER angle, solve the outer
  if (Math.abs(Math.cos(e[1])) < 1e-6) {
    e[0] = ref[0];
    // q = q_outer(c)·q_middle(b)·q_inner(a) in column form  ⇒  q_outer = q · q_inner(−a) · q_middle(−b)
    const qo = q.clone().multiply(axisQ(innerAxis(order), -e[0])).multiply(axisQ(middleAxis(order), -e[1]));
    e[2] = 2 * Math.atan2(dot(qo.xyz, unitAxis(outerAxis(order))), qo.w);
  }
  // 3. both equivalent triples, unwrapped toward ref; pick the nearest
  const a = unwrap3(e, ref), b = unwrap3(alternate(e), ref);
  return dist(a, ref) <= dist(b, ref) ? a : b;
}
```

**Key rule:** the reference is the control's *current evaluated channel values at the current time*, never zero. Rotating with the gizmo therefore never writes a key that jumps by 2π or flips to the alternate solution.

Gizmo pipeline: world rotation from the gizmo → `q_L = (W_space · O)⁻¹.q · q_world` → `eulerNear(q_L, order, currentChannels)` → set channels, and key if auto-key is on.

### 14.4 Gimbal tooling

- **Gimbal gizmo mode** draws the three actual Euler axes:
  - the outer axis fixed in the parent frame
  - the middle axis rotated by the outer
  - the inner axis rotated by both

  An axis turns red when `|cos(middle)| < cos(80°)`, i.e. within 10° of lock.
- **Change rotate order, preserving the pose.** For every key time, `q = quat(e_old, oldOrder)`, then `e_new = eulerNear(q, newOrder, prev)`, then run the Euler filter. When keys are sparse, optionally re-key every frame in the range, because interpolation differs between orders.
- **Rotate-order autotune** (later, data-driven). For each control and a set of clips (the CC0 library or the current file), choose the order that maximises `min_t |cos(middle(t))|`, i.e. stays furthest from gimbal lock. This validates the §5.2 defaults.

---

## 15. Baking (controls → bone tracks) and importing (bone tracks → controls)

### 15.1 Rules from the specs

- Sampler input: *"time in seconds with `time[0] >= 0.0`, and strictly increasing values"* ([sampler schema](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/schema/animation.sampler.schema.json)). The input accessor **MUST** define `min`/`max`, and data **MUST NOT** contain NaN or Inf. Inputs are relative to the animation start, and values before or after the range are clamped.
- Samplers within one animation **MAY** have different inputs. Per-track oversampling is therefore legal.
- Rotation outputs may be `float32`, `snorm8/16` or `unorm8/16`. Normalized 16-bit rotations are core glTF (no extension needed) and halve the size of rotation data.
- `LINEAR` rotation interpolation is slerp using `|v_k·v_{k+1}|` and its sign, so conforming players already take the short path (spec Appendix C). `CUBICSPLINE` quaternions must be normalized after interpolation, and exporters should ensure `v_k ≠ −v_{k+1}`. A node with a `matrix` must not be animated.
- VRMA: no scale on humanoid bones, translation only on hips, `leftEye`/`rightEye` not animated, "30 FPS as a guideline", linear interpolation assumed ([VRMA spec](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md)).

### 15.2 Channels per target

| Target | Rotation | Translation | Scale | Space of values |
|---|---|---|---|---|
| Embedded clips in a VRM/GLB (append-only bake, 03 §5.1) | Every node any clip in the file animates | hips (+ generic bones whose translation differs from rest) | Only if animated (never humanoid) | Raw node local TRS |
| `.vrma` | Humanoid bones except eyes | hips only | never | Normalized: write a T-pose node hierarchy with **identity rest rotations** (allowed: "the hierarchy of T-pose can have any rotation") and positions = target rest offsets; tracks = `N_b` directly |
| Ekza shared humanoid clip (renderer library format) | Humanoid `N_b` (int16 quantized) | hips ÷ rest height | never | Normalized |
| OMOBA `humanoid-glb-v1` | Raw nodes, clip names `idle/walk/attack/cast/death` | hips; X/Z locked for in-place | never | Raw |
| Animation-only GLB (DCC) | All animated nodes | As animated | As animated | Raw, with the skeleton nodes included |

**Do not drop constant rest tracks in multi-clip files.** three.js `AnimationMixer` leaves untracked bones in whatever state a previous action left them. Keep 2-key constant tracks for every node animated by *any* clip in the file. Drop a track only for nodes no clip touches.

### 15.3 Bake loop

```ts
function bakeClip(prog: RigProgram, anim: AnimDoc, o: BakeOptions): BakedClip {
  const { fps = 30, startFrame, endFrame, target } = o;          // integer frames, document fps
  const n = endFrame - startFrame + 1;
  const sel = selectChannels(prog, anim, target);                 // §15.2
  const out = allocTracks(sel, n);
  const pose = prog.allocPose(), q = quat();
  for (let i = 0; i < n; i++) {
    prog.evaluate(anim, (startFrame + i) / fps, pose);            // stateless (D3)
    for (const tr of out.rotation) {
      readRotation(pose, tr.node, target.space, q);               // raw local, or normalized N_b
      if (i > 0 && dot(q, tr.prev) < 0) negate(q);                // hemisphere continuity
      if (i > 0 && angle(q, tr.prev) > o.maxStep /* 90° */) tr.oversample.push(i);  // refine later
      tr.write(i, q); tr.prev.copy(q);
    }
    for (const tr of out.translation) tr.write(i, readTranslation(pose, tr.node, target));
    for (const tr of out.scale)       tr.write(i, readScale(pose, tr.node));
  }
  refineOversampled(out, prog, anim, o);      // per-track extra sub-frame samples (legal: own inputs)
  applyRootMotion(out, o.rootMotion);         // §13
  for (const tr of out.all) {
    if (isConstant(tr, o.eps)) tr.collapseTo2Keys();
    else if (o.reduce) reduceKeys(tr, { rotDeg: 0.05, posMm: 0.1 });   // greedy RDP; slerp/lerp error
  }
  out.times = Float32Array.from({ length: n }, (_, i) => i / fps);    // starts at 0, strictly increasing
  validate(out);   // finite, strictly increasing, min/max present, |q| = 1 ± 1e-6, VRMA channel rules
  return out;
}
```

**Sampling.**

- Bake integer frames at the document fps: default 30, options 24 and 60. OMOBA's library is 24 fps (03 §6.4).
- IK, constraints and space switches make the result non-polynomial, so sampling is the only exact bake. Authored Bézier tangents cannot be carried into glTF `CUBICSPLINE` anyway.
- Use `LINEAR`. A clip whose curves are all stepped ("blocking" mode) exports `STEP`.
- Mixed stepped and smooth curves sampled per frame show a 1-frame blend at the steps. That is acceptable, and the exporter documents it.

### 15.4 Import: bake an existing clip onto controls (edit existing animations)

```
times = union of the clip's key times, or resample at document fps (user choice)
for t in times:
  set raw bone locals from the clip; compute bone worlds top-down
  for each control c in schedule order:                       // FK controls and 1:1 controls
    L_c = (W_space(c) · O_{c,s})⁻¹ · W_b(c) · K_cb⁻¹          // translation only for t-keyable controls
    r_c = eulerNear(L_c.q, order_c, previous r_c)             // continuity across frames
  for limbs the user marks IK: match IK to FK (§10) and key ik + pole
then: optional key reduction or curve fitting (later: Schneider-style Bézier fit within tolerance)
```

The round-trip guarantee is tested: `import(bake(curves))` reproduces bone poses within 1e-5 rad and 1e-6 m.

---

## 16. Mirror pose and mirror animation

### 16.1 Formula (frame-independent)

The mirror plane is the character's YZ plane at the root rest (`x → −x`), with `M = diag(−1, 1, 1)`. For a control `c` and its counterpart `c'`, which is `c` itself for centre controls:

```
Δ    = W_c · (W_c⁰)⁻¹                     // world (character-space) delta from rest
Δ'   = M · Δ · M                          // rotation: (x,y,z,w) → (x,−y,−z,w); translation: (−x, y, z)
W_c' = Δ' · W_c'⁰                         // apply on the counterpart's own rest
L_c' = (W_space(c') · O_{c',s})⁻¹ · W_c'  → channels via eulerNear(…, current values of c')
```

**Quaternion reflection.** For a rotation by `θ` about axis `n`, reflection maps the axis as a pseudo-vector, `n' = det(M)·M·n = (n_x, −n_y, −n_z)`, with the same angle. So `q' = (x, −y, −z, w)`.

Mirroring the *delta* rather than the absolute orientation keeps the result correct even when the left and right rest frames differ slightly. The rig builder still validates symmetry (`|M·p_L⁰ − p_R⁰| < 0.01 H`) and warns otherwise. The VRM T-pose guarantees symmetry about X.

**Two modes.**

- **World mirror** (the formula above) makes the counterpart symmetric in character space. Use it for IK controls, root and COG, and full-body flips.
- **Local mirror** mirrors each control relative to its own parent: `L_c' = M·L_c·M` in world-aligned frames. Use it for FK controls when only part of the body is selected. For example, with a twisted torso a mirrored FK arm should keep its relation to the chest. This is what most Maya pose tools do, and it is the default for partial FK selections.

**Fast path for world-aligned (normalized) controls (local mode):** `W_c⁰.q = I` on both sides, so the mirror is a pure channel transform. Swap the pair, map the local quaternion as `(x, −y, −z, w)` and the translation as `(−x, y, z)`. For Euler values this is `rx' = rx, ry' = −ry, rz' = −rz`, independent of rotate order. Proof: `M·(A·B·C)·M = (MAM)(MBM)(MCM)`, and the elementary rotations reflect to `R_x(a)`, `R_y(−b)`, `R_z(−c)`. For a full-body flip, local and world modes agree, because every parent is mirrored too.

### 16.2 Operations

| Operation | Behaviour |
|---|---|
| Mirror pose (selection) | Snapshot all source deltas first, then apply top-down, re-evaluating parents. Centre controls mirror onto themselves (yaw and roll flip). |
| Flip pose (whole body) | Mirror every pair in both directions, from the snapshot |
| Mirror animation | For a pair, at the union of both curves' key times (or every frame if IK or constraints are involved): mirrored pose → keys, then the Euler filter. Option: **half-cycle offset** `t' = (t + T/2) mod T` for locomotion cycles, which turns a left step into a right step. |
| Mirror selection | Select counterparts |

### 16.3 Left/right mapping

1. VRM humanoid: `left<Bone>` ↔ `right<Bone>` (e.g. `leftUpperArm` ↔ `rightUpperArm`).
2. Name patterns, case-insensitive. Each pattern is tried for left → right and the reverse:
   - suffix `.L/.R`, `_L/_R`, `-L/-R`
   - suffix `_l/_r` (Unreal style, e.g. `upperarm_l`)
   - prefix `L_`/`R_`, `l_`/`r_`
   - word `Left`/`Right` anywhere (Mixamo `mixamorig:LeftArm`)
3. Spatial fallback: the bone nearest `M·p⁰` within `0.01 H` with the same depth and child count.

`RigDoc.mirror.pairs` stores the result explicitly, both directions, so users can fix it.

---

## 17. Pose copy and paste

Clipboard payload (JSON in `text/plain` via `navigator.clipboard.writeText`, plus an in-memory fallback):

```json
{
  "kind": "ekza.pose", "version": 1,
  "rig": { "id": "rig_7f3k", "fingerprint": "sha256:…" },
  "time": 1.2333,
  "controls": { "fk.upperArm.L": { "t": [0,0,0], "r": [0.10, -0.42, 1.21], "order": "yxz", "attrs": {} } },
  "world":    { "fk.upperArm.L": { "t": [0.21, 1.38, 0.02], "q": [0.12, -0.31, 0.55, 0.77] } },
  "humanoid": { "leftUpperArm": [0.12, -0.31, 0.55, 0.77], "hips": [0, 0, 0, 1], "hipsPosition": [0, 0.98, 0] }
}
```

| Paste mode | Formula |
|---|---|
| Local (same rig) | Copy channel values by control id |
| Mirrored | §16.1 applied to the pasted values |
| World | `L = (W_space · O)⁻¹ · W_pasted` per control, top-down |
| Humanoid (other avatar) | Set `N_b` (and hips scaled by `y_dst/y_src`), then match FK/IK controls from the resulting bones (§15.4 for one frame) |
| Blend paste | `slerp`/`lerp` from current to pasted by a slider `α`, i.e. pose-to-pose breakdowns |

---

## 18. Onion skin and motion trails

| Item | Design |
|---|---|
| Ghost pool | Clone the model once per ghost with `SkeletonUtils.clone` (three.js `examples/jsm/utils/SkeletonUtils.js`; it rebinds the skeleton and shares `BufferGeometry`). Swap materials for one shared unlit, transparent material per ghost (`depthWrite = false`), with an optional fresnel-silhouette shader later. |
| Poses | Evaluate the rig at `t ± k·step` into a per-frame pose cache (`Float32Array`, bone count × 10), keyed by the animation document revision. Recompute on edit, debounced to idle time. Cost per ghost is one evaluation plus one skinned draw. |
| Modes | Relative (`±k` frames, step `n`), keyed (previous and next `N` keys of the selection), pinned frames (Maya-style "ghost at frames") |
| Look | Past frames cool-tinted, future frames warm. Opacity `0.35·(1 − k/(N+1))`. Morphs and spring bones are skipped on ghosts. |
| Motion trail | For selected controls, sample `W_c` positions over `[t − a, t + b]` into a `Line2` with dots at keyed frames. Editable trails (drag a point to re-key) come later. |
| Viewports | Onion skin is a per-viewport toggle. For example, off in the fixed "camera" view and on in the free view. |

---

## 19. Rig definition format (`ekza.rig` v1)

### 19.1 Types

```ts
type Id = string;                      // /^[A-Za-z0-9._:-]{1,96}$/ ; auto-rig ids are deterministic ("fk.upperArm.L")
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];          // x, y, z, w (glTF order)
type TRS  = { t: Vec3; q: Quat; s?: number };           // similarity transform, s defaults to 1
type DccRotateOrder = "xyz" | "yzx" | "zxy" | "xzy" | "yxz" | "zyx";   // "xyz": X applied first
type Side = "L" | "R" | "C";
type AttrPath = `${Id}/@${string}`;                     // "switch.arm.L/@ikFk"
type BoneRef = { humanoid: string } | { name: string; parentName?: string };  // never a glTF index
type SpaceTarget = { kind: "world" } | { kind: "control"; id: Id } | { kind: "bone"; bone: BoneRef };
type Axes = [boolean, boolean, boolean];

interface RigDoc {
  format: "ekza.rig"; version: 1;
  id: Id; name: string;
  generator?: { name: "ekza-autorig-humanoid" | "ekza-autorig-fk"; version: string; options?: Record<string, unknown> };
  conventions: { units: "m"; angles: "rad"; up: "+Y"; forward: "+Z"; rotateOrder: "dcc" };
  skeleton: { kind: "vrm1" | "vrm0" | "gltf"; fingerprint: string; facing: Quat };  // facing: π-yaw for VRM 0.x
  controls:    Record<Id, ControlDef>;
  spaces:      Record<Id, { label: string; target: SpaceTarget }>;
  constraints: Record<Id, ConstraintDef>;
  solvers:     Record<Id, SolverDef>;
  bindings:    Record<Id, { control: Id; bone: BoneRef; mode: "rotate" | "translateRotate" | "full" }>;
  mirror: { plane: "YZ"; pairs: Record<Id, Id> };                   // both directions present
  selectionSets?: Record<Id, { name: string; members: Record<Id, true> }>;
}

interface ControlDef {
  name: string; side: Side; group?: "body" | "fingers" | "face" | "secondary";
  parent: Id | null;                    // default space; null = rig root
  restWorld: TRS;                       // W_c⁰ in character space (offset O is derived)
  rotateOrder: DccRotateOrder;
  keyable: { t: Axes; r: Axes; s: boolean };
  limits?: { tMin?: Vec3; tMax?: Vec3; rMin?: Vec3; rMax?: Vec3 };
  attrs?: Record<string, { type: "float" | "bool" | "enum"; default: number; min?: number; max?: number;
                           enumLabels?: string[]; keyable: boolean; stepped?: boolean }>;
  spaceSwitch?: { attr: string; options: Id[] };   // ids into RigDoc.spaces; APPEND-ONLY (enum indices)
  shape: { kind: "circle" | "square" | "cube" | "sphere" | "diamond" | "arrow4" | "star" | "foot" | "cross" | "custom";
           size: number; offset?: TRS; points?: Vec3[][]; color?: "side" | string; lineWidth?: number };
}

interface ConstraintDef {
  type: "parent" | "point" | "orient" | "aim";
  driven: { control: Id } | { bone: BoneRef };          // control ⇒ drives its space, not its channels
  targets: Record<Id, { target: SpaceTarget; weight: number | AttrPath; offset?: TRS }>;
  maintainOffset: boolean;
  blend?: number | AttrPath;
  skip?: { t?: Axes; r?: Axes };
  aim?: { aimAxis: Vec3; upAxis: Vec3;
          worldUp: { type: "vector"; vector: Vec3 } | { type: "object"; target: SpaceTarget }
                 | { type: "objectRotation"; target: SpaceTarget; vector: Vec3 } | { type: "none" } };
  enabled: boolean;
}

type SolverDef =
  | { type: "ik2"; bones: { upper: BoneRef; mid: BoneRef; end: BoneRef };
      ikControl: Id; pole: Id; fk: { upper: Id; mid: Id; end: Id };
      blendAttr: AttrPath; twistAttr?: AttrPath; poleDistanceAttr?: AttrPath;
      hingeAxis: Vec3;                 // in the mid bone's local rest frame, + = flexion
      soft?: number; stretch?: boolean; endOrient: "ik" | "fk" }
  | { type: "footRoll"; ik2: Id; ikControl: Id; toes?: BoneRef;
      pivots: { heel: Vec3; ball: Vec3; toe: Vec3; inner: Vec3; outer: Vec3 };   // ik control rest frame
      attrs: { roll: AttrPath; bank: AttrPath; heelTwist?: AttrPath; toeTwist?: AttrPath };
      breakAngle: number; straightAngle?: number; variant: "simple" | "straighten" }
  | { type: "chain"; algorithm: "fabrik" | "ccd"; bones: BoneRef[]; target: Id; pole?: Id;
      iterations: number; tolerance: number; blendAttr?: AttrPath };
```

**Animation document** (separate, see other docs): curves are keyed `"<controlId>/<channel>"`, where channel is one of `tx ty tz rx ry rz s` or `@<attr>`. Examples: `"fk.upperArm.L/rx"`, `"switch.arm.L/@ikFk"`, `"ik.leg.R/@roll"`. Rotation curve values are radians in the control's `rotateOrder`.

### 19.2 Example (excerpt: left arm)

```json
{
  "format": "ekza.rig", "version": 1, "id": "rig_vrm1_7f3k", "name": "Sample VRM",
  "generator": { "name": "ekza-autorig-humanoid", "version": "0.1.0" },
  "conventions": { "units": "m", "angles": "rad", "up": "+Y", "forward": "+Z", "rotateOrder": "dcc" },
  "skeleton": { "kind": "vrm1", "fingerprint": "sha256:…", "facing": [0, 0, 0, 1] },
  "controls": {
    "fk.upperArm.L": { "name": "L Upper Arm FK", "side": "L", "parent": "fk.shoulder.L",
      "restWorld": { "t": [0.17, 1.39, -0.01], "q": [0, 0, 0, 1] }, "rotateOrder": "yxz",
      "keyable": { "t": [false, false, false], "r": [true, true, true], "s": false },
      "shape": { "kind": "circle", "size": 0.055, "offset": { "t": [0.06, 0, 0], "q": [0, 0, -0.7071068, 0.7071068] }, "color": "side" } },
    "ik.arm.L": { "name": "L Arm IK", "side": "L", "parent": "root",
      "restWorld": { "t": [0.68, 1.39, -0.02], "q": [0, 0, 0, 1] }, "rotateOrder": "zxy",
      "keyable": { "t": [true, true, true], "r": [true, true, true], "s": false },
      "spaceSwitch": { "attr": "space", "options": ["space.root", "space.world", "space.cog", "space.chest", "space.head"] },
      "attrs": { "space": { "type": "enum", "default": 0, "enumLabels": ["root", "world", "cog", "chest", "head"], "keyable": true, "stepped": true } },
      "shape": { "kind": "cube", "size": 0.08, "color": "side" } },
    "pole.arm.L": { "name": "L Arm Pole", "side": "L", "parent": "root",
      "restWorld": { "t": [0.42, 1.39, -0.53], "q": [0, 0, 0, 1] }, "rotateOrder": "xyz",
      "keyable": { "t": [true, true, true], "r": [false, false, false], "s": false },
      "shape": { "kind": "diamond", "size": 0.03, "color": "side" } },
    "switch.arm.L": { "name": "L Arm Switch", "side": "L", "parent": null,
      "restWorld": { "t": [0.72, 1.45, -0.02], "q": [0, 0, 0, 1] }, "rotateOrder": "xyz",
      "keyable": { "t": [false, false, false], "r": [false, false, false], "s": false },
      "attrs": { "ikFk": { "type": "float", "default": 0, "min": 0, "max": 1, "keyable": true } },
      "shape": { "kind": "cross", "size": 0.02, "color": "side" } }
  },
  "spaces": {
    "space.root":  { "label": "root",  "target": { "kind": "control", "id": "root" } },
    "space.world": { "label": "world", "target": { "kind": "world" } },
    "space.cog":   { "label": "cog",   "target": { "kind": "control", "id": "cog" } },
    "space.chest": { "label": "chest", "target": { "kind": "bone", "bone": { "humanoid": "upperChest" } } },
    "space.head":  { "label": "head",  "target": { "kind": "bone", "bone": { "humanoid": "head" } } }
  },
  "constraints": {
    "attach.switch.arm.L": { "type": "parent", "driven": { "control": "switch.arm.L" },
      "targets": { "t0": { "target": { "kind": "bone", "bone": { "humanoid": "leftHand" } }, "weight": 1 } },
      "maintainOffset": true, "enabled": true }
  },
  "solvers": {
    "ik2.arm.L": { "type": "ik2",
      "bones": { "upper": { "humanoid": "leftUpperArm" }, "mid": { "humanoid": "leftLowerArm" }, "end": { "humanoid": "leftHand" } },
      "ikControl": "ik.arm.L", "pole": "pole.arm.L",
      "fk": { "upper": "fk.upperArm.L", "mid": "fk.lowerArm.L", "end": "fk.hand.L" },
      "blendAttr": "switch.arm.L/@ikFk", "hingeAxis": [0, -1, 0], "soft": 0, "stretch": false, "endOrient": "ik" }
  },
  "bindings": {
    "b.upperArm.L": { "control": "fk.upperArm.L", "bone": { "humanoid": "leftUpperArm" }, "mode": "rotate" }
  },
  "mirror": { "plane": "YZ", "pairs": { "fk.upperArm.L": "fk.upperArm.R", "fk.upperArm.R": "fk.upperArm.L" } }
}
```

### 19.3 CRDT and versioning rules

1. **Flat maps keyed by stable ids.** Never arrays of entities, and no `children` arrays. The hierarchy is parent pointers only, and children are derived. This avoids move/duplicate conflicts. In Yjs, each top-level collection is a `Y.Map<id, Y.Map>`.
2. **Small atomic values.** `Vec3`, `Quat` and `TRS` are replaced as a whole (last-writer-wins registers). Two users editing different controls never conflict. Two users editing the same field resolve by LWW, which is acceptable for rig data.
3. **Deterministic auto-rig ids** (`fk.upperArm.L`, `ik2.arm.L`, …). Two peers that auto-rig the same model produce identical ids, so curves keyed by control id merge naturally. User-created entities use random ids (nanoid, 12 characters).
4. **Ordered lists are allowed only where order is semantic and the list is append-only.** That means `spaceSwitch.options`, because stepped enum curves store indices. `chain.bones` is replaced atomically.
5. **The compiler repairs, it never throws.** Dangling references disable the entity. Cycles are broken deterministically (§8). Unknown fields are preserved for forward compatibility.
6. **Bones are referenced semantically** (`humanoid` first, then `name` plus `parentName`), never by glTF node index. OMOBA binds by semantic humanoid map too, and node indices change when files are re-exported. `skeleton.fingerprint` (a hash of sorted bone names, parents and rest TRS rounded to 1e-5) detects a model swap.
7. `version` bumps only on breaking changes. Migrations are pure functions `v(n) → v(n+1)`.

**Storage.**

- The project file holds the `RigDoc` and the `AnimDoc`; it is the lossless source of truth (03 §5.6).
- An optional round-trip copy goes into exported GLBs under `extras.ekzaAnimator`: `{ rig, curves }`, gzip plus base64 when large. `extras` needs no extension prefix registration and does not trip the "required extensions" validators of OMOBA or the registry. A vendor extension can replace it once a prefix is registered.

---

## 20. Reuse from Ekza (rig-relevant subset; full audit in 03)

| Source | Item | Use |
|---|---|---|
| `ekza-avatar-renderer` | `detectVrmKind`, the Draco-enabled VRM loader config | Model loading (import as a dependency) |
| `ekza-avatar-renderer` | `flipYawQuaternion` / `flipYawPosition` | VRM 0.x export conjugation (§1.1) |
| `ekza-avatar-renderer` | `resolveDrivenParentBone`, `sortBonesByDepth` | Humanoid hierarchy with optional bones missing (§4, §5.2) |
| `ekza-avatar-renderer` | VRM 0 thumb alias table (bake script) | Humanoid map normalisation |
| `ekza-avatar-renderer` | `SerializedHumanoidClip` format and CC0 shared library | Import source (library clips → controls via §15.4) and export target (§15.2). Keep **float** precision for authoring; the int16 quantization is a playback format. |
| `ekza-avatar-renderer` | `autoUpdateHumanBones: false` convention | The kernel writes raw bones (§4) |
| `omoba-bevy` | Motion = semantic world-rotation deltas from T-pose + hips displacement; in-place locomotion; `contacts` map per clip | Same space as D5. In-place export preset (§13). Contact markers are exported as clip events (`extras`). |
| `omoba-bevy` | `RetargetBasis` (facing from rest geometry) | Character frame for generic rigs (§5.1) |
| `core` | `src/engine` boundary (pure engine, host adapters) | Package layering (§2) |

Nothing in the existing repos implements controls, constraints or IK. Those are written from scratch, so no quality is lost.

---

## 21. MVP, tests, risks, open questions

### 21.1 MVP scope for this subsystem

1. `math` package:
   - similarity transforms and quaternions
   - Euler ↔ quaternion for all 6 orders, with the DCC ↔ three mapping
   - `eulerNear` and the Euler filter
2. `RigDoc` v1: types, validator, compiler (topological sort, cycle repair) and stateless evaluator (SoA buffers).
3. Humanoid auto-rig for VRM 0/1 (§5.2):
   - root, COG, FK spine, neck and head
   - FK and IK arms and legs with pole and hinge
   - IK/FK blend plus match and seamless switch
   - spaces for IK hands and feet and the head
   - simple foot roll
   - FK fingers
4. 1:1 FK auto-rig for generic glTF skeletons.
5. Control shapes:
   - `Line2` rendering, side colours, the two-pass x-ray
   - GPU picking, mesh-click → control, marquee and pickwalk
   - bones hidden by default
6. Constraints: parent, point, orient and aim, with weights, maintain-offset and blend.
7. Bake:
   - embedded raw clips (via the append-only writer from 03) and VRMA (normalized)
   - continuity, constant tracks, `LINEAR`/`STEP`, validation
   - root-motion modes `hips` and `in-place`
8. Import clips onto controls (FK, legs optionally IK-matched).
9. Mirror pose and animation, pose copy and paste (local, mirrored, humanoid), onion skin (±N ghosts).

### 21.2 Later

- FABRIK and CCD chains
- spline-IK spine
- stretch
- quaternion curve mode
- weighted spaces
- rotate-order autotune
- behavior-mirrored frames
- swing–twist limits
- editable motion trails
- finger curl and spread attributes (driven keys)
- toe flap
- lookAt and expression controls (VRMA `lookAt` / `expressions`)
- animation layers (additive)
- a rig editor UI (create controls and constraints interactively)
- VRM node-constraint baking for plain glTF
- Bézier curve fitting on import
- partial re-evaluation

### 21.3 Test plan (Vitest; property tests with fast-check)

| Test | Assertion |
|---|---|
| Zero pose | All channels at default ⇒ every bone local equals rest (≤ 1e-9), for every auto-rig and fixture |
| three-vrm parity | Kernel raw output equals `vrm.humanoid.update()` from the same `N_b` on the VRM 0 and VRM 1 fixtures (≤ 1e-6) |
| Rotation order table | For each of the 6 orders, `quat(e, dcc)` equals three's `setFromEuler(e', toThreeOrder(dcc))` with re-labelled angles |
| Euler filter and `eulerNear` | Random smooth quaternion paths ⇒ max per-frame Euler jump < 0.5 rad; `quat(eulerNear(q)) ≡ q` |
| Two-bone IK | Reachable target: `|end − target| < 1e-6·L`. The mid bone's local delta axis ∥ hinge. The mid joint lies in the pole plane (< 1e-6 rad). Unreachable target: straight towards it. |
| IK/FK match | FK→IK→FK round trip leaves the bone pose unchanged (< 1e-6) |
| Mirror | `mirror(mirror(P)) = P`; a symmetric pose is a fixed point |
| Bake round trip | `import(bake(curves))` reproduces bone poses (< 1e-5 rad, < 1e-6 m) |
| glTF validity | Exported files pass the Khronos glTF-Validator. VRMA channel rules are checked (§15.1). |
| Determinism | Same inputs give identical output arrays across two evaluations; compiled schedule order is stable across id insertion orders |

### 21.4 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Euler flips in imports, IK→FK matches and gizmo keys | Popping curves | `eulerNear` everywhere, Euler filter, gimbal warnings (§14) |
| Asymmetric rest pose (non-VRM rigs) | Mirror drift | Delta mirroring (§16.1), symmetry validation, editable pairs |
| Non-uniform or negative scale rigs (some FBX → glTF conversions) | Incorrect binding | Validate and warn; `Matrix4` path later |
| IK pole flip when the target crosses the pole axis | Knee or elbow snaps | Inherent to RP solvers. Mitigated by the pole-distance UI, the annotation line and soft IK. Stateless by design, so no hysteresis hacks. |
| CRDT merges producing invalid rigs | Broken evaluation | Compiler repair (§8, §19.3) |
| Stylised avatars (huge heads, tiny limbs) | Ugly or overlapping control sizes | Mesh-based radius clamps and per-control size edits |
| Cross-browser floating-point differences | Non-bit-identical poses between peers | Peers sync curves, not poses. One client performs export bakes. |
| VRM 0.x facing and thumb naming | Mirrored or wrong exports | Root yaw policy, alias table, tests on both fixtures |

### 21.5 Open questions for the owner

1. Defaults: arms FK and legs IK? Arm IK space defaulting to `root`, or `world`?
2. Colour convention: keep left blue / right red / centre yellow (the request) as the default theme?
3. Should right-side controls be *behavior-mirrored* (same values ⇒ mirrored pose, Maya style) or world-aligned (consistent axes, mirror via the tool)? This doc proposes world-aligned for the MVP.
4. Default root-motion mode per export target: `hips` for Space and VRMA, `in-place` for OMOBA?
5. Should rigs become a registry asset kind (a shared rig per avatar template), or stay inside project files only?
6. Should exported GLBs embed the rig and curves (`extras.ekzaAnimator`) for round-tripping, or should the project file be the only editable source?
7. Allow stretch and scale for non-VRM exports, given that OMOBA and VRMA forbid them?

---

## 22. References

- glTF 2.0 specification (coordinate system, animations, Appendix C interpolation): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- glTF 2.0 animation sampler schema (strictly increasing input): https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/schema/animation.sampler.schema.json
- VRM 1.0 humanoid: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md
- VRM 1.0 T-pose: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/tpose.md
- VRMC_vrm_animation 1.0: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md
- VRM "how to transform human pose": https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/how_to_transform_human_pose.md
- VRMC_node_constraint 1.0: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_node_constraint-1.0/README.md
- VRM Animation overview: https://vrm.dev/en/vrma/
- three-vrm `VRMHumanoidRig` source: https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm-core/src/humanoid/VRMHumanoidRig.ts
- three-vrm `rotateVRM0`: https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/src/VRMUtils/rotateVRM0.ts
- three.js `CCDIKSolver` docs: https://threejs.org/docs/pages/CCDIKSolver.html; source: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/animation/CCDIKSolver.js
- three.js `Matrix4.makeRotationFromEuler`: https://github.com/mrdoob/three.js/blob/dev/src/math/Matrix4.js
- Maya `MTransformationMatrix`: https://help.autodesk.com/cloudhelp/2016/ENU/Maya-SDK/cpp_ref/class_m_transformation_matrix.html
- Maya `MFnIkJoint` (joint matrix with jointOrient): https://help.autodesk.com/cloudhelp/2016/ENU/Maya-SDK/cpp_ref/class_m_fn_ik_joint.html
- Maya transform node (`offsetParentMatrix`): https://help.autodesk.com/cloudhelp/2025/ENU/Maya-Tech-Docs/Nodes/transform.html
- Maya orientConstraint node (interp types, No Flip needs run-up/cache): https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Tech-Docs/Nodes/orientConstraint.html
- Maya animated rotation (Euler vs quaternion): https://help.autodesk.com/cloudhelp/2023/ENU/Maya-Animation/files/GUID-CBD30A0A-1166-4076-A564-1ADC946A15F3.htm
- Maya animation settings (rotation interpolation modes): https://help.autodesk.com/cloudhelp/2016/ENU/MayaLT/files/GUID-0817C74B-C95C-4E5F-BCFA-26DEE1D7747F.htm
- Maya Graph Editor Curves menu (Euler Filter): https://help.autodesk.com/cloudhelp/2023/ENU/Maya-Animation/files/GUID-619CAE9C-107D-4504-A769-227DDC847153.htm
- Maya "Fix corrupted curves": https://help.autodesk.com/cloudhelp/2016/ENU/Maya/files/GUID-10782D86-F2BC-418B-8076-DE02725AFED8.htm
- D. Holden, "Simple Two Joint IK": https://theorangeduck.com/page/simple-two-joint
- A. Aristidou, J. Lasenby, "FABRIK: A fast, iterative solver for the Inverse Kinematics problem", Graphical Models 73(5), 2011: https://www.andreasaristidou.com/FABRIK
- Blender: two Euler solutions, pick nearest (`mat3_normalized_to_compatible_eulO`): https://projects.blender.org/archive/blender-archive/commit/fbca69c6
- Spine IK softness: https://en.esotericsoftware.com/spine-ik-constraints
- Rig colour convention example (varies by studio): https://courses.cs.washington.edu/courses/cse458/07au/projects/project6/rigging_tutorial/controls.htm
- Sibling research: `03-ekza-reuse-audit.md` (containers, VRM append-only bake, Ekza conventions)
