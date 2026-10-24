# 14 — From a modeled mesh to an animatable character: skeleton, skinning, weights, VRM/GLB export

> Research note for Ekza Animator (modeling iteration). Date: 2026-10-18. Status: proposal for review.
> Scope: the bridge that turns a mesh modeled in our tool (or an imported static or skinned mesh) into a character
> that the existing control rig can animate and that Ekza can consume: skeleton creation from a VRM humanoid
> template, bind pose, auto-skinning, weight editing, deformation testing, VRM 1.0 / GLB export, Ekza upload, and
> editing imported characters. Out of scope: the mesh data model and modeling tools themselves (other notes of this
> iteration own `MeshData`; this note states what it needs from them), facial expressions and spring bones
> (later), AI 3D generation (only the hand-off is described, §11).
> Inputs: research [02](02-formats-gltf-vrm.md) §4–§5, §11, §14; [03](03-ekza-reuse-audit.md) §2.4, §5–§7;
> [06](06-collaboration.md) R1–R12, §8.2, §10.1; [07](07-rig-controls-math.md) §3–§5, §16; [08](08-extensibility-modeling.md)
> §3, §5, §9.8; [09](09-ui-ux-spec.md) §9.3; ADRs [0002](../adr/0002-document-store-and-collaboration-readiness.md),
> [0004](../adr/0004-rig-model.md), [0005](../adr/0005-export-strategy.md), [0010](../adr/0010-ekza-integration-tiers.md),
> [0011](../adr/0011-project-file-format.md); the code on `dev` after the M2a merge (`io/skeleton`, `rig/autorig`,
> `doc/records`).
> Reference tools are named generically: a leading commercial desktop DCC ("the desktop DCC") and a popular
> open-source DCC ("the open-source DCC").

---

## 0. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | **A character can be sourced from the document, not only from an asset.** `CharacterRecord` gains `source: { kind: 'asset' } \| { kind: 'model' }`; a model-sourced character is skeleton + skin + meshes as document records. Everything downstream (`SkeletonDesc`, `autoRig`, IK, exports of clips) is reused unchanged by deriving `SkeletonDesc` from records instead of from GLB bytes. | Today the whole rig pipeline starts at `skeletonFromGltf(GlbContainer)` (pure data). `SkeletonDesc` is already pure data, so a second producer (`skeletonFromDoc`) is the smallest change that makes the pipeline turnkey. Round-tripping through GLB bytes on every joint move or brush stroke would be slow and would churn content hashes. |
| D2 | **Bind pose = skeleton rest pose = VRM T-pose**, always, for humanoids. Inverse bind matrices are derived (`IBM_j = (W⁰_j)⁻¹`), never stored. A-pose modeling is allowed and converted with **Apply Pose as Rest** (the desktop DCC's "T-Stance Correction"). | VRM 1.0 makes the T-pose normative ("VRM models must follow the specification of the rest pose"); VRMA, Ekza Space and OMOBA retarget from T-pose rests (OMOBA's `RetargetBasis` applies source deltas on the target's rest). One invariant removes a whole class of bind/rest bugs. |
| D3 | **Joints store their rest world position in character space** (+Y up, +Z forward, left = +X) and an **identity rest rotation** by default. Leaf joints carry a `tail` (display and skinning segment only). | Same rule as controls in ADR 0004 (rest world stored, locals derived; concurrent edits to different joints never conflict). Identity rest rotations are VRM-valid and make the normalized humanoid space equal to the raw space, so export, VRMA and the kernel agree trivially. |
| D4 | **Humanoid template = VRM 1.0 bone set** in three presets (Lite 17, Standard 33 with mitten hands, Full 52), node names = VRM bone names, under a non-humanoid `root`. | Canonical names (03 §6.2), unique names for Bevy name paths, required bones for Space/OMOBA/registry, fewer joints for low-poly. |
| D5 | **Joint placement is desktop-DCC-first**: Joint tool with **Snap to Projected Center**, X-symmetry on by default, and a **Quick Rig** wizard (markers → guides → skeleton → skin) modeled on the desktop DCC's Quick Rig Step-by-Step flow. | The owner is a desktop-DCC user; its Quick Rig already defines the right stages (embed guides, mirror, T-stance correction, Geodesic Voxel skinning by default). |
| D6 | **Auto-skin default for low-poly = "Auto (low-poly)"**: mesh islands that fit one bone are bound rigidly; continuous parts get **bone-heat diffusion** (Baran & Popović 2007, the algorithm behind the open-source DCC's Automatic Weights), solved in TS in a Worker. Geodesic voxel binding (the desktop DCC's default) is the later path for AI/polygon-soup meshes. | Measured on the CC0 low-poly fixture Polybot: 95.3% of its vertices have one influence; 30 of its 37 islands are bound to one joint; "island centroid → nearest bone, rigid" reproduces the artist's dominant joint on **90.5%** of vertices and is within one joint on **100%**, while per-vertex nearest-bone gets 69.9% / 92.6% (§5.3). The heat solve itself costs ≈ 0.1 s for 10k vertices × 55 bones in plain JS (§5.4). |
| D7 | **Max 4 influences, always normalized** (desktop-DCC "Interactive" normalization + "Maintain Max Influences"), stored as `JOINTS_0`-ready data. | glTF clients "MAY support only a single set of up to four" (three.js r186 `GLTFLoader` maps only `JOINTS_0`/`WEIGHTS_0`; Bevy 0.19.1 only `Joints(0)`/`Weights(0)`). What you paint is exactly what exports. |
| D8 | **Weights live in a per-mesh skin blob** (content-addressed, ~24 B/vertex) referenced by a `SkinRecord`; topology operators carry weights through **registered attribute interpolators** of the `MeshData` layer system. | Research 06: binary data by hash, never per-vertex CRDT. A paint stroke rewrites the small skin blob, not the geometry blob. |
| D9 | **Weight tools (MVP)**: component weight table, assign-to-joint / rigid islands, Paint Skin Weights (Replace / Add / Scale / Smooth + Flood, joint locks), weight display, Mirror Skin Weights, copy/paste, prune, normalize, smooth ("hammer"), closest-point transfer. | The minimum that fixes the 7–10% of vertices any auto-skin gets wrong on a low-poly character, with desktop-DCC names and the open-source DCC's Auto-Normalize/Lock semantics. |
| D10 | **Deformation testing reuses the existing auto-rig** on the derived `SkeletonDesc` (radii and foot support computed from our weights), plus a generated **range-of-motion (ROM) clip** and painting on the posed mesh. | No second rig system; M2a IK legs work on our own characters on day one. |
| D11 | **Exports**: a **fresh deterministic writer** (glTF Transform document) for model-sourced characters → `.vrm` (VRM 1.0 with `VRMC_vrm`: meta, humanoid, thumbnail) and `.glb`; a **skin surgeon** (append new `JOINTS_0`/`WEIGHTS_0` accessors, keep everything else) for weight edits on imported VRM/GLB; a **geometry surgeon** later for topology edits on imports. | The ADR 0005 rule holds: never round-trip a user's VRM through a library that drops extensions; fresh documents are ours to write. |
| D12 | **Ekza**: T0 = export VRM 1.0 and upload it as an avatar in Studio (the registry's `avatar` kind and Space's `vrm-humanoid-v1` already exist). **T3 "Publish avatar"** needs only the `studio-upload` scope, so it can ship before the animation kind (T1). | The avatar path needs no registry migration; the animation path does (ADR 0010). |
| D13 | **Licence gates**: an imported VRM whose meta says `modification: prohibited` (VRM 1.0) cannot be made editable or re-exported with changed geometry or weights; the export dialog requires explicit VRM meta for our own models. | Respects creators' terms; VRM meta is required (`name`, `authors`, `licenseUrl`) and its defaults are restrictive. |
| D14 | **No GPL/LGPL code**: the open-source DCC's heat code (GPL) and Pinocchio's library (LGPL) are read for ideas only; we implement from the papers. | The project is MIT (ADR 0009). |

---

## 1. Where we are and what "turnkey" means

### 1.1 The pipeline on `dev` today

```
.glb/.vrm bytes ─► GlbContainer ─► skeletonFromGltf() ─► SkeletonDesc ─► autoRig() ─► RigDefinition ─► compileRig ─► kernel
                     (io)            pure: nodes, rest TRS,        (rig)   controls, IK limbs      (rig)
                                     humanoid map, boneRadii,
                                     boneSupport from JOINTS_0/WEIGHTS_0
CharacterRecord { asset: AssetId (sha256), format, rig, placement }        exports: surgeon bake into the source bytes,
                                                                            animation-only GLB, VRMA
```

`SkeletonDesc` (rig `types.ts`) is pure data: nodes in topological order with rest locals, the humanoid map,
`boneRadii` (1.25 × P90 distance of dominated bind-pose vertices, research 07 §5.4), `height`, `fingerprint` and
the M2a `boneSupport` (foot pivots). `measureMeshes` computes radii and support from glTF accessors through a
`GltfReader`. Nothing in the rig needs three.js or the original bytes, except the surgeon bake (which needs the
original file by design).

### 1.2 The gap

A mesh modeled in the tool has no skeleton, no weights and no source bytes. The bridge must create all three,
keep them editable, and feed the existing pipeline. "Turnkey" = this loop without leaving the app:

```
Model (low-poly, T-pose) ─► Character Setup: Skeleton ─► Bind/Auto-skin ─► Fix weights ─► Test (ROM, IK)
        ▲                                                                                  │
        └─────────── mesh / joint edits keep weights and curves ◄──────────────────────────┘
                                                                                           ▼
                                    Animate (M1/M2a tools) ─► Export .vrm / .glb / .vrma ─► Ekza Studio / Space / OMOBA
```

### 1.3 Evidence from the two bundled fixtures

Measured with a throwaway script over the GLB accessors (2026-10-18):

| Fixture | Vertices | Triangles | Skin joints | Vertices by influence count (1/2/3/4) | Dominant weight ≥ 0.95 | Islands |
|---|---|---|---|---|---|---|
| Polybot (VRM 0.x, CC0, low-poly) | 1,722 | 2,130 | 55 (31 carry weight) | 1,641 / 75 / 2 / 4 | 96.0% | 37 |
| Seed-san (VRM 1.0, VRM Public License) | 34,059 | 45,058 | 23 + 7 + 1 + 21 + 80 | 24,790 / 6,303 / 2,344 / 622 | 77.8% | — |

Two consequences: (1) low-poly characters are skinned **almost rigidly**, often as separate pieces, so a
rigid-first auto-skin is the right default; (2) **Polybot's rest pose is an A-pose** (left upper arm → hand drops
from y = 0.586 H to 0.381 H, legs splayed), so real low-poly assets violate the VRM T-pose rule even though they
load as VRM. We need a T-pose lint and a correction tool (§4.4).

