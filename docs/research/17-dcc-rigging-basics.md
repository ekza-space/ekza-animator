# 17 — Desktop-DCC rigging basics for low-poly game characters: joints, orientation, mirroring, binding and weight tools

> Research note for Ekza Animator, M6b ("Characters from own models", expanded by the owner's request into a full but
> not over-engineered **Rig & Skin workspace**). Date: 2026-10-19. Status: proposal for the M6b build spec.
>
> Scope: the rigging basics of a leading commercial desktop DCC ("the desktop DCC" below) **tool by tool**: Joint Tool,
> joint hierarchy editing, Orient Joint, Mirror Joint, joint display, Quick Rig and humanoid-IK skeleton templates, Bind
> Skin, Paint Skin Weights, the Component Editor weight table, Copy / Mirror Skin Weights, Prune Small Weights, Remove
> Unused Influences, bind pose and Go to Bind Pose, and re-binding after topology edits; the equivalents worth borrowing
> from a popular open-source DCC ("the open-source DCC"); and the automatic weighting algorithms we can realistically
> run in TypeScript (or WASM) on meshes of up to 10k vertices. For each item: a priority (**BASE** = M6b, **LATER**,
> **NO**), the desktop DCC's menu path and hotkey, and behaviour notes precise enough to implement.
>
> Relation to research [14](14-skinning-own-models.md): 14 owns the pipeline (data model, the `auto-lowpoly` bind, the
> normalization contract, exports, imports, the ROM clip). This note refines it at tool level, states where the desktop
> DCC and we differ, and records five changes to 14 (§0, rows R1–R5). Storage follows
> [ADR 0015](../adr/0015-mesh-storage-in-the-document.md) §8 and [M6A-SPEC](../M6A-SPEC.md) §4.2–§4.3: weights are the
> `skin.joints` / `skin.weights` **point** layers of a mesh revision, the binding is `MeshRecord.skin`, and there is no
> separate skin record or blob (this supersedes 14 §3.1–§3.2).
>
> Out of scope: constraints (FR-RIG-10) and control-shape editing (FR-RIG-13), which the expanded M6b also covers; only
> their touch points with joints are listed (§13). Non-goals of the whole M6b expansion: set driven keys, a node editor,
> rig scripting, blend-shape authoring, muscle systems, dual-quaternion skinning (glTF is linear blend only, 14 §5.1).
>
> Inputs: [MODELING-PLAN](../MODELING-PLAN.md) §3.10, §5; [M6A-SPEC](../M6A-SPEC.md) §4.2, §4.3, §5.2, §5.7, §5.10, §7;
> [M2A-SPEC](../M2A-SPEC.md); research [07](07-rig-controls-math.md) §1, §3–§7, §16, §19; [09](09-ui-ux-spec.md) §9.3;
> [12](12-lowpoly-workflow.md) L5–L6, §7; [14](14-skinning-own-models.md); [16](16-model-workspace-ui.md) §17;
> [REQUIREMENTS](../REQUIREMENTS.md) FR-RIG, FR-MOD-31…34; ADRs [0004](../adr/0004-rig-model.md), [0015](../adr/0015-mesh-storage-in-the-document.md),
> [0016](../adr/0016-modeling-interaction-paradigm.md); the rig package (`packages/rig/src`: `types.ts`,
> `autorig/naming.ts`, `humanoid/map.ts`, `mirror/mirrorPose.ts`). Facts about both DCCs were checked on 2026-10-19
> against the vendor documentation listed in §19; the desktop-DCC pages are the 2019–2026 help unless a section says
> otherwise.

---

