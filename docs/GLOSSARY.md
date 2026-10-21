# Glossary

Short definitions of terms used across the Ekza Studio docs and code. Maya and Blender names are used
descriptively.

| Term | Meaning |
|---|---|
| **AnimX** | Autodesk's Apache-2.0 C++ library that evaluates animation curves "the same way as Maya". Ported to TypeScript in `anim-core`; the C++ build is the golden-test oracle. |
| **Auto-key** | When on, editing a channel keys it at the current frame. Maya rule: only channels that already have curves; preference "all" keys everything. |
| **Auto-rig** | Generator that creates controls from a skeleton: humanoid FK rig for VRM, 1:1 FK rig for generic skeletons. |
| **Band (time-slider band)** | The frame or range selected on the time slider with Shift+click / Shift+drag; its keys can be moved, scaled, deleted, copied or re-tangented. |
| **Bake** | Evaluating the rig at every frame of a clip and writing per-bone samples (quaternions, translations) for export. |
| **Bind offset (`K_cb`)** | Fixed transform from a control to the bone it drives, derived from the rest pose: `(W_c⁰)⁻¹·W_b⁰`. |
| **Broken / unified tangent** | Unified: in and out handles stay collinear when edited. Broken: they move independently. |
| **Canonical character space** | VRM 1.0 convention used by the rig: +Y up, +Z forward, character's left = +X, metres. VRM 0.x models are rotated by π about Y (`facing`) to match. |
| **Change batch** | The record-level before/after list a transaction (or preview update) emits, with its origin (`local`, `undo`, `remote`, …) and, for field-merge updates, the changed fields. |
| **Channel** | One scalar animatable value of a control: `tx ty tz rx ry rz sx sy sz` or a custom `@attr`. One curve per channel. |
| **Channel Box** | Maya-style panel listing the selected controls' channels with numeric fields and keyed/changed/locked colours. |
| **Claim** | Collaboration (M3): a soft lock announced through presence ("Alice is animating the left arm"). Advisory, never blocks offline users; structural clip operations need an exclusive claim. |
| **Clip** | A named animation of one character (glTF `animation`, Blender action). Owns layers, curves and keys; has its own fps, range, scene start, loop flag, root-motion mode, contact frame, tags and provenance. |
| **Clip frame / scene frame** | Clip frame: time in the clip's own fps (what the ruler and Graph Editor show). Scene frame: the shared clock at the project's scene fps; `clipFrame = (sceneFrame − sceneStart)·clipFps/sceneFps`. |
| **cog** | "Centre of gravity" control: a pure space (translate + rotate) above the pelvis and spine; it drives no bone itself. |
| **Compiled curve** | Typed-array form of a curve (times, values, resolved slopes and handles, segment kinds) built from key records for fast evaluation and drawing. |
| **Conformance suite** | Shared tests (`@ekza-studio/doc/testing`) every `DocumentStore` implementation must pass; the test-only Yjs store runs its replicating part (convergence, invariants, per-user undo) in CI from M1. |
| **Control** | The thing an animator selects and keys (a circle, cube, star, lollipop…). Controls drive bones; bones are never keyed. |
| **Control shape** | The drawn geometry of a control, a `SplineSet` from the control-shape registry (the same type future spline modeling uses). |
| **CRDT** | Conflict-free replicated data type (Yjs) used for real-time collaboration from M3. |
| **D / U / P** | State scopes. **D**ocument: saved, undoable, shared. **U**ser session: selection, current time, view cameras, overrides. **P**references: local per user. |
| **DCC rotate order** | Maya/Blender naming where the first letter is applied first (`xyz` = X first = three.js `'ZYX'`). Stored per control. |
| **DCO** | Developer Certificate of Origin: contributors certify their right to submit code with a `Signed-off-by:` line, checked in CI. |
| **Edit kernel** | The editor-core helpers every writer uses (`applyChannelEdits`, `beginChannelEditGesture`, `moveKeys`, `scaleKeys`, `setKeyHandle`, …), so operators, tools and panels follow identical keying rules. |
| **Editor history** | The undo/redo stack the user sees: document undo entries interleaved with unkeyed override edits (ADR 0013). |
| **Ekza Studio, Ekza Hub** | Ekza Studio is this editor, called **Ekza Animator** until 2026-10-19; Ekza Hub is the publishing site (`ekza-registry/web`), called "Ekza Studio" until then (DECISIONS-OPEN §H). Research notes, work-package notes and decision logs written before the rename keep the old names. Persisted identifiers keep the old name: `ekza-animator-doc`, `ekza-animator-project`, `ekza_animator_bake_v*`, provenance `tool: 'ekza-animator'`, the `ekza-animator:` storage keys and the autosave database. |
| **Euler filter** | Removes ±360° jumps and gimbal-equivalent flips in Euler curves by choosing, key by key, the nearest of the two equivalent angle triples. |
| **`eulerNear`** | Converts a quaternion to Euler angles in a given rotate order closest to reference angles (usually the control's current values), so keys never flip. |
| **Export profile** | Data describing an export target (registry platform/profile, size limits, required clips, lint severities), e.g. `ekza/space-avatar-v1`. |
| **Facing** | Quaternion from a model's own space to canonical character space; identity for VRM 1.0 and glTF, a π yaw for VRM 0.x. |
| **fk.hips** | The pelvis control under `cog`; rotates the hips bone without swinging the spine; the legs hang under it. |
| **Fixed tangent** | A handle the user edited (or the insert operation froze); never recomputed. Every other tangent type is computed from neighbouring keys. |
| **Gimbal lock / Gimbal mode** | Loss of a rotational degree of freedom when the middle Euler axis reaches ±90°. Gimbal mode draws the real Euler axes for the rotate order; dragging one ring changes exactly one channel. |
| **Infinity (pre/post)** | How a curve continues before its first and after its last key: constant, linear, cycle, cycle with offset, oscillate. |
| **Key** | One keyframe record: time (frames), value, tangent types and handles. One record per key. |
| **Layer** | Animation layer of a clip. The MVP has exactly one base layer; additive/override layers come in V2. |
| **Locked shot camera** | A shot camera whose `locked` flag prevents navigation from every pane; the left pane of the split layout. |
| **M1-stretch** | MVP items built only if time remains (plateau tangents, mesh-click picking, Space-hold radial, …); their tests are `test.fixme` until done. |
| **Merge unit** | The unit of last-writer-wins merge and of compare-before-restore undo: whole record for keys and assets, top-level field for every other table. |
| **Normalized humanoid space / `N_b`** | three-vrm/VRMA convention: a rest-relative, world-aligned local rotation per humanoid bone, portable across avatars. Computed from bone world deltas: `N_b = D_parent⁻¹·D_b`. three-vrm's normalized space for VRM 0.x faces −Z, so it sees `flipYaw(N_b)`. |
| **Offset group / zero group (`O_c`)** | Transform between a control's parent and its rest placement, so the control's channels read zero at rest (Maya offset group / `offsetParentMatrix`). |
| **Operator** | A named, parameterized, optionally undoable action (`key.set`, `graph.tangent.set`) with an async `prepare` and a synchronous `apply`. Every UI surface, hotkey and test calls operators. |
| **Override (pose override)** | Session-only (U) channel value on a keyed channel edited with auto-key off; discarded on frame change, undoable through the editor history, turned into keys by `S`. |
| **P0–P3** | Collaboration phases of research 06 (local, sync, Ekza auth, per-user layers). Not to be confused with Ekza tiers T0–T3. |
| **Pane** | One camera view inside the Viewport panel (single, split or quad layout). All panes share one WebGL canvas. |
| **Partition** | Group of records that becomes one CRDT document: `scene`, `char:<id>` (rig, controls, clip metadata), `clip:<id>` (layers, curves, keys). Opened and closed through the store's lifecycle. |
| **Pin Feet / Plant Feet** | M1 aid for FK legs: Pin stores the foot bone worlds; Plant re-solves the legs with a two-bone IK solve so the feet return to the pins, writing FK keys. |
| **Plugin trust levels** | data (packs, no code), trusted (in-process dev-mode extensions), sandboxed (opaque-origin iframe plugins). Not to be confused with Ekza tiers. |
| **Pose buffers** | Typed-array output of the rig kernel: bone locals/worlds, control worlds, normalized humanoid rotations, hips position. |
| **Preview session** | Temporary overlay of document writes during a drag; committed as one transaction (one undo step, or none with `undoable: false`) or cancelled. |
| **Provenance** | Per-clip record of where its motion came from (`derivedFrom`: title, author, licence, source hash) and whether it may be redistributed. |
| **Raw bones / raw nodes** | The glTF nodes as stored in the file, with their own (possibly non-identity) rest rotations. Embedded clips target raw nodes. |
| **Rest pose** | The skeleton's pose in the file (VRM: T-pose). Zero channel values reproduce it exactly. |
| **Rig program** | Compiled, topologically sorted schedule of ops (control world, constraint slot, solver slot, bind bone, bone local) over typed arrays. |
| **Root** | Floor-level placement control above `cog`; folded into hips motion on export. |
| **Root motion mode** | `hips`: travel stays in hips translation. `in-place`: hips X/Z locked to rest (in canonical space). |
| **Secondary control** | Auto-generated control for a non-humanoid joint (hat, tail), hidden by default. Spring-bone joints and node-constraint destinations get none. |
| **Shot camera / view camera** | Shot camera: a document camera, shared, lockable. View camera: a pane's personal persp/top/front/side camera, never in the document. |
| **SkeletonDesc** | Pure-data description of a model's node hierarchy, rest transforms, humanoid map, spring joints, node constraints, bone radii, height and facing, extracted from glTF JSON and BIN. |
| **Slot** | Ekza clip vocabulary name (`idle`, `walk`, `attack`, `cast`, `death`, `wave`, …) used as the exported animation name. |
| **Spring bones** | VRM physics chains (hair, cloth) simulated at runtime; preview only, never baked. |
| **Static value** | Maya's static attribute value: the value of a channel that has no keys (stored on the curve record, per clip). |
| **Structural clip operation** | An edit that rewrites many key records (fps change, rotate-order change); needs an exclusive claim once collaboration exists. |
| **Surgeon** | The append-only GLB patcher: adds animations to the original file without moving any existing JSON index or BIN byte, so VRM data, materials and compression survive; its marker allows a safe rollback on re-bake. |
| **Template key** | Deterministic name of an auto-rig control (`fk.upperArm.L`); part of the control ID and the key for pasting poses across characters. |
| **Tier 0–3 (T0–T3)** | Ekza integration levels only: T0 compatible exports (MVP), T1 typed animation assets, T2 avatar animation sets, T3 one-click publish. |
| **Transaction** | A group of document writes applied atomically, emitting one change batch and (for local origin) one undo entry; nested transactions join the outer one. |
| **VRM 0.x / 1.0** | Humanoid avatar formats on glTF. 0.x faces −Z with the `VRM` extension; 1.0 faces +Z with `VRMC_vrm`. |
| **VRMA** | VRM Animation (`VRMC_vrm_animation`): a glTF file with only humanoid animation, retargetable to any VRM. One clip per file. |
| **VRMC_node_constraint** | VRM 1.0 runtime constraints (roll, aim, rotation) such as Seed-san's robot arm; evaluated in the preview, never baked into VRM outputs. |
| **Weighted tangent** | Handle whose length matters (Bézier segment in time and value); non-weighted handles only define a slope. |