---

## 2. Interaction model for this area: desktop-DCC first, open-source-DCC ideas where they are better

| Topic | Desktop DCC | Open-source DCC | Ours |
|---|---|---|---|
| Overall flow | Rigging menu set: Skeleton ▸ Create Joints / **Quick Rig**; Skin ▸ Bind Skin, Paint Skin Weights, Mirror / Copy Skin Weights | Armature edit mode, Ctrl+P ▸ With Automatic Weights, Weight Paint mode | **Rig workspace** (09 §9.3) with a *Character Setup* panel: Skeleton → Bind → Weights → Test, desktop-DCC names |
| Joint placement | Joint tool + **Snap to Projected Center** ("each joint is centered automatically") | Bone head/tail, X-Axis Mirror, Snap to Volume | Joint tool, projected-center snapping, symmetry on by default |
| Auto weights | Bind methods: Closest Distance, Closest in Hierarchy (default), Heat Map, **Geodesic Voxel** (Quick Rig default); falloff 0.2 default | **Bone heat** ("With Automatic Weights"), envelopes | "Auto (low-poly)" = rigid islands + bone heat (§5); voxel later |
| Normalization | Normalize Weights: None / **Interactive** (default) / Post; Max Influences (default 5), Maintain Max Influences | **Auto Normalize**, **Lock-Relative** display, Normalize All with locked groups | Always interactive, max 4 maintained, joint locks, Lock-Relative display option |
| Paint ops | Replace, Add, Scale, Smooth, Flood; B+drag brush size | Mix/Add/Subtract/Blur/Average/Smear brushes, Gradient tool, Sample Weight | Replace, Add, Scale, Smooth, Flood (desktop DCC), + Gradient and Sample later (open-source DCC) |
| Mirror | Skin ▸ Mirror Skin Weights: mirror plane, direction, surface association (closest point default), influence association (closest joint, label, name, one-to-one) | Weight paint Mirror tool (active group, X only) | Mirror Skin Weights across YZ, closest-point fallback, humanoid L/R joint map |
| Re-running an operator with new parameters | Option boxes before running | **Adjust Last Operation** panel | Bind/Auto-skin show an *adjust last operation* panel (operator args are JSON-schema, 08 §5.2) |

Keymap: the `dcc` preset first (the owner's muscle memory), an alternative keymap preset (open-source-DCC style) as
data later (08 §5.3). Paint-tool keys follow the desktop DCC's Artisan: `B`+drag brush radius (documented by the
vendor), `N`+drag value (Artisan convention, to verify against the hotkey editor), `Ctrl`+drag sample weight.

---

## 3. Data model

### 3.1 New and changed records (`doc`, partition `char:<characterId>`)

```ts
// Changed (schema v3; a migration rewrites every v2 record to { kind: 'asset', asset }):
interface CharacterRecord {
  readonly id: CharacterId; readonly name: string;
  readonly source:
    | { readonly kind: 'asset'; readonly asset: AssetId }                         // imported GLB/VRM, as today
    | { readonly kind: 'model'; readonly skeleton: SkeletonId };                  // meshes found via SkinRecord.skeleton
  readonly format: ModelFormat;           // 'vrm1' for model-sourced humanoids (canonical +Z), 'gltf' otherwise
  readonly rig: RigId; readonly placement: ReadonlyXf; readonly order: string; readonly deleted: Tombstone;
}

interface SkeletonRecord {
  readonly id: SkeletonId; readonly character: CharacterId;
  readonly template: 'vrm-humanoid' | 'generic'; readonly templateVersion: string;   // e.g. '1.0.0'
  readonly preset: 'lite' | 'standard' | 'full' | 'custom';
  readonly symmetry: boolean;                       // X-mirror editing (session default, stored for collaborators)
  readonly deleted: Tombstone;
}

interface JointRecord {
  readonly id: JointId; readonly skeleton: SkeletonId;
  readonly parent: JointId | null; readonly order: string;          // fractional index among siblings
  readonly name: string;                                             // export node name; unique per skeleton (lint)
  readonly humanBone: HumanBoneName | null;                          // VRM 1.0 name; unique per skeleton
  readonly restPosition: ReadonlyVec3;                               // character space, metres (D3)
  readonly restRotation: ReadonlyQuat;                               // identity by default (D3)
  readonly tail: ReadonlyVec3 | null;                                // leaf joints: end point for display/skinning
  readonly side: 'L' | 'R' | 'C'; readonly mirror: JointId | null;   // pair link for symmetric editing and mirroring
  readonly deleted: Tombstone;
}

interface SkinRecord {
  readonly id: SkinId; readonly mesh: MeshId; readonly skeleton: SkeletonId;
  readonly weights: { readonly blob: string };     // sha256 of an `ekza.skin.v1` blob (§3.2)
  readonly topology: string;                       // sha256 of the mesh topology the blob indexes (stale check)
  readonly bindMethod: SkinBindArgs | null;        // last auto-skin arguments (adjust-last-operation, provenance)
  readonly deleted: Tombstone;
}
```

`MeshId`/`MeshRecord` belong to the modeling-core note; the only requirement here is a stable vertex index space per
topology version and the attribute-layer hooks of §8.1.

Merge units (ADR 0002 §2): `JointRecord` merges per top-level field (two people may move two different joints);
`SkinRecord.weights` is atomic (one blob). Skeleton and skin edits take the exclusive `rig` claim of research 06
§8.2 when collaboration arrives. Deterministic IDs are needed only where 06/07 require them; template joints get
`<skeletonId>:<humanBone>` so concurrent "Create template" runs agree.

### 3.2 `ekza.skin.v1` blob

```
header  (JSON, UTF-8, length-prefixed): { "format": "ekza.skin.v1", "vertexCount": V, "influences": 4,
                                          "joints": ["<JointId>", ...] }   // palette, skeleton topological order
body    Uint16  joints [V × 4]   (palette indices; unused slots = 0, as glTF says they SHOULD be)
        Float32 weights[V × 4]   (descending per vertex; zero-padded; Σ = 1 within 1e-6 before export rounding)
```

24 bytes per vertex plus the palette: 240 KB for a 10k-vertex mesh, small enough to snapshot per brush stroke
(undo keeps hashes; the blob store keeps old versions until GC, research 06 §10.1). The palette order is the
export `skin.joints` order, so writing glTF is a copy plus a uint8/uint16 cast. Deterministic bytes for identical
content (NFR-06).

### 3.3 Derived data, never stored

| Derived | Formula / source | Consumer |
|---|---|---|
| Joint rest locals | `L⁰_j = (W⁰_parent)⁻¹ · W⁰_j` | `SkeletonDesc.nodes[].restLocal`, export node TRS |
| Inverse bind matrices | `IBM_j = (W⁰_j)⁻¹` (bind = rest, D2) | three.js `Skeleton.boneInverses`, export accessor |
| `SkeletonDesc` | `skeletonFromDoc(records)`: format `vrm1`, facing identity, humanoid map from `humanBone`, `springJoints = []`, `nodeConstraints = []`, `boneRadii`/`boneSupport`/`height` from the skin blob and mesh positions, fingerprint as today | `autoRig`, kernel, VRMA / animation-only exports |
| three.js view | one `SkinnedMesh` per mesh built directly from `MeshData` + skin blob (`skinIndex`/`skinWeight` attributes) | viewport |

`measureMeshes` gets a typed-array entry point (`measureSkinned(positions, joints, weights, jointWorlds, …)`) so the
asset path and the model path share one implementation of radii and foot support.

