# 18 — Constraints and control-shape editing

Status: research and design proposal, 2026-10-19. Audience: the M6b spec author and the implementers of
`packages/rig`, `packages/doc`, `packages/anim-core` (shape registry), `packages/editor-core` and the Rig & Skin
workspace.

This note turns two V1 requirements into buildable contracts for the Rig & Skin workspace of M6b:

- **FR-RIG-10** — constraints: parent, point, orient and aim, with weighted targets, maintain offset and blend.
- **FR-RIG-13** — control-shape editing: shape library, colour, line width, size, offset, CV edits and mirroring. Rig
  edits never create keys.

It also covers what both features touch elsewhere:

- the compiled op schedule
- keying weights as channels
- baking constraints to keys
- export
- undo and collaboration
- simple space switching (a stretch item, research 07 §11 built as a constraint)

Inputs:

- research [07](07-rig-controls-math.md) §3, §7, §8, §11, §16, §19; [08](08-extensibility-modeling.md) §9;
  [09](09-ui-ux-spec.md) §4.5–4.6, §5.8; [14](14-skinning-own-models.md) §7
- [M2A-SPEC](../M2A-SPEC.md) §4.3, §5.1, §5.3–5.8; [MVP-SPEC](../MVP-SPEC.md) §4.11.15; [ADR 0004](../adr/0004-rig-model.md)
- the code on `m6b/spec`: the rig compiler, kernel, influence and inverse modules, the shape registry, the viewport
  control layer and the manipulator drag math