## 0. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| J1 | **Joint orientation is a separate, optional rest rotation**, never a precondition. `JointRecord.restRotation` is a character-space quaternion; template humanoid joints keep **identity** ("World", Quick Rig's *World – No Alignment*); new non-humanoid chains default to **X down the bone, Y up** (the usual desktop-DCC setup). **Orient Joint** is a BASE operator. | Because rest *positions* are stored in character space (14 D3), orienting a joint rewrites one quaternion and never moves a child. It is cheap, so the owner's desktop-DCC habit costs us almost nothing. |
| J2 | **Orientation cannot change deformation or humanoid animation.** Skinning uses world deltas `W_b·(W⁰_b)⁻¹`, and humanoid controls are world-aligned (ADR 0004 §3), so the delta equals the control's rotation whatever the joint's frame (§2.3). It changes channel *meaning* only for **bone-aligned** controls (generic and secondary chains): Orient Joint on such a joint with rotation keys warns and converts the keys (the FR-RIG-08 resampling path). | One invariant to test (§16), and a clear rule for when the operator is safe. |
| J3 | **Joint Tool = one modal session per chain**: clicks place preview joints, `Enter` or RMB completes the chain as **one undo step**, `Backspace` removes the last point, `Esc` cancels with no step, `Insert`/`Home` or MMB-drag repositions the last joint (desktop-DCC convention). **Snap to Projected Center** and **X symmetry** are on by default for humanoids. | The desktop DCC's placement feel within the M6a modal-tool contract (M6A-SPEC §5.10). |
| J4 | **Hierarchy ops (BASE)**: insert / split, remove (splice), delete (subtree, as the desktop DCC's Delete), reparent (`P` / `Shift+P`, Outliner drag), disconnect, human-bone mapping as the "joint labels". **Reroot** is LATER and limited to generic skeletons. | Everything a low-poly humanoid plus tails, ears, hair and skirt chains needs. |
| J5 | **Mirror Joint (BASE)** across the character's **YZ plane (x = 0)**, not the desktop DCC's XY default. Mode **Orientation** for humanoids (identity stays identity), **Behavior** for non-humanoid chains; names through the shipped L/R name swap; an existing counterpart is **updated in place** (IDs, weights and curves survive), else created. | VRM space is mirror-symmetric about x = 0; updating keeps "Mirror L → R" usable while fitting. |
| J6 | **Joint display (BASE)**: X-ray joints on in Rig & Skin, one global joint size (auto 0.012 H, desktop-DCC *Joint Size*), side colours from the control tokens, local-axis triads (desktop-DCC *Local Rotation Axes*), human-bone labels (desktop-DCC *Show All Labels*). No per-joint radius attribute (schema v3 is frozen and it is not needed). | Readable skeletons at low-poly scale without a schema change. |
| J7 | **Test deformation the desktop-DCC way**: after binding, **rotating a joint (`E`) poses it for testing** through session overrides on its driving control (never keys); **Go to Bind Pose** clears them; the ROM clip (14 §7.2) is the scripted variant. Rest edits (move, orient) happen in the bind pose with **Move Skinned Joints** semantics (the mesh stays, deformation changes). | Riggers in the desktop DCC rotate joints, paint, and return to the bind pose; our bind pose is the zero pose, so "Go to Bind Pose" can never be blocked (the desktop DCC's is, by keyed IK and constraints). |
| J8 | **Rest flexion instead of "Set Preferred Angle"**: templates and the Quick Rig fitter give elbows and knees **1–3° of flexion on the hinge side** (inside the 5° T-pose lint tolerance, 14 §4.4) and place hinge pivots off-centre (elbow toward the back, knee toward the front, research 12 §7.2). New lint `skel.hinge-bend`. | M2a measured hyperextended rest arms on both fixtures (Seed-san −1.4°, Polybot −4.9°) and needed a continuity amendment in the IK solver (DECISIONS-OPEN M2A-A1-3). Fresh skeletons should not repeat that. |
| S1 | **Bind Skin options map onto `skin.bind` args** (§8). Linear blend only; **max 4 influences, maintained**; interactive normalization always; one bind pose = rest (14 D2). The desktop DCC's skinning methods (DQ, Weight Blended), *Post*/*None* normalization and multiple bind poses are **NO**. | glTF and both runtimes read one set of four influences (14 §5.1). |
| S2 | **Auto-weight methods**: BASE `closest` (desktop-DCC *Closest in Hierarchy* with dropoff, our reading), `rigid-islands`, `heat` (bone heat), `auto-lowpoly` (14 §5.4); LATER `envelope` (capsules: desktop-DCC *Interactive Skin Bind*, open-source-DCC envelopes) and `voxel` (geodesic voxel, for M7 meshes). **All in TypeScript in a Worker; WASM is not needed at ≤ 10k vertices** (§9). | 14 measured the heat solve at 82 ms for 10k vertices × 55 bones in plain JS; the system matrix is the same for every bone, so it factors once. |
| S3 | **Paint Skin Weights**: the desktop DCC's operations and value/opacity semantics, one stroke = one transaction computed **from the stroke-start weights** (non-accumulating, deterministic), plus the open-source DCC's **X-mirror stroke** (the desktop DCC disables reflection in this tool), Lock-Relative display and a sample key `I`. | Desktop-DCC feel; the open-source DCC's mirror stroke adds the symmetric painting the desktop DCC lacks. |
| S4 | **For low-poly, numbers beat brushes**: the **weight-numbers overlay** (the desktop DCC's *Show Numbers*, 2026 release) and the Component Editor table are first-class, together with Assign-to-joint (14). Painting is the second tool, not the first. | A 600–3,000-vertex body has two or three loops per joint (research 12 §7.2); typing 0.5 on a loop is faster and more exact than a brush. |
| S5 | **Transfers use closest point + weight inpainting** (Abdrashitov et al., SIGGRAPH Asia 2023: match only where distance ≤ 0.05 × bounding-box diagonal and the normal is within 35°, solve the rest with a Dirichlet + Laplacian energy). Used by Copy Skin Weights, by the "skin out of date" recovery after topology edits that lose correspondence, and by Make editable rebinds. | Plain closest point is the documented baseline that fails on armpits, crotches and loose parts; the inpainting step is a small sparse solve of the same kind as bone heat. |
| S6 | **Cleanup operators (BASE)**: Prune Small Weights (default 0.01), Remove Unused Influences (palette compaction), Normalize (open-source-DCC *Normalize All* with locks), Smooth Skin Weights (open-source-DCC factor / iterations / expand), Move Weights to Influence, Copy/Paste Vertex Weights, Weight Hammer. *Limit Total* is implicit (max 4 is always maintained). | Each is a few dozen lines over the §6.1 normalization contract of 14. |
| R1 | *Change to 14 §4.2*: "Move / Rotate joint" splits into **move = rest edit** and **rotate = test pose after binding** (J7); rotating a rest is done by Orient Joint or by `D`-held rotate (§6). | Desktop-DCC muscle memory for weight testing. |
| R2 | *Change to 14 §6.2*: add the numbers overlay, Smooth Skin Weights, Move Weights, Sample, palette compaction (S4, S6). | Low-poly practice. |
| R3 | *Change to 14 §6.2 "Transfer"*: closest point becomes the matching stage of the inpainting transfer (S5). | Robustness. |
| R4 | *Change to 14 §6.4*: the **Delete** key removes a joint **and its subtree** (desktop-DCC convention); *Remove Joint* (menu) splices it out; both fold weights into the nearest surviving ancestor. | Desktop-DCC semantics for the key; 14's splice survives as Remove Joint. |
| R5 | *Change to 14 §3*: weights are mesh-revision layers on the **point** domain (ADR 0015 §8), so UV and normal seams share weights by construction; 14's R3 (seams tearing) remains only for imports welded by M6a's make-editable rule. | Superseded storage. |

---

## 1. The desktop DCC's Rigging menu set mapped onto the Rig & Skin workspace

The desktop DCC's rigging tools live in the **Rigging** menu set, mainly the **Skeleton** and **Skin** menus (plus
Deform, Constrain and Control). Our Rig & Skin workspace (research 16 U4, MODELING-PLAN §5.1) gets **Skeleton** and
**Skin** menus with the desktop DCC's item names; Constrain and Control belong to the sibling M6b notes. The desktop DCC
ships almost no default hotkeys for these items; the hotkeys that exist are listed in §1.3.

### 1.1 Skeleton menu (and joint-related items elsewhere)

| Desktop-DCC item (path) | What it does | Ours (operator / tool) | Priority |
|---|---|---|---|
| Skeleton ▸ **Create Joints** | Opens the Joint Tool | tool `skel.jointTool` → `skel.joint.create {points, parent, …}` (§3) | BASE |
| Skeleton ▸ **Insert Joints** | Insert Joint Tool: adds joints into an existing chain | `skel.joint.insert {bone, t}`, `skel.bone.split {joint, n}` (§4) | BASE |
| Skeleton ▸ **Mirror Joints** | Duplicates the chain across a plane; Behavior / Orientation; search/replace names | `skel.joint.mirror` (§5) | BASE |
| Skeleton ▸ **Orient Joint** | Sets local axes: primary axis down the bone, secondary axis toward a world direction, optionally for children | `skel.joint.orient` (§2.4) | BASE |
| Skeleton ▸ **Remove Joints** | Deletes the current joint and unites the remaining joints into one chain | `skel.joint.delete {subtree: false}` (§4) | BASE |
| Skeleton ▸ **Connect Joint** | *Connect Joint* (moves the first chain onto the second joint) or *Parent Joint* (inserts a bone between them) | *Parent* mode = `skel.joint.reparent`; *Connect* mode (snap the chain root onto the target) | BASE (parent) / LATER (connect) |
| Skeleton ▸ **Disconnect Joint** | Breaks the skeleton at the current joint into two chains | `skel.joint.reparent {parent: null}` | BASE |
| Skeleton ▸ **Reroot Skeleton** | Makes the current joint the root; the MEL `reroot` says the joint "should not have skin attached" | `skel.joint.reroot` for generic skeletons; refused on a humanoid's hips path | LATER |
| Skeleton ▸ **Joint Labelling** | Side (Center/Left/Right) and type labels used by retargeting and by "Label" influence association | `JointRecord.side` + `humanBone` (`skel.joint.setHumanBone`, 14 §4.2); labels overlay (§7) | BASE |
| Skeleton ▸ **Quick Rig** | Wizard: One-Click or Step-by-Step (geometry → guides → skeleton and rig → skinning) | `skel.quickRig` wizard (14 §4.3, refinements in §10) | BASE |
| Skeleton ▸ **humanoid IK** (full-body IK submenu) | Humanoid character definition and skeleton generator | VRM humanoid template presets + humanoid mapping dialog (FR-IO-13); no full-body humanoid IK solver | BASE (template) / NO (solver) |
| Skeleton ▸ Create IK Handle / IK Spline Handle | IK handles | the auto-rig's limb IK (M2a); spline/chain IK is M2c (07 §9.3) | — |
| Skeleton ▸ Set / Assume Preferred Angle | Stores the bend direction IK uses | rest flexion in templates + lint `skel.hinge-bend` (J8); no attribute | BASE (as lint) |
| Edit ▸ Parent (`P`) / Unparent (`Shift+P`) | DAG parenting | `skel.joint.reparent` (§4) | BASE |
| Display ▸ Animation ▸ **Joint Size** | Global joint display scale (factor 1 = diameter 1 unit) | preference `rig.jointDisplayScale` (§7) | BASE |
| Display ▸ Transform Display ▸ **Local Rotation Axes** | Shows each selected joint's axes | `view.jointAxes {target: 'selected' \| 'all' \| 'none'}` (§7) | BASE |
| Viewport Shading ▸ **X-Ray Joints** | Draws joints over shaded geometry | on by default in Rig & Skin (§7) | BASE |
| Component mode ▸ Local Rotation Axes (manual axis rotate) | Rotating the axis component edits the orientation | `D`-held rotate on a joint (§6) covers the use; axis-component picking | LATER |
| Modify ▸ Search and Replace Names | Batch rename | `skel.joint.renameMany {search, replace}` | LATER (template names are fixed) |
| Skin ▸ **Move Skinned Joints** | Repositions joints of a bound skeleton without detaching the skin | the default joint move in the bind pose (J7, §6) | BASE |

### 1.2 Skin menu

The desktop DCC's Skin menu (2026 release), in order: Bind Skin, Interactive Bind Skin, Unbind Skin, Go to Bind Pose,
Paint Skin Weights, Mirror Skin Weights, Copy Skin Weights, Smooth Skin Weights, Hammer Skin Weights, Copy / Paste
Vertex Weights, Prune Small Weights, Reset Default Weights, Disable / Enable (Post) Weight Normalization, Normalize
Weights, Export / Import Weight Maps, Interactive Skin Bind Tool, Move Skinned Joints, Move Weights to Influences, Edit
Influences, Substitute Geometry, Bake Deformation to Skin Weights. The **Rigid Bind** menu items were removed; the
vendor help says a rigid result is "smooth skin using one influence per vertex", which is exactly our rigid-islands
output.

| Desktop-DCC item | Ours | Priority | Notes |
|---|---|---|---|
| **Bind Skin** ▫ | `skin.bind {method, joints?, vertices?, …}` + adjust-last card | BASE | §8 maps every option |
| Interactive Bind Skin / Interactive Skin Bind Tool | `skin.bind {method: 'envelope'}` with capsule manipulators | LATER | §9.1 row 4 |
| **Unbind Skin** | `skin.unbind {meshes}`: drops the `skin.*` layers and `MeshRecord.skin` (undoable) | BASE | |
| **Go to Bind Pose** | `skin.test.bindPose` (14 §7.2): clears test overrides and shows the zero pose | BASE | never blocked (J7) |
| **Paint Skin Weights** ▫ | tool `skin.paint` (§11) | BASE | |
| **Mirror Skin Weights** ▫ | `skin.weights.mirror` (14 §6.3, §12.3 here) | BASE | |
| **Copy Skin Weights** ▫ | `skin.weights.transfer {source, method: 'inpaint' \| 'closest-point'}` (§12.2) | BASE (same skeleton) / LATER (other skeletons, UV space) | |
| **Smooth Skin Weights** | `skin.weights.smooth {factor, iterations, expand}` | BASE | the open-source DCC's operator parameters |
| **Hammer Skin Weights** | `skin.weights.hammer` | BASE | 14 §6.2 |
| **Copy / Paste Vertex Weights** | `skin.weights.copyVertex` / `skin.weights.pasteVertex` | BASE | |
| **Prune Small Weights** ▫ | `skin.weights.prune {below: 0.01}` | BASE | locked joints are not pruned |
| Reset Default Weights | `skin.bind` masked to the selected joints (14 §5.4 `joints` arg) | BASE | |
| Disable / Enable / Post normalization | none: normalization is always interactive | NO | export needs Σ = 1 |
| **Normalize Weights** | `skin.weights.normalize {lockActive?}` | BASE | for imports with Σ ≠ 1 |
| Export / Import Weight Maps | JSON export/import of a skin (per vertex, by joint name) | LATER | |
| **Move Weights to Influences** | `skin.weights.move {from, to}` on the selected vertices | BASE | |
| Edit Influences ▸ Add / Remove Influence | implicit: the palette grows when a joint receives weight; `skin.palette.compact` | BASE (compact) | §12.5 |
| **Remove Unused Influences** (Bind option + Edit Influences) | `skin.palette.compact` | BASE | §12.5 |
| Substitute Geometry | not needed: layers travel through topology ops; replacement meshes use the transfer | NO | §14 |
| Bake Deformation to Skin Weights | fit LBS weights to sampled poses of another deformer | LATER | M7 cleanup |
| Window ▸ General Editors ▸ **Component Editor** (Smooth Skins tab) | Weight table panel (§11.6) | BASE | |

▫ = has an option box in the desktop DCC; ours shows the same options on the Last-op card and in Channels panel INPUTS
(adjust last operation, M6A-SPEC §5.7).

### 1.3 Hotkeys

Desktop-DCC defaults that exist in this area, and what we bind (preset `dcc`, scope `rig.viewport` unless noted; chords
use `KeyboardEvent.code` like M6A-SPEC §7):

| Desktop DCC | Meaning there | Ours | Origin |
|---|---|---|---|
| `Enter` / `Return` | Completes the joint chain | `Enter`, `NumpadEnter`, RMB complete the Joint Tool session (tool keys) | M |
| `Insert` (`Home` on Mac keyboards) | Moves the active joint during creation | same, inside the Joint Tool; outside it, `Insert`/`Home` toggles "joint only" moves (the Model pivot-edit chord) | M |
| MMB-drag | Moves the last placed joint | same (inside the Joint Tool session) | M |
| `P` / `Shift+P` | Parent / unparent | `skel.joint.reparent` (last selected = parent) / unparent | M |
| `Delete` | Deletes the selection (a joint and its subtree) | `skel.joint.delete {subtree: true}` | M |
| Arrow keys | Pick-walk the hierarchy | joints: up = parent, down = first child, left/right = mirror partner or sibling (the shipped control pick-walk rules) | M |
| `B`+drag | Brush radius (above the slider's 50 limit too) | paint tool modifier | M |
| `M`+drag | Opacity (the desktop DCC's 2026 Paint Skin Weights page; older Artisan pages say "maximum displacement") | paint tool modifier | M |
| `N`+drag | Paint value | paint tool modifier | M |
| `U`+LMB | Artisan paint-operation marking menu | Replace / Add / Scale / Smooth / Flood / Sample marking menu | M (+E items) |
| `Alt+F` (Option+F) | Flood | **not bound**: `Alt+F` is on the never-bound list (Windows menu access, M6A-SPEC §7); Flood is in the `U` menu and the tool panel | — |
| `Ctrl+<` / `Ctrl+>` | Toggle Paint / Select / Paint Select modes | `Ctrl+Shift+Comma` / `Ctrl+Shift+Period` cycle Paint ↔ Select; QA row (browser chords) | M |
| — | — | `I` (hold, click a vertex) = sample weight into Value, as Paint Colour's eyedropper (M6A-SPEC §7) | E |
| — | — | `D` held during a joint drag = move/rotate the joint only, children keep their world rest (§6) | M~ |
| — | — | `Shift+RMB` = Rig & Skin tools marking menu (Joint Tool, Insert, Mirror, Orient, Bind Skin, Paint Skin Weights, Go to Bind Pose, Mirror Skin Weights); positions provisional as Q-MOD-UI-1 | E |

No chord is proposed for Go to Bind Pose, Bind Skin or Orient Joint: the desktop DCC has none, the marking menu and the
command palette (`Mod+K`) reach them, and every new chord costs a conformance row.

---

## 2. Joint model and what the desktop DCC's "orientation" means here

### 2.1 The desktop DCC's joint versus our `JointRecord`

A desktop-DCC joint is a transform with extra attributes. Its local matrix is `[S]·[RO]·[R]·[JO]·[IS]·[T]` in the
DCC's row-vector order (the SDK's `MFnIkJoint` class reference, quoted in 07 §3): `jointOrient` (JO) holds the rest
orientation, `rotate` (R) the animation, `rotateAxis` (RO) a pre-rotation, and `segmentScaleCompensate` the inverse
parent scale (IS). Riggers "freeze" rotations into JO so that the joint reads zero at rest.

Ours (schema v3, frozen by M6A-SPEC §4.2): `restPosition` and `restRotation` are both in **character space**; local
rests are derived (`L⁰_j = (W⁰_parent)⁻¹·W⁰_j`, 14 §3.3); joints are never keyed (ADR 0004 D1); scale is uniform 1. So:

| Desktop-DCC concept | Ours |
|---|---|
| `jointOrient` | `restRotation` (world, not parent-relative) |
| `rotate` channels | the driving control's channels (zero = rest) |
| "Freeze Transformations" on joints | not needed: there are no joint rotate channels to freeze |
| `rotateAxis`, `scaleOrient`, segment scale compensate | none (similarity transforms, ADR 0004 amendment) |
| joint `radius` | display only, global (§7) |
| bind pose (`dagPose`) | the rest pose itself (14 D2) |

### 2.2 Where orientation matters

| Consumer | Does joint orientation matter? |
|---|---|
| Skinning (viewport, export) | **No** — §2.3 |
| Humanoid FK/IK controls, VRMA, Ekza clip library | **No** — world-aligned controls; normalized rotations come from world deltas (ADR 0004 §3, §8) |
| VRM 1.0 export | Representation only: the raw node rotations change, consumers normalize them. VRM 1.0 relaxed 0.x's normalization requirement and keeps the T-pose ([vrm.dev](https://vrm.dev/en/vrm/vrm_features/)); three-vrm says VRM 1.0 "allows for non-normalized bone orientations" and exposes normalized bones for that reason; a VRM 1.0 test fixture inspected in 07 §1.1 has 51 of 52 non-identity rests |
| Generic and secondary chains (bone-aligned controls, ADR 0004 §4) | **Yes**: `rx/ry/rz` are rotations about the joint's own axes; X down the bone makes a tail curl one channel |
| Rotate manipulator in *Object* space on a test-posed joint | Yes (axes shown) |
| Plain GLB opened in the open-source DCC | Cosmetic: glTF has no bone tails, so its glTF importer guesses bone directions (`bone_heuristic`: the default heuristic puts tips along local +Y, TEMPERANCE aims at the nearest local axis to the child, FORTUNE at the child itself; its 5.2 Python API reference). Identity rests import as bones all pointing up under the default heuristic; the `yAim` (Y down the bone) orientation preset imports cleanly |
| Engines (Unity Humanoid, Godot, Unreal retargeting) | Their retargeters normalize rests; no requirement found that forces an orientation |

### 2.3 Why orientation cannot change deformation (the invariant behind J2)

For a joint `b` driven by control `c` with `rotate` binding (ADR 0004 §2): `q_b = q_c · q_K` with
`q_K = (q⁰_c)⁻¹ · q⁰_b`. Re-orienting the joint replaces `q⁰_b` by `q⁰_b' = q⁰_b · Δ`. For a **world-aligned** control
(`q⁰_c = 1`) the world delta is `D_b = q_b · (q⁰_b)⁻¹ = q_c · q⁰_b · (q⁰_b)⁻¹ = q_c`, the same before and after. The
joint's world position is `W_parent · L⁰_b`, and with `W_parent = D_parent · W⁰_parent` it equals
`D_parent · W⁰_b`, also independent of any orientation. The skinning matrix `W_b · IBM_b = W_b · (W⁰_b)⁻¹` therefore
depends only on the deltas: **deformation and humanoid animation are invariant under Orient Joint.** For a
**bone-aligned** control (`q⁰_c = q⁰_b`), `D_b = q⁰_b · R(r) · (q⁰_b)⁻¹`, so the same channel values now rotate about
different world axes; the operator must convert keys (§2.4 step 6).

### 2.4 `skel.joint.orient` (Orient Joint)

The desktop DCC's options (vendor help: *Orient Joint Options*):
*Orient Joint to World* (local axes = world axes; disables the rest), *Primary Axis* ("points down the bone"),
*Secondary Axis* (one of the other two; *None* lets the DCC choose), *Secondary Axis World Orientation* (± a world
axis), *Orient children of selected joints*, *Reorient the local scale axes*, *Toggle Local Axes Visibility*. Newer
Joint Tool pages also list *Auto orient secondary axis* (orients the secondary axis "using neighbouring joints"). Quick
Rig's *Align Joint X-Axis* offers *Mirrored Behavior* (default), *X Towards Next Joint* and *World – No Alignment*
(vendor help: *Quick Rig settings*).

Arguments (JSON schema, adjust-last):

```ts
interface OrientJointArgs {
  joints: JointId[];                        // selection by default
  mode: 'world' | 'aim';                    // 'world' = identity (DCC "Orient Joint to World")
  primary: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';           // aim mode: axis pointing at the child
  secondary: '+x' | '-x' | '+y' | '-y' | '+z' | '-z' | 'auto'; // must not be ±primary
  secondaryWorld: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';     // character space
  children: boolean;                        // DCC "Orient children of selected joints" (default true)
  symmetry: boolean;                        // default = SkeletonRecord.symmetry: write mirror partners (§5 modes)
}
// Presets in the UI: World (VRM) · X aim 'xAim' (+x / +y / +y) · Y aim 'yAim' (+y / +z / +y: glTF +Y is the open-source DCC's +Z after import, as Recalculate Roll ▸ Global +Z)
```

Algorithm per joint `j`, in topological order:

1. **Aim target**: the child on the humanoid chain (`humanChainChildren`), else the first child by `order`, else the
   joint's `tail`. A leaf without a tail copies its parent's `restRotation` (the desktop DCC leaves end joints aligned
   with their parent). A zero-length bone (< 1e-6 H) keeps its rotation.
2. `f = normalize(p_target − p_j)`.
3. `u = w − (w·f)·f` with `w` = `secondaryWorld`. If `|u| < 0.02` (the bone is within ≈ 1° of the world axis):
   use the parent's secondary axis projected the same way (keeps a spine or a hanging hair chain continuous; this is
   our reading of *auto orient secondary axis*), and for a root the next world axis in the order `+z, +x, +y`
   (skipping `±w`). `secondary: 'auto'` = the axis after `primary` in the cycle x → y → z.
4. Frame: the column for the primary axis is `±f`, the column for the secondary axis is `±normalize(u)`, the third is
   their cross product in right-handed order; `restRotation = quat(frame)` (normalized, `w ≥ 0`).
5. **Mirror partners** (when `symmetry`): the partner's rotation is written by the joint's mirror mode (§5), not
   recomputed, so left and right stay exact mirror images.
6. **Keys**: for every **bone-aligned** control driving a re-oriented joint that has rotation keys, convert each key
   by `R(r') = Δ⁻¹ · R(r)` (Δ = old→new rest delta) with Euler continuity (the shipped quaternion → nearest Euler,
   07 §14.3); exact at keys, approximate between them, with the same info toast as a rotate-order change
   (DECISIONS-OPEN INT-46). World-aligned controls are skipped (§2.3). Then `rig.autoRig.update` (14 §7.1).

One transaction. Lints: `skel.orientation-mixed` (info: siblings in one chain with different modes).

---

## 3. Joint Tool (`skel.jointTool`)

### 3.1 Desktop-DCC behaviour

Joint Tool settings (vendor help):
*Degrees of Freedom*; *Symmetry* Off (default) / X / Y / Z (creates the mirrored joints as you click); *Scale
compensate* (on); *Auto joint limits*; *Create IK handle*; *Variable Bone Radius* (short/long bone length and radius);
*Projected Centering*; orientation settings as in §2.4. Clicking places a joint, each further click a child joint with
a bone between them; `Enter` completes the chain; `Insert` moves the active joint during creation; MMB-drag moves the
last placed joint (vendor help: *Snap to Projected Center*, *Creating joints*).
Starting a new chain on an existing joint connects it there: the desktop DCC's own lesson warns to start "a little away"
from the hip, "otherwise the first joint will be connected to the hip joint". With Projected Centering on, "the joint is
automatically centered in the model", and a moved joint is "dynamically centered in its new position"; with several
layers, centering "minimizes displacement and places the joint in the center of the layers".

### 3.2 Ours

| Aspect | Behaviour |
|---|---|
| Session | Modal tool contract (M6A-SPEC §5.10): `idle → hover → placing → confirm \| cancel`. Clicks add **preview** joints (no document writes); `Enter`, `NumpadEnter` or RMB completes → **one** `app.run('skel.joint.create', {points, parent, namePrefix, orient, symmetry})`, one undo step; `Esc` cancels with no step; `Backspace` removes the last point (reserved key while placing). |
| First click | On an existing joint (pick radius 8 CSS px on the joint sphere) → that joint is the parent (branch). Elsewhere → a new root, or, when a joint is selected before the tool starts, a child of the selection (the desktop DCC's "continue from the selected joint"). |
| Later clicks | Never snap onto existing joints (no cycles); `V` vertex/joint snap and `X` grid snap holds work as in Model. `Shift` held: the new bone snaps to 15° steps in the view plane (Ekza; unverified as a desktop-DCC habit). |
| Depth | **Snap to Projected Center** (status-line toggle, default on in Rig & Skin): the slab midpoint along the view ray (14 §4.2), in perspective and orthographic panes. New joints use the slab nearest the camera; repositioning uses the slab containing the current depth (the desktop DCC's "minimizes displacement"). No hit: the depth of the parent joint's plane facing the camera (the desktop DCC uses the view plane through the origin; the parent's depth is what a rigger wants). |
| Hinge bias | Option *Hinge bias* (default 0.15 of the slab thickness): for joints the user maps as elbow/knee (or the guide fitter places), shift the depth toward the back (elbow) / front (knee) (J8; research 12 §7.2). |
| Reposition | `Insert`/`Home` toggles "move last point" (pointer moves it; click sets it); MMB-drag moves the last point directly (desktop-DCC convention). |
| Symmetry | `SkeletonRecord.symmetry` (default on for `vrm-humanoid`): points within 0.005 H of the plane `x = 0` snap to it and get side `C`; others create the mirror chain in the same run with names from `sideFromName` (shipped in `autorig/naming.ts`), `mirror` links both ways, rotations by the §5 mode (Orientation for human bones, Behavior for other chains). Off: one chain. Y and Z symmetry: NO (VRM space is only X-symmetric). |
| Naming | Prefix field (default `joint`; *Add chain* presets `tail`, `ear`, `hair`, `skirt`): `prefix_01…`, unique per skeleton (`skel.unique-names`); `humanBone` null (map later). |
| Orientation | Per §2.4 presets: World for joints that will be mapped to human bones, the `xAim` preset (X down the bone, Y up) for non-humanoid chains (J1). |
| Joint Tool options we drop | Degrees of freedom, auto joint limits (joint limits are 07 §9.4, later), Create IK handle (the auto-rig owns IK), scale compensate (uniform scale), variable bone radius (global display size). |
| Readout | Help line: "Click to place · Enter/RMB finish · Backspace undo point · Esc cancel · Insert move last"; HUD shows the bone length in metres and the angle to the parent. |

Projected-center ray queries: three-mesh-bvh `raycast` with all hits on the character's meshes (both faces), pairing
entry/exit hits by facing. For non-watertight low-poly parts (open sleeves, hair cards) the pairing can fail; the
fallback in 14 §4.2 (single hit pushed inward by half the local radius estimate) holds. A robust inside test, if
needed later, is the generalized winding number ([Jacobson, Kavan, Sorkine-Hornung 2013](https://www.cs.toronto.edu/~jacobson/weblog/3090.html);
fast version for soups: [Barill et al. 2018](https://dgp.toronto.edu/projects/fast-winding-numbers)).

---

## 4. Joint hierarchy editing

All operators write `JointRecord`s in one transaction; because rest positions are world, **no edit below moves a joint
that the user did not move** (positions stay bit-equal; property test in §16).

| Operator | Desktop-DCC reference | Behaviour | Weights | Humanoid rules |
|---|---|---|---|---|
| `skel.joint.insert {bone: JointId, t}` | Insert Joint Tool | Click on a bone (segment parent → child) inserts `k` at parameter `t` (or drag from the joint as the desktop DCC does); `parent(k) = j`, `parent(c) = k`; `restRotation` recomputed for `j` and `k` in aim mode, else copied from `j` | none on `k`; toast "Auto weights for the new joint" (14 §6.4: masked bind on `k` and its neighbours) | `k.humanBone = null`; offer mapping when the template has a free optional bone between them (e.g. inserting between `spine` and `neck` proposes `chest`/`upperChest`) |
| `skel.bone.split {joint, n}` | open-source-DCC *Subdivide* | `n − 1` joints evenly along the bone | as insert | as insert |
| `skel.joint.delete {joints, subtree: false}` (**Remove Joint**) | Remove Joints: deletes the joint and "unites the remaining joints and bones into a single joint chain" | Children re-parent to the removed joint's parent | folded into the nearest surviving ancestor, renormalized (14 §6.4) | refused for the 15 required bones, with the reason; optional bones allowed (the auto-rig collapses to the nearest ancestor, ADR 0004 §9) |
| `skel.joint.delete {joints, subtree: true}` (**Delete** key) | Delete on a joint removes its subtree | Joint and descendants | folded into the nearest surviving ancestor | refused when the subtree contains a required bone |
| `skel.joint.reparent {joints, parent}` (`P`, Outliner drag; desktop-DCC *Parent Joint*) | Connect Joint ▸ Parent Joint, Edit ▸ Parent | New parent pointer; a bone appears; positions unchanged; cycles refused | unchanged | lint `skel.parent-map` re-runs |
| `skel.joint.reparent {parent: null}` (`Shift+P`; *Disconnect Joint*) | Disconnect Joint | New root | unchanged | humanoid joints must stay under `hips`: warning lint |
| `skel.joint.connect {joint, target}` (LATER) | Connect Joint ▸ Connect | Moves the chain so its root lands on `target`, then removes the duplicate | as Remove | — |
| `skel.joint.reroot {joint}` (LATER) | Reroot Skeleton | Reverses the parent pointers on the path to the old root; aim-mode orientations recomputed | unchanged | refused on a humanoid (the VRM parent map fixes `hips` as the humanoid root) |
| `skel.joint.rename {joint, name}` | rename | Unique per skeleton; template humanoid names are VRM bone names (14 D4) and renaming them warns | — | — |
| `skel.joint.setHumanBone {joint, bone \| null}` | Joint Labelling (side/type) | Uniqueness and parent map enforced (14 §4.2); `side` follows the bone | — | — |

Joint IDs: template joints keep `<skeletonId>:<humanBone>` (M6A-SPEC §4.2); a joint whose `humanBone` changes keeps its
ID (IDs are identity, not meaning); user joints get `jnt_` IDs. Deleting and re-creating a template bone reuses its
deterministic ID, so curves keyed on the auto-rig control come back (`rig.autoRig.update` keeps control IDs).

---

## 5. Mirror Joint (`skel.joint.mirror`)

The desktop DCC (vendor help: *Mirror Joint options*):
*Mirror Across* XY (default) / YZ / XZ; *Mirror Function* **Behavior** ("the mirrored joints have the opposite
orientation", handy for opposing movements of paired limbs) or **Orientation** ("the same orientation as the original
joints", so copied animation behaves identically); *Search For* / *Replace With* rename the duplicates
(`cmds.mirrorJoint(mirrorXY=True, mirrorBehavior=True, searchReplace=('left_', 'right_'))`). It always duplicates.

Ours:

```ts
interface MirrorJointArgs {
  root: JointId;                       // the selected joint; its subtree is mirrored
  direction: 'L→R' | 'R→L' | 'auto';   // auto: from the root's side
  mode: 'orientation' | 'behavior';    // default: 'orientation' when the subtree has human bones, else 'behavior'
  search: string; replace: string;     // empty = the shipped L/R name swap (sideFromName)
  update: boolean;                     // default true: update existing counterparts in place
}
```

1. Plane: **YZ through the character origin** (`x → −x`). The desktop DCC's XY default suits a character facing +X; ours
   faces +Z with left = +X (07 §1.1), so YZ is the only useful plane and no plane option is shown.
2. Positions: `p' = (−x, y, z)`; tails likewise.
3. Rotations: **Orientation** `q' = q` (same world orientation; identity stays identity, so VRM templates stay
   normalized). **Behavior** `q' = q_X(π) · q` (all axes of the reflected frame negated, the right-side frame of 07 §3:
   the same channel values on a bone-aligned control then give the mirrored motion).
4. Names: `search/replace` if given, else `sideFromName` swap (`_L`/`.L`/`L_`/`Left` forms, case kept), else suffix
   `_R`/`_L`; `humanBone` through `mirrorHumanBone` (`humanoid/map.ts`).
5. Parent of the mirrored root: the original root's parent if it is a centre joint (e.g. `leftShoulder` under
   `upperChest`), else that parent's mirror partner, else the same parent.
6. **Update in place** (our addition): a counterpart found by `mirror` link, then by mirrored `humanBone`, then by
   mirrored name is moved and re-oriented instead of duplicated; IDs, weights and curves survive. New joints get
   template IDs when they carry a human bone.
7. `mirror` links and `side` are set both ways. **Weights are not mirrored** (the desktop DCC does not either); the
   toast offers *Mirror Skin Weights*.

Involution test: mirroring twice restores every position bit-equal and every rotation to 1e-12.

---

## 6. Moving, rotating and testing joints: one rule per state

| Gesture on a selected joint (Rig & Skin) | Skeleton not bound to any mesh | Bound, bind pose shown | Bound, test pose active |
|---|---|---|---|
| `W` drag (Move) | rest edit: joint **and subtree** move (desktop-DCC DAG behaviour) | rest edit with **Move Skinned Joints** semantics: weights stay, IBM re-derived, the mesh stays, deformation changes (14 §4.2) | refused: "Joints are posed for testing — Go to Bind Pose to edit the rest" |
| `D` held + `W` drag | rest edit: **joint only**, children keep their world rest (the desktop-DCC *Insert*/pivot habit, M~) | same, skinned | refused |
| `E` drag (Rotate) | rest edit: rotates the subtree's rest positions (and their rest rotations) about the joint — fitting an arm chain to an A-posed mesh | **test pose**: a session override on the joint's driving control (ADR 0004 §5: channels ⊕ session overrides); never a key; the auto-rig exists from the moment of binding (14 D10) | test pose continues |
| `D` held + `E` drag | rest edit: re-orients the joint only (manual Orient Joint; children unchanged) | same, skinned | refused |
| Go to Bind Pose | — | no-op | clears every test override (one non-document step) |
| Apply Pose as Rest (14 §4.4) | — | — | bakes the test pose into the rest and the mesh (T-stance correction) |

Test overrides survive switching to Weights and back inside Rig & Skin, are cleared when entering Animate (where the
clip drives the pose), and are never written to the document. A `TEST POSE` badge replaces `BIND POSE` while any
override is active. This is the desktop-DCC loop (rotate a joint, paint, Go to Bind Pose) without its failure mode:
there, Go to Bind Pose is blocked by constraints, expressions or keyed IK handles (vendor help: *Bind pose*); ours
resets channels to their defaults, which by ADR 0004 §2 is the rest pose.

---

## 7. Joint display

Desktop DCC: joints are spheres with a per-joint `radius`, scaled globally by *Display ▸ Animation ▸ Joint Size*
(factor 1 = diameter 1 unit; also in Preferences ▸ Kinematics; the `jointDisplayScale` command),
bones are wedges to the children, *Local Rotation Axes* per joint, *X-Ray Joints* per viewport, labels via *Show All
Labels*, and *Colorize Skeleton* on bind gives joints and skin vertices matching colours.

| Element | Ours | Priority |
|---|---|---|
| Joint | instanced sphere, radius `rig.jointDisplayScale × 0.012 H`, clamped to ≥ 4 CSS px on screen | BASE |
| Bone | octahedral wedge (as in the open-source DCC) from joint to child, width 0.1 × length capped by the joint radius; leaf to `tail` | BASE |
| Colours | side tokens shared with controls (L `#4f8dff`, R `#ff5f69`, C `#ffd84d`, ADR 0004 §10); selected white; hover lighter; joints without `humanBone` in a humanoid skeleton drawn hollow | BASE |
| X-ray | two passes like controls (07 §5.4): depth-tested, then occluded parts at 35 %; on by default in Rig & Skin | BASE |
| Local axes | RGB triads (X red, Y green, Z blue), length 3 × joint radius; selected joints by default, toggle all/none | BASE |
| Labels | `humanBone` display name (`humanDisplayName`), else `name`; DOM overlay positioned per frame (CSS2D-style), toggle | BASE |
| Influence colours | deterministic per-joint hue (golden-angle over the topological index); used by bind preview and the *Influence colours* weight display (desktop-DCC *Colorize Skeleton*, *Multi-color feedback*) | BASE |
| Per-joint radius, draw styles (box, none) | — | NO |

Picking: joints are pickable only in Rig & Skin (Animate keeps bones hidden and unpickable, FR-RIG-05). Priority:
joint sphere > bone > mesh. Selection changes are undo steps in Rig & Skin as in Model (M6A-SPEC §5.6), because joint
and vertex selections are expensive to rebuild (open question Q-RIGB-5).

---

## 8. Bind Skin: the desktop DCC's options and our arguments

*Bind Skin Options* (vendor help):

| Desktop-DCC option (default) | Its behaviour | Ours |
|---|---|---|
| Bind to: **Joint hierarchy** (default) / Selected joints / Object hierarchy | whole skeleton from the root / only the selected joints / any transform hierarchy | `joints?: JointId[]` (default: all joints of the character's skeleton). One joint selected = a rigid attach (hats, helmets, accessories). Object hierarchy: NO |
| Bind method: Closest distance / **Closest in hierarchy** (default) / Heat Map / Geodesic Voxel | proximity only (cross-side bleeding) / hierarchy-aware proximity / "heat diffusion from each influence" with *Heatmap falloff* 0.68 / voxel geodesic distances | `method: 'auto-lowpoly'` (default, 14 §5.4) \| `'closest'` \| `'rigid-islands'` \| `'heat'`; LATER `'envelope'`, `'voxel'` (§9) |
| Skinning method: Classic Linear / Dual Quaternion / Weight Blended | volume-preserving DQ and a painted blend | **Linear only** (glTF, 14 §5.1) |
| Normalize weights: None / **Interactive** (default) / Post | Post normalizes at deformation time without storing | always Interactive (14 §6.1) |
| Weight distribution: **Distance** (default) / Neighbors | how removed weight is redistributed during interactive normalization | proportional redistribution to the unlocked joints (14 §6.1); *Neighbors* LATER |
| Allow multiple bind poses | per-geometry bind poses | NO: bind pose = rest |
| Max influences (**5**) + Maintain max influences | per-point cap | **4, always maintained** |
| Remove unused influences | drop zero-weight influences from the bind | automatic palette compaction after binding (§12.5) |
| Colorize skeleton | colours joints and skin points | influence colours (§7) shown during and after binding |
| Include hidden selections on creation | binds hidden geometry | NO: hidden meshes are not bound unless picked in the list |
| Dropoff rate (**4**, 0.1–10, ≤ 100) | closest methods: how fast influence falls with distance | `dropoff` for `closest` |
| Falloff (**0.2**), Resolution, Validate voxel state (on) | geodesic voxel: rigid ↔ smooth, voxel grid, post-validation | `stiffness` for `heat` (role of falloff), `rigidifyAbove`; voxel args LATER |

Our full argument set (extends 14 §5.4): `method`, `joints?`, `vertices?` (mask), `meshes`, `dropoff` (closest,
default 4), `stiffness` (heat, default 1), `pruneBelow` (0.025), `rigidifyAbove` (off), `symmetrize` (default on when the
mesh has a symmetry partner map, §9.3), `maxInfluences` (fixed 4). Bind runs in the geometry Worker, writes one new
revision per mesh (skin layers + `MeshRecord.skin = { skeleton, bind: args }`) in **one transaction**, and opens the
Last-op card; adjusting re-runs through undo + run (M6A-SPEC §5.7). Binding several meshes at once (body, separate
head, eyes, accessories) is the normal case: each mesh is solved separately; small far islands (eyes, buttons) bind
rigidly by the island rule.

**Unbind** (`skin.unbind`): removes the layers and the binding; undoable; no "keep history" variants (there is no
history to keep).

---

## 9. Automatic weights for ≤ 10k-vertex meshes in TS (or WASM)

### 9.1 Methods compared

Sizes: our low-poly targets are 0.6k–5k vertices (research 12), the ceiling is 10k vertices × ≤ 60 joints. "JS time"
is single-thread plain JavaScript in a Worker on the reference machine; measured values come from 14 §5.4, the rest are
estimates marked ≈.

| # | Method | Idea | Cost | JS time (10k × 60) | Quality on low-poly | Failure modes | Effort | Priority |
|---|---|---|---|---|---|---|---|---|
| 1 | **Closest distance** (desktop DCC) | nearest `K` bone segments, `w ∝ d^−dropoff` | O(V·B) | ≈ 10 ms | rigid-looking, wrong across close limbs (thigh ↔ thigh, hand ↔ hip) | cross-side bleeding (the desktop DCC's own warning) | 0.25 d | BASE (`closest {hierarchy: false}`) |
| 2 | **Closest in hierarchy** (desktop-DCC default; algorithm not published — our reading) | candidates = nearest *visible* segment `j*`, its parent and children; `w ∝ d^−dropoff` among them | O(V·B) + ≈ V × 1–3 BVH rays | ≈ 20–40 ms | good on segmented, acceptable on single-piece except armpit/crotch | needs visibility to stop arm → torso bleeding; joint chains of tiny bones (fingers) over-blend | 0.5 d | BASE (`closest`, default `hierarchy: true`) |
| 3 | **Rigid islands** (14 §5.2) | each connected island → bone nearest its centroid, weight 1 | O(V + I·B) | < 5 ms | **best on segmented** (90.5 % exact / 100 % within one joint on Polybot) | one-island bodies degenerate | in 14 | BASE |
| 4 | **Envelope / capsule** (open-source-DCC *With Envelope Weights*; desktop-DCC *Interactive Skin Bind* capsules) | per joint a capsule of radius `r_j` (from `boneRadii`), `w = falloff(d/r_j)` | O(V·B) | ≈ 10 ms | predictable, artist-tunable; ignores topology | overlapping capsules bleed; needs manipulators to be useful | 1.5 d with manipulators | LATER |
| 5 | **Bone heat** (Baran & Popović 2007; open-source-DCC *Automatic Weights*; desktop-DCC *Heat Map*) | solve `(L + H)·w_j = H·p_j` per bone on the surface | build 4–17 ms; solves 20–82 ms (measured, 14 §5.4) + rays | ≈ 0.1–0.3 s | smooth bends on continuous bodies; blend width = loop spacing | islands that see no bone (singular → fallback); long thin triangles (negative cotans → clamp) | in 14 | BASE |
| 6 | **Geodesic voxel** (Dionne & de Lasa 2013; desktop-DCC Quick Rig default) | voxelize the solid, geodesic distance inside the volume from each bone | see §9.4 | ≈ 0.5–2 s (estimate) | good, robust on non-manifold/intersecting meshes; falloff slider | coarse grids merge nearby parts (desktop-DCC help example: knee and hand); joints must be inside | 4–5 d | LATER (M7 G2 AI meshes) |
| 7 | **Weight inpainting transfer** (Abdrashitov et al. 2023) | copy weights where a reliable match exists, solve the rest | one sparse factorization + per-bone solves | ≈ 0.1–0.3 s | the right tool after topology changes and between meshes | needs a skinned source | 1.5 d | BASE (§12.2, §14) |
| 8 | Bounded biharmonic weights (Jacobson et al. 2011) | constrained QP on a tet mesh | tetrahedralization + QP | seconds+ | very smooth | tet meshing low-poly soups | — | NO |
| 9 | Deformation fitting (desktop-DCC *Bake Deformation to Skin Weights*) | fit LBS weights to sampled poses of another deformer (non-negative least squares) | per vertex small NNLS | ≈ 0.5 s | reproduces delta-mush-like results | needs a source deformer we do not have | — | LATER |
| 10 | ML rigging (UniRig, MIT, Python/GPU) | learned skeleton + weights | server GPU | — | for generated meshes | not in the browser | — | M7 (server) |

**Conclusion.** For ≤ 10k vertices everything BASE runs in well under a second in plain TypeScript. WASM buys nothing
here and costs a toolchain, a bundle and a licence review (Eigen is MPL-2.0, CHOLMOD is LGPL/GPL); keep the solvers in
float64 TypeScript (deterministic iteration order, `Math.fround` only when writing the `f32` layer). Revisit WASM only
for the voxel method at 128³ or if dense AI meshes (≫ 10k) must be solved without the reduce step of M7.

### 9.2 Bone heat: implementation notes beyond 14 §5.4

- **One matrix for all bones.** In `(L + H)·w_j = H·p_j` the matrix does not depend on `j` (`H` is diagonal, built from
  the distance to the nearest visible bone). A direct solver factors `L + H` **once per island** and back-substitutes
  per bone; PCG (Jacobi preconditioner, started from `p_j`) solves per bone in 12–14 iterations (measured in 14). Recommendation: PCG first (no dependency); a sparse `LDLᵀ`
  with AMD ordering (MIT implementations exist, e.g. `cholesky-solve`, 14 Sources) if profiling ever needs it.
- **Skip bones that cannot matter.** A bone with `p_j ≡ 0` on an island and no neighbour bone with non-zero `p` there
  gets zero weights without a solve.
- **Laplacian.** Cotangent weights with negative values clamped to zero (keeps weights in [0, 1]); lumped (barycentric)
  mass is not needed for heat but is for the inpainting energy (§9.5). Triangulate n-gons with M6a's single
  triangulation function (M6A-SPEC §5.4) so the solve sees the same triangles as the viewport. Upgrade path for slivers:
  the intrinsic-Delaunay "robust Laplacian" (Sharp & Crane 2020, MIT C++ reference).
- **Visibility.** A vertex sees a bone if the segment from the vertex (offset by ε along the normal) to the closest point
  on the bone hits no other triangle (three-mesh-bvh `raycast` on the character's meshes). Only the nearest 3 bones need
  rays (the open-source DCC casts rays only for the closest bones, 14 §5.4).
- **Islands.** Solve per connected island of the welded point graph; an island with `H ≡ 0` falls back to rigid on the
  bone nearest its centroid and raises `skin.unreachable-island` (14).

### 9.3 Post-processing shared by every method

1. `w < pruneBelow` → 0 (0.025 with a 0.025–0.05 ramp, the open-source DCC's limits, 14 §5.4).
2. Keep the 4 largest, normalize (float64).
3. **Symmetrize** (new): when the mesh has an exact symmetry partner map (M6a keeps one per mesh, M6A-SPEC §5.14),
   replace `w(v)` by the average of `w(v)` and the mirrored `w(partner(v))` (joints mapped through `mirror` links /
   `mirrorHumanBone`); centre points average with themselves. Removes left/right differences caused by asymmetric
   triangulation or float noise; makes Mirror Skin Weights a no-op right after binding.
4. `rigidifyAbove x`: dominant ≥ x → 1 (the segmented look, 14).
5. Write `f32`, renormalize after rounding, residual into the largest weight (14 R7).

### 9.4 Geodesic voxel, made cheaper (LATER)

14 §5.5 runs one Dijkstra per bone. Cheaper and equivalent for our cap of 4 influences: **one multi-label Dijkstra**
over interior voxels that keeps, per voxel, the `K = 6` best (bone, distance) pairs (a label-correcting variant of
multi-source Dijkstra). Cost O(K · N log N) once instead of O(B · N log N). With a 96³ grid (≈ 885k voxels, typically
20–30 % interior for a humanoid) that is ≈ 0.2M voxels × 6 labels: an estimated 0.5–2 s in JS. Inside/outside: flood
fill from the border for watertight input; generalized winding numbers for soups (§3.2 references). Vertex weights:
trilinear over the 8 surrounding voxels, `w_j ∝ (1/d_j)^p` blended toward rigid by a falloff (desktop-DCC default 0.2),
then §9.3.

### 9.5 Weight inpainting (the transfer, BASE)

From the paper ([project page](https://www.dgp.toronto.edu/~rinat/projects/RobustSkinWeightsTransfer/), MIT reference
code in Python with libigl: [rin-23/RobustSkinWeightsTransferCode](https://github.com/rin-23/RobustSkinWeightsTransferCode)):

1. **Match**: for each target point, the closest point on the source surface is a match if its distance ≤ `D` and the
   normals differ by ≤ `Θ`; defaults `D = 0.05 × d_bbox` (target bounding-box diagonal) and `Θ = 35°`; an optional
   second pass with flipped normals handles inner layers. Matched points copy the barycentric interpolation of the
   source triangle's weights (`S_match`); the rest form `S_nomatch`.
2. **Inpaint**: minimize `trace(Wᵀ (−L + L M⁻¹ L) W)` with the matched rows fixed (`L` cotangent stiffness, `M` lumped
   Voronoi mass). Per bone: `Q_UU · w_U = −Q_UI · w_I` with `Q = −L + L·M⁻¹·L`; one Cholesky of `Q_UU` serves every
   bone; bones with `w_I = 0` are skipped. Partition of unity holds when the boundary data sums to 1.
3. **Clean**: the paper observed weights ≥ −0.03 and simply clamps negatives to 0 and renormalizes; optional Laplacian
   smoothing iterations on `S_nomatch`; then §9.3 steps 1–2 and 5.
4. **Artist control** (the paper's §3.4): the match mask can be edited before inpainting; ours exposes "force
   re-solve" for the selected vertices (they join `S_nomatch`).

For a topology edit inside one mesh, the source is the pre-edit revision and the target the post-edit revision, so most
points match exactly and only the new region is inpainted.

### 9.6 What to expect, by character style

| Style | Best default | Typical fixes |
|---|---|---|
| Segmented robot / toy (Polybot, OMOBA's 100 %-rigid dragon) | `auto-lowpoly` → rigid islands | Assign to joint on a few pieces |
| Single-piece blocky body, 2 loops per joint | `auto-lowpoly` → heat, `stiffness` 1–2 | type 0.5 on the middle loop of elbows/knees; Smooth once at the armpit |
| Chibi / big head | heat with `rigidifyAbove 0.9` | Assign the head island to `head`; neck loop 0.5/0.5 |
| Hair cards, skirts, capes (open, layered) | heat on the body; Add chain + masked heat for the chain | Copy Skin Weights from the body with inpainting for clothing-like parts |
| Accessories (hat, helmet, backpack) | Bind to one selected joint (rigid) | — |

---

## 10. Quick Rig and humanoid-IK templates: what to take

### 10.1 The desktop DCC

Quick Rig (vendor help, 2026 release):
*One-Click* (best for a biped facing +Z, Y up) creates a skeleton, a full-body humanoid-IK control rig and the skin;
*Step-by-Step* exposes the stages. Step-by-Step settings: **Geometry** list; **Guides** with *Embed Method* (Perfect
Mesh / Watertight / Imperfect Mesh / Polygon Soup / No Embedding), *Resolution*, *Symmetry* (bounding box, hips, none),
*Center* (guide counts: the default humanoid-IK skeleton has 3 spine nodes, one neck, one shoulder per side), *Hips
Translation*; **User Adjustment of Guides** (Mirror Left to Right / Right to Left, select and show guides, X-ray joints,
guide colour); **Character Generation** (skeleton and control rig, or skeleton only; *T-Stance Correction*, recommended
on; *Align Joint X-Axis*: Mirrored Behavior (default) / X Towards Next Joint / World – No Alignment); **Skinning**
(Geodesic Voxel by default). The humanoid-IK skeleton generator: spine 3 joints (max 10), neck 1 (max 10), roll bones 0
per limb segment (max 5), up to 3 joints per finger; the 15 required base joints; T-stance facing +Z, Y up, arms along X
(vendor help: *Skeleton setup area*).

### 10.2 Ours (refines 14 §4.1, §4.3)

| Desktop DCC | Ours | Priority |
|---|---|---|
| One-Click | **One-Click guess** (below), then the same steps, all adjustable | BASE |
| Step-by-Step stages | Geometry → Markers (5 clicks) → Guides → Adjust → Skeleton → Bind → Control rig (14 §4.3) | BASE |
| Embed methods (voxel skeleton embedding) | markers + projected center; *No Embedding* = template at default proportions | BASE (markers); voxel embedding NO |
| Symmetry: bounding box / hips | the mesh must be centred at x = 0 (the Geometry step offers *Center and ground*) | BASE |
| Center counts (spine 1–10, neck 1–10) | presets Lite 17 / Core 21 / Standard 33 / Full 52 (spine, chest, upperChest = the humanoid-IK skeleton's 3 spine nodes; VRM has one neck) | BASE |
| Roll bones | non-humanoid twist joints with a `VRMC_node_constraint` roll | LATER |
| Hips Translation joint | NO: VRM `hips` carries the translation (VRMA rules) | NO |
| Fingers (≤ 3 joints each) | Standard = mitten (thumb + one chain), Full = all fingers | BASE |
| T-Stance Correction | Apply Pose as Rest (14 §4.4) | BASE |
| Align Joint X-Axis | Orient presets (§2.4): World default | BASE |
| Mirror Left to Right / Right to Left | Mirror Joint with update in place (§5) | BASE |
| Geodesic Voxel skinning | `auto-lowpoly` (voxel LATER) | BASE |

**One-Click guess** (deterministic, ≈ 50 ms, calibrated on the fixtures like the fitter in 14 §4.3): rasterize the
front silhouette of the selected meshes (orthographic, 256 rows over the height `H`); **wrist** = the outermost
silhouette column in the band of maximal width (the T-pose arm span), pulled in by 0.25 × the hand length estimate;
**elbow** = midway between wrist and the torso edge at that height; **groin** = the highest row where the silhouette at
`x = 0` is outside the mesh while both sides are inside (the leg split); **knee** = midway between groin and 0.05 H;
**chin** = the narrowest row between the shoulder band and 0.9 H. Depth of every marker by projected center (with the
hinge bias, J8). Failure (no leg split, no arm band) falls back to template proportions and shows the markers step.

---

## 11. Paint Skin Weights (`skin.paint`)

### 11.1 Desktop-DCC behaviour

*Paint Skin Weights Tool* (vendor help, 2026 release):

- **Influences**: sort *Alphabetically* / *By Hierarchy* / *Flat*; filter; pin; per-influence **lock** icons ("lock and
  unlock each influence from receiving weight as you paint"); influence colours; tool buttons *Copy weights*, *Paste
  weights*, *Weight hammer*, *Move weights* (source → targets), *Show Influences* (selects every influence of the
  selected vertices), *Invert Selection*, *Reveal Selected*.
- **Brush**: modes *Paint* / *Select* / *Paint Select* (add, remove, toggle) / *Select Geometry* (`Ctrl+<`/`Ctrl+>`
  toggle); operations **Replace / Add / Scale / Smooth**; *Weight Type* skin weights (default) or DQ blend weights;
  *Normalize Weights* Off / **Interactive** (default) / Post; **Opacity** ("with a Value of 1.0, setting Opacity to 0.5
  paints a weight of 0.5"); **Value**; *Min/Max Value* 0–1 by default ("negative values are useful for subtracting
  weight"); **Flood** applies the brush settings to every vertex.
- **Visualization**: colour ramp with presets; **Show Numbers** with 2 decimal places by default ("weight values of 0.00
  are hidden").
- **Stroke**: Radius (U) up to 50 on the slider (more with `B`+drag), Radius (L) for styluses, *Screen Projection* off,
  **"Reflection is disabled for the Paint Skin Weights Tool"** (use Skin ▸ Mirror Skin Weights), stamp spacing, stamp
  depth 0.5.
- **Display**: draw brush, brush feedback, wireframe, *Color feedback* (greyscale), *Multi-color feedback* (joint
  colours), *X-Ray Joints*, min/max colour.
- **Keys**: `B`+drag radius, `M`+drag opacity, `Ctrl+<`/`Ctrl+>` modes; Artisan: `N`+drag value, `U`+LMB operation menu,
  `Alt+F` flood (vendor help: *Artisan hotkeys*).

### 11.2 Ours: operations (per vertex, active joint `a`, value `v`, strength `s = opacity × falloff`)

| Operation | Formula on `w_a` (then the 14 §6.1 normalization) | Notes |
|---|---|---|
| **Replace** | `w_a' = w_a + (v − w_a)·s` | The desktop DCC's help example: `w_a = 0`, `v = 1`, opacity 0.5 → 0.5 |
| **Add** | `w_a' = w_a + v·s`; `v < 0` subtracts (the desktop DCC's negative Min, the open-source DCC's Subtract) | clamped to `[0, avail]` |
| **Scale** | `w_a' = w_a · (1 − (1 − v)·s)` | `v = 0.5`, full strength halves the weight |
| **Smooth** | the vertex's whole weight vector → `lerp(w, avg(1-ring), s)` over unlocked joints | applied per stamp against current values (iterative by nature) |
| **Flood** | the current operation on every vertex of the paint mask (all, or the Select-mode selection), `s = opacity` | one transaction |

**Stroke rule** (determinism and one-transaction strokes): for Replace, Add and Scale, a stroke keeps a per-vertex
**maximum strength** `s_max(v)` over all stamps and applies the operation once, to the **stroke-start** weights:
`w_final = op(w_start, v, s_max)`. Repainting over the same spot within a stroke does not compound (Artisan's
"accumulate opacity" off); a new stroke does. The preview shows `w_final` live; release commits one revision of the
skin layers (ADR 0015) as one undo step; `Esc` during a stroke cancels it with no step.

### 11.3 Ours: brush, masks, display

| Setting | Default | Notes |
|---|---|---|
| Radius | 40 CSS px (screen), `B`+drag | 14 §6.2 chose screen radius (the open-source DCC's *View* radius); a *Scene* (world-unit) radius as in the desktop DCC is an option, LATER |
| Profile | smooth (Gaussian-like) / linear / constant | The desktop DCC's four stamp presets reduced to three; image stamps NO |
| Falloff space | **Surface** (connected within the radius: no painting through to the other leg) / Volume | 14 |
| Front faces only | on | |
| Value / Opacity | 1 / 1 (`N`+drag, `M`+drag) | |
| X-mirror stroke | **on when the skeleton's symmetry is on** | The open-source DCC's mirror painting: the mirrored vertex (partner map, else the closest point) receives the same operation on the mirror joint; centre band receives both, averaged. The desktop DCC disables reflection here; this is the one place we follow the open-source DCC |
| Locks | per joint, session state, mirrored to the weight table's Hold row | Desktop-DCC lock icons = Component Editor *Hold* |
| Lock-Relative display | off | Open-source DCC: shows weights as if locked joints were removed and the rest renormalized |
| Display | **heat ramp** (blue → red, as in the open-source DCC) default; greyscale (desktop-DCC *Color feedback*); influence colours (desktop-DCC *Multi-color feedback*); **numbers** (§11.5) | shader reads the active joint without re-uploading (14 §6.2) |
| Sample | `I` + click | Value ← the clicked vertex's weight of the active joint (open-source-DCC *Sample Weight*; Paint Colour's eyedropper key) |
| Active joint | click a joint sphere (X-ray, drawn above the mesh) or a row of the joint list | painting never selects joints; joints never take paint clicks |
| Modes | Paint / Select (`Ctrl+Shift+Comma` / `Period`) | Select = vertex component selection (M6a `ComponentSelection`), used as the Flood and table mask; Paint Select LATER |
| Posed painting | allowed in a test pose (§6) and on ROM frames | CPU-skinned BVH for picking, bind-pose weights edited (14 §7.3) |

Influence list (joint list panel): sort *By Hierarchy* (default) / *Alphabetical* / *Flat*; filter; lock column; colour
chip; buttons Copy / Paste / Hammer / Move weights / Show influences / Reveal selected — the desktop DCC's set, each an
operator usable outside the tool too.

### 11.4 Performance

The 14 §7.3 budget holds: ≤ 4 ms per pointer frame at 10k vertices (BVH hit, surface flood within the radius, partial
attribute upload). The stroke-start snapshot is two typed arrays (`u16 × 4V`, `f32 × 4V`, 240 kB at 10k vertices).

### 11.5 Weight numbers overlay (BASE)

The desktop DCC's *Show Numbers* (2026 release), made central for low-poly: for every visible vertex of the selected
mesh (or the selection), draw the active joint's weight with 2 decimals; hide 0.00; colour by the ramp; in Select mode
also on selected vertices of hidden faces. Above 2,000 visible labels, show only selected vertices (density guard). DOM
overlay or a single instanced SDF-text draw; labels are never pickable.

### 11.6 Component Editor weight table (`skin.weights.set`)

Desktop DCC: Window ▸ General Editors ▸ Component Editor ▸ **Smooth Skins** tab: rows = selected vertices, one column
per influence on them, a **Hold** row ("set the Hold cell to 'on'" locks the influence and shows the lock icon in the
paint tool; typed values still apply), and locking many influences can stop normalization from finding room (vendor
help: *Lock smooth skin weights*).

Ours (14 §6.2 plus): columns = joints with non-zero weight on the selection, plus the active joint, by hierarchy; a
**Hold** row (the same locks as the paint tool); a **Σ** column (red when |Σ − 1| > 1e-6, imports only); selecting
several cells and typing sets them all (each vertex normalized independently); **Average** mode (one row) above 50
selected vertices; `Tab`/`Enter` move between cells; the M6a numeric grammar (`+=0.1`, `50%`). Every edit is one
transaction through §6.1; a value that cannot fit (locks) is clamped and the cell flashes with the reason.

---

## 12. Copy, mirror, move and clean up weights

### 12.1 Copy / Paste Vertex Weights (BASE)

Desktop DCC: Skin ▸ Copy Vertex Weights / Paste Vertex Weights: copy the **active** vertex's weight vector; paste onto
the selected vertices (locks respected, normalized). Pasting across the symmetry plane offers "mirror joints" (L ↔ R
map).

### 12.2 Copy Skin Weights (`skin.weights.transfer`)

Desktop DCC (vendor help: *Copy Skin Weights options*):
*Surface Association* **Closest point on surface** (default; interpolates), *Ray cast*, *Closest component* (no
interpolation), *UV space* (for characters that differ in scale or proportion); *Influence Association* in up to three
passes: **Closest joint** (default first pass), *Closest bone*, *One to one*, *Label*, *Name*, *None*. The scripting
default for surface association is `closestComponent`, unlike the UI.

| Arg | Ours | Priority |
|---|---|---|
| `source` | another skinned mesh of the same character, or the pre-edit revision of the same mesh (§14) | BASE |
| `method` | **`inpaint`** (default, §9.5) / `closest-point` (the desktop DCC's default) / `closest-component` | BASE |
| `distance`, `angle` | 0.05 × bbox diagonal, 35° | BASE |
| `uvSpace` | match in UV space | LATER |
| `influence` | `same` (same skeleton: identity) | BASE |
| | `humanBone` → `name` → `closest-joint` passes (another character's skeleton) | LATER |

### 12.3 Mirror Skin Weights (`skin.weights.mirror`)

Desktop DCC (vendor help: *Mirror Skin Weights*):
*Mirror Across* XY (default) / YZ / XZ, *Direction* (positive to negative), *Surface Association* (closest point
default, raycast, closest component), *Influence Association* (closest joint default, one to one, label, none),
*Normalize*. Ours: 14 §6.3 unchanged, plus: plane fixed to YZ (§5 reason); direction default **+X → −X** (VRM left to
right); joint map order `mirror` link → `mirrorHumanBone` → name swap → closest mirrored joint (the "label" and "closest
joint" passes); partner map first when the mesh keeps one; `selection` arg mirrors only selected destination vertices.

### 12.4 Move Weights, Smooth, Hammer (BASE)

- `skin.weights.move {from, to, fraction = 1}`: on the selected vertices, `w_to += fraction·w_from; w_from −= …`
  (desktop-DCC *Move weights*; locks respected).
- `skin.weights.smooth {factor = 0.5, iterations = 1, expand = 0}`: the open-source DCC's operator — blend each
  selected vertex's vector toward the average of its neighbours; `expand > 0` grows the affected set, `< 0` shrinks it
  (its Smooth "Factor", "Iterations", "Expand/Contract"); the desktop DCC's Smooth Skin Weights menu item.
- `skin.weights.hammer`: selected ← average of their **unselected** neighbours (desktop-DCC behaviour), 14.

### 12.5 Prune, Normalize, Remove Unused Influences (BASE)

- `skin.weights.prune {below = 0.01}`: the desktop DCC's *Prune Below* resets smaller weights to 0 and renormalizes (it
  exists to remove the tiny weights normalization leaves behind, e.g. 0.008); locked joints are skipped (§6.1 contract);
  the open-source DCC's *Clean* with *Keep Single* is the same idea (with at most 4 influences summing to 1, the largest
  weight is ≥ 0.25, so a prune below 0.25 can never empty a vertex; the operator caps `below` at 0.2).
- `skin.weights.normalize {lockActive = false}`: open-source-DCC *Normalize All* (locked groups keep their values; *Lock
  Active* also keeps the active joint). Needed for imports; authored skins are always normalized.
- `skin.palette.compact` (**Remove Unused Influences**): drops palette joints with zero weight on every point of the
  mesh revision and rewrites the joint indices (one new revision). Runs automatically after `skin.bind`. The export
  writer may still list every skeleton joint in `skin.joints` (that is a writer decision, 14 §9.1); compaction is
  storage hygiene and keeps `data.joints` meaningful for `referencesOf`.
- *Limit Total* (open-source DCC, default limit 4 in practice): implicit, max 4 is maintained by every operator.

---

## 13. Touch points with constraints and control shapes (owned by sibling notes)

- Constraints (FR-RIG-10, 07 §7) target **controls** and drive control spaces; a constraint that needs a joint target
  uses the bone world through the existing `Attach` op. Joint deletion that leaves a constraint dangling disables the op
  with a warning (ADR 0004 §6), never throws.
- Control shapes (FR-RIG-13) sit on the auto-rig controls generated by `rig.autoRig.update` from our skeleton; their
  sizes come from the bound mesh (`boneRadii`), so **re-binding resizes controls unless the user overrode the size**
  (14 §7.1 keeps user overrides).
- Orient Joint changes bone-aligned control frames (§2.4 step 6); a shape edited in control space rotates with it.

---

## 14. Bind pose and re-binding after topology or skeleton edits

The desktop DCC's model: a `bindPose` (dagPose) node per skeleton records joint transforms at bind; changing the
skeleton, the bind pose or the modeling requires **unbind → edit → rebind** (older help), the *Move Skinned Joints
Tool*, or *Substitute Geometry*; mesh edits under a skinCluster live in construction history and are fragile. Ours
avoids each:

| Change | Desktop DCC | Ours |
|---|---|---|
| Move a joint after binding | Move Skinned Joints Tool | default `W` in the bind pose (§6) |
| Change the bind pose (A → T) | unbind, pose, rebind | **Apply Pose as Rest** (14 §4.4) |
| Topology op with correspondence (extrude, loop, bevel, merge, mirror) | history after the skinCluster | layer rules carry weights (M6A-SPEC §5.2: lerp on split, average on merge, swap-side on mirror); **no rebind** |
| Op without correspondence (boolean, remesh, decimate, replacing the mesh) | Copy Skin Weights from a duplicate, or Substitute Geometry | `skin.stale` → on leaving Model, inpainting transfer from the last bound revision (§9.5); the Outliner badge `skin ⚠` and the Rig & Skin glyph ◐ "Review weights (transferred)" (16 §17) |
| New joint | Add Influence, then paint | masked auto weights for the new joint and its neighbours (14 §6.4) |
| Removed joint | Remove Influence (weights redistributed) | folded into the nearest ancestor (§4) |
| Re-run automatic weights on part of the body | Reset Default Weights | `skin.bind` with `joints` / `vertices` masks |
| Multiple bind poses / Go to Bind Pose blocked | dagPose clean-up, disable IK/constraints | impossible by construction: bind = rest = zero channels |

---

## 15. Open-source-DCC ideas worth borrowing (summary)

| Open-source-DCC feature | Desktop-DCC counterpart | Ours | Priority |
|---|---|---|---|
| Armature X-Axis Mirror (edit both sides) | Joint Tool Symmetry X | `SkeletonRecord.symmetry` | BASE |
| Symmetrize bones (`.L` → `.R`) | Mirror Joint | Mirror Joint with update in place | BASE |
| Recalculate Roll (`Shift+N`; Global ±X/Y/Z axis, Active Bone, View Axis, Flip, Shortest Rotation) | Orient Joint | Orient Joint; "match active joint" and "view axis" options | LATER (options) |
| Snap to Volume | Snap to Projected Center | projected center | BASE |
| Subdivide bones | Insert Joint | `skel.bone.split` | BASE |
| Parent ▸ With Automatic Weights (bone heat) | Bind Skin ▸ Heat Map | `heat`, `auto-lowpoly` | BASE |
| Parent ▸ With Envelope Weights | Interactive Skin Bind (capsules) | `envelope` | LATER |
| Parent ▸ With Empty Groups | Bind with nothing assigned | NO (an empty skin cannot export) | NO |
| Weight Paint: Auto Normalize | Interactive normalization | always on | BASE |
| Lock-Relative display | — | display option | BASE |
| Multi-Paint (several groups at once) | — | — | LATER |
| X / Y / Z mirror painting | none ("reflection is disabled") | X-mirror stroke | BASE |
| Gradient tool (linear / radial) | — | `skin.paint` gradient sub-tool | LATER (≈ 0.5 d) |
| Sample Weight | — | `I` | BASE |
| Smooth (Factor, Iterations, Expand/Contract) | Smooth Skin Weights | `skin.weights.smooth` | BASE |
| Normalize All (Lock Active) | Normalize Weights | `skin.weights.normalize` | BASE |
| Clean (Limit, Keep Single) | Prune Small Weights | `skin.weights.prune` | BASE |
| Levels, Quantize, Invert | — | — | LATER |
| Mirror vertex groups (Flip Group Names, Topology Mirror) | Mirror Skin Weights | `skin.weights.mirror` (partner map = topology mirror) | BASE |

Sources: the open-source DCC's manual pages *Armature Deform Parent*, *Bone Roll*, *Weight Paint options*, *Weight
Paint editing* and *Weight Paint tools* (4.2 manual, German edition), listed in §19. The open-source DCC is GPL:
behaviour and names only, never code (14 D14).

---

## 16. Sizes, packages and acceptance

### 16.1 Delta to MODELING-PLAN §5.2 (agent-days)

| Package | Added scope (this note) | + days |
|---|---|---|
| C1 `skeleton` | Orient Joint with presets and key conversion (§2.4); Mirror Joint with update (§5); insert/split/remove/delete/reparent/disconnect (§4); joint display (§7); Joint Tool session details (§3); `D`/`Insert` joint-only edits; `skel.hinge-bend`; One-Click silhouette guess (§10.2) | +3 |
| C2 `auto-skin` | `closest` with hierarchy and dropoff (§9.1 row 2); symmetrize post-step (§9.3); `joints` = one selected joint as rigid attach | +0.5 |
| C3 `weights` | numbers overlay (§11.5), table extras (§11.6), stroke rule and desktop-DCC value/opacity semantics (§11.2), Sample, Lock-Relative, Smooth/Move/Prune/Normalize/Compact operators (§12) | +2 |
| C4 `rig-test-loop` | test pose by rotating joints, `TEST POSE` badge, Go to Bind Pose clearing overrides (§6) | +1 |
| C4/C7 | weight inpainting transfer (§9.5) as the stale-skin recovery and Copy Skin Weights | +1.5 |
| **Total** | | **≈ +8** (M6b ≈ 51.5 agent-days) |

Turnkey-minimum delta ≈ **+4.5**: Mirror Joint, hierarchy ops and joint display (≈ 1.5), the test pose (1), the
numbers overlay (0.5) and the inpainting transfer (1.5). Orient Joint, the One-Click guess, the table extras and the
cleanup operators can follow in the fix round.

### 16.2 Gates (headless unless noted)

- **Orientation invariance**: on Seed-san-as-records and the box man, Orient Joint (every preset, children on) leaves
  every skinned vertex position at every ROM frame within 1e-9 m and every humanoid normalized rotation within 1e-9;
  bone-aligned keyed controls convert with world rotations equal at key times (1e-9).
- **Edits never move unselected joints**: insert, split, remove, delete, reparent, orient, mirror keep every other
  joint's `restPosition` bit-equal (fast-check over random skeletons).
- **Mirror Joint involution** (§5); **symmetrized bind**: on a symmetric box man, `w(v)` equals the mapped `w(partner)`
  exactly after `skin.bind`.
- **Joint Tool session**: a five-click chain with symmetry is one undo step; `Esc` leaves history unchanged; `Backspace`
  removes exactly the last point.
- **Paint stroke determinism**: replaying the same stamp sequence gives bit-equal layers; overlapping stamps in one
  stroke equal one stamp at `s_max`.
- **Inpainting transfer**: box man, insert an edge loop then remesh one forearm (synthetic correspondence loss) →
  transferred weights within 0.05 (max abs) of a fresh bind on matched points and with no forearm vertex on the spine.
- **Prune/normalize/compact** properties: sums 1 ± 1e-9, ≤ 4 influences, locked weights bit-equal, compaction keeps
  every vertex's joint IDs and weights.
- New e2e (IDs for the spec): **E2E-SKIN-09** Joint Tool chain with symmetry + Mirror Joint update + Orient Joint on a
  tail chain; **-10** rotate a forearm joint after binding, paint with Replace + X-mirror, Go to Bind Pose, one undo
  per stroke; **-11** numbers overlay + table edit of an elbow loop; **-12** topology change in Model → transferred
  weights → review glyph clears after one paint stroke.

---

## 17. Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | Users with desktop-DCC habits expect `E` on a bound joint to edit the rest | `TEST POSE` badge, help line, `D`+`E` for rest rotation, Apply Pose as Rest; owner feel check |
| K2 | Orient Joint after animating bone-aligned chains changes motion between keys | conversion exact at keys plus the info toast (as rotate-order changes); suggest orienting before animating |
| K3 | "Closest in hierarchy" differs from the desktop DCC's unpublished algorithm | named as our reading; acceptance numbers are ours, not parity with the desktop DCC |
| K4 | Inpainting solve fails on degenerate sliver triangles | clamped cotangents, the robust Laplacian upgrade path, fallback to closest point with a warning |
| K5 | Numbers overlay clutter on dense meshes | density guard (selected only above 2,000 labels) |
| K6 | Projected center on open, layered low-poly parts | single-hit fallback (14), winding-number inside test later, user drags guides |
| K7 | Browser chords for `Ctrl+Shift+Comma/Period` and `B`/`M`/`N`/`U` holds collide with the page | QA matrix rows; every action also in the tool panel and the `U` menu |
| K8 | Scope creep (envelopes, gradient, voxel, cross-skeleton transfer) | listed LATER with sizes; BASE stays within ≈ +8 days |

---

## 18. Open questions for the owner

1. **Q-RIGB-1** Default joint orientation for humanoid templates: **World (identity, VRM-normalized)** or the desktop
   DCC's X down the bone? *Recommendation: World; X-down only for non-humanoid chains. Animation and deformation do not
   change either way (§2.3); World keeps VRM exports normalized.*
2. **Q-RIGB-2** `E` on a bound joint: **test pose** (desktop-DCC feel, recommended) or rest rotation?
3. **Q-RIGB-3** The `Delete` key on a joint: the desktop DCC's subtree delete (recommended) or splice?
4. **Q-RIGB-4** Mirror Joint default for non-humanoid chains: **Behavior** (desktop-DCC Quick Rig default, recommended)
   or Orientation?
5. **Q-RIGB-5** Rig & Skin selection changes as undo steps (like Model)? *Recommendation: yes.*
6. **Q-RIGB-6** Paint brush radius: screen pixels (14, recommended) or the desktop DCC's world units?
7. **Q-RIGB-7** Flood has no chord (`Alt+F` is never bound): acceptable with the `U` menu and panel button?
   *Recommendation: yes.*
8. **Q-RIGB-8** Pull the envelope/capsule method (desktop-DCC Interactive Skin Bind) into M6b (+1.5 days)?
   *Recommendation: LATER; numbers + table + paint cover low-poly.*

---

## 19. Sources

Desktop DCC (vendor help, checked 2026-10-19; vendor URLs omitted)
- Skeleton menu (Rigging menu set), 2022 help
- Joint Tool settings, 2024 help
- Create joints with Snap to Projected Center, 2017 help
- Creating joints (Enter completes the chain, branching advice), 2010 help
- Create symmetric joints, 2017 help
- Orient Joint Options, 2017 help
- `joint` command (orientJoint, secondaryAxisOrient, scaleCompensate), command reference
- Mirror Joint options, 2017 help; the same page in the 2015 help of the LT edition; `mirrorJoint` (Python), 2012
  command reference (Japanese edition)
- `reroot` (skin restriction), 2010 command reference
- Joint labels, 2024 help
- Joint size, 2017 help; `jointDisplayScale` (Python), command reference
- Local axes display and manual orientation, 2011 and 2009 help
- `MFnIkJoint` (joint matrix), 2016 SDK C++ reference
- Quick Rig, 2026 help; Step-by-Step settings, 2026 help
- Humanoid-IK skeleton setup area, 2016 help
- Skin menu, 2026 help
- Bind Skin Options, 2019 help; Smooth Bind (dropoff), 2014 help
- Interactive skin binding and its manipulators, 2017 help
- Paint Skin Weights Tool, 2026 help
- Artisan hotkeys, 2017 and 2009 help
- Lock smooth skin weights (Component Editor Hold), 2017 help; Component Editor, 2026 help
- Mirror Skin Weights, 2019 help
- Copy Skin Weights / Surface Association, 2023 help; `copySkinWeights`, 2009 command reference
- Prune Small Weights, 2013 and 2011 help
- Bind pose, 2009 help; Move Skinned Joints Tool, 2014 help
- skinCluster node, 2026 node reference

Open-source DCC (manual and API; behaviour and names only; vendor URLs omitted)
- Armature Deform Parent (Envelope / Automatic / Empty Groups), dev manual
- Bone Roll (Recalculate Roll, `Shift+N`), dev manual
- Weight Paint options (Auto Normalize, Lock-Relative, Multi-Paint), dev manual
- Weight Paint editing (Normalize All, Clean, Levels, Smooth), dev manual
- Weight Paint tools (Gradient, Sample), 4.2 manual (German edition)
- glTF importer `bone_heuristic`, `guess_original_bind_pose`, 5.2 Python API reference

VRM
- VRM features (0.x normalized T-pose vs 1.0): https://vrm.dev/en/vrm/vrm_features/
- three-vrm (normalized vs raw bones): https://github.com/pixiv/three-vrm

Papers and code
- Baran, Popović, "Automatic Rigging and Animation of 3D Characters", SIGGRAPH 2007: https://people.csail.mit.edu/ibaran/papers/2007-SIGGRAPH-Pinocchio.pdf
- Dionne, de Lasa, "Geodesic Voxel Binding for Production Character Meshes", SCA 2013: https://diglib.eg.org/handle/10.2312/15001
- Abdrashitov, Raichstat, Monsen, Hill, "Robust Skin Weights Transfer via Weight Inpainting", SIGGRAPH Asia 2023 Technical Communications, DOI 10.1145/3610543.3626180: https://www.dgp.toronto.edu/~rinat/projects/RobustSkinWeightsTransfer/ ; code (MIT): https://github.com/rin-23/RobustSkinWeightsTransferCode
- Jacobson, Kavan, Sorkine-Hornung, "Robust Inside-Outside Segmentation using Generalized Winding Numbers", SIGGRAPH 2013: https://www.cs.toronto.edu/~jacobson/weblog/3090.html ; Barill et al., "Fast Winding Numbers for Soups and Clouds", SIGGRAPH 2018: https://dgp.toronto.edu/projects/fast-winding-numbers
- Jacobson, Baran, Popović, Sorkine, "Bounded Biharmonic Weights for Real-Time Deformation", 2011: https://www.cs.toronto.edu/~jacobson/weblog/1784.html
- Sharp, Crane, "A Laplacian for Nonmanifold Triangle Meshes", SGP 2020: https://diglib.eg.org/handle/10.1111/cgf14069
- three-mesh-bvh (MIT): https://github.com/gkjohnson/three-mesh-bvh

Repository evidence (read-only): `docs/M6A-SPEC.md` §4.2 (`JointRecord`, `SkeletonRecord`, `MeshRecord.skin`), §4.3
(`skin.joints`/`skin.weights` layers), §5.2 (layer propagation), §5.7, §5.10, §7; `docs/adr/0004-rig-model.md`;
`docs/adr/0015-mesh-storage-in-the-document.md` §8; `docs/DECISIONS-OPEN.md` (M2A-A1-3, INT-46, Q-RIG-3);
`packages/rig/src/autorig/naming.ts` (`sideFromName`), `packages/rig/src/humanoid/map.ts` (`mirrorHumanBone`,
`humanChainChildren`, `humanDisplayName`), `packages/rig/src/mirror/mirrorPose.ts` (mirror for non-world-aligned rest
frames).