---

## 4. Skeleton creation

### 4.1 Humanoid template

Presets (VRM 1.0 names; the 15 required bones are `hips, spine, head` and left/right `UpperArm, LowerArm, Hand,
UpperLeg, LowerLeg, Foot`):

| Preset | Bones | Notes |
|---|---|---|
| **Lite** (17) | 15 required + `chest`, `neck` | `chest`/`neck` are required by VRM 0.x consumers and OMOBA's VRM 0 path; cheap to include |
| **Standard** (33, default) | Lite + `leftShoulder/rightShoulder` + `leftToes/rightToes` + **mitten hands**: thumb (Metacarpal, Proximal, Distal) and index (Proximal, Intermediate, Distal) per hand | Low-poly hands are usually mittens; the four fingers are weighted to the index chain. VRMA finger curls then drive the mitten; missing optional finger bones are legal |
| **Full** (52) | Standard + `upperChest` + all 30 finger bones (eyes not mapped; `jaw` optional) | For detailed hands; `upperChest` "can exist only when chest exists" (VRM humanoid spec) |

Default positions, fractions of the character height `H`, VRM T-pose (+X = character left; mirrored for `R`):

| Joint | Standard (from the VRM 1.0 fixture, rounded) | Stylized big head (from Polybot's heights, straightened into a T-pose) |
|---|---|---|
| `hips` | (0, 0.50, 0) | (0, 0.38, 0) |
| `spine` / `chest` / `upperChest` | 0.59 / 0.67 / 0.74 | 0.45 / 0.51 / 0.55 |
| `neck` / `head` (tail) | 0.815 / 0.845 (1.0) | 0.60 / 0.64 (1.0) |
| `leftShoulder` | (0.03, 0.80, 0) | (0.065, 0.59, 0) |
| `leftUpperArm` / `LowerArm` / `Hand` (tail) | x 0.09 / 0.25 / 0.39 (0.47), y 0.78 | x 0.13 / 0.25 / 0.36 (0.42), y 0.585 |
| `leftUpperLeg` / `LowerLeg` / `Foot` | x 0.056; y 0.49 / 0.29 / 0.048 | x 0.05; y 0.36 / 0.22 / 0.05 |
| `leftToes` (tail) | (0.056, 0.01, 0.09) (z 0.13) | (0.05, 0.01, 0.06) (z 0.10) |

These are initial guesses only; Quick Rig markers and projected-center snapping replace them (§4.3).

Hierarchy and export layout: `root` (non-humanoid, at the origin, identity) → `hips` → VRM humanoid parent map
(spine → chest → upperChest → neck → head; shoulders under the topmost chest bone; legs under hips). The VRM 1.0
humanoid spec allows non-humanoid nodes between humanoid bones and draws hips under a non-humanoid root. Rest
rotations are identity (D3). All node transforms are positive uniform scale 1 (VRM T-pose Definition 2.1).

### 4.2 Placement tools

| Tool / operator | Behaviour |
|---|---|
| **Joint tool** (`skel.joint.create`) | Click to place a joint, continue the chain; `Enter` ends; `Shift` click branches from the selected joint (desktop-DCC Joint tool feel). Placing in an orthographic view sets the two in-plane coordinates from the click and the third from **projected center** |
| **Snap to Projected Center** (status-line toggle, default on in the Rig workspace) | Cast the view ray through the cursor, collect *all* mesh hits (three-mesh-bvh, both sides), pair entry/exit hits by facing, and put the joint at the midpoint of the slab. A new joint uses the nearest slab; moving an existing joint uses the slab containing its current depth (desktop DCC: "minimizes displacement and centers the joint among layers"). An open mesh with one hit falls back to the hit pushed inward by 0.5 × the local bone-radius estimate |
| Move / Rotate joint (`skel.joint.move`) | W manipulator; moves `restPosition`; with **Move Skinned Joints** semantics after binding: weights stay, `IBM` is re-derived, the mesh does not move, deformation changes (desktop-DCC tool of the same name; open-source-DCC edit-mode bone moves) |
| Symmetry (`SkeletonRecord.symmetry`, default on for humanoids) | Editing an `L`/`R` joint writes its pair at `(−x, y, z)`; centre joints are clamped to `x = 0` |
| Insert / split / delete / reparent joint | `skel.joint.insert` (on a bone, at a parameter), `skel.joint.delete` (children re-parent; its weights go to the parent, §6.6), `skel.joint.reparent` |
| Map bone (`skel.joint.setHumanBone`) | Pick a `HumanBoneName` from a list filtered by the parent map; uniqueness enforced |
| Add chain (`skel.chain.add`) | Tails, ears, hair, skirts, props: click points on the surface (projected center), named chain `tail_01…`, non-humanoid; animated by the generic secondary FK controls (ADR 0004 §9) |

Lints (Validation list of the Rig workspace): `skel.required-bones` (15), `skel.unique-names`, `skel.unique-human-bone`,
`skel.parent-map` (humanoid ancestry matches VRM), `skel.tpose` (§4.4), `skel.symmetry` (pairs mirror within 0.01 H),
`skel.grounded` (mesh minimum Y within 0.01 H of 0), `skel.facing` (toes in front of feet).

### 4.3 Quick Rig (wizard)

Modeled on the desktop DCC's Quick Rig *Step-by-Step* (Geometry → Guides → User Adjustment of Guides → Skeleton and
Rig Generation → Skinning) and the marker step of a web auto-rigging service (chin, wrists, elbows, knees, groin):

1. **Geometry**: pick the meshes (body, separate eyes, accessories). Check: facing +Z, Y-up, grounded, roughly
   symmetric (offer *Center and ground* and *Rotate to face +Z* fixes).
2. **Markers** (front orthographic view, symmetry on): `chin`, `groin`, `wrist.L`, `elbow.L`, `knee.L`; optional
   `ankle.L`, `shoulder.L`. Five clicks for a symmetric character. *One-Click* = guess the markers from the
   silhouette and the template proportions, then go to step 3.
3. **Guides** = template joints fitted to the markers (heuristics, to be calibrated on the fixtures):
   - legs vertical in the T-pose: `upperLeg.x = lowerLeg.x = foot.x = knee.x`; `lowerLeg.y = knee.y`;
     `upperLeg.y = groin.y + 0.02 H`; `hips.y = groin.y + 0.04 H`; `foot.y` = ankle marker or 0.05 H; `toes` at the
     front third of the foot's vertices, `tail` at the foot's front extent;
   - arms horizontal: `lowerArm = elbow`, `hand = wrist`, `upperArm.x = elbow.x − 0.95·(wrist.x − elbow.x)`
     clamped to the torso silhouette at that height, `shoulder` halfway between `upperArm` and the spine;
   - `neck.y = chin.y − 0.01 H`, `head.y = neck.y + 0.03 H`, head tail at the top of the mesh; spine joints evenly
     spaced between hips and neck;
   - fingers per preset along the hand's long axis; thumb at 45° between +X and +Z (VRM T-pose Definition 1.8);
   - depth of every guide by projected center along Z.
4. **Adjust guides**: drag guides with symmetry; *Mirror L → R / R → L*; X-ray joints.
5. **Create skeleton** (writes `SkeletonRecord` + `JointRecord`s in one transaction), then **Skinning** (§5),
   then **Create control rig** (the existing `autoRig`, humanoid, legs IK).

Fitter test: synthesize markers from the fixtures' own joints (Seed-san T-pose; Polybot after Apply Pose as Rest),
run the fitter, require every humanoid joint within 0.03 H of the ground truth.

Not planned: fully automatic skeleton embedding without markers (Pinocchio's discrete embedding over a medial
graph) — heavy for the browser and fragile on non-watertight low-poly meshes; ML rigging is the better future path
(§11).

### 4.4 T-pose, A-pose and Apply Pose as Rest

VRM 1.0 T-pose rules we lint (`skel.tpose`, error in VRM export profiles, warning otherwise): legs, torso and head
along +Z and symmetric about X = 0; arms and hands parallel to X and to the ground, palms −Y; four fingers parallel to
X; thumbs 45° between X and +Z; feet parallel to Z, toes +Z; grounded at Y = 0 by the mesh's appearance; positive
uniform scale. Tolerance 5° per bone direction.

Low-poly artists often model in an A-pose (Polybot does). **Apply Pose as Rest** (`skel.pose.applyAsRest`):

1. pose the skeleton into the target pose (e.g. *T-Stance*: rotate upper arms and legs to the template directions);
2. bake the skinned mesh: `v' = Σ_k w_k · (W_k(P) · IBM_k) · v` (the same LBS the viewport uses), normals likewise;
3. set each joint's `restPosition` to its posed world position, `restRotation` to identity; `IBM` follows (D2);
4. the weights are unchanged.

Warning shown before running it: existing animation is rest-relative (ADR 0004 D2), so clips authored on the old
rest shift by the pose delta; offer it before animating, not after. A curve compensation option is later.

---

## 5. Bind and auto-skinning

### 5.1 What the targets accept (normative)