Out of scope (owner's non-goals): set driven keys, a node editor, rig scripting, blendshape authoring and muscle
systems. §16 lists what else is deferred.

---

## 0. Decisions at a glance

| # | Decision | Reason |
|---|---|---|
| K1 | **A constraint drives a control's zero frame, never its channels.** The zero frame `Z_c` is the offset group of a leading commercial desktop DCC ("the desktop DCC" below). The control's world stays `W_c = Z_c · L_c`, so a constrained control can still be animated. | This is desktop-DCC best practice for constraining the offset group, and research 07 §7 says the same. No pairBlend node is needed. The viewport gizmo already derives the frame as `W · L⁻¹` (`viewport/src/manipulators/drag.ts`), so it works on constrained controls unchanged. |
| K2 | **Four built-in rig ops**, `constraint:parent`, `constraint:point`, `constraint:orient` and `constraint:aim`, registered by `registerBuiltinRigOps`. They use the shipped `ConstraintRecord` with typed `params` (v1). **The record shape does not change.** | This is how M2a added `ik2` on top of `SolverRecord.params`. Nothing changes in the schema or in validation. |
| K3 | **Three offset modes, read from existing fields.** `maintainOffset: true` without a stored offset derives the offset from the rest pose (the default). With a stored `targets[k].offset` it uses that offset, captured at a frame. `maintainOffset: false` snaps. | Rest-derived offsets are deterministic and survive joint edits (`rig.autoRig.update`, M6b). Capturing at the current frame is what the desktop DCC does, and what "Set Inverse" does in a popular open-source DCC ("the open-source DCC" below). |
| K4 | **Target weights and the blend are attribute channels on a holder control** (by default the driven control): `@<key>.<target>` and `@<key>.blend`. They are `keyAll: false`, like `ikFk`. Constraints without a holder (for example on a bare bone) use the static record weights. | Curves exist only on controls (ADR 0004 §1). The desktop DCC keys `targetWeight` the same way, and the open-source DCC keys Influence. Attribute slots, sampling, the Graph Editor and undo already handle `@name` channels (M2A §5.1). |
| K5 | **Blending.** Translations are averaged with weights. Rotations use a sequential, hemisphere-aligned, normalized weighted sum (the desktop DCC's **Average**, the default), or slerp for two targets (its **Shortest**). There is no **No Flip**, **Longest** or **Cache**. | Evaluation is stateless (research 07 D3). The desktop DCC documents that No Flip needs history. |
| K6 | **Schedule rules.** Op→op edges follow the data: a writer always runs before its reader. Ops that write the same world run solvers first, then constraints. A constraint that writes something a solver also writes is disabled. A cycle through a constraint disables that constraint only. | This fixes three gaps in today's compiler (§1, gaps A and B). A user's constraint must never disable leg IK or detach a control. |
| K7 | **Bake to keys** samples every integer frame and solves controls top-down. It uses `eulerNear` and the Euler filter, then disables the constraint by default, in one undo step. **Export needs no bake step**: every exporter already samples the kernel. Two fixes are needed so that it stays correct (gaps C and D). | Same behaviour as the desktop DCC's `bakeResults -simulation` and the open-source DCC's Bake Action with Visual Keying. Exports stay exact. |
| K8 | **Authoring constraints are never written as `VRMC_node_constraint`.** They are always baked into bone tracks. | The VRM extension allows one source per constraint, rotation only, and blends weight from the rest pose. It cannot express what we evaluate. |
| K9 | **Space switching (stretch)** is a parent constraint in **select** mode. A stepped enum `@space` picks the target, and rest-derived offsets reproduce research 07 §11's `O_{c,s}` exactly. Switch-with-match reuses the M2a IK/FK key policy. | Needs no `ControlRecord.spaceSwitch` field, which the shipped schema never got. One op serves both blended and discrete spaces. |
| K10 | **Shapes stay `ControlShape`** (a `SplineSet`, `poly` or `bezier`). Transforming the whole shape writes `offset` and `size`, so the kind stays parametric. Editing CVs converts the shape to `custom`. One optional field, `edited`, lets `rig.autoRig.update` keep user edits. Shape edits never key and never recompile the program. | FR-RIG-13 acceptance: "shape change undoable; no keys created". The kernel never reads `shape`. |
| K11 | **Mirror shape** maps `offset' = B·(M·offset·M)` and `points' = M·points`, with `B = R⁰_{c'}⁻¹·M·R⁰_c·M`. For world-aligned controls `B = I`. Every built-in shape is symmetric about the YZ plane, so a mirrored built-in keeps its kind. | Exact for any rest frame. It is an involution. Built-ins stay small and editable. |
| K12 | **Four new built-in shapes**: `arrow`, `arrow2`, `gear` and `doubleCircle`. Older apps draw an unknown kind as the fallback circle. | Covers the requested library (arrow, cog) and research 09 §5.8 (double circle for the COG) without a schema change. |

---

## 1. What exists today (code facts on `m6b/spec`)

1. **Schema slot.** `ConstraintRecord` lives in `packages/doc/src/records.ts`:

   ```ts
   {id, rig, type: 'parent'|'point'|'orient'|'aim', driven: {control}|{bone},
    targets: Record<key, {target: SpaceTarget, weight: number, offset?: Xf}>,
    maintainOffset, params, enabled, deleted}
   ```

   - The comment on `params` says "typed in V1". Validation (`records/validate.ts`, `constraintShape`) only checks
     that `params` is a plain object.
   - The merge unit is `field`, so `targets` and `params` are each one atomic value.
   - The partition is `char:<character>`.

   FR-RIG-09's gate, "a constraint record compiles to a disabled op with a warning", holds today because no
   constraint type is registered.
2. **Op contract.** `RigOpImpl` lives in `packages/rig/src/kernel/ops.ts`. It has `reads`, `writes`, an optional
   `compile` (its result becomes `state`) and `run`.
   - After `run`, the kernel re-reads the worlds the op wrote: `controlWorld` and `boneWorld` go back into its
     transforms, and written bones are marked overridden.
   - When `run` returns `false`, nothing is re-read, so every bone local is bit-identical to a program without the
     op. `ik2` relies on this at `ikFk` 0.
3. **Scheduling** (`packages/rig/src/compile/compileRig.ts`). Priorities are control 0, constraint 1, solver 2 and
   bone 3, used as the tie-break of a Kahn sort. Each op gets edges producer → op for everything it reads, plus the
   M2A §5.4 rule 2 edges for its writes. Op→op edges are added only by this rule:

   ```ts
   if (touches && compareOps(writer, reader) < 0) edges.push([writer, reader]);
   ```

   - **Gap A.** If a solver writes a bone that a constraint reads, no edge is added, because solvers sort after
     constraints. The constraint is then ready first and reads the FK world. Example: a prop constrained to
     `rightHand` while the arm is in IK. FR-RIG-10's own acceptance case ("prop follows hand") would fail on an IK
     arm.
   - **Gap B.** Cycle repair drops the edge whose consumer sorts greatest. If that edge has an op at either end, the
     op is disabled; if it ends at a control, the control is detached. **An edge into a bone is dropped silently**:
     no warning, and the bone evaluates before its parent. Bones sort last, so in a cycle through a bone chain the
     dropped edge is almost always bone → bone.
     - Example: `fk.spine` orient-constrained to the `head` bone gives the cycle constraint → `spine` … `head` →
       constraint. The repair drops `neck → head`.
     - `ik2` cannot create such cycles, because its reads never depend on its writes. User constraints can.
4. **Influence** (`packages/rig/src/schedule/influence.ts`). `OpInfluence` indexes the ops that write each
   node (line 90) and ignores ops that write controls. Raw tracks exist only for nodes driven by a control.
   - **Gap C.** A constraint that writes a control adds its targets' curves to no track's influencing set.
     `computeStepSchedule` can then export STEP from the control's own stepped keys while the target moves
     smoothly, and the §5.16 keep set misses the target's key times.
   - **Gap D.** A constraint on a bone that no control drives exports no track at all, because
     `io/src/bake/bake.ts` takes raw tracks from `program.drivenNodes`.
5. **Inverse path** (`packages/rig/src/inverse/solve.ts`, `parentFrame`). It assumes the frame is
   `P = W_parent · O_c`.
   - **Gap E.** For a constrained control, match, Plant Feet, clip import and world-space paste would solve against
     the unconstrained frame.
   - The viewport drag already uses `P = W · L⁻¹` (`viewport/src/manipulators/drag.ts`, line 32), so the gizmo is
     right.
6. **Shapes.**
   - `ControlShape` is `{kind, size, offset: Xf, custom: SplineSet | null, color: 'side' | '#hex', lineWidth: number
     | null}`.
   - The registry (`anim-core/src/spline`) holds 10 built-ins: `circle`, `halfCircle`, `square`, `cube`, `sphere`,
     `diamond`, `arrow4`, `star`, `cross` and `lollipop`. All are unit size, and the planar ones lie in XY. Bézier
     arcs tessellate to 48 segments per circle.
   - The viewport draws `p_local = offset · (size · p_unit)`. An unknown kind or an empty `custom` falls back to a
     circle.
   - The only shape operators are `rig.setControlSize` and `rig.setFootParams`, which rewrites the IK footprint as a
     `custom` shape.
7. **Research 07 §19 vs the shipped schema.** Research 07 §19 proposed `ControlDef.spaceSwitch` and `weight: number |
   AttrPath`. The shipped schema has neither: `ControlRecord` has no space field, and `targets[k].weight` is a
   number. This note keeps the shipped schema and puts typed data in `params`.

---

## 2. Reference behaviour (verified 2026-10-19)

| Topic | Desktop DCC | Open-source DCC | Ours |
|---|---|---|---|
| Maintain offset | `maintainOffset`: "the position and rotation of the constrained object will be maintained" (parentConstraint command). Per-target `targetOffsetTranslate`/`Rotate` "in target's local space" (parentConstraint node). | Child Of **Set Inverse** / **Clear Inverse** (its manual) | Rest-derived offset by default. **Update Offset** captures one at the current frame (K3). |
| Skip axes | `skipTranslate` / `skipRotate`: "the axis specified [is] not to be considered when constraining" | Per-axis toggles | Per axis: translation in the parent frame, rotation per Euler axis in the control's rotate order (§3.4) |
| Weights | `targetWeight` defaults to 1 and is keyable. Docs example: "setting and keying the target weights lets you anchor in time the amount of influence" | **Influence** is keyable, "to change over time which target object will be considered the parent" | Attribute channels on the holder (K4) |
| Rotation mix | `interpType`: No Flip, Average, Shortest, Longest, Cache. The documented default is 1 (Average when counted from No Flip = 0). Average "can cause flipping since the previous result is not taken into consideration". | — | `average` (default) and `shortest`. No Flip and Cache need history (research 07 §7) |
| Point | The node averages the target pivots by weight, maps the result into the parent space (`constraintParentInverseMatrix`) and adds `offset` | Copy Location | Same, with per-target offsets in the parent frame |
| Aim | `aimVector` (1, 0, 0), `upVector` (0, 1, 0), `worldUpType` default `"vector"`. Types: `scene`, `object`, `objectrotation`, `vector`, `none` ("no twist calculation is performed") | Damped Track / Track To | The same five types. `scene` is +Y in character space |
| Animation on top of a constraint | `pairBlend` is "automatically create[d] … when the user tries to keyframe a constrained object". Its blend weight sets "the amount of influence the animation and constraints have". | Constraint stack | Not needed: the channels sit on top of the zero frame. `@<key>.blend` is the envelope |
| Bake | `bakeResults` with `simulation`, `sampleBy`, `preserveOutsideKeys`, `minimizeRotation`, `sparseAnimCurveBake` | `bake_action(do_visual_keying, do_constraint_clear)` | `rig.constraint.bake` (§8) |
| Curve shapes | `nurbsCurve` has `degree`, `form` (open, closed, periodic) and `spans`. `lineWidth` defaults to −1, which "defer[s] to the global settings". `dispCV` shows CVs. | Custom bone shapes (meshes) | `SplineSet` (poly or bezier). `lineWidth: null` means the theme default |
| Colour | `overrideEnabled`. `overrideColor` is an index in 0–31 ("zero disables the override"). `overrideRGBColors` and `overrideColorRGB` give RGB | Bone colour sets | `color: 'side' \| '#hex'`. The picker offers a 32-swatch palette |
| Replace shape | `parent -shape -relative` parents a new shape under the existing transform | Custom Shape field | `rig.shape.replace` keeps the control, its curves and its offset |
| VRM runtime constraints | — | — | `VRMC_node_constraint`: roll, aim and rotation; **one source**; weight "performs Spherical Linear Interpolation (slerp) from the rest rotation"; rotation only. Not used for authoring (K8) |

Sources are in §19.

---

## 3. Constraint math

The notation follows research 07 §1.2: similarity transforms `X = (t, q, s)` with uniform scale for joints, column
vectors, and `A·B` meaning B is applied first. All worlds are in canonical character space.

### 3.1 Frames

```
L_c   = T(t) · R(r; order) · S(s)            channels of control c (ChannelBuffer slots 9c…9c+8)
Z_c   = zero frame of c (desktop-DCC offset group); unconstrained: Z_c = W_p · O_c   (W_p = I for root controls)
W_c   = Z_c · L_c                             the control's world, as today
rest  : Z⁰_c = W⁰_c                           channels at their defaults
bone  : Z_b = W_b                             a constraint on a bone replaces the bone's world
```

The **input frame** `Z_in` of a constraint op is the frame before that op runs:

- If the compiler knows the op is the **first writer** of `c` in the schedule: exactly `W_p · O_c`, from the
  parent's evaluated world and `internals.offsets`. This avoids inverting the channels.
- Otherwise: `W_c · L_c⁻¹`, read from the current world and the channels. The fallback when `|s| < 1e-12` is
  `W_p · O_c`.
- For a bone: the bone's current world, computed by its bone op from its parent and rest local or from its binding.

The op writes the **constrained frame** `Z` and then `W_c = Z · L_c` (or `W_b = Z`).

### 3.2 Targets and offsets

`W_ti` is the evaluated world of target `i`:

- `{kind: 'world'}`: the identity, which is the character root. A world target moves with the character's scene
  placement, as research 07 §11's `space.world` already does.
- A control: its `controlWorld`.
- A bone: its `boneWorld`.

`W⁰_ti` is the target's rest world: the identity, the control's `restWorld`, or the skeleton rest world.

**Offset mode** (K3):

- `maintainOffset` with no `targets[k].offset`: **rest-derived**, computed at compile time.
- `maintainOffset` with a stored offset: **stored**, captured by `rig.constraint.create` or **Update Offset**.
- `maintainOffset: false`: **snap**.

| Type | Per-target term | Rest-derived offset | Stored offset (captured at frame f) | Snap |
|---|---|---|---|---|
| parent | `C_i = W_ti · Off_i` | `Off_i = (W⁰_ti)⁻¹ · Z⁰` | `Off_i = W_ti(f)⁻¹ · Z_in(f)` | `Off_i = I` |
| point | `p_i = t(W_ti) + s(P)·(q(P) ⊗ Δ_i)` | `Δ_i = q(P⁰)⁻¹ ⊗ (t(Z⁰) − t(W⁰_ti)) / s(P⁰)` | the same at f; stored as `offset.t` (q = I) | `Δ_i = 0` |
| orient | `r_i = q(W_ti) · q(Off_i)` | `q(Off_i) = q(W⁰_ti)⁻¹ · q(Z⁰)` | `q(W_ti(f))⁻¹ · q(Z_in(f))` | `I` |
| aim | `q = R · q(Off)` (§3.5); one offset for the constraint, kept on the first target key | `q(Off) = (R⁰)⁻¹ · q(Z⁰)`, with `R⁰` the aim frame from rest positions | `R(f)⁻¹ · q(Z_in(f))` | `I` |

`P` is the **parent frame** of the zero frame: `W_p` (the identity for root controls) or, for a bone, the parent bone
world (the facing frame for roots).

- The parent offset is in target-local space and the point offset in the parent frame. Both match the desktop DCC's
  node documentation.
- **Rest exactness.** At default channels and default attributes, every rest-derived constraint gives `Z = Z⁰`. With
  the parent type, `C_i = W⁰_ti · (W⁰_ti)⁻¹ · Z⁰`. Bone locals then equal the rest within 1e-9, the FR-RIG-02 gate
  (§14).

### 3.3 Weights and averaging

The effective weights `w_i` for the targets in **target order** depend on `params.weights.mode`:

| Mode | Target order | `w_i` |
|---|---|---|
| `select` | `params.weights.order`, an append-only list | 1 for the target that `clamp(round(@<key>), 0, n−1)` picks, 0 for the others |
| `attrs` | target keys in code-unit order | `max(0, @<key>.<target>)` |
| `static` | target keys in code-unit order | `max(0, targets[k].weight)` |

Blend: `b = clamp(@<key>.blend, 0, 1)` when `params.blend` is set, else 1.

`Σ = Σ w_i`. **If `b · Σ = 0`, `run` returns `false`.** Nothing is written, the kernel re-reads nothing and the pose is
bit-identical to a program without the constraint, as with `ik2` at `ikFk` 0. Otherwise `ŵ_i = w_i / Σ`.

Weights are normalized and never padded to a "rest position". The desktop DCC can pull towards `restPosition` when
weights sum below 1; we use the blend for fading instead.

```
t = Σ ŵ_i t_i                                                  // parent: t(C_i); point: p_i; aim: target points
// rotation 'average' (default): sequential hemisphere alignment against the running sum
s = (0,0,0,0)
for i in target order, skipping ŵ_i = 0:
    σ = (dot(s, q_i) < 0) ? −1 : +1                            // first active target: s = 0 → +1
    s = s + ŵ_i · σ · q_i
q = |s| > 1e-9 ? s / |s| : q_k                                  // k: largest ŵ, first in target order on ties
// rotation 'shortest': exactly two active targets a, b → q = slerp(q_a, σ·q_b, ŵ_b), σ = sign(dot(q_a, q_b))
//                      any other count → 'average'
```

Why sequential alignment against the running sum, and not against "the first target":

- A target with weight 0 never decides a sign. If a zero-weight first target sat in the opposite hemisphere to two
  close targets, aligning to it would cancel them.
- A target entering from weight 0 contributes continuously.
- Signs can still flip when the active targets differ by about 180° in rotation (4D dot ≈ 0). That ambiguity is
  inherent to stateless averaging, and the desktop DCC documents the same for Average. The Attributes panel warns when
  two active targets differ by more than 120°.

The normalized weighted sum approximates the optimal average, which is the eigenvector of `Σ w_i q_i q_iᵀ` (Markley et
al. 2007), when targets are close together: for 2–4 targets within 60° of each other the two differ by at most
0.0064 rad in a 20,000-case random check made for this note. The constraint does not need the exact mean. The eigenvector method is
the reference implementation in the property tests (§14).

### 3.4 Skip axes

`params.skip = {t: Axes, r: Axes}`, where `true` means "do not constrain this axis" (the desktop DCC's `skip`).

- **Translation**: `a = P⁻¹ · t(Z)` and `b = P⁻¹ · t(Z_in)` (points in the parent frame). Take `b`'s component on
  each skipped axis. Then `t(Z) = P · a'`.
- **Rotation**:
  - `e_c = eulerNear(q(P)⁻¹·q(Z), ρ, e⁰)` and `e_in = eulerNear(q(P)⁻¹·q(Z_in), ρ, e⁰)`.
    - `ρ` is the control's rotate order, or `xyz` for bones.
    - `e⁰` is the Euler of `q(P⁰)⁻¹·q(Z⁰)`, a compile-time constant, so the result is stateless.
  - Take `e_in` on each skipped axis. Then `q(Z) = q(P) · quat(e', ρ)`.
  - The axes are the Euler axes of the zero frame relative to its parent. This is the desktop DCC's "the rotateX channel
    is not driven", expressed on the zero frame.
- Skipping all three axes of a group is a no-op for that group. The create operator refuses a constraint whose every
  axis is skipped.

### 3.5 Aim

Inputs:

- `a` and `u`: the aim and up axes, unit vectors in the zero frame's local space. `u` is Gram–Schmidt'ed against `a`
  at compile time; if they are parallel, `u` becomes the local axis least parallel to `a`.
- `T = Σ ŵ_i t(W_ti)`: target positions averaged by weight, as in the desktop DCC.
- `P = t(Z_in)`: the zero frame's origin, which is the control's pivot at zero channels. Translation channels do not
  move the aim origin. That is the price of K1, and it does not affect rotation-only controls such as FK and head.

```
f  = normalize(T − P)                         if |T − P| < 1e-9: q(Z) = q(Z_in) (no aim; the op still writes)
w  = world up by params.aim.worldUp.type:
       scene          (0, 1, 0)                                (character space)
       vector         params vector                            (character space)
       object         normalize(t(W_up) − P)                   (falls back to scene when |t(W_up) − P| < 1e-9)
       objectRotation q(W_up) ⊗ params vector
       none           → q(Z) = shortestArc(q(Z_in) ⊗ a, f) · q(Z_in)   (no twist; the VRM aim semantics)
u⊥ = w − (w·f) f;   if |u⊥| < 1e-6: u⊥ = (q(Z_in) ⊗ u) − ((q(Z_in) ⊗ u)·f) f;   if still < 1e-6: any unit ⊥ f,
     taken from the character axis least parallel to f (deterministic)
u⊥ = normalize(u⊥)
R  = [ f | u⊥ | f × u⊥ ] · [ a | u | a × u ]ᵀ                   // maps local (a, u) onto (f, u⊥)
q(Z) = quat(R) · q(Off)                                         // Off from §3.2 (identity when snapping)
```

**Default axes at creation.** `rig.constraint.create` picks:

- `a`: the ± local axis of the zero frame nearest to the direction from the pivot to the target at that moment;
- `u`: the ± local axis nearest to character +Y, other than `a`;
- `worldUp`: `scene`.

For a world-aligned `fk.head` aimed at a `lookAt` control in front of the face, that gives `a = +Z`, `u = +Y` and
`R⁰ = I`, so snapping is rest-exact as well. When `params.aim` is missing, the defaults are the desktop DCC's:
`(1, 0, 0)`, `(0, 1, 0)` and `vector (0, 1, 0)`.

### 3.6 Assembly, blend and write

| Type | Replaces in `Z_in` | Keeps |
|---|---|---|
| parent | `t`, `q` | `s` (a parent constraint never drives scale, as in the desktop DCC) |
| point | `t` | `q`, `s` |
| orient | `q` | `t`, `s` |
| aim | `q` | `t`, `s` |

Then:

1. Apply skip axes (§3.4).
2. Blend: `Z = (lerp(t_in, t, b), slerp(q_in, σ·q, b), s_in)`.
3. Write `W_c = Z · L_c` into `pose.controlWorld`, or `W_b = Z` into `pose.boneWorld`. Return `true`.

### 3.7 Several constraints on one control

Two constraints that drive the same control (the desktop DCC's point + orient pattern) run in `(priority, id)` order.
Each sees the previous one's frame as its `Z_in`, because the input frame of a non-first writer is `W_c · L_c⁻¹`.

The create operator offers **parent with skip axes** in place of point + orient. It keeps one record, one set of
weights and one offset.

### 3.8 Constraints on bones and binding modes

**`driven: {bone}`** is meant for bones that **no control drives**: a prop or socket joint in an M6b skeleton, or an
imported helper joint.

- If the bone already has a driver control, the compiler disables the constraint with a `duplicate-binding` warning:
  "L Hand is driven by fk.hand.L; constrain the control instead".
- Bones that are `VRMC_node_constraint` destinations or spring-bone joints are refused as driven bones *and* as
  targets. The viewport evaluates them after the kernel, so the kernel sees their unsimulated worlds (research 07
  §4).

**Binding mode** decides what a constrained control passes to its bone (ADR 0004 §7). The create operator warns, but
does not refuse:

| Control binding | point | orient / aim | parent |
|---|---|---|---|
| `rotate` (FK) | Moves the control only; the bone ignores translation. Warns: "fk.head drives its bone by rotation only; a point constraint moves the control, not the bone." | Exact | The bone follows rotation only; the control shape leaves the bone. Warns and suggests orient. |
| `translateRotate` | Exact | Exact | Exact |
| none (pure space, e.g. `root`, `cog`, IK controls, props) | Exact; children follow | Exact | Exact |

---

## 4. Data shapes

### 4.1 `ConstraintRecord.params` (version 1)

The new types go into `packages/rig/src/types.ts` (additive). `ConstraintRecord` itself is unchanged:

```ts
import type { Axes, ControlId, SpaceTarget } from '@ekza-studio/doc';

export type ConstraintType = 'parent' | 'point' | 'orient' | 'aim';

/** How the aim's up direction is found (desktop-DCC worldUpType). Vectors are in canonical character space. */
export type WorldUp =
  | { readonly type: 'scene' }                                                   // (0, 1, 0)
  | { readonly type: 'vector'; readonly vector: readonly [number, number, number] }
  | { readonly type: 'object'; readonly target: SpaceTarget }                   // towards the object's position
  | { readonly type: 'objectRotation'; readonly target: SpaceTarget; readonly vector: readonly [number, number, number] }
  | { readonly type: 'none' };                                                   // shortest arc, no twist

export type ConstraintWeights =
  | { readonly mode: 'static' }                                // targets[k].weight; nothing animatable
  | { readonly mode: 'attrs' }                                 // '@<key>.<targetKey>' on the holder
  /** Space switching (§10): enum '@<key>' on the holder picks order[i]; APPEND-ONLY (stepped curves store indices). */
  | { readonly mode: 'select'; readonly order: readonly string[] };

/** `ConstraintRecord.params` for the four built-in types (version 1). Unknown fields are preserved. */
export interface ConstraintParams {
  readonly v: 1;
  /** Short name, [A-Za-z][A-Za-z0-9_]{0,23}, unique among the constraints of one holder; attribute names derive from it. */
  readonly key: string;
  /** Control that owns the animatable attributes; null = static weights and blend 1. Default: the driven control. */
  readonly holder: ControlId | null;
  readonly weights: ConstraintWeights;
  /** '@<key>.blend' (0…1) on the holder scales the whole constraint; false = always 1. */
  readonly blend: boolean;
  /** true = the axis is NOT constrained (desktop-DCC skipTranslate / skipRotate). Ignored for the groups a type never drives. */
  readonly skip: { readonly t: Axes; readonly r: Axes };
  readonly interp: 'average' | 'shortest';
  /** Aim only (null otherwise). Axes are unit vectors in the zero frame's local space. */
  readonly aim: { readonly aimAxis: readonly [number, number, number]; readonly upAxis: readonly [number, number, number];
                  readonly worldUp: WorldUp } | null;
}
```

The existing record fields keep their meaning:

| Field | Meaning in v1 |
|---|---|
| `type` | Op type. A space switch is `'parent'` with `weights.mode: 'select'`. |
| `driven` | `{control}` drives the control's zero frame (K1). `{bone}` drives a bone no control drives (§3.8). |
| `targets` | Keys are short names, `[A-Za-z][A-Za-z0-9_]{0,23}` (they appear in attribute names), not `blend`. `weight` is the static weight, and also the default of the `@<key>.<target>` attribute in `attrs` mode. `offset` is the stored offset (§3.2): a parent target-local TRS, a point parent-frame vector in `t`, an orient target-local `q`; for aim, only on the first target in target order. |
| `maintainOffset` | `true`: rest-derived, or stored when `offset` is present. `false`: snap. |
| `enabled` | Rig-level switch. It is not animatable; use the blend to animate. |

`parseConstraintParams(record)` lives next to `parseIk2Params`. A missing or partial `params` reads as:

```
{v: 1, key: type, holder: null, weights: {mode: 'static'}, blend: false,
 skip: none, interp: 'average', aim: desktop-DCC defaults (aim only)}
```

An unknown `v` disables the op with an `unsupported-op` warning. The compiler never throws on document content.

### 4.2 Attributes on the holder

They are created and removed together with the constraint, in the same transaction, by patching `ControlRecord.attrs`:

| Attribute (channel) | When | `AttrDef` |
|---|---|---|
| `@<key>.<target>` | `weights.mode: 'attrs'`, one per target | `{type: 'float', default: targets[k].weight, min: 0, max: 1, keyable: true, keyAll: false, stepped: false, label: '<Key>: <Target>', mirror: 'copy'}` |
| `@<key>` | `weights.mode: 'select'` | `{type: 'enum', default: 0, enumLabels: order (display names), keyable: true, keyAll: false, stepped: true, label: '<Key>', mirror: 'copy'}` |
| `@<key>.blend` | `blend: true` | `{type: 'float', default: 1, min: 0, max: 1, keyable: true, keyAll: false, label: '<Key> Blend', mirror: 'copy'}` |

Labels are title-cased: `space` becomes "Space" and `parent.hand` becomes "Parent: Hand".

- **`keyAll: false`** for all three (M2A §5.1 rule 4). They are modes and settings, like `ikFk`: a later `S` on the
  pose must not re-key a stale weight. They are keyed when they are channels selected in the Channels panel, by auto-key when
  edited, and by their own operators (space switch, bake).
- **Mirroring** copies the value to the same-named attribute on the counterpart holder. `rig.constraint.mirror`
  keeps `key` and the target keys, so the names line up (§7).

### 4.3 Examples

A prop that follows the right hand, with space switching (stretch §10). `prop.R` is a pure space control under
`root` that drives the `prop.R` joint, which sits under the skeleton root:

```json
{
  "id": "cns_7Hq2mX0aLr4Tb9eZ", "rig": "rig_…", "type": "parent",
  "driven": { "control": "<prop.R control id>" },
  "targets": {
    "root":  { "target": { "kind": "control", "id": "<root control id>" }, "weight": 0 },
    "hand":  { "target": { "kind": "bone", "bone": { "humanoid": "rightHand" } }, "weight": 1 },
    "world": { "target": { "kind": "world" }, "weight": 0 }
  },
  "maintainOffset": true,
  "params": { "v": 1, "key": "space", "holder": "<prop.R control id>",
              "weights": { "mode": "select", "order": ["root", "hand", "world"] },
              "blend": false, "skip": { "t": [false, false, false], "r": [false, false, false] },
              "interp": "average", "aim": null },
  "enabled": true, "deleted": null
}
```

- `prop.R.attrs.space` is `{type: 'enum', default: 1, enumLabels: ['Root', 'Hand', 'World'], stepped: true, keyAll:
  false}`.
- Rest-derived offsets keep the prop where it is at rest in every space.

A head look-at:

```json
{ "type": "aim", "driven": { "control": "<fk.head>" },
  "targets": { "look": { "target": { "kind": "control", "id": "<lookAt>" }, "weight": 1 } },
  "maintainOffset": true,
  "params": { "v": 1, "key": "aim", "holder": "<fk.head>", "weights": { "mode": "attrs" }, "blend": true,
              "skip": { "t": [false, false, false], "r": [false, false, false] }, "interp": "average",
              "aim": { "aimAxis": [0, 0, 1], "upAxis": [0, 1, 0], "worldUp": { "type": "scene" } } },
  "enabled": true }
```

It adds `@aim.look` and `@aim.blend` to `fk.head`. The animator still rotates `fk.head` on top: a nod relative to
the aim.

### 4.4 Compiled state (internal)

```ts
interface ConstraintState {
  readonly type: 0 | 1 | 2 | 3;                // parent, point, orient, aim
  readonly drivenSlot: number;                 // −1 for a bone
  readonly drivenNode: number;                 // −1 for a control
  readonly firstWriter: boolean;               // Z_in = W_p · O_c exactly (§3.1)
  readonly parentSlot: number;                 // control parent slot or −1; bone: parent node (−1: facing)
  readonly targetKind: Uint8Array;             // 0 world, 1 control, 2 bone (target order)
  readonly targetIndex: Int32Array;            // control slot or node
  readonly off: XfArrays;                      // Off_i (parent/orient/aim) or Δ_i in t (point), per target
  readonly weightSlot: Int32Array;             // attr slot per target, −1 = static
  readonly staticWeight: Float64Array;
  readonly selectSlot: number;                 // −1 unless mode 'select'
  readonly blendSlot: number;                  // −1 when blend is off
  readonly skipT: Uint8Array; readonly skipR: Uint8Array;
  readonly order: RotateOrder; readonly restEuler: Float64Array;   // §3.4
  readonly aim: { readonly a: Float64Array; readonly u: Float64Array; readonly upKind: number;
                  readonly upIndex: number; readonly upVector: Float64Array } | null;
  readonly scratch: XfArrays; readonly q: Float64Array;            // run() allocates nothing
}
```

---

## 5. Compile and evaluation changes (`packages/rig`)

**R1 — Registration.**

- `BUILTIN_RIG_OPS` gains `['constraint', 'parent' | 'point' | 'orient' | 'aim', constraintOp]`.
- FR-RIG-09's M1 test keeps passing as long as it compiles without `registerBuiltinRigOps`; registration stays
  explicit. M1/M2a documents contain no enabled constraint records, so their schedules do not change.

**R2 — Declarations.**

- `reads`:
  - controls: every control target, the `object`/`objectRotation` up target, and the holder when it is not the
    driven control;
  - nodes: every bone target and up bone;
  - a world target adds nothing.
- `writes`: `{controls: [driven]}` or `{nodes: [driven bone]}`.
- Like `ik2`, the parse validation happens in `reads` and `writes`. Each of these throws, which disables the
  constraint with a warning:
  - a target that equals the driven entity;
  - a driven bone with a driver (`duplicate-binding`);
  - a node-constraint destination or spring joint as driven or target;
  - an unknown `v`.

**R3 — Op→op edges follow data** (replaces the loop at `compileRig.ts` lines 154–163). Gap A is fixed: the
prop-in-IK-hand case now orders `ik2.arm.R` → the constraint.

```ts
// for every ordered pair (w, r), w ≠ r
const flow   = intersects(w.writesControls, r.readsControls) || intersects(w.writesNodes, r.readsNodes);
const cowrite = intersects(w.writesControls, r.writesControls) || intersects(w.writesNodes, r.writesNodes);
if (flow) edges.push([w, r]);                                  // always: a writer precedes its reader
else if (cowrite && compareOps(w, r) < 0) edges.push([w, r]);  // shared writes: (priority, id)
```

- Swap the priorities, so that shared writes run **solvers before constraints**: `PRIORITY_SOLVER = 1` and
  `PRIORITY_CONSTRAINT = 2`. The constraint then has the last word. The desktop DCC behaves the same: a constraint
  overrides what drives its target.
- M2a programs schedule only solvers, and the solver priority still lies between controls (0) and bones (3), so their
  schedules are **identical** (gate in §14).
- A mutual flow (A writes what B reads and the reverse) is a real cycle and is handled by R5.

**R4 — Constraints yield to solvers.** After `collectOps`, and before sorting:

- A constraint whose written controls or nodes intersect any solver's written controls or nodes is disabled with
  `duplicate-binding`: "constraint 'space' on fk.index1.L: L Arm IK moves this control; constrain a control outside
  the arm, or a joint under the root".
- Without this rule, the shared write would close a cycle (constraint → driven bone → `ik2` → constraint), and the
  cycle repair might disable the arm IK.
- **Guidance**: a joint under the hand follows the hand without a constraint. Props that change hands or get dropped
  belong under the root (a standard game-rig layout).

**R5 — Cycle policy** (the dropped-edge handling at `compileRig.ts` lines 167–189; Gap B):

- Sort. If any dropped edge's cycle contains a **constraint** op, disable the constraint in that cycle with the
  greatest id, warn `cycle` with the path, remove its edges and sort again. The loop is bounded by the number of
  constraints.
- Only then apply today's repair to the remaining cycles: disable the op, or detach the control.
- In addition, a dropped edge into a bone that has no op at either end now warns `cycle` instead of passing silently.
  Today no document can produce one; the warning guards future ops.
- `rig.constraint.create` dry-runs the compile and poll-fails on a new cycle ("fk.spine would depend on itself
  through the head bone"). Cycles can therefore reach the compiler only through CRDT merges, as research 07 §8
  expects.

**R6 — `run`.** It allocates nothing; every buffer lives in `ConstraintState`.

```
run(state, pose, ch):
  b = blendSlot ≥ 0 ? clamp(ch.attrs[blendSlot], 0, 1) : 1
  w_i = weights per §3.3;  Σ = Σ w_i
  if b == 0 || Σ == 0: return false                          // bit-identical to no constraint
  read W_ti from pose (mat4 → xf); Z_in per §3.1 (L_c from ch.values via eulerToQuat with the control's order)
  compute Z (§3.2–§3.6)
  write xf → pose.controlWorld[drivenSlot] (Z·L_c) or pose.boneWorld[drivenNode] (Z)
  return true
```

**R7 — Influence** (`schedule/influence.ts`, gaps C and D). The definition grows by one sentence:

> An op that writes control `c` adds its reads' influence (the curves of the controls it reads, with their control
> ancestors and attribute curves, and recursively the influence of the nodes it reads) to every track whose
> influencing control chain contains `c`.

- Implementation: `OpInfluence` also indexes `writesControls`, and `trackInfluence` closes each chain set over
  `controlExtra(slot)` with a worklist. The closure is needed because a target control may itself be constrained.
- The holder is a read, so a stepped `@space` key becomes a step of the prop's tracks, which is correct.
- Raw tracks also exist for nodes written by a constraint whose `driven` is a bone. Their influence is the op's
  reads plus their parent's.
- **Activity**: a constraint with `params.blend` whose blend is statically ≤ 0 over the whole clip is inactive, as in
  the `ikFk` rule of `clipOpActivity`. Every other enabled constraint is active.

**R8 — Exported nodes** (Gap D).

- `RigProgram.drivenNodes` documents "node indices written by bindBone ops (exported as animated)". It becomes "…
  and nodes that a constraint op writes as its driven bone". This is additive; M2a programs are unchanged.
- `io/src/bake/bake.ts` then emits rotation and translation tracks for them. Translation is `always` only for the
  hips, as today; VRMA still drops it for non-hips humanoid bones (§9).

**R9 — Inverse frame** (`inverse/solve.ts`, Gap E). `parentFrame(…)` becomes `zeroFrame(internals, pose, slot,
channels)`:

- `W_p · O_c` exactly, as today, unless a constraint op writes the control;
- otherwise `W_c · L_c⁻¹`, from the pose evaluated with those same channels. This is the formula the viewport drag
  already uses. It is exact because a constraint's `Z` never depends on its own control's channels: that would be a
  cycle, refused by R5.

`solveControlChannels`, `channelsFromPose`, `matchIkToFk` (an IK control constrained into a space), Plant Feet, clip
import and world-space paste go through it.

Controls that `ik2` moves (the follow rule) keep the old frame. Switching them over would also be correct, but it
changes M2a import results in the last ulp, and M2a exports must stay byte-identical.

**R10 — Writer version.**

- `requiredWriterVersion(tables)` returns the schema version that first ships constraint ops when any live, enabled
  constraint record has a built-in type.
  - Older apps compile such records as disabled ops and would show a different pose without saying so, so they must
    open the project read-only.
  - That version is 4 if M6a is tagged with schema v3 before M6b lands. Otherwise constraint ops can ship inside v3,
    if M6a's B0a and the release order allow it. This is an open question (Q-CNS-9).
- New shape kinds and `ControlShape.edited` do not raise it: older apps keep unknown fields and draw the fallback
  circle.

**R11 — Budget** (report).

- A constraint `run` costs about 2–4 matrix↔xf conversions per target plus a few quaternion operations: under 1 µs.
- Gate: Seed-san with four IK limbs and ten constraints evaluates in ≤ 0.1 ms. The M2a IK bench target is ≤ 0.06 ms
  (M2A §5.4 rule 5); the pose budget stays 0.5 ms.

---

## 6. Evaluation order with FK and IK

| Case | Edges that decide it | Result |
|---|---|---|
| Constraint on an **IK control or pole** (spaces, IK hand holding a prop) | constraint writes `ik.arm.L` → `ik2` reads it (R3 flow) | The constraint runs first; IK solves to the constrained control |
| Constraint **reads a bone `ik2` writes** (prop follows the IK hand) | `ik2` writes `rightHand` → the constraint reads it (R3 flow) | `ik2`, then the constraint. Fails today (Gap A) |
| Constraint on **`fk.hand`** (the FK chain end; not written by `ik2`) | constraint → `bone(hand)` → `ik2` (`ik2` writes the hand bone) | The constraint shapes the FK hand; `ik2` blends FK and IK as usual. At `ikFk` 1 the IK hand wins, as in the desktop DCC |
| Constraint on a **control below the FK chain** (fingers, secondary controls under the hand) | shared write with `ik2` | Disabled by R4 with a message |
| Constraint on a **spine or head FK control** | constraint writes `fk.chest` → `bone(chest)` → … → `ik2` reads `parent(upper)` | Correct order through the bone ops; IK arms follow the constrained chest |
| Constraint whose **target depends on the driven control** (`fk.spine` → `head` bone) | cycle | The constraint is disabled (R5); `create` refuses it |
| Two constraints on one control | shared write, `(priority, id)` | In id order; each sees the previous frame (§3.7) |

Example schedule (abridged) for a humanoid with IK arms and the prop of §4.3:

```
controls (priority 0, as soon as ready): root, prop.R, cog, fk.hips, fk.spine … ik.arm.R, pole.arm.R …
bones (priority 3): hips, spine, chest, upperChest, rightShoulder, rightUpperArm …
solver ik2.arm.R           reads ik.arm.R, pole.arm.R, bone(rightShoulder); writes subtree(rightUpperArm) + finger controls
constraint space (prop.R)  reads bone(rightHand) [flow edge from ik2.arm.R], control root;  writes control prop.R
bone prop.R                driven by prop.R (edge constraint → bone)
```

---

## 7. Keying and animating constraints

- **Channels.** Weights, the blend and the `@space` enum are ordinary attribute channels of the holder. That covers
  curves, static values, overrides, the Graph Editor (`other` colour), the Dope Sheet, the clipboards, undo and
  auto-key (M2A §5.1). Weights are per clip, as every curve is; the record's `targets[k].weight` is the rig-level
  default.
- **Channels panel.**
  - Rows appear under "Custom" with their labels.
  - The control's header shows a constraint chip ("⛓ space: Hand") using `--cb-constrained` (research 09 §4.5).
    The chip has a tooltip and opens Attributes › Constraint.
  - The TRS fields keep their normal keyed/unkeyed colours, because they stay free (K1). The desktop DCC paints
    constrained channels blue because they are driven; ours are not driven.
- **What `S` keys.** `keyAll: false` attributes are keyed only when selected (above). Body-part keying, the tween
  `frame` target and `pose.resetToRest` skip them. The space switch keys `@space` itself (§10).
- **Mirror pose and mirror animation.**
  - Attributes map by `AttrDef.mirror: 'copy'` onto the counterpart holder's attribute of the same name.
  - Channels use the M1 rule.
  - World-mode mirroring solves through R9.
  - A constraint without a mirrored partner constraint mirrors channels only and warns once: "space on prop.R has no
    counterpart on prop.L".
- **Pose clipboard.** `keyAll: false` attributes are skipped unless selected (M2A §5.8).
- **Viewport.**
  - `Show › Constraints` (default on in Rig & Skin, off in Animate) draws a dashed line from each constrained control
    to every active target. Opacity is proportional to `ŵ_i`, using the `--rig-pole-line` style.
  - An aim constraint also draws its up object.
  - Lines are recomputed per pose version, with no React render per frame (M2A §5.5 rule 5).

---

## 8. Bake constraints to keys

`rig.constraint.bake {constraints, clips: 'active' | 'all', range: 'clip' | {start, end}, after: 'disable' |
'delete' | 'keep', reduce: ReduceSpec | null}`. This is the desktop DCC's **Edit › Keys › Bake Simulation** and the
open-source DCC's **Bake Action** with **Visual Keying** and, optionally, **Clear Constraints**.

1. `D` = the controls these constraints drive. Constraints on bones are refused ("prop.R joint has no control to key;
   export bakes it anyway"), because bones are never keyed (ADR 0004 §1).
2. `P_on` = the current program. `P_off` = `compileRig` of the definition with these constraints disabled. This is a
   side program, built in the operator; nothing is committed yet.
3. For each clip and every integer frame `f` of the range:
   - evaluate `P_on` and record `W_c(f)` for each `c` in `D`;
   - then solve `D` in `P_off` slot order, one depth level at a time, substituting the values already solved for
     ancestors in `D`.
   - The solve per control is: `L = zeroFrame_off(c)⁻¹ · W_c(f)`; rotations via
     `eulerNear(q(L), order, previous frame's values)`; translation and scale only where keyable.
4. Replace the keys of the written channels inside the range and keep the keys outside it (the desktop
   DCC's `preserveOutsideKeys`). Run the Euler filter on the written rotation curves. With `reduce`, run key reduction
   using `DEFAULT_REDUCE`, the import tolerances.
5. **Residual.** Evaluate `P_off` with the baked curves at every frame. If a control's world differs from `W_c(f)` by
   more than 1e-4 m or 1e-4 rad, warn. This happens when the constraint moved a channel that is not keyable: "fk.head:
   translation is not keyable; the baked head is 3.1 cm off at frame 12".
6. `after`:
   - `disable` (default): `enabled: false`; the attributes and their curves stay, so it can be re-enabled.
   - `delete`: removes the record, its holder attributes and their curves in every clip. This opens the clips'
     partitions first, as `rig.setRotateOrder` does.
   - `keep`: warns that the result now doubles.

It is one transaction and one undo step, labelled "Bake Constraint". Runtime is at most frames × depth levels × one
evaluation: well under a second for 1,000 frames.

**Export does not need this operator** (§9). Baking is for turning a constrained motion into editable curves, for
example before handing a shot to FK-only editing.

---

## 9. Export

- **Every exporter samples `RigProgram.evaluate`** at integer frames (research 07 §15.3). Constraints are therefore
  baked into the bone tracks they affect, with no extra step. What changes is only R7 (STEP schedule and keep set)
  and R8 (tracks for constraint-driven bones).
- **VRMA** (normalized humanoid tracks):
  - Constraints that affect humanoid bones appear through `N_b` and the hips position.
  - A constraint-driven non-humanoid bone has no VRMA track. The export dialog lists it: "prop.R is not part of the
    humanoid; VRMA drops its motion".
  - Translation on non-hips humanoid bones is dropped (VRMA rule) and listed.
- **Embedded VRM/GLB clips and the plain GLB** write raw tracks for every exported node, constraint-driven bones
  included.
- **`VRMC_node_constraint` is never written for authoring constraints** (K8). The extension has a single source, no
  translation, no up vector and rest-relative weights. Existing node constraints in imported VRMs keep their own
  rules: preview only, never baked (FR-RIG-18).
- **Round trip.** Constraint records travel with the rig in the project file and in `extras.ekzaAnimator` (research
  07 §19.3) like every rig record.
- **Determinism.** Baked tracks are identical whether or not the user ran `rig.constraint.bake` first, within the
  residual of step 5. The export golden tests stay as they are.

---

## 10. Space switching (stretch)

Research 07 §11's discrete spaces are built as a constraint:

- A **select-mode parent constraint** on the control, whose targets are its spaces.
- **Index 0 must be the control's own parent**, so the rest pose and the default value reproduce today's
  unconstrained frame exactly.
- With rest-derived offsets, `Z = W_s · (W⁰_s)⁻¹ · W⁰_c`, which is exactly research 07 §11's
  `W_space · O_{c,s}`.
- The **attrs** mode of the same op gives the "weighted spaces" research 07 listed as later, at no extra cost.

**Operators**

- `rig.space.add {control, spaces: SpaceTarget[], key = 'space'}` creates the record and the `@space` enum. The
  default sets are:

  | Control | Spaces |
  |---|---|
  | IK hands | `root` (0), `world`, `cog`, chest (the first present of `upperChest`, `chest`, `spine` as a bone), `head` (bone) |
  | IK feet | `root` (0), `world`, `cog` |
  | Poles | `root` (0), their IK control ("follow foot/hand") |
  | `fk.head` | `fk.neck` (its parent, 0), `fk.chest`, `cog`, `root`, `world` |

  The head is an orient-type select constraint (rotation only), so the neck still carries its position.
- `rig.space.switch {control, to, match = true, key: 'auto' | 'none' | 'key' | 'seamless'}`:

  ```
  W  = W_c(f)                                    // evaluated before the switch
  set @space = index(to)                         // override, then keyed by the policy below
  Z' = zeroFrame(c) evaluated with the new value // R9
  L' = Z'⁻¹ · W ;  channels via eulerNear(current values)
  key policy exactly as M2A §5.6 'switch': 'seamless' also keys f − 1 with the previous space and channel values
  (step tangents), so the pose at f − 1 and f is unchanged (1e-6)
  ```

  - In `attrs` mode the switch keys one-hot weights.
  - A switch to the current space poll-fails ("ik.arm.L is in Chest space already").
- **UI.** A "Space" enum row in the Channels panel. Choosing a value runs the switch with match. Typing a raw index
  writes the attribute without matching, as the desktop DCC's enum attributes do. There is also an Attributes › Space
  section with the key-mode select.
- The Graph Editor draws vertical markers at `@space` keys. The Euler filter treats the segments between them
  separately, because the curves are meant to jump there (research 07 §11).

---

## 11. Control shapes

### 11.1 Storage

```ts
// packages/doc/src/records.ts — ControlShape (additive optional field; table versions unchanged)
export type ShapeField = 'kind' | 'size' | 'offset' | 'color' | 'lineWidth';
export interface ControlShape {
  readonly kind: ControlShapeKind;             // built-in, registered, or 'custom'
  readonly size: number;                       // metres: unit shape → control-local scale
  readonly offset: ReadonlyXf;                 // shape placement in control-local space; s may be non-uniform
  readonly custom: SplineSet | null;           // kind 'custom' only: unit-space points
  readonly color: 'side' | `#${string}`;
  readonly lineWidth: number | null;           // px; null = theme default (2), desktop-DCC lineWidth −1
  /** Fields the user edited; `rig.autoRig.update` keeps them and regenerates the rest. Absent = generated. */
  readonly edited?: readonly ShapeField[];     // 'kind' also covers the custom points
}
```

- The shape is one atomic field of the control record, so it is one merge unit. A shape edit replaces it as a
  whole.
- `p_local = offset · (size · p_unit)` (viewport `controls/shapes.ts`) is the only placement formula.
- Research 07 §5.4 and §19 proposed `points: Vec3[][]` polylines. Research 08 §9 proposed `CurveData`. The shipped
  `SplineSet` is research 08's `CurveData` without `nurbs`, which stays reserved for M8 spline modeling.
- Validation limits, added to the `splineSet` check with repair: at most 64 splines and 4,096 points per shape, all
  finite. Oversized custom shapes are refused by the operators and truncated with a warning on load.

### 11.2 Library

The existing built-ins are `circle`, `halfCircle`, `square`, `cube`, `sphere`, `diamond`, `arrow4`, `star`, `cross`
and `lollipop`. Additions (`anim-core/src/spline/shapes.ts`, appended to `BUILTIN_CONTROL_SHAPES`):

| Kind | Geometry (unit, XY plane unless noted) |
|---|---|
| `arrow` | single arrow along +Y: shaft 0.2 wide from (0, −1) to (0, 0.4), head 0.6 wide to the tip (0, 1) |
| `arrow2` | double-headed arrow along ±Y, same proportions |
| `gear` | 12-tooth cog: outer radius 1, root radius 0.8, tooth flat 40 % of the pitch (the desktop DCC's "cog"/gear control) |
| `doubleCircle` | circles of radius 1 and 0.85 (research 09 §5.8 COG) |

Every built-in, old and new, is symmetric about the YZ plane (`x → −x`), which §11.4's mirror relies on. A
registry unit test asserts it.

Rectangles, flat boxes and ovals need no new kinds: `offset.s` may be non-uniform (square with `s = (2, 1, 1)`).

### 11.3 Operations (all undoable; never create keys; never recompile the program)

| Operation | Effect on `ControlShape` | Desktop-DCC equivalent |
|---|---|---|
| **Replace** `rig.shape.replace {controls, kind, custom?}` | `kind`, `custom`; keeps `size`, `offset`, `color`, `lineWidth`; `edited += kind` | Parent a new curve shape under the transform (`parent -s -r`), delete the old one |
| **Size / colour / width / offset fields** `rig.shape.set {controls, size?, color?, lineWidth?, offset?}` | the given fields; `edited +=` them. Absorbs `rig.setControlSize`, which stays as an alias | Attribute Editor drawing overrides, `lineWidth` |
| **Transform shape** `rig.shape.transform {controls, delta, pivot}` | Uniform scale goes to `size` (and `offset.t` scales about the pivot); rotation and non-uniform scale go to `offset` (§11.4); the kind stays parametric | Select every CV and move/rotate/scale |
| **Edit CVs** `rig.shape.editPoints {control, edits}` | First edit of a built-in: `custom` = a copy of the registry spline set and `kind: 'custom'`; then the unit points (§11.4); `edited += kind` | Component mode, CVs |
| **Mirror** `rig.shape.mirror {controls, direction: 'leftToRight' \| 'rightToLeft' \| 'selected'}` | Writes the counterpart's shape (§11.4); colour `side` stays `side`, a hex colour is copied; `edited` of the counterpart += the source's | Studio mirror-shape scripts |
| **Copy / Paste shape** `rig.shape.copy {control}`, `rig.shape.paste {controls}` | Clipboard `{kind: 'ekza.controlShape', version: 1, shape}`; paste writes `kind`, `custom`, `offset` (rotation and non-uniform scale only, keeping the target's own `offset.t`), `color`, `lineWidth`; `size` scaled by the ratio of the two controls' generated sizes | Copy/paste curve shapes via scripts |
| **Reset** `rig.shape.reset {controls, fields?}` | The generator's shape for these fields, from the current `SkeletonDesc`; removes them from `edited` | — |

- `structural: false`. The kernel never reads `shape`, so a shape patch must not trigger `compileRig`. The evaluation
  service's structural check ignores the `shape` field.
- The viewport rebuilds that control's line geometry only.

### 11.4 Math

**Unit ↔ local.** `p_local = O · (k · p_unit)`, where `O = offset` (TRS with possibly non-uniform `s`) and `k =
size`. The inverse is `p_unit = (1/k) · O⁻¹ · p_local`.

**Whole-shape transform** with a gizmo delta `D` given in world space at the current pose:

1. Convert it to control-local: `Δ = W_c⁻¹ · D · W_c`.
2. With the pivot `p` in control-local space (default: the shape's bounding-box centre), the new placement is
   `T(p) · Δ · T(−p) · O`.
3. Write the uniform part `k_Δ` into `size' = k_Δ · size` and keep the rest in `offset`. Uniform scale stays a size
   change: what the Attributes field shows, and what `rig.autoRig.update` regenerates when `size` is not edited.

**CV edit.** One CV is one anchor; for Bézier splines its two handles move with it.

- The local-space delta `Δ` (a translation, or a rotation or scale about the selection pivot) applies to each
  selected anchor and to both of its handles, so scaling all anchors of a circle scales it exactly.
- Unselected anchors keep their handles.
- Stored values are `p_unit' = (1/k) · O⁻¹ · Δ · O · (k · p_unit)`.

**Mirror** onto the counterpart `c'`:

- `M = diag(−1, 1, 1)`, and `R_c`, `R_{c'}` are the rest rotations `q(W⁰)`.
- A local shape point maps to `p' = R_{c'}⁻¹ · M · R_c · p` (pivot-relative, so a slightly asymmetric rest does not
  push the shape off its pivot).
- Since `M·M = I` and `M` commutes with the scalar `k`:

  ```
  p'_local = B · M · O · (k · p_unit) = B · (M·O·M) · (k · M·p_unit),     B = R_{c'}⁻¹ · M · R_c · M  (det +1)
  offset'  = B · (M·O·M)       with M·O·M = (t: (−x, y, z), q: (x, −y, −z, w), s unchanged)
  points'  = M · points        ((−x, y, z) for every point and handle; built-ins are M-invariant, so the kind stays)
  ```

- For world-aligned humanoid controls `R_c = R_{c'} = I`, so `B = M·M = I` and the mirror is the familiar sign rule.
  Bone-aligned generic rigs get the exact proper rotation `B`.
- Mirroring twice is the identity (property test, §14).

### 11.5 Interaction in Rig & Skin

- **Selecting a control** fills Attributes › Control Shape, as in research 09 §4.6, with:
  - a shape picker with a thumbnail grid of the library and "Custom (from CVs)";
  - Size;
  - Offset translate / rotate (degrees) / scale;
  - Colour: Side, a 32-swatch palette in the desktop DCC's index order, and Custom hex;
  - Line width;
  - buttons: Mirror to Other Side, Copy, Paste, Reset.
- **CV mode**: `F8` toggles object ↔ CV, `F9` or `1` enters CV mode, or RMB on the control › Control Vertex. These
  reuse M6a's `select.mode` keys in the `rig.viewport` scope (M6A §5.17).
  - It shows the anchors of every hilited control as points (and handles as small dots joined to their anchor).
  - Marquee, click and Shift/Ctrl work as in M6a.
  - `W`/`E`/`R` transform in control space, with the pivot at the selection centroid.
  - `Mod+A` selects every CV; transforming then writes `rig.shape.transform`, which keeps the kind.
  - Each drag is a live preview with no document writes, then one operation and one history step on release (M6A
    modal tool contract).
- **Edits apply to every hilited control**, as in the desktop DCC when several curves' CVs are selected.
- **Symmetric CV edits** inside one centre control are later work (§16).
- **In Animate**, the Attributes Size field keeps working as today (`rig.shape.set`). Every other shape editor lives
  in Rig & Skin, which matches FR-RIG-13 ("in a Rig workspace").

### 11.6 `rig.autoRig.update` (M6b C4) and shapes

The generator recomputes each control's shape from the new `SkeletonDesc` (sizes from the new radii, offsets from
the new bone lengths) and keeps the user's value for every field listed in `edited`.

- Offsets are control-local, so a user offset follows the moved joint.
- On bone-aligned generic rigs, a re-oriented joint also rotates a user-edited shape. That is acceptable, and the
  update toast says so.
- Constraints with **stored** offsets are listed in the toast ("re-capture with Update Offset"). Rest-derived ones
  update by themselves.
- Constraints whose controls or bones disappeared compile disabled with `dangling-ref`.
- When the joint tool renames a joint, it must rewrite the `BoneRef`s of constraint targets and driven bones in the
  same transaction. This belongs to the joint operators' contract.

### 11.7 Undo, collaboration, validation

- **Undo.** Every operation is one transaction and one history step, with labels such as "Replace Shape", "Edit
  CVs", "Mirror Shape" and "Create Parent Constraint".
  - Creating a constraint inserts the record and patches the holder's `attrs` in one transaction.
  - Deleting one also removes the holder's attributes and their curves in every clip (partitions opened first).
- **Collaboration.**
  - Shapes, `targets` and `params` are atomic fields with last-writer-wins.
  - Two users adding constraints to the same holder at once both patch `attrs`, so one set of attributes can be
    lost. The compiler then reads the missing attributes' targets with their static record weight and warns
    `dangling-ref`. **Repair Constraint Attributes**, the warning's action, re-creates them.
  - CRDT merges that create cycles are handled by R5.

---

## 12. Operators

| Operator | Undo | Workspaces | Notes |
|---|---|---|---|
| `rig.constraint.create {type, targets?, driven?, maintainOffset: 'rest' \| 'current' \| 'none', skip, weights: 'attrs' \| 'static', blend, interp, aim?, key?}` | U, adjustable | rig, animate | Selection: targets first, then the lead as the driven object (desktop-DCC order); joints are pickable in Rig & Skin. A picked FK control that drives a bone becomes a **bone** target by default (option "Follow: Bone / Control"), so the constraint follows IK and FK alike. Poll: no cycle (dry-run compile), no solver conflict (R4), at least one axis constrained. The last-op card shows maintain offset, skip axes, weights, interp and aim axes. |
| `rig.constraint.edit {constraint, patch}` | U | rig, animate | Static weights, offset mode, skip, interp, aim, holder, enabled |
| `rig.constraint.addTarget` / `removeTarget {constraint, target \| key}` | U | rig, animate | Adds or removes the weight attribute too; `select` mode appends only (removing a target hides it and keeps its index) |
| `rig.constraint.updateOffset {constraint, targets?}` | U | rig, animate | Captures stored offsets at the current frame and keeps `W_c` (desktop DCC: "Update offset"; open-source DCC: "Set Inverse") |
| `rig.constraint.clearOffset {constraint}` | U | rig, animate | Back to rest-derived offsets (open-source DCC: "Clear Inverse") |
| `rig.constraint.bake {…}` | U | rig, animate | §8 |
| `rig.constraint.mirror {constraints}` | U | rig, animate | The counterpart record: the driven object and targets mapped by `ControlRecord.mirror`, humanoid left↔right and research 07 §16.3 name patterns; axis vectors and world up mapped by `(−x, y, z)` (world-aligned frames; bone-aligned frames through `B` of §11.4); offsets mirrored per §11.4; same `key` and target keys |
| `rig.constraint.delete {constraints}` | U | rig, animate | Also the holder's attributes and their curves |
| `rig.space.add`, `rig.space.switch` | U | rig, animate | Stretch, §10 |
| `rig.shape.replace`, `.set`, `.transform`, `.editPoints`, `.mirror`, `.copy`, `.paste`, `.reset` | U (`copy`: none) | rig (`set`: also animate) | §11.3 |

**Menus.**

- Rig & Skin › **Constrain**: Parent, Point, Orient, Aim, Pole Vector, Update Offset, Clear Offset, Bake to Keys,
  Mirror, Delete, Spaces ▸.
  - "Pole Vector" selects the limb's pole control and offers its space.
  - Animate shows the same items under Rig › Constrain ▸.
- Rig & Skin › **Control Shape**: Replace ▸ (library), Edit CVs, Mirror Left → Right, Mirror Right → Left, Copy,
  Paste, Reset.

No new default hotkeys apart from the CV-mode keys reused from M6a.

---

## 13. UI placement (summary)

| Surface | Content |
|---|---|
| Attributes › Constraint (one section per constraint on the lead control; research 09 §4.6) | type, targets with weight sliders (static or animated: a key toggle per row), offset mode with Update/Clear, skip axes (t: x y z, r: x y z), interp, aim axes and world up, blend, enabled, Bake…, Delete |
| Attributes › Control Shape | §11.5 |
| Channels | weight, blend and space rows under Custom; constraint chip on the header (§7) |
| Outliner (Rig & Skin) | constraints listed under the driven control with a chain glyph, like the desktop DCC's constraint nodes; RMB: Select Targets, Bake, Delete |
| Viewport | constraint lines (§7); CV points in CV mode |
| Validation list (C6) | constraint warnings (`cycle`, `duplicate-binding`, `dangling-ref`, `unsupported-op`) with a "Select" action |

---

## 14. Tests and gates

Unit tests are Vitest with fast-check property tests. E2E tests are Playwright (run in CI).

| Gate | Assertion |
|---|---|
| Rest exactness | Any constraint with rest-derived offsets, at default channels and attributes: every bone local equals rest within 1e-9 (Seed-san, Polybot, the synthetic rig), each type and mode |
| Inactive = absent | `blend = 0` or all weights 0: `run` returns false; `boneLocal`, `humanLocal` and `controlWorld` are bit-identical to the program without the record |
| M2a schedules unchanged | The priority swap and R3–R5: the schedules of every M2a fixture rig (FK, IK legs, IK arms) are identical, and exports byte-identical |
| Parent follow | Random target and control poses: `W_c = W_t · Off · L_c` within 1e-9; with skip axes, skipped Euler/translation components equal the unconstrained ones within 1e-9 |
| Point / orient | Weighted point lands on `Σ ŵ_i p_i`; orient with one target equals `q(W_t)·q(Off)` |
| Average | Within 0.01 rad of the Markley eigenvector average for 2–4 targets within 60° of each other (worst case measured while writing this note: 0.0064 rad over 20,000 random cases); invariant to per-target sign flips of the input quaternions; continuous (≤ 1e-3 rad output change per 1e-4 weight change) away from the 4D-orthogonal set |
| Aim | Aim axis points at `T` (≤ 1e-9 rad); the up axis lies in the (f, w) half-plane; finite output for `T = P`, `w ∥ f` and zero-length up objects |
| Gap A | Prop parent-constrained to `rightHand` with the arm at `ikFk` 1: prop world = hand world · offset (1e-9); fails on today's compiler |
| Cycles | `fk.spine` orient → `head` bone: the constraint is disabled with `cycle`; no control detached; `ik2` never disabled; no silent bone-edge drop (Gap B) |
| Solver conflict | Constraint on `fk.index1.L` with arm IK: disabled with `duplicate-binding`; the arm IK still compiles |
| Influence | Prop with stepped own keys and smoothly animated hand: its tracks are LINEAR; the keep set contains the hand's key times; `@space` stepped keys produce steps (Gap C) |
| Constraint-driven bone export | A raw GLB track exists for a constraint-driven undriven joint and reads back within 1e-6 (Gap D) |
| Inverse | `matchIkToFk` on an IK hand in Chest space: FK → IK → FK leaves the chain within 1e-6 (Gap E) |
| Bake | Bake then disable: bone worlds at every integer frame equal the constrained ones within 1e-6 where the channels are keyable; rotation curves have per-frame jumps < 0.5 rad; one undo step restores everything |
| Mirror constraint | `mirror(mirror(record))` equals the record (ids aside); mirrored pose of a constrained pair is symmetric within 1e-9 on the synthetic rig |
| Space switch (stretch) | `seamless` at f: poses at f − 1 and f unchanged (1e-6); index 0 equals the unconstrained frame bit for bit |
| Shapes: no keys, no recompile | Every `rig.shape.*` operation leaves the curve and key tables unchanged and the program object identical (FR-RIG-13) |
| Shape mirror | Involution (1e-12); world-aligned controls give the sign rule; built-ins keep their kind |
| CV edit | Scaling all anchors of a circle by 2 equals `size × 2` (tessellated points within 1e-9); one history step per drag |
| autoRig.update | Edited fields survive a joint move; unedited sizes follow the new radii |
| Budget | Seed-san, four IK limbs, ten constraints: ≤ 0.1 ms per evaluate (report) |

E2E scenarios:

| ID | Scenario |
|---|---|
| E2E-CNS-01 | Prop follows an IK hand, then switches to world at frame 20 (seamless); the exported GLB plays it |
| E2E-CNS-02 | Bake an aim constraint on `fk.head`; one undo restores it |
| E2E-CNS-03 | Replace a shape, then edit its CVs; no keys are created, and undo restores both steps |
| E2E-CNS-04 | Mirror shapes L → R on an M6b Quick Rig character |
| E2E-CNS-05 (stretch) | IK hand space switch with match |

---

## 15. Work package and sizing

Proposed for MODELING-PLAN §5.2, as package **C8 `constraints-shapes`**:

| Part | Scope | Size (agent-days) | Starts after |
|---|---|---|---|
| C8a | rig: four ops, `parseConstraintParams`, R3–R10, bake core, mirror mapping, unit gates | 4.5 | C0 (only the rig package; it can start at once) |
| C8b | editor-core operators (§12), Attributes › Constraint, Channels panel rows and chip, Outliner entries, viewport lines | 3 | C8a, C6 |
| C8c | shape library additions, `rig.shape.*`, CV mode (reusing B10/B12a component selection and transform tools), mirror/copy/paste/reset, `edited` + `autoRig.update` preservation | 3 | B10, B12a, C4 |
| C8d (stretch) | `rig.space.add` / `switch`, default space sets, Graph Editor markers | 1.5 | C8a, C8b |

**Core ≈ 10.5 agent-days, stretch 1.5.** C8a has no UI dependency and can run alongside C1/C2. The rig changes
(R3–R5, R7–R9) are small and well bounded, but they touch the M2a scheduling and bake paths, so the M2a schedule and
byte-identity gates in §14 are required in C8a.

---

## 16. Non-goals and later

- **Owner non-goals**: set driven keys, a node editor, rig scripting, blendshape authoring, muscle systems.
- **Later**:
  - scale constraint (`s = Π s_i^{ŵ_i}`);
  - geometry, normal, tangent and point-on-poly constraints, rivets and motion paths (research 08 §9.1);
  - the desktop DCC's `Longest` interp;
  - No Flip and Cache interp: never, they break D3;
  - constraint layers and per-user constraint ownership (M3);
  - exporting simple single-target orient or aim constraints as `VRMC_node_constraint` for runtime use;
  - degree-3 NURBS CVs for shapes (`SplineKind 'nurbs'`, M8);
  - drawing new curves (M8);
  - symmetric CV edits within one shape;
  - editing Bézier handles separately (the M8 spline editor);
  - constraining CVs.

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The priority swap and new edges change M2a schedules | Exports drift | M2a programs schedule only solvers; schedule-identity and byte-identity gates (§14) |
| Average flips when targets are far apart in rotation | A pop while weights animate | Documented; the `shortest` option; Attributes warning above 120°; step the weights for real switches |
| Users constrain controls under an IK chain | Confusion | R4 disables with an explanation and a suggested fix; the create poll refuses it up front |
| Stored offsets go stale after joint edits | A prop sits off the hand | Rest-derived offsets by default; the `autoRig.update` toast lists stored ones |
| Point or parent constraints on rotate-bound FK controls | The bone does not move as expected | Creation warning (§3.8) |
| CRDT merges drop one constraint's attributes or create cycles | Static weights, disabled constraint | Compiler repair with warnings and a repair action (§11.7, R5) |
| Large custom shapes | Slow picking or rendering | Limits of 64 splines and 4,096 points per shape |
| Older apps open projects with constraints | Wrong pose shown silently | `requiredWriterVersion` makes them read-only (R10) |

---

## 18. Open questions for the owner

| ID | Question | Default proposed |
|---|---|---|
| Q-CNS-1 | Animatable weights by default (attributes on the driven control), or static unless asked? | Animatable (`attrs`), like the desktop DCC's keyable `targetWeight` |
| Q-CNS-2 | Default offset: rest-derived, or the desktop DCC's "capture at the current frame"? | Rest-derived; Update Offset captures |
| Q-CNS-3 | Create constraints in Animate too, or only in Rig & Skin? | Both (the desktop DCC puts Constrain in the Animation and Rigging menu sets); shapes only in Rig & Skin |
| Q-CNS-4 | After a bake: disable, delete or keep the constraint? | Disable |
| Q-CNS-5 | Space switching in M6b (stretch), or keep it in M5 as the roadmap says? | M6b stretch, since it is about 1.5 days on top of the constraint op |
| Q-CNS-6 | Weights, blend and space as `keyAll: false` (keyed only explicitly, like `ikFk`)? | Yes |
| Q-CNS-7 | Point/parent constraints on rotate-bound FK controls: warn or refuse? | Warn |
| Q-CNS-8 | True NURBS CVs for shapes now, or Bézier anchors until M8? | Bézier anchors now |
| Q-CNS-9 | Ship constraint ops under schema v4 (M6a tagged first), or inside v3? | Decide at the M6b spec freeze, depending on the M6a tag |

---

## 19. Sources

Desktop DCC (vendor documentation, accessed 2026-10-19; vendor URLs omitted):

- parentConstraint command (maintainOffset, skipTranslate/skipRotate, weight, createCache), 2025 Python command
  reference
- parentConstraint node (interpType values and default, targetWeight, target-local offsets), node reference
- pointConstraint node (weighted average of target pivots, constraintParentInverseMatrix, offset), node reference
- orientConstraint node (No Flip needs a run-up or cache), node reference
- aimConstraint command (aimVector, upVector, worldUpType values and defaults), 2025 Python command reference
- Constraining objects (keying target weights; pairBlend between animation and constraints), 2017 help of the LT
  edition
- pairBlend node (created automatically when keying a constrained object), 2015 node reference (Chinese edition)
- bakeResults command (simulation, sampleBy, preserveOutsideKeys, minimizeRotation, sparseAnimCurveBake), 2025 Python
  command reference
- nurbsCurve node (lineWidth −1 = global setting, dispCV, degree/form/spans), 2025 node reference
- dagNode drawing overrides (overrideEnabled, overrideColor 0–31, overrideRGBColors, overrideColorRGB), 2025 node
  reference
- parent command (`-shape`, `-relative`), 2025 Python command reference

Open-source DCC (manual and API; vendor URLs omitted):

- Child Of constraint (keyable Influence, Set Inverse / Clear Inverse), dev manual
- `bpy_extras.anim_utils.bake_action` (`do_visual_keying`, `do_constraint_clear`), 2.74 Python API reference

Standards and papers:

- VRMC_node_constraint 1.0 (roll/aim/rotation, one source, weight slerps from rest, no circular dependencies):
  https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_node_constraint-1.0/README.md
- F. L. Markley, Y. Cheng, J. L. Crassidis, Y. Oshman, "Averaging Quaternions", *Journal of Guidance, Control, and
  Dynamics* 30(4), 2007, doi:10.2514/1.28949:
  https://oshman.net.technion.ac.il/files/2016/04/Markley_Cheng_Crassidis_Oshman_JGCD_V30_N4_July_Aug_2007.pdf

Repository (read on `m6b/spec`):

- `packages/doc/src/records.ts`, `packages/doc/src/records/validate.ts`
- `packages/rig/src/kernel/ops.ts`, `kernel/program.ts`, `kernel/internals.ts`, `compile/compileRig.ts`,
  `compile/schedule.ts`, `compile/build.ts`, `schedule/influence.ts`, `schedule/steps.ts`, `inverse/solve.ts`,
  `limb/ik2.ts`, `types.ts`
- `packages/anim-core/src/spline/index.ts`, `spline/shapes.ts`, `types.ts`
- `packages/viewport/src/controls/shapes.ts`, `viewport/src/manipulators/drag.ts`
- `packages/io/src/bake/bake.ts`
- `packages/editor-core/src/operators/builtin/rig.ts`