| Rule | Source |
|---|---|
| Skinning is linear blend: per-vertex matrices "computed as weighted linear sums of the joint transformation matrices"; inverse bind matrices are applied before the joint world transforms | glTF 2.0 §3.7.3 |
| `JOINTS_n`/`WEIGHTS_n` come in pairs; `JOINTS_n` uint8/uint16; `WEIGHTS_n` float32, unorm8 or unorm16; weights MUST NOT be negative; a joint MUST NOT appear twice with non-zero weight; float sums SHOULD be ≈ 1 (validator threshold 2e-7 × non-zero count); unorm sums MUST be exactly 255/65535; unused joints SHOULD be 0 | glTF 2.0 §3.7.3.3 |
| Clients MAY support only one set of four influences | glTF 2.0; three.js r186 `GLTFLoader` (`JOINTS_0 → skinIndex`, `WEIGHTS_0 → skinWeight` only); Bevy 0.19.1 `vertex_attributes.rs` (`Joints(0)`, `Weights(0)` only) |
| `inverseBindMatrices`: float MAT4, count ≥ joints, fourth row `[0,0,0,1]`, finite; the skinned mesh node's own transform MUST be ignored | glTF 2.0 §3.7.3.1–2 |
| Dual-quaternion skinning is not expressible in glTF | glTF 2.0 (LBS only) |

So: LBS, 4 influences, float32 weights renormalized **after** float32 rounding, unused slots joint 0 weight 0.

### 5.2 Algorithms compared

| Method | Idea | Cost in TS (this repo's sizes) | Low-poly quality | Robustness | Licence / reuse |
|---|---|---|---|---|---|
| **Closest bone (rigid)** | each vertex → nearest bone segment, weight 1 | O(V·B); < 10 ms for 10k × 55 | 69.9% exact / 92.6% within one joint on Polybot | wrong across limbs and on big pieces (head → shoulders) | trivial, ours |
| **Rigid islands** | each mesh island → bone nearest its centroid | O(V + islands·B) | **90.5% / 100%** on Polybot (segmented robot) | fails on single-piece bodies (one island) | trivial, ours |
| **Bone heat** (Baran & Popović 2007; open-source DCC "With Automatic Weights"; desktop DCC "Heat Map") | solve `(L + H) w_j = H p_j` per bone on the surface; `H` from distance to the nearest *visible* bone | build ≈ 5–17 ms, solves ≈ 20–80 ms for 1.5k–10k vertices × 55 bones (measured, §5.4) + visibility rays | smooth joints; good on continuous low-poly bodies; vertices are the only samples, so joints blend over edge loops | singular on islands that see no bone (open-source DCC: "failed to find solution") → per-island fallback | paper; the open-source DCC (GPL) and Pinocchio library (LGPL) are references only |
| **Geodesic voxel** (Dionne & de Lasa 2013; desktop-DCC default) | voxelize the solid, geodesic distance inside the volume from bone voxels, weights from distance with a falloff (desktop-DCC default 0.2) | 64³–128³ grids, one geodesic pass per bone: ≈ 0.5–5 s in a Worker (estimate) | good; "Falloff" gives a rigid ↔ smooth slider | handles non-manifold, non-watertight, intersecting, multi-component meshes; needs joints inside the volume; coarse grids merge nearby parts | paper; ours |
| Bounded biharmonic weights (Jacobson et al. 2011) | constrained QP over a tet mesh | needs tetrahedralization + QP solver | very smooth | tet meshing is the failure point | libigl core MPL-2.0 (file-level copyleft), solvers heavy |
| Pinocchio | automatic skeleton embedding + heat weights | discrete embedding, heavy | — | needs watertight meshes | library LGPL, demo MIT |
| ML (UniRig, SIGGRAPH 2025) | autoregressive skeleton + learned weights | Python + GPU; not in-browser | trained on varied assets | for generated meshes | MIT (`VAST-AI-Research/UniRig`) |

### 5.3 Experiment: auto-skin heuristics against Polybot's artist weights

Method: read Polybot's skin (joint bind positions from the inverse bind matrices, segments joint → child joint, the
31 joints that carry weight as candidates), weld vertices by position, find islands, assign a dominant joint by each
heuristic, compare with the artist's dominant joint; "within one joint" = parent/child in the joint tree.

| Heuristic | Exact | Within one joint | Typical far errors |
|---|---|---|---|
| A. per-vertex nearest segment | 69.9% | 92.6% | head → shoulders (60 vertices), upper spine → shoulders (40) |
| B. island majority vote (≥ 60%) else per-vertex | 75.0% | 93.7% | as A, fewer |
| C. island centroid → nearest segment, rigid | **90.5%** | **100.0%** | none further than one joint |

Polybot is a segmented robot, the friendliest case. An organic single-piece low-poly body is one island, so C
degenerates to "everything on hips"; that is where bone heat takes over. Acceptance numbers for the real
implementation (§12) are therefore set on two fixtures: Polybot-without-weights (segmented) and a synthetic
single-piece "box man" (continuous).

### 5.4 Recommended pipeline: `skin.bind` with method `auto-lowpoly`

Runs in the IO/geometry Worker, deterministic (float64, fixed iteration order), one transaction on finish.

```
1  Weld        vertices by position (and existing skin, for imports) → solver vertices; UV/normal seams share weights
2  Islands     connected components of the welded mesh
3  Segments    per joint: segment joint → each child joint; leaf joint → its tail (or a point)
4  Per island  votes = nearest visible segment per vertex (visibility: ray vertex → closest segment point, ε offset,
               three-mesh-bvh); c = joint nearest the island centroid
               rigid if every vote is within tree distance 1 of c AND (island extent along c's bone ≤ 1.25 × bone
               length OR island ≤ 2% of vertices)            → weight 1 on c (thresholds calibrated on fixtures)
               else                                          → bone heat restricted to this island
5  Bone heat   L = cotan Laplacian, negative cotans clamped to 0 (keeps the discrete maximum principle, weights in [0,1]);
               d_j(v) = |v − seg_j| / (0.5·(cos θ + 1.001)), θ = angle between the vertex normal and v − seg_j
               C(v) = { j : d_j(v) ≤ min_k d_k(v)·(1 + 1e-4) and seg_j visible from v }
               H_vv = |C(v)| · c_stiff / max(min d, 1e-4)²,   p_j(v) = 1/|C(v)| if j ∈ C(v) else 0
               solve (L + H) w_j = H p_j for each joint j with any p_j > 0 in the island
               (Jacobi-preconditioned CG, tol 1e-6; or one sparse LDLᵀ factorization reused for all j)
               an island where H ≡ 0 (no visible bone) → rigid to c (step 4 fallback) + warning `skin.unreachable-island`
6  Post        w < 0.025 → 0, 0.025–0.05 ramp (open-source-DCC limits), keep the 4 largest, normalize;
               option "rigidify ≥ x": snap dominant weights ≥ x to 1 (low-poly look)
7  Write       skin blob + SkinRecord.bindMethod = args (for the adjust-last-operation panel)
```

Arguments (operator JSON schema): `method: 'auto-lowpoly' | 'heat' | 'rigid-islands' | 'closest' | 'voxel'`,
`stiffness` (heat `c_stiff`, default 1; higher = more rigid, the role of the desktop DCC's falloff), `maxInfluences`
(fixed 4), `pruneBelow` (0.025), `rigidifyAbove` (off), `joints` (subset: "auto weights for selected joints"),
`vertices` (mask: "auto weights for selected vertices", as the open-source DCC's weight-paint mask).

Measured solve cost (plain JS, single thread, Apple M4 Pro under load; tube meshes; 55 bones; 40% of vertices with
no visible bone so the diffusion actually iterates): 1,464 vertices 20 ms, 4,840 vertices 43 ms, 10,050 vertices
82 ms, CSR build 4–17 ms, 12–14 CG iterations per bone. Visibility needs only rays to the nearest few segments
(the open-source DCC casts rays only for the closest sources), ≈ V × 1–3 BVH raycasts. Budget: **≤ 1 s for 10k vertices
× 60 joints** including rays, in the Worker.

Low-poly specifics: (1) triangulate n-gons for the solve only; (2) long thin triangles make cotans negative, hence
the clamp; Sharp & Crane's robust Laplacian (MIT, C++ in geometry-central) is the upgrade if artefacts appear;
(3) the result is sampled only at the few vertices of each edge loop, so the joint blend width equals the loop
spacing; the *stiffness* slider and *rigidify* cover the style range from segmented to smooth.

### 5.5 Geodesic voxel binding (later, for AI and polygon-soup meshes)

Voxelize the meshes (solid fill, flood fill from outside; resolution 64–128 along the longest axis), mark voxels
crossed by each bone segment, run one multi-source Dijkstra / fast-marching pass per bone over non-exterior voxels,
map each vertex to its voxel (trilinear over the 8 neighbours), weight `w_j ∝ (1/d_j)^p` blended by a falloff
parameter, prune to 4 and normalize. The desktop DCC's notes apply: all joints must lie inside the volume; coarse grids
connect nearby parts (hand to hip), so start coarse and refine. Generated meshes (§11) are the main customer.

---

## 6. Weight editing tools

### 6.1 Normalization contract (every tool)

Per vertex, weights `w_k ≥ 0`, at most 4 non-zero, `Σ w_k = 1`; locked joints (per joint, session + stored as a
skin-editing preference) never change. When a tool sets the active joint `a` to `t`:

```
avail = 1 − Σ_{k locked} w_k                              (if avail ≤ 0: stroke has no effect on this vertex)
w_a'  = clamp(t, 0, avail)
rest  = Σ_{k unlocked, k ≠ a} w_k
if rest > 0:   w_k' = w_k · (avail − w_a') / rest           for unlocked k ≠ a
else if avail − w_a' > 0:  give the remainder to the nearest unlocked ancestor of a; if none, w_a' = avail
prune: while non-zero count > 4, drop the smallest unlocked weight and renormalize the unlocked ones
```

Property tests (fast-check): sums within 1e-9 (float64), non-negative, ≤ 4 influences, locked weights bit-equal,
idempotent normalize. Display option **Lock-Relative** (open-source DCC): show weights as if locked joints were removed.

### 6.2 Tools

| Tool / operator | MVP | Behaviour |
|---|---|---|
| **Component weight table** (`skin.weights.set`) | yes | Rows: selected vertices (or one averaged row), columns: joints with non-zero weight; type a value → normalization §6.1; *Hold* (lock) per joint; *Prune < x*; *Normalize*. Desktop-DCC Component Editor ▸ Smooth Skins tab |
| **Assign to joint** (`skin.weights.assign`) | yes | Selected vertices/faces/islands → weight 1 on the active joint. The 80% tool for segmented low-poly; desktop-DCC legacy "rigid bind" per selection |
| **Rigid islands** (`skin.weights.rigidIslands`) | yes | Step 4 of §5.4 on demand for selected islands |
| **Paint Skin Weights** (tool, `skin.weights.paint` modal) | yes | Operations **Replace** (`w_a → lerp(w_a, value, s)`), **Add** (`w_a + value·s`), **Scale** (`w_a · (1 − (1 − value)·s)`), **Smooth** (weight vector → lerp toward the 1-ring average, all unlocked joints); **Flood** applies the current operation to all (selected) vertices. `s` = strength × falloff (smooth/linear/constant). Brush radius in screen pixels; *Surface* mode (only vertices connected to the hit vertex within the radius — no painting through to the other leg) or *Volume* (sphere); front faces only by default; X-mirror stroke (mirror vertex, mirror joint). One stroke = one interactive transaction (preview overlay, one undo step, 08 §5.1) |
| **Weight display** | yes | Active joint as greyscale (desktop DCC) or heat ramp (open-source DCC); *Influence colours* mode (each joint its colour, blended); highlight vertices with > 4 or unnormalized weights (imports). Shader-side: `w = dot(skinWeight, vec4(equal(skinIndex, vec4(uActive))))`, so switching joints uploads nothing |
| **Mirror Skin Weights** (`skin.weights.mirror`) | yes | §6.3 |
| **Copy / Paste vertex weights** | yes | Copy the active vertex's weights, paste onto the selection (desktop-DCC Copy/Paste Vertex Weights) |
| **Weight Hammer** (`skin.weights.hammer`) | yes | Selected vertices ← average of their unselected neighbours (as in the desktop DCC) — fixes spikes on low-poly in one click |
| **Transfer weights** (`skin.weights.transfer`) | yes | From another skinned mesh (same skeleton): closest point on the source surface + barycentric interpolation of its triangle's weights (desktop-DCC Copy Skin Weights, surface association "closest point", the default) |
| Prune / Normalize / Remove unused influences | yes | `skin.weights.prune {below}`, `skin.weights.normalize`, palette cleanup |
| Gradient tool, Sample weight, Smear | later | open-source-DCC weight-paint tools |
| Paint on posed mesh | yes | §7.3 |

### 6.3 Mirror Skin Weights

1. Joint map L ↔ R: `JointRecord.mirror`; else `mirrorHumanBone` (exists in `rig/humanoid/map.ts`); else name
   patterns (`left`/`right`, `.L`/`.R`, `_l`/`_r`, `Left`/`Right`); else the joint nearest the mirrored position.
2. Vertex map: for each destination vertex `v` (direction `+X → −X` by default), mirrored position `(−x, y, z)`:
   exact match by spatial hash (tolerance 1e-4 H) → copy weights through the joint map; otherwise closest point on
   the source half's surface (three-mesh-bvh `closestPointToPoint`) and barycentric interpolation of its triangle's
   weights through the joint map.
3. Centre vertices (|x| ≤ tolerance): symmetrize (average of the vertex and its mirror image, mapped).
4. Prune to 4, normalize. Involution test: on a symmetric mesh, mirroring twice restores the weights exactly.

If the modeling core maintains a symmetry vertex map (symmetry modeling mode), step 2 uses it first.

### 6.4 Joint lifecycle and weights

| Change | Weights |
|---|---|
| Joint moved (rest change) | unchanged; IBM re-derived; deformation updates live |
| Joint added | no weights; offer "Auto weights for the new joint" (masked solve with the new joint and its neighbours) |
| Joint deleted | its weight moves to its parent joint (deterministic, unlike the desktop DCC's proportional redistribution) |
| Joint re-parented | unchanged; humanoid lint re-runs |
| Humanoid bone remapped | unchanged; the control rig update re-runs (§7.1) |

---

## 7. Testing deformation with the control rig

### 7.1 Auto-rig on our own skeleton

`skeletonFromDoc` produces a `SkeletonDesc` whose `boneRadii`, `boneSupport` and `height` come from the skin blob
and mesh positions (the same measurement code as imports, §3.3). `autoRig(skeleton, ids, { kind: 'humanoid', ik:
{ legs: true, arms: false } })` then gives exactly the M1/M2a rig: `root`, `cog`, `fk.hips`, FK chain, 30 finger
controls if present, leg IK with foot roll on mesh-derived pivots.

New operator **`rig.autoRig.update`**: after joint or weight edits, regenerate control rest transforms, shapes and
limb records from the new `SkeletonDesc` while keeping control IDs (`<rigId>:<templateKey>`, deterministic), every
keyed curve, and user display overrides (size, colour, visibility). Controls whose bone disappeared are soft-deleted
with their curves kept and a warning. Curves stay valid because control channels are rest-relative and
world-aligned (ADR 0004 D2–D3): moving a knee changes the rest, not the meaning of the keys.

### 7.2 Range-of-motion clip

`skin.test.rom` creates (or refreshes) a non-exported clip `__rom` keyed on controls: arms down / forward / up,
elbows 0–140°, wrists ±60°, spine and neck twist and bend ±40°, legs forward / side / back, knees 0–130°, feet
±30°, fingers curl (if present); 4 frames per pose at 30 fps. Scrubbing it while painting is the deformation test;
`skin.test.bindPose` toggles between the clip and the bind pose (= zero pose).

### 7.3 Painting on the posed mesh

The brush picks against a CPU-skinned copy of the mesh (three.js `SkinnedMesh.applyBoneTransform` per vertex on pose
change, then three-mesh-bvh `refit()`), maps hits to vertex indices and edits bind-pose weights; the GPU shows the
deformation live. Budget: ≤ 4 ms per pointer frame for 10k vertices (partial `skinWeight`/`skinIndex` uploads with
`addUpdateRange`); CPU re-skin + refit only when the pose changes, not per stroke sample.

### 7.4 Skin lints

`skin.unweighted-vertex` (Σ = 0), `skin.influences` (> 4, imports), `skin.weight-sum` (|Σ − 1| > 1e-6),
`skin.unreachable-island`, `skin.stale` (topology hash ≠ mesh), `skin.joint-without-weights` (info),
`skin.cross-side` (a left-side vertex with > 0.5 on a right-side joint, beyond the centre band).

---

## 8. Editing meshes that are skinned (own and imported)

### 8.1 What `MeshData` must provide (contract for the modeling-core note)

- A stable vertex index space per topology version and a topology hash.
- **Per-vertex attribute layers with registered interpolators**, called by every topology operator inside the same
  transaction. The skin layer registers:

| Topology operation | Skin weights of new / changed vertices |
|---|---|
| split edge, insert edge loop, knife, connect | `lerp(w_a, w_b, t)` at the edge parameter `t` (union of influences) |
| subdivide / poke (face centre) | average of the face's corners |
| extrude (faces, edges, vertices), inset, duplicate, separate | copy from the source vertex |
| bevel / chamfer | copy from the original vertex (a vertex-mode bevel lerps along each edge) |
| merge, collapse, weld, target-weld | average of the merged vertices |
| symmetrize / apply mirror | mirrored vertices get mirrored joints (§6.3 joint map) |
| combine two skinned meshes | union palette (same skeleton required; else refuse with `skin.skeleton-mismatch`) |
| delete | drop |
| boolean, remesh, decimate (later; AI cleanup) | closest-point transfer from the pre-op surface (§6.2) |

  Every result is pruned to 4 and normalized. Morph-target deltas (blend shapes, later) use the same rules.
- A mirror vertex map when the symmetry mode is on.

### 8.2 Edit in bind pose

Entering mesh component mode on a skinned mesh shows the **bind pose** (zero pose; animation preview suspended,
timeline position kept); leaving it restores the evaluated pose. Editing on a posed cage (inverse LBS of vertex
deltas) is later. Joint moves are allowed at any time (§6.4).

### 8.3 Imported characters

| Case | MVP | How |
|---|---|---|
| **Re-skin or paint an imported skinned GLB/VRM, topology unchanged** | yes | Read `JOINTS_0`/`WEIGHTS_0` (`JOINTS_1` imports are pruned to 4 with a warning), weld duplicates for editing, write back per original vertex. Export through the **skin surgeon**: the ADR 0005 append-only surgeon plus new `JOINTS_0`/`WEIGHTS_0` accessors per edited primitive and re-pointed `attributes`; new `inverseBindMatrices` when joints moved; new joints appended at the end of `nodes` and `skin.joints` (the parent's `children` array is the only edited original value). The allowed-diff list joins the ADR 0005 preservation invariant. VRM expressions, spring bones, constraints, MToon and meta survive because no index moves |
| **"Make editable"** (`char.makeEditable`): convert an import into a model-sourced character | yes (for GLB and for VRM files whose licence allows modification) | Meshes → `MeshData` (decoded through three's loaders, so Draco/meshopt work), skin → skin blob, skeleton nodes → `JointRecord`s (rest positions from node rest worlds, rest rotations kept as they are, humanoid map kept). **Rebind at rest** when the file's IBMs disagree with its node rest pose (max deviation > 1e-4): skin the mesh with the rest pose, bake positions and normals, set `IBM = (W⁰)⁻¹`. Export then uses the fresh writer (§9), which **drops** VRM data we do not model yet (spring bones, node constraints, MToon, expressions, firstPerson, lookAt) — said in the dialog |
| Topology edits on an imported VRM with everything preserved | later | **Geometry surgeon**: append new POSITION/NORMAL/TEXCOORD/COLOR/JOINTS/WEIGHTS/indices/morph-target accessors and re-point primitives; remove `KHR_draco_mesh_compression` from edited primitives (otherwise loaders decode the old Draco data and ignore ours); keep the morph-target count per mesh (expression binds address target indices) |
| Imported static (unskinned) GLB/OBJ | yes | Load as a model-sourced character directly: the bridge works before our modeling tools exist (§12, ordering) |

Licence gate (D13): VRM 1.0 `meta.modification == 'prohibited'`, or VRM 0.x meta whose licence forbids
modification, disables *Make editable*, the skin surgeon and Apply Pose as Rest for that character, with the reason
shown. Animation-only exports (VRMA, animation GLB) stay available (ADR 0010 §6).

---

## 9. Export

### 9.1 Fresh character writer (model-sourced characters)

A glTF Transform `Document` built from records (the same library as today's VRMA and animation-only writers):

```
scene 0
├─ root                       (identity; name "root")
│  └─ hips → … humanoid and extra joints (names = JointRecord.name; TRS = derived rest locals; scale 1)
└─ <mesh node per mesh>       (identity; mesh + skin 0)
skins[0]   joints = palette order; skeleton = root; inverseBindMatrices = (W⁰_j)⁻¹ float32 MAT4
primitive  POSITION, NORMAL, TEXCOORD_0 (if any), COLOR_0 (if any, non-MToon), JOINTS_0 (uint8 if ≤ 256 joints,
           else uint16), WEIGHTS_0 (float32, renormalized after rounding), indices; one primitive per material;
           no TANGENT (VRM 1.0: "do not export")
materials  KHR_materials_unlit (flat/low-poly look) or PBR metallic 0 / roughness 1; textures embedded as PNG
animations optional: slot-named clips (ADR 0010 vocabulary), sampled as in ADR 0005
asset      generator "Ekza Animator <version>"; extras.ekza_model_v1 (§9.5); extras.ekza.avatar.heightScale if set
```

Rules: deterministic bytes (stable order, sorted keys, no timestamps); every node named and sibling names unique
(Bevy name paths); no `uri` anywhere; one embedded buffer; `extensionsRequired` never set by us (unlit has a
defined PBR fallback). MToon note: "In MToon, vertex colors are ignored" (VRMC_materials_mtoon), so vertex-coloured
low-poly models export as unlit/PBR with `COLOR_0`, or get baked to a palette texture if the user picks MToon.

### 9.2 VRM 1.0 (`.vrm`)

A writer-side `VRMC_vrm` extension class beside the existing `VRMC_vrm_animation` one (root `ExtensionProperty`
with a `RefMap<Node>` for `humanoid.humanBones` and a texture reference for `meta.thumbnailImage`), typed against
`@pixiv/types-vrmc-vrm-1.0` (MIT, 3.5.5, dev dependency).

| Field | Rule (VRMC_vrm 1.0 schema) | Our UI |
|---|---|---|
| `specVersion` | `"1.0"`, required | fixed |
| `humanoid.humanBones` | required; 15 required bones; unique; parent map | from `JointRecord.humanBone` |
| `meta.name`, `meta.authors`, `meta.licenseUrl` | **required**; `licenseUrl` = `https://vrm.dev/licenses/1.0/` | name from the character; authors must be typed (no default) |
| `avatarPermission` | `onlyAuthor` (default) / `onlySeparatelyLicensedPerson` / `everyone` | licence preset |
| `commercialUsage` | `personalNonProfit` (default) / `personalProfit` / `corporation` | licence preset |
| `modification` | `prohibited` (default) / `allowModification` / `allowModificationRedistribution` | licence preset |
| `allowRedistribution`, `creditNotation`, `allowExcessivelyViolentUsage`, `allowExcessivelySexualUsage`, `allowPoliticalOrReligiousUsage`, `allowAntisocialOrHateUsage` | booleans / `required`\|`unnecessary`, restrictive defaults | licence preset + advanced |
| `otherLicenseUrl`, `copyrightInformation`, `contactInformation`, `references`, `thirdPartyLicenses`, `version` | optional | text fields; `thirdPartyLicenses` auto-filled from provenance (imported parts, AI service) |
| `meta.thumbnailImage` | optional; square, 1024 × 1024 preferred, PNG or JPG | rendered from the viewport with the framing helper from `ekza-avatar-renderer` (COPY, research 03 §2.1); the same PNG is the Studio thumbnail |
| `firstPerson`, `lookAt`, `expressions` | optional | later |
| `VRMC_springBone`, `VRMC_node_constraint`, `VRMC_materials_mtoon` | separate extensions | later |

Licence presets in the export dialog (explicit choice required): **Personal** (spec defaults), **Open — CC0**
(`everyone`, `corporation`, `allowModificationRedistribution`, `allowRedistribution: true`, `creditNotation:
unnecessary`, `otherLicenseUrl` = CC0 deed), **Credit — CC BY 4.0** (same with `creditNotation: required`),
**Custom**. Lints: `vrm.meta-required`, `vrm.thumbnail-square`, `skel.tpose` (error), `vrm.*` from ADR 0010.
VRM 1.0 lists `animations` as "unused"; embedded clips are still valid glTF and Ekza Space plays `idle`/`walk`
from them (03 §6.5), so clip embedding stays an option with the ADR 0010 interop warnings.

### 9.3 Plain GLB and OMOBA `humanoid-glb-v1`

| Mode | Content | Who consumes it |
|---|---|---|
| **GLB + VRM humanoid** | the VRM document saved as `.glb` | OMOBA treats it as humanoid (`VRM`/`VRMC_vrm` present) and retargets its own motion library; embedded clips only through operator aliases (03 §5.3) |
| **Plain GLB (game clips)** | no `VRMC_vrm`; embedded `idle, walk, attack, cast, death` (+ any slot) | OMOBA's non-VRM path plays embedded clips by name substring; Bevy, Godot, the open-source DCC |

OMOBA `validate_humanoid_profile` rules we lint locally (`omoba-bevy/passport/src/lib.rs:131`): non-empty `skins`
with valid joint indices; no `uri` in `buffers`/`images`; the five clips present with non-empty channels whose
`target.node` is valid; plus `HumanoidRig` limits (GLB ≤ 50 MiB, JSON ≤ 4 MiB, ≤ 4,096 nodes). Ekza Studio's
avatar upload accepts only VRM (`validate_model` requires VRM `humanBones`, `meshes`, `skins`), so the plain mode
is for local OMOBA testing and other engines, not for Studio.

### 9.4 Validation

| Check | Where |
|---|---|
| Khronos glTF-Validator (already used): 0 errors on fresh writers | CI + export read-back |
| `vrm-validator` (Apache-2.0, npm `2.0.0-dev.3.10`, a fork of glTF-Validator with VRM 1.0 checks; last published 2024-11) | CI dev dependency only; pinned; replaceable |
| Read-back: `skeletonFromGltf(written)` equals `skeletonFromDoc(records)` (fingerprint, humanoid map, radii within 1e-4 H); three-vrm `VRMLoaderPlugin` loads it, `humanoid.getRawBoneNode` for all mapped bones, a VRMA clip plays and the T-pose check passes | Vitest (Node GLTFLoader harness from the test kit) |
| Ekza lints (ADR 0010 table + `skel.*`, `skin.*`, `vrm.meta-required`) | export dialog per profile |
| The open-source DCC's VRM add-on (MIT) and UniVRM import smoke | manual / V1 |

### 9.5 Model metadata

```json
"asset": { "extras": { "ekza_model_v1": {
  "schema": 1, "rig": "vrm-humanoid", "skeletonTemplate": "vrm-humanoid@1.0.0/standard",
  "provenance": { "tool": "ekza-animator", "toolVersion": "<semver>", "projectSha256": "<hex|null>",
                  "derivedFrom": [ { "title": "...", "author": "...", "license": "CC0-1.0", "sourceSha256": "<hex|null>" } ],
                  "generator": { "kind": "manual" | "ai", "service": "<name|null>" } } } } }
```

Same placement and rules as `ekza_animation_v1` (hashed with the bytes, no `uri` key, deterministic). It records
where geometry came from (imported parts, AI services, §11) so registry curation can see it.

---

## 10. Ekza integration

| Tier | Avatar path (this note) | Change needed elsewhere |
|---|---|---|
| **T0** | Export `.vrm` (VRM 1.0) → upload in Studio as an avatar revision (`.vrm`, ≤ 50 MiB, embedded buffers and images, VRM humanoid + meshes + skins). Space (`universal / vrm-humanoid-v1`, VRM 1.0 only) shows it and plays embedded `idle`/`walk`; OMOBA's builder derives `desktop / humanoid-glb-v1` and retargets its own library | none |
| **T3** | "Publish avatar to Ekza": device-code login, `POST /v1/studio/assets { assetKind: 'avatar' }`, `PUT …/source` (the `.vrm`), `PUT …/thumbnail` (the VRM thumbnail PNG), `POST …/submit` (research 03 §7.5 item 7) | the `studio-upload` token scope only — the avatar kind already exists, unlike `ekza:animation` (T1) |

Export profiles: `ekza/space-avatar-v1` becomes exporter-agnostic — surgeon bake for asset-sourced characters, fresh
VRM writer for model-sourced ones, with the same lints. Height: keep authored `extras.ekza.avatar.heightScale`
within 0.5..2 (`ekza.height-scale-range`). The interop banner tells the truth: "Space: idle/walk play; OMOBA: your
avatar is used, its custom clips are not played yet" (ADR 0010 §6).

---

## 11. Hand-off to AI 3D generation (later iteration)

Generated meshes are usually unrigged, dense, non-manifold, arbitrarily scaled, posed and oriented. The bridge
gives them the same path with a cleanup front end:

1. Normalize: scale to a height, ground, rotate to +Z (silhouette or two markers), weld.
2. Optional low-poly reduction: meshoptimizer `simplify` (MIT, 1.3.0) or remesh; repair with manifold-3d
   (Apache-2.0) when booleans or voxel binding need watertight input; weights or UVs re-projected by closest point.
3. Skeleton: Quick Rig markers (§4.3); ML skeleton prediction (UniRig, MIT, Python/GPU) as an optional server-side
   service, never in the browser bundle.
4. Skin: geodesic voxel binding (§5.5) — the method built for polygon soup — or bone heat on the remeshed proxy plus
   transfer back.
5. Vendor auto-rig APIs (Meshy, Tripo) return rigged GLBs with common auto-rigger skeletons; they enter through import +
   humanoid inference (FR-IO-13, M2b) + Make editable. Credits per call vary by vendor and are not verified here.
6. Provenance → `ekza_model_v1.provenance.generator = { kind: 'ai', service }` and the VRM `thirdPartyLicenses`.

---

## 12. Plan: work packages, sizes, acceptance

Sizes are agent-days (ROADMAP convention). Package slugs are proposals for the coordinator's TODO.

| WP | Scope | Size | Depends on | Acceptance (headless unless noted) |
|---|---|---|---|---|
| **S0 contracts** | Records (§3.1), schema v3 + migration (`source.kind = 'asset'`), `ekza.skin.v1` codec, `skeletonFromDoc`, typed-array `measureSkinned`, SkinnedMesh view from records, operator ID stubs, lint codes | 3 | M2a on `dev` | v2 projects open and round-trip; `skeletonFromDoc` of a records copy of Seed-san equals `skeletonFromGltf` (fingerprint, humanoid map, radii within 1e-4 H); codec bytes deterministic |
| **S1 skeleton** | Template presets (§4.1), Joint tool, projected-center snap, symmetry, insert/delete/reparent/map bone, Add chain, Quick Rig wizard (markers, one-click guess), Apply Pose as Rest, `skel.*` lints | 6 | S0 | Fitter on synthesized markers: every joint within 0.03 H on Seed-san and on T-posed Polybot; projected center within 0.01 H of the slab midpoint on synthetic tubes; e2e: Quick Rig on a static low-poly mesh in ≤ 6 clicks |
| **S2 auto-skin** | `closest`, `rigid-islands`, `heat` (BVH visibility, clamped cotan, PCG, per-island fallback), `auto-lowpoly`, post-processing, masks, Worker, adjust-last panel | 5 | S0 (S1 for UI) | Polybot without weights: within one joint ≥ 98%, exact ≥ 85% (calibrate in the first spike); synthetic single-piece box man: no vertex of the forearm on the spine; 10k vertices × 60 joints ≤ 1 s in the Worker; deterministic output |
| **S3 weight tools** | §6.1 normalization, weight table, assign, rigid islands, Paint (Replace/Add/Scale/Smooth/Flood, surface/volume, X-mirror stroke, locks), display modes, Mirror Skin Weights, copy/paste, hammer, transfer, prune/normalize | 7 | S2 | Property tests of §6.1; mirror involution; e2e: paint fixes a seeded bad weight, one undo restores it; stroke ≤ 4 ms per pointer frame at 10k vertices |
| **S4 test loop** | `rig.autoRig.update`, ROM clip, bind-pose toggle, paint on the posed mesh, `skin.*` lints | 3 | S2, S3 (paint) | Moving a knee joint keeps every keyed curve and the walk clip still plants feet with leg IK; ROM clip regenerates idempotently |
| **S5 writers** | Fresh GLB writer, `VRMC_vrm` writer + meta dialog + licence presets + thumbnail, `ekza_model_v1`, OMOBA plain-GLB mode, validators and read-back in CI | 6 | S0, S2 | 0 validator errors; `vrm-validator` 0 errors; read-back equality (§9.4); a VRMA idle plays on the exported VRM in three-vrm; OMOBA rules lint passes with five clips; re-export byte-identical |
| **S6 imports** | Skin surgeon (weights on imported VRM/GLB), Make editable with rebind-at-rest, licence gate, attribute interpolators wired into the modeling core, stale-weights recovery (closest-point transfer) | 6 | S3, S5, modeling core | Seed-san weight edit → surgeon output keeps every original JSON value except the allowed diffs and the BIN prefix byte-identical; Make editable on Polybot (CC0) → re-export loads in three-vrm; Make editable refused on a `modification: prohibited` synthetic VRM |
| **S7 Ekza** | Profile changes, interop banner, T0 docs; T3 "Publish avatar" after the scope decision | 1.5 (+2 for T3) | S5 | `ekza/space-avatar-v1` lints pass on a model-sourced character; a locally run registry `validate_model` accepts the export |
| Later | Geodesic voxel binding; geometry surgeon; edit on posed cage; MToon writer; expressions (morph targets + `VRMC_vrm.expressions`); lookAt; spring bones; gradient/smear tools; curve compensation for Apply Pose as Rest | — | — | — |

Totals: S0–S7 ≈ 37.5 agent-days. The **turnkey minimum** (S0, S1, S2, S3-core = table + assign + paint
Replace/Add/Smooth + mirror + display ≈ 4, S4, S5, S7-T0) ≈ 28 agent-days.

Ordering: S0–S5 do **not** need the modeling tools — they run on imported static meshes and on Polybot with its
weights stripped. Build the bridge in parallel with the modeling core; S6 and the interpolator wiring are the only
joins. A derived fixture `fixtures/models/polybot-unskinned.glb` (CC0, produced by a committed script like the
meshopt fixture) and a synthetic box man generated in tests cover the quality gates.

New e2e scenarios (IDs for the iteration spec): **E2E-SKIN-01** Quick Rig + auto-skin + ROM on the unskinned fixture;
**-02** paint fix with undo; **-03** mirror weights; **-04** joint move after animating keeps the clip; **-05**
VRM export → re-import → VRMA plays; **-06** OMOBA plain GLB with five clips; **-07** skin surgeon on Seed-san;
**-08** the turnkey walkthrough: model (or open a static mesh) → rig → skin → walk with leg IK → export VRM.

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Auto-skin on single-piece organic low-poly is worse than on segmented models | Bone heat with stiffness + rigidify; the editing tools are MVP, not later; fixture metrics on both kinds |
| R2 | Bind pose ≠ node rest pose in imported files (IBMs disagree) | Detect; *Rebind at rest* in Make editable; the skin surgeon writes consistent IBMs |
| R3 | Vertex duplicates at UV/normal seams tear apart when weights differ | Weld for solving, painting and mirroring; write identical weights to all duplicates |
| R4 | A-pose assets fail VRM T-pose expectations (Polybot does) | `skel.tpose` lint, Apply Pose as Rest before animating, warning about shifted clips |
| R5 | Exporting an edited import drops VRM data (spring bones, MToon, expressions) | Skin surgeon for weight-only edits; explicit list of dropped data in the fresh-writer dialog; geometry surgeon later |
| R6 | Licence violations (editing `modification: prohibited` avatars; GPL/LGPL code entering the MIT repo) | D13 gate; implement from papers (Baran & Popović, Dionne & de Lasa), never from the open-source DCC's or Pinocchio's sources |
| R7 | Float32 rounding breaks the weight-sum rule (validator threshold 2e-7 × count) | Renormalize after float32 rounding, push the residual into the largest weight; unit test against the validator |
| R8 | Schema v3 (`CharacterRecord.source`) breaks older apps | `minWriterVersion` bump → older apps open read-only (ADR 0011 §4); migration is pure and idempotent |
| R9 | Bundle size (three-mesh-bvh, solvers) pushes the editor route past its 900 kB gate | Rig workspace code and the skinning Worker load lazily (the M2a M-2 pattern) |
| R10 | Weight blobs grow undo memory on dense meshes | 24 B/vertex; per-stroke snapshots are fine for low-poly; paged blobs (4,096-vertex pages) if dense meshes need it |
| R11 | `vrm-validator` is a young single-maintainer fork (last publish 2024-11) | CI-only, pinned, behind the same report interface as glTF-Validator; read-back through three-vrm is the primary gate |
| R12 | Collaborators editing the same skin | Exclusive `rig` claim for skeleton/skin edits (06 §8.2); the skin blob is one atomic merge unit |

---

## 14. Open questions for the owner

1. **Q-SKIN-1** VRM 1.0 as the native character format, with the T-pose rest enforced for humanoids and A-pose
   modeling handled by Apply Pose as Rest? *Recommendation: yes.*
2. **Q-SKIN-2** Licence gate: refuse Make editable / weight edits on VRMs with `modification: prohibited`, or allow
   with an acknowledgement? *Recommendation: refuse; animation-only exports stay allowed.*
3. **Q-SKIN-3** Default licence preset for creators' own models in the export dialog: none pre-selected (explicit
   choice), or *Open — CC0*? *Recommendation: explicit choice, CC0 listed first.*
4. **Q-SKIN-4** Fixed 4 influences everywhere (WYSIWYG with three.js/Bevy) or 8 internally with export pruning?
   *Recommendation: 4.*
5. **Q-SKIN-5** Should the segmented / rigid look be a first-class style (default `auto-lowpoly` binds islands
   rigidly)? *Recommendation: yes; the stiffness slider covers smooth styles.*
6. **Q-SKIN-6** Ship "Publish avatar to Ekza" (T3, needs only the `studio-upload` scope) before the animation kind
   (T1)? *Recommendation: yes; it is the shortest path to "turnkey".*
7. **Q-SKIN-7** Hand preset default: mitten (Standard) or full fingers? *Recommendation: mitten for low-poly.*
8. **Q-SKIN-8** For AI-generated meshes later: host an ML rigging service (UniRig, MIT, GPU) or rely on vendor
   auto-rig APIs plus our Quick Rig? *Recommendation: Quick Rig + voxel binding first; decide on ML hosting in the
   AI-generation iteration.*

---

## Sources

Specifications (checked 2026-10-18)
- glTF 2.0 specification, Skins (§3.7.3: joints, inverse bind matrices, `JOINTS_n`/`WEIGHTS_n` rules, LBS): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#skins — source: https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc
- VRM 1.0 (`VRMC_vrm`) README (extensions used with it, unused `animations`, tangents): https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/README.md
- VRM 1.0 humanoid (required bones, uniqueness, parent rules): https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md
- VRM T-pose: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/tpose.md
- VRM meta (licence URL, thumbnail rules): https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md
- JSON schemas (`required: [specVersion, meta, humanoid]`; meta `required: [name, authors, licenseUrl]`, enums and defaults): https://github.com/vrm-c/vrm-specification/tree/master/specification/VRMC_vrm-1.0/schema
- VRMC_materials_mtoon 1.0 ("In MToon, vertex colors are ignored"; unlit fallback): https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_materials_mtoon-1.0/README.md

Papers
- Baran, Popović, "Automatic Rigging and Animation of 3D Characters", SIGGRAPH 2007: https://people.csail.mit.edu/ibaran/papers/2007-SIGGRAPH-Pinocchio.pdf ; source release (library LGPL, demo MIT): https://github.com/pmolodo/Pinocchio
- Dionne, de Lasa, "Geodesic Voxel Binding for Production Character Meshes", SCA 2013, DOI 10.1145/2485895.2485919: https://diglib.eg.org/handle/10.2312/15001
- Jacobson, Baran, Popović, Sorkine, "Bounded Biharmonic Weights for Real-Time Deformation", 2011: https://www.cs.toronto.edu/~jacobson/weblog/1784.html
- Sharp, Crane, "A Laplacian for Nonmanifold Triangle Meshes", SGP 2020: https://diglib.eg.org/handle/10.1111/cgf14069 ; geometry-central (MIT): https://github.com/nmwsharp/geometry-central
- UniRig, SIGGRAPH 2025 (MIT): https://github.com/VAST-AI-Research/UniRig

Desktop DCC documentation (vendor help; vendor URLs omitted)
- Bind Skin options (bind methods, normalize modes, max influences default 5, falloff 0.2), 2019 help
- Geodesic Voxel binding, 2017 help
- Paint Skin Weights tool, 2022 help
- Mirror Skin Weights, 2019 help; Surface Association, 2023 help; `copySkinWeights`, 2009 command reference
- Quick Rig, 2026 help; Step-by-Step settings, 2026 help
- Create joints with Snap to Projected Center, 2017 help; Status line, 2026 help

Open-source DCC documentation and source (reference only; GPL; vendor URLs omitted)
- Armature Deform Parent, With Automatic Weights ("bone heat"), 5.2 LTS manual
- Weight Paint tools; options (Auto Normalize, Lock-Relative, Mirror), current manual
- Snapping to Volume, 2.93 manual
- Bone heat implementation (`C_WEIGHT 1.0`, weight limits 0.025/0.05, visibility rays, "failed to find solution"):
  `editors/armature/meshlaplacian.cc` in its source tree (main branch)

Runtimes and libraries
- three.js r186 `GLTFLoader` (`JOINTS_0`/`WEIGHTS_0` only): https://unpkg.com/three@0.186.1/examples/jsm/loaders/GLTFLoader.js ; `SkinnedMesh` (`applyBoneTransform`, `normalizeSkinWeights`): https://unpkg.com/three@0.186.1/src/objects/SkinnedMesh.js
- Bevy `bevy_gltf` 0.19.1 vertex attributes (`Joints(0)`, `Weights(0)`, `Colors(0)`): https://docs.rs/crate/bevy_gltf/0.19.1/source/src/vertex_attributes.rs
- three-mesh-bvh 0.9.16 (MIT): https://github.com/gkjohnson/three-mesh-bvh
- three-vrm 3.5.5 (MIT; loaders only, no exporter) and `@pixiv/types-vrmc-vrm-1.0` 3.5.5: https://github.com/pixiv/three-vrm
- vrm-validator (Apache-2.0, npm 2.0.0-dev.3.10): https://github.com/mrxz/vrm-validator
- VRM add-on for the open-source DCC (MIT, by saturday06 on GitHub; URL omitted) ; UniVRM (MIT): https://github.com/vrm-c/UniVRM
- libigl (MPL-2.0 core, GPL modules): https://github.com/libigl/libigl ; cholesky-solve (MIT, 0.2.1): https://github.com/Erkaman/cholesky-solve
- meshoptimizer 1.3.0 (MIT): https://github.com/zeux/meshoptimizer ; manifold-3d 3.5.4 (Apache-2.0): https://github.com/elalish/manifold
- Marker set of the web auto-rigging service (community forum thread, secondary; URL omitted)
- Meshy API pricing (auto-rigging per-call credits; not verified here): https://docs.meshy.ai/api/pricing ; Tripo API: https://developers.tripo3d.com/

Local evidence (Ekza umbrella checkout, read-only; commits as in research 03 unless noted)
- This repository on `dev` (post-M2a): `packages/io/src/skeleton/{read,radii}.ts`, `packages/rig/src/{types.ts,autorig/autoRig.ts,humanoid/map.ts}`, `packages/doc/src/records.ts`, `fixtures/models/{polybot,seed-san}.vrm` (statistics and the §5.3 experiment computed with throwaway scripts; method described in §1.3 and §5.3)
- `omoba-bevy/passport/src/lib.rs:131` (`validate_humanoid_profile`), `passport/src/humanoid.rs` (limits), `client/src/player/animation.rs:499` (VRM vs embedded clips), `client/src/humanoid/retarget.rs` (`RetargetBasis` from rest worlds) at `0c0585c`
- `ekza-registry/backend/app/services/studio.py:45-115` (`validate_model`: GLB rules, no `uri`, VRM humanBones + meshes + skins) at `90e7850`
