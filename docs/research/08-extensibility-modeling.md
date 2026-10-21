# 08 — Extensibility: scene model, operators, tools, plugins, future modeling

> Research note for Ekza Animator (working name). Date: 2026-10-17. Status: proposal for review.
> Scope: how to structure the core so that the MVP (humanoid animation editing, GLB/glTF/VRM in, GLB/VRMA out)
> can later grow into spline/NURBS modeling, mesh editing, scripting, third-party plugins and real-time
> collaboration **without rewriting the core**. Other research notes own the graph editor UX, file formats,
> rigging math and collaboration transport in depth; this note fixes the *shape* of the core that they plug into.

---

## 0. Decisions in one screen

| # | Decision | Why |
|---|----------|-----|
| D1 | **The document is ours, not three.js.** A flat, normalized record store (`Record<NodeId, NodeRecord>`) with typed node schemas is the single source of truth. three.js objects are a *view* derived from it. | three.js binds animation by node **name** (`PropertyBinding.findNode` matches `name` or `uuid`), names are not unique in glTF, and Object3D trees have no undo, schema, migration or CRDT story. |
| D2 | **Stable, client-generated IDs** (UUIDv7 or nanoid, type-prefixed for debugging) for every node, channel, clip and key. Imported glTF nodes get deterministic IDs and we persist them in `extras.ekza.id` on export. | Undo patches, collaboration, constraints, selection and re-import all need identity that survives renames and reloads. |
| D3 | **Every mutation goes through a transaction** that records forward/inverse patches. Undo/redo is patch replay. Operators never touch the store directly. | One choke point gives undo, change events, dirty propagation, collaboration ops, plugin attribution and macro recording for free. |
| D4 | **Operator registry** (Blender-style `poll / invoke / execute / modal`, JSON-schema args, undo flag) is the *only* way UI surfaces do work: menus, hotkeys, marking/pie menus, command palette, toolbar, scripting, tests, AI agents. Built-in features register through the same registry. | Maya's "everything is a command" and Blender's operators are what make those tools scriptable and customizable; retro-fitting this later is the most expensive rewrite. |
| D5 | **Pure, re-entrant evaluator.** `evaluate(doc, time, out)` with explicit time and output buffer; schedule built from *declared* dependencies; forward (push) evaluation in topological order; fine-grained dirty bits only for expensive caches. | Onion skin, motion trails, baking and two viewports at different times all need evaluation that is not tied to a global "current frame". Maya moved from pull to forward evaluation for exactly this kind of scheduling reason. |
| D6 | **View sync is imperative.** One `SceneView` maps `NodeId → Object3D` and copies evaluated matrices each frame. React (R3F) renders editor chrome, gizmos and structure changes only, never per-frame values. | Avoids React reconciliation on every scrub/drag; loaded glTF scenes are imperative trees anyway. |
| D7 | **Tools are hierarchical state machines** (tldraw `StateNode`-style) scoped per editor; manipulators (gizmos) are separate from tools; tools commit through interactive transactions. | Same pattern serves move/rotate/scale today and CV-draw / pen / sculpt later. |
| D8 | **Selection has components from day one**: `{ node, component? }` where component ∈ key, tangent handle, CV, edit point, (later) vertex/edge/face. Selection is per-user session state, not document state. | Graph-editor keys and tangent handles *are* curve components; the same model later serves CVs and mesh components; per-user selection is mandatory for collaboration. |
| D9 | **Curves are a first-class data type in the MVP**, because Maya-style control circles *are* NURBS curve shapes. Spline modeling later = make those curve shapes editable + add draw tools + add generators. | The owner's favourite controls give us the modeling foundation at near-zero extra cost. |
| D10 | **Editors, importers, exporters, node types, tools, keymaps and menus all have registries** with a common `contribute()` shape. The public plugin API is *those registries*, frozen later. | VS Code / Blender pattern: built-ins are extensions; plugins are not second-class. |
| D11 | **No third-party code plugins in the MVP.** Ship (a) data-only packs (keymaps, control-shape libraries, rig templates, export presets) and (b) trusted local "developer mode" extensions. Design the sandboxed tier (opaque-origin iframe + async RPC + capability manifest; QuickJS-WASM if hard CPU limits are needed) but build it after 1.0 of the core API. | In-process JS cannot be sandboxed; Blender itself states it "cannot prevent third-party add-ons" from violating its rules; Figma's first sandbox (Realms shim) had escapes. |
| D12 | **Project document ≠ export.** The project file keeps full authoring data (controls, constraints, tangents, curves, IDs). GLB/VRMA exports are lossy *targets* chosen by **export profiles** (authoring GLB with an `EKZA_*` extension vs. clean runtime GLB that passes an Ekza registry profile). | Runtime consumers (OMOBA on Bevy 0.19) do not read `KHR_animation_pointer` or curves; authoring data must not leak into game assets. |

---

## 1. What the reference tools teach

### 1.1 Comparison

| Tool | Document model | Commands / undo | Interaction | Extension model & security | Take | Avoid |
|------|----------------|-----------------|-------------|----------------------------|------|-------|
| **Maya** | DAG (transforms + shapes) inside a Dependency Graph of nodes with typed attributes (plugs) and connections; animation = `animCurveTL/TA/TU/TT` nodes connected to attributes; construction history = upstream generator nodes. | Every action is a MEL/Python command; plug-in commands implement `doIt` / `undoIt` / `redoIt` / `isUndoable` and the undo manager keeps undoable instances. | Tools (contexts) + manipulators; marking menus/hotbox; Channel Box shows *keyable* attributes. | C++/Python plug-ins in-process, full trust. | Transform-vs-shape split; keyable flag; construction history; `offsetParentMatrix` (Maya 2020+) to zero controls; Evaluation Manager: build a forward schedule from dirty propagation, then evaluate in order (parallel where independent). | Generic plug-level connection graph for *everything* (too heavy for an MVP); hand-written undo per command. |
| **Blender** | ID data-blocks (Object, Armature, Action, Mesh…); RNA reflection gives every property a path (`pose.bones["arm.L"].rotation_quaternion` + `array_index`); F-Curves address RNA paths; Actions are data-blocks, and since 4.4 "slotted actions" let one Action animate several data-blocks. | Operators: `bl_idname`, `bl_label`, `bl_options` (`REGISTER`, `UNDO`, …), `poll()`, `invoke()`, `execute()`, `modal()`, returning `FINISHED / CANCELLED / RUNNING_MODAL / PASS_THROUGH`; undo is a global memfile/undo-step system around operators. | Modal operators double as tools; keymaps per editor; pie menus; F3 operator search. | Python add-ons / Extensions (4.2+, `blender_manifest.toml` with `permissions = files, network, clipboard, camera, microphone`) — **declarative only**: "Blender cannot prevent third-party add-ons from violating this rule." | Original vs. evaluated data (depsgraph copy-on-evaluation; render engines never touch original data); RNA paths; poll/invoke/execute/modal; Actions as reusable data-blocks. | Full-trust in-process plugins in a web app. |
| **Houdini** | Node networks per context (OBJ/SOP/…); KineFX rigs; **APEX** (Houdini 20+) separates rig *logic* (graphs) from rig *evaluation*; HDAs as shareable units. | Parameter changes + network edits; undo blocks. | Viewer states (Python) for custom interaction. | HDAs/Python, full trust. | "Rig as a graph that is data" is the long-term form of our constraint system; evaluation separated from authoring. | Exposing node networks to animators in an MVP. |
| **Figma** | Scene tree of typed nodes with stable IDs, multiplayer. | Host-owned undo; plugin edits are grouped. | Host tools only. | Plugin logic runs on the main thread **in a minimal JS sandbox without browser APIs**; UI in an `<iframe>`; the two talk by message passing; manifest declares `networkAccess.allowedDomains`, `permissions` (`currentuser`, `activeusers`, `payments`, …). After 2019 Realms-shim escapes, Figma moved to a separate JS engine (QuickJS) compiled to WASM. | Split "document access (sandboxed, no network)" from "UI/network (iframe)"; manifest-declared network allowlist; plugin edits go through host API. | Rolling our own JS-in-JS sandbox. |
| **tldraw** | Flat record store with typed IDs (`shape:…`), parent IDs + fractional indices, schema migrations. | History marks; `bailToMark` style cancel. | Tools are `StateNode` subclasses with child states (`idle → pointing → dragging`) and `onPointerDown/Move/Up` handlers; registering a tool adds it to the state chart, toolbar is separate. | In-process customization only. **Licence: proprietary "tldraw license"; production use needs a licence key** — study, do not depend. | Record store shape, migrations, tool state charts. | Taking it as a dependency. |
| **Excalidraw** | Flat element list. | `Action` objects: `name`, `label`, `perform`, `keyTest`, `predicate`, `PanelComponent`, `checked`, `viewMode`. | — | No third-party plugin system. | Compact action shape (hotkey test + predicate + panel UI on the same object). | `keyTest` functions per action (hard to build a keymap editor from). |
| **VS Code** | Text models. | Commands by string ID. | — | Contribution points (`commands`, `menus`, `keybindings`, `views`) + **when-clause contexts** for enablement; extensions run in a separate extension host process. | Declarative contributions + context keys; built-ins are extensions. | — |
| **Theatre.js** | Sheets → Objects → typed props, keyframes. | Studio-managed. | Sequence editor. | `studio.extend()` adds toolbar buttons and panes; API marked unstable. **`@theatre/studio` is AGPL-3.0**, last npm release 0.7.2 (2024-05). | Typed prop schema driving both UI and animation. | AGPL dependency; stale project. |
| **Spline (spline.design)** | Closed editor; runtime API controls exported scenes via events/variables. | — | Good in-browser modeling UX reference. | No public editor plugin API found. | UX reference only. | — |

### 1.2 Synthesis

1. **Two graphs, not one.** Maya's DAG (hierarchy) + DG (data flow) and Blender's ID tree + depsgraph both separate *what the user edits* from *how it is computed*. We do the same: document records (hierarchy + attributes) and a derived evaluation schedule.
2. **Original vs. evaluated.** Blender's rule "render engines … are never touching original DNA" is the right rule for us: the three.js view, exporters and gizmos read evaluated buffers, never mutate the document.
3. **Commands are the API.** Maya (commands), Blender (operators), VS Code (command IDs), Excalidraw (actions) converge: a registry of named, parameterized, undoable actions that every UI surface calls.
4. **Modal tools are state machines.** Blender modal operators and tldraw StateNodes are the same idea; we take tldraw's explicit hierarchy because it is easier to test.
5. **Plugin trust is the hard part.** Desktop tools accept full trust. Web tools that host third-party code (Figma) isolate it hard. We start with data-only packs and trusted extensions and design the sandbox before opening a marketplace.

---

## 2. Layered architecture

```
                 ┌──────────────────────── Registries (contribution points) ───────────────────────┐
                 │ nodeTypes · operators · tools · editors · menus · keymaps · importers · exporters │
                 │ exportProfiles · controlShapes · evaluators · (later) snapProviders, generators  │
                 └───────────────────────────────────────────────────────────────────────────────────┘
 user input ──► Editors (React) ──► Tools (state machines) ──► Operators ──► Transactions ──► Document store
                    ▲                     │ gizmos                     (patch log, undo,      (records, schemas,
                    │                     ▼                             change events)         migrations)
                    │               SceneView (three.js)  ◄── Evaluated buffers ◄── Evaluator (schedule, caches)
                    └─────────────── subscriptions (per-node versions, not per-frame values) ◄──┘
```

Dependency direction (mirrors the rule in Ekza Space's `src/engine`: engine modules must not import app concerns):

| Package (proposal) | Contains | May import | Must not import |
|---|---|---|---|
| `@ekza-studio/core` | IDs, schemas, record store, transactions, undo, operator/tool/editor registries (headless parts), selection model, property paths | `three/src/math` only (or own math) | React, DOM, WebGL, Next.js |
| `@ekza-studio/anim` | curves, keys, tangents, sampling, Euler filter, bake, key reduction | core | React, WebGL |
| `@ekza-studio/rig` | controls, constraints, IK, control-shape library, eval ops | core, anim | React, WebGL |
| `@ekza-studio/geo` (later) | `CurveData`, NURBS/Bezier math, tessellation, generators, `MeshData` | core | React, WebGL |
| `@ekza-studio/io-gltf` | glTF/GLB/VRM/VRMA import/export via glTF-Transform, extension codecs, export profiles | core, anim, rig, geo | React |
| `@ekza-studio/view-three` | `SceneView`, picking map, gizmos, curve display | core + three | Next.js |
| `@ekza-studio/ui` | editors (viewport, outliner, graph editor, …), layout | everything above, React, R3F | — |
| `apps/web` | Next.js shell, routing, auth, Ekza upload, CSP headers | everything | — |

Rule: `core`, `anim`, `rig`, `geo`, `io-gltf` run in Node under Vitest with no DOM. That is what makes operators testable, bake runnable in a Worker, and a CLI/batch exporter possible.

---

## 3. Scene document model

### 3.1 Principles

- **Flat and normalized.** `nodes: Record<NodeId, NodeRecord>`; hierarchy via `parent: NodeId | null` + `order: string` (fractional index, e.g. `fractional-indexing`, CC0). No nested child arrays (they conflict under collaboration and make patches large).
- **Typed by schema.** Each record has `type` (namespaced, e.g. `ekza.joint`, `acme.springChain`) and `v` (schema version of that type). Attributes are declared, not ad hoc.
- **Assets are referenced, not exploded.** Imported GLB/VRM bytes are an immutable *asset* (content hash). The document holds a `Character` node that references the asset plus `Joint` nodes for animatable bones. Meshes stay inside the asset until modeling exists (then "Make editable" converts). This is Maya's *file reference* idea: re-importing an updated avatar keeps animation, matched by joint name / VRM humanoid bone.
- **Unknown types survive.** A record whose `type` has no registered schema is kept verbatim, shown as "missing extension", and written back unchanged.

### 3.2 IDs

| Kind | Format | Generation |
|---|---|---|
| Node, Clip, Channel | `n_<uuidv7>` / `clip_…` / `ch_…` (prefix for debugging only; never parsed for logic) | client-side on creation (`uuidv7` Apache-2.0 or `nanoid` MIT) |
| Key | `k_<nanoid(10)>` inside a channel | client-side; unique per channel |
| Imported glTF node | `hash(assetHash, nodeIndex, namePath)` → stable across reloads of the same asset | deterministic, so two collaborators importing the same file agree |
| Round-trip | written to `node.extras.ekza.id` on authoring export; read back on import before falling back to the deterministic hash | — |

Trap: glTF node names are optional and not unique; three's `GLTFLoader.createUniqueName()` sanitizes and de-duplicates them, so names coming out of three are **not** the names in the file. Never key anything on three object names.

### 3.3 Record shapes (sketch)

```ts
type NodeId = string & { readonly __brand: 'NodeId' };

interface NodeRecordBase {
  id: NodeId;
  type: string;            // 'ekza.transform' | 'ekza.joint' | 'ekza.control' | ...
  v: number;               // schema version of `type`
  name: string;            // display only, not unique
  parent: NodeId | null;
  order: string;           // fractional index among siblings
  attrs: Record<string, AttrValue>;  // validated against the type schema
  meta?: Record<string, unknown>;    // tool/plugin metadata, namespaced keys
}

type AttrValue =
  | number | boolean | string
  | readonly [number, number, number]            // vec3
  | readonly [number, number, number, number]    // quat (x,y,z,w) or color
  | { ref: NodeId }                              // typed reference
  | { refs: NodeId[] }
  | { blob: string };                            // content hash of binary data (curves/meshes later)

interface ClipRecord {          // a data-block, like a Blender Action
  id: string; name: string; v: number;
  range: [number, number];      // seconds; fps is a display/bake setting, not storage
  channels: Record<string, ChannelRecord>;
  meta?: Record<string, unknown>;
}

interface ChannelRecord {
  id: string;
  target: ChannelTarget;
  keys: KeyBlock;               // SoA typed arrays, replaced copy-on-write per edit
  preInfinity: 'constant' | 'linear' | 'cycle' | 'cycleOffset' | 'oscillate';
  postInfinity: ChannelRecord['preInfinity'];
  locked?: boolean; muted?: boolean;
}

type ChannelTarget =
  | { kind: 'node'; node: NodeId; attr: string; component?: 'x' | 'y' | 'z' | 'w' | number }
  | { kind: 'humanoid'; bone: string /* VRM human bone */; attr: 'rotate' | 'translate'; component?: 'x'|'y'|'z' }
  | { kind: 'expression'; name: string };       // VRM expression weight

interface KeyBlock {           // one scalar curve; tangent model owned by the anim research note
  ids: string[];
  time: Float64Array; value: Float64Array;
  inTan: Float32Array; outTan: Float32Array;   // packed (dx, dy) pairs or slope/weight, per anim note
  flags: Uint8Array;                           // tangent types, broken/unified, weighted
}
```

Channel targets are **scalar** (Maya `rotateX`, Blender `rotation_euler[0]`): that is what the Graph Editor draws and what animators key. Vector attributes are split into component channels.

`kind: 'humanoid'` targets let one clip drive any VRM humanoid (the same idea as `SerializedHumanoidClip` in ekza-avatar-renderer: per-human-bone, rest-relative rotation local to the driven parent). They are what VRMA export and the Ekza shared clip library need. `kind: 'node'` targets are for everything else.

### 3.4 Node types

| Type | MVP | Key attributes | Notes |
|---|---|---|---|
| `ekza.scene` | yes | `fps`, `unit`, `upAxis` (glTF: Y-up, metres) | root; one per document |
| `ekza.transform` | yes | `translate`, `rotate` (Euler), `rotateOrder`, `scale`, `offsetParentMatrix`, `visibility` | groups, nulls |
| `ekza.character` | yes | `asset {blob}`, `humanoid` mapping, `restPose` | references imported GLB/VRM |
| `ekza.joint` | yes | rest TRS (read-only, from asset), `translate`, `rotate`, `rotateOrder`, `scale`, `humanoidBone?` | animatable bone proxy; deterministic ID |
| `ekza.control` | yes | transform attrs + `offsetParentMatrix`, `shape {ref → curveShape}`, `color`, `lockedChannels`, `keyable[]` | Maya-style control; zeroed at bind pose |
| `ekza.curveShape` | yes (display) | `curve: CurveData`, `lineWidth`, `renderable=false` | the circle under a control; becomes modeling curve later (§9) |
| `ekza.constraint.*` | yes: parent, point, orient; later: aim, scale, IK, spline-IK, motion-path | `targets {refs}`, `weights[]`, `offsets[]` (maintain offset), `driven {ref}`, `channels` mask | constraints are nodes, like Maya; they declare eval deps |
| `ekza.camera` | yes | `fov` (deg, vertical), `near`, `far`, `filmFit`, transform attrs | **shot cameras** only; free viewport cameras are per-user view state (§7.4) |
| `ekza.selectionSet` | later | `members {refs}` | Maya quick-select sets / character sets |
| `ekza.animLayer` | later | `mode: additive/override`, `weight`, `mute`, `members` | also a collaboration tool (§10) |
| `ekza.curve` | later | renderable `CurveData` | spline modeling |
| `ekza.mesh` | later | `mesh {blob}` editable `MeshData` | mesh modeling |
| `ekza.generator.*` | later | inputs `{ref}`, params | construction history: sweep, loft, revolve, extrude |
| `ekza.light` | later | glTF `KHR_lights_punctual` mapping | |

### 3.5 Attribute schema

Every node type declares attributes once; the declaration drives the Channel Box, Attribute Editor, validation, serialization, migrations, collaboration encoding and plugin introspection (the role Blender's RNA plays).

```ts
interface AttrDef {
  key: string;                          // 'translate', 'rotate', 'rotateOrder', 'fov'
  type: 'float' | 'int' | 'bool' | 'enum' | 'vec3' | 'euler' | 'quat' | 'color' | 'ref' | 'refs' | 'string' | 'blob';
  default: AttrValue;
  unit?: 'm' | 'deg' | 'rad' | 's' | 'none';
  animatable: boolean;                  // can have channels
  keyable?: boolean;                    // shown in Channel Box & keyed by "Set Key" (Maya distinction)
  min?: number; max?: number; softMin?: number; softMax?: number;
  enumValues?: readonly string[];
  readOnly?: boolean;                   // e.g. joint rest pose
  ui?: { group?: string; label?: string; hidden?: boolean };
}

interface NodeTypeDef<A extends Record<string, AttrDef> = any> {
  type: string; version: number; label: string; icon?: string;
  attrs: A;
  isDag: boolean;                       // participates in transform hierarchy
  migrations?: Array<(rec: unknown) => unknown>;  // v1→v2, v2→v3 …
  evalOps?: (rec: NodeRecordBase, b: EvalBuilder) => void;  // declares ops + deps (§4)
  exporters?: Partial<Record<string, ExportHook>>;
}
```

Rotation decision (needs confirmation with the graph-editor note): **controls and joints store rotation as Euler + `rotateOrder`** in degrees, because animators edit per-axis curves (Maya default). Imported quaternion tracks are converted with an Euler filter (unwrap ±180°) on import; export converts back to quaternions (glTF/VRMA require `rotation` as quaternion). A raw `quat` attribute type remains for data that should not be edited per axis.

### 3.6 Property paths

Grammar (string form used in UI, logs, scripting, plugin API; internally parsed once):

```
path      := nodeRef ':' attr ( '.' component | '[' index ']' )*
nodeRef   := NodeId | '@' humanoidBone | '#' expressionName
examples  := n_018f…:rotate.y      @leftUpperArm:rotate.x      n_02…:weights[3]      #happy
```

Mapping to export/preview targets:

| Our attribute | glTF core channel | `KHR_animation_pointer` | three.js `PropertyBinding` | VRMA |
|---|---|---|---|---|
| `translate` | `node` + `translation` | `/nodes/{i}/translation` | `.position` | hips only ("must not include translations for bones other than the Hips") |
| `rotate` (Euler) | baked → `rotation` (quat) | `/nodes/{i}/rotation` | `.quaternion` | humanoid bone rotation |
| `scale` | `scale` | `/nodes/{i}/scale` | `.scale` | not allowed for humanoid bones |
| `weights[k]` | `weights` (all targets per node) | `/nodes/{i}/weights/{k}` | `.morphTargetInfluences[k]` | via expressions |
| expression weight | — | — | (three-vrm expression manager) | node `translation.x` of the expression node |
| `visibility` | — | `/nodes/{i}/extensions/KHR_node_visibility/visible` (bool, STEP) | `.visible` | — |
| camera `fov` | — | `/cameras/{i}/perspective/yfov` (radians) | `.fov` (degrees) | — |
| material colour | — | `/materials/{i}/pbrMetallicRoughness/baseColorFactor` | `.material.color` | — |
| control / constraint attrs | baked onto joints | — | — | — |
| curve CVs | **none** (no glTF curves) | none | — | — |

Facts that constrain this table (verified 2026-10-17):

- `KHR_animation_pointer` is **ratified**; targets are RFC 6901 JSON pointers; `int`/`bool` targets must use `STEP`; the same property must not be targeted twice in one animation; loaders that do not support it ignore those channels.
- three.js r186 core `GLTFLoader` does **not** implement it; the loader docs point to the external `@needle-tools/three-animation-pointer` (MIT, 1.1.3, peer `three >=0.165`).
- glTF-Transform's extensions package (main branch) has no `KHR_animation_pointer` implementation; we would write a custom `Extension` codec.
- Bevy 0.19 `bevy_gltf` (used by OMOBA) lists `KHR_animation_pointer` as unsupported.

Consequence: **runtime export profiles only emit core TRS/weights channels**; pointer channels are an opt-in for web targets (Ekza Space) and authoring files.

### 3.7 Persistence and migrations

- Project JSON: `{ format: 'ekza-animator', formatVersion, nodes, clips, assets: {hash → uri}, typeVersions: {type → v} }` + binary blobs by content hash (asset GLBs, key blocks, later curve/mesh data). Packaging (zip vs. GLB container with an `EKZA_animator` extension) is for the formats note; the model above works with both.
- On load: for each record, run `migrations[v..current]` of its type; unknown types pass through untouched.
- `formatVersion` migrations (store-level) are separate from per-type migrations (tldraw does the same split).
- Rule for contributors: **no schema change merges without a migration and a fixture test**.

---

## 4. Evaluation pipeline

### 4.1 Stages for one evaluation at time `t`

```
1. Resolve channels     value(node.attr) = base attr ⊕ layers(t)        (anim: curve sampling, infinity modes)
2. Local transforms     L = OPM · T · R(euler, order) · S                (per DAG node)
3. Schedule ops         topological order of declared deps:
                        parent → child world matrices, constraint targets → constrained,
                        IK chain roots → effectors, (later) generators → geometry
4. Write joints         joint local = parentJointWorld⁻¹ · jointWorld    (after constraints)
5. Publish buffers      Float32Array worldMatrices[evalIndex*16], visibility bits, (later) geometry handles
6. View sync            SceneView copies matrices into Object3D (bones, controls, cameras); three skins the mesh
```

Formulas (column vectors, glTF convention):

- World: `W(n) = W(parent(n)) · L(n)`.
- Control local with offset parent matrix: `L = OPM · T · R · S` → a control can sit exactly on a joint while its channels read zero (Maya 2020 `offsetParentMatrix` idiom). "Zero out" operator: `OPM ← OPM · T · R · S; T,R ← 0; S ← 1`.
- Parent constraint, maintain offset: at creation `O = W(target)₀⁻¹ · W(driven)₀`; at eval `W(driven) = W(target) · O`. Multiple targets: blend translations linearly by normalized weights, rotations by weighted quaternion average (nlerp with hemisphere alignment; slerp for 2 targets).
- Writing back to a joint: `L(joint) = W(parentJoint)⁻¹ · W(driven)`, decompose to TRS, then convert R to the joint's Euler with the previous frame as unwrap hint.
- Point/orient constraints: the T or R part only of the above.

### 4.2 Evaluation graph

Ops are finer than nodes (Blender depsgraph "components"): a node may contribute `transform`, `world`, `constraint`, (later) `geometry`, `display` ops.

```ts
interface EvalBuilder {
  op(id: OpKey, run: (ctx: EvalContext) => void, opts?: { timeDependent?: boolean; cost?: 'cheap' | 'expensive' }): void;
  dep(from: OpKey, to: OpKey): void;      // `to` reads what `from` writes
}
type OpKey = `${NodeId}/${'local' | 'world' | 'constraint' | 'geometry' | 'display' | string}`;
```

- Build: each node type's `evalOps` declares ops + deps → Kahn topological sort → **schedule** (array of op indices). Rebuilt only on *structural* changes (node added/removed, reparent, constraint retarget). O(V+E), trivially fast at character scale.
- Cycles: detected during sort; ops in a cycle are evaluated once in arbitrary order and the UI flags them (Maya prints a cycle warning; silently "fixing" cycles hides rig bugs).
- Execute: forward evaluation over the schedule (Maya's Evaluation Manager model — build the schedule once, then evaluate in order; independent ops could later run in parallel or in a Worker).

### 4.3 Dirty propagation (what actually needs it)

At character scale (tens of joints, tens of controls, tens to low hundreds of channels) a full forward pass is cheap — estimated well under 1 ms on desktop (to be measured in the first spike). So the MVP evaluates **the whole schedule** on every time change and every edit, and uses dirty bits only for *expensive derived data*:

| Change | Invalidates |
|---|---|
| time `t` | all `timeDependent` ops (re-run full pass) |
| key edit on channel `c` in `[t0,t1]` | current pose; motion-trail / onion-skin / cached-playback frames in `[t0 − pre, t1 + post]` (pre/post from infinity & tangent span); graph-editor curve tessellation for `c` |
| attribute edit (non-animated) | current pose; all cached frames of that character |
| structural edit | schedule rebuild + all caches |
| (later) curve CV edit | tessellation of that curve, downstream generators' geometry, BVH for picking |

Per-op dirty flags + downstream BFS become worthwhile when generators/mesh evaluation arrive; the op graph above already supports it, so it is a later optimization, not a rewrite.

### 4.4 Re-entrancy rule

```ts
interface EvalContext {
  time: number;
  doc: DocSnapshot;            // immutable view of the document at evaluation start
  out: EvalBuffers;            // caller-provided; never global
  overrides?: TransientOverrides; // live drag preview (§5.2) and remote previews (§10)
}
evaluate(schedule, ctx): void
```

No module-level "current time" or "current pose". This single rule enables: onion skins (evaluate at t±k into side buffers), motion trails, baking (evaluate N frames in a Worker), two viewports showing different times, and headless tests.

### 4.5 View sync

- `SceneView` owns `Map<NodeId, Object3D>` and a reverse `WeakMap<Object3D, PickTarget>` for picking (`{ node, component? }`).
- Structural changes (node added/removed) → create/remove Object3Ds (R3F may render editor-owned helpers declaratively; the character's loaded glTF tree is attached imperatively).
- Per frame (or per evaluation): copy `worldMatrices` into `object.matrixWorld` / bone matrices with `matrixAutoUpdate = false` for driven objects.
- React subscriptions are **per-node version counters** (outliner row re-renders when *that* node's name/parent changes), never the evaluated values.

---

## 5. Transactions, undo, operators

### 5.1 Transactions

```ts
interface Tx {
  create(rec: NodeRecordBase): void;
  delete(id: NodeId): void;
  set(id: NodeId, attr: string, value: AttrValue): void;
  setKeys(clipId: string, channelId: string, keys: KeyBlock): void;   // copy-on-write block
  setMeta(id: NodeId, key: string, value: unknown): void;
}
interface Doc {
  transact<T>(label: string, fn: (tx: Tx) => T, opts?: { origin?: string; mergeKey?: string }): T;
  beginInteractive(label: string): InteractiveTx;   // for drags
}
interface InteractiveTx { update(fn: (tx: Tx) => void): void; commit(): void; cancel(): void; }
```

- Each transaction yields `Patch[]` = `{ op, id, path, before, after }`; undo applies inverses. Hand-rolled patches are simpler and faster than Immer/Mutative here because records are flat and key blocks are typed arrays replaced wholesale.
- **Interactive transactions** (dragging a control, a key, a tangent): updates go to a transient overlay that the evaluator reads (`ctx.overrides`) — no document writes, no undo entries, no collaboration traffic per mouse-move. `commit()` writes one transaction (one undo step); `cancel()` (Esc / right-click) drops the overlay. This mirrors Blender modal cancel and tldraw's bail-to-mark.
- Undo entries carry `meta.selectionBefore/After` so undo restores selection (the Yjs UndoManager offers `stackItem.meta` for exactly this).
- Collaboration: the same `Tx` API is implemented over a Yjs binding later; undo then becomes **per-origin** (Yjs `UndoManager` with `trackedOrigins`) so you never undo a collaborator's work.

### 5.2 Operators

```ts
interface OperatorDef<A = unknown> {
  id: string;                         // 'anim.key.insert', 'rig.control.create', 'curve.cv.insert'
  label: string; description?: string; icon?: string;
  args?: JSONSchema;                  // validated; enables redo panel, scripting, macros, AI tools
  flags?: { undo?: boolean; register?: boolean /* show in log/repeat-last */; internal?: boolean; modal?: boolean };
  poll?(ctx: OpContext): boolean | { ok: false; reason: string };   // reason shown as disabled tooltip
  invoke?(ctx: OpContext, ev?: InputEvent): OpResult;               // interactive entry: gather args / start modal
  execute(ctx: OpContext, args: A): OpResult;                       // deterministic, scriptable
  modal?(ctx: OpContext, ev: InputEvent, state: unknown): OpResult;
}
type OpResult = 'finished' | 'cancelled' | 'running_modal' | 'pass_through';

interface OpContext {
  doc: Doc; time: number;
  selection: SelectionState;          // objects, components, keys (per user)
  editor?: { type: string; instanceId: string };
  tool?: string; user: { id: string };
  run(opId: string, args?: unknown): OpResult;   // composition
}
```

Lifecycle: `poll → invoke (UI) | execute (script) → [modal loop] → commit/cancel`. `execute` wraps itself in one transaction when `flags.undo` is set (Blender's `UNDO` option); operators that call other operators produce one undo step (nested transactions merge).

Naming: `<area>.<object>.<verb>` — `anim.key.insert`, `anim.key.delete`, `anim.tangent.set` (`{type:'auto'|'flat'|'linear'|'stepped'|...}`), `anim.tangent.break`, `anim.tangent.unify`, `anim.bake`, `rig.control.create`, `rig.constraint.parent`, `rig.control.zero`, `view.frame.selected`, `io.export` (`{profile}`), `ekza.upload` (host-owned, always confirms).

Consumers of the registry (all MVP except where noted):

| Surface | Uses |
|---|---|
| Menus / context menus | `menus.contribute({ menu: 'graph.key', op: 'anim.tangent.set', args: {type:'flat'}, group, order, when })` |
| Hotkeys | keymap entries `{ code: 'KeyS', mods: [], op: 'anim.key.insert', context: 'viewport' }` |
| Marking / pie menus (Maya-style) | data layouts of `{ direction: 'N'|'NE'|…, op, args }` |
| Command palette (Blender F3 / Maya Find Menu) | all registered, non-internal operators with `poll` state |
| Channel Box / Attribute Editor buttons | operators with args |
| Operator log (Maya Script Editor echo, Blender Info) | every `register` operator call printed as `ops.run('anim.key.insert', {…})` → copy as macro |
| Scripting console (later) | same `ops.run` API |
| AI agent / MCP bridge (later) | operators with `args` JSON schema map 1:1 to tool definitions |
| Tests | headless `ops.run` against fixture documents |

### 5.3 Keymaps

- Resolution order on keydown: active modal operator/tool keymap → active editor context (`viewport`, `graph`, `dopesheet`, `outliner`…) → global. Contexts are simple predicates for built-ins; VS Code-style `when` strings only when third-party keymaps arrive.
- **Bind by `KeyboardEvent.code` (physical key), not `key`.** With a Russian (ЙЦУКЕН) layout `key` for the W/E/R position is "ц/у/к"; Maya's W/E/R/S muscle memory must work regardless of layout. Show labels via `navigator.keyboard.getLayoutMap()` where available (Chromium-only Keyboard Map API; fall back to Latin labels).
- Presets as data: `maya` (W/E/R move/rotate/scale, S set key, Alt+LMB/MMB/RMB tumble/track/dolly, F frame selected, `,`/`.` prev/next key), `blender`, user overrides on top.
- Browser-reserved shortcuts cannot be captured (e.g. Ctrl/Cmd+W, Ctrl/Cmd+T, Ctrl/Cmd+N); never put essential operators on them. Desktop wrappers (later) lift that limit.

---

## 6. Tools, manipulators and selection

### 6.1 Terms

| Term | Meaning | Example |
|---|---|---|
| **Operator** | a named, undoable action, possibly modal | `anim.key.insert`, `transform.rotate` |
| **Tool** | a persistent interaction mode of one editor; routes pointer/keyboard events; owns a state machine | Viewport Rotate tool, Graph Editor Pen tool |
| **Manipulator (gizmo)** | a drawable handle set bound to the active tool + selection; emits drags to the tool | rotate rings, translate arrows, tangent handles |

### 6.2 Tool state machine

```ts
abstract class ToolState {
  static id: string;
  static children?: () => (typeof ToolState)[];
  static initial?: string;
  onEnter?(info?: unknown): void; onExit?(): void;
  onPointerDown?(e: ToolPointerEvent): void; onPointerMove?(e: ToolPointerEvent): void; onPointerUp?(e: ToolPointerEvent): void;
  onKeyDown?(e: ToolKeyEvent): void; onWheel?(e: ToolWheelEvent): void;
  onCancel?(): void;                   // Esc / right-click during drag
  transition(to: string, info?: unknown): void;
  cursor?(): string;
}

interface ToolDef {
  id: string; editor: 'viewport' | 'graph' | 'dopesheet' | string;
  label: string; icon?: string; hotkey?: KeyBinding;
  root: typeof ToolState;              // e.g. RotateTool → [Idle, Pointing, DraggingRing, DraggingFree]
  manipulator?: React.FC<ManipulatorProps>;   // rendered by the editor for the active tool
  options?: AttrDef[];                 // tool settings panel (e.g. rotate space: world/local/gimbal)
}
```

Event routing inside an editor: active modal operator → active tool's current state → editor default (camera navigation on Alt+drag in viewport, pan/zoom in graph editor) → pass-through. Camera navigation is not a tool (Maya: works under any tool with Alt).

### 6.3 Tool catalog

| Editor | MVP tools | Later |
|---|---|---|
| Viewport | Select (click, marquee, Shift/Ctrl add/toggle), Translate, Rotate (world / local / gimbal axes), Scale, Set-key-on-drag (auto-key toggle) | Curve CV tool, EP tool, Bezier pen, CV/vertex component select & soft-select, snapping, sculpt (much later) |
| Graph Editor | Select keys/tangents (box), Move keys (time/value constrained by drag axis), Scale keys (pivot), Insert key on curve, Tangent handle edit (break/unify, weighted) | Region/lattice tool, curve simplification brush |
| Dope Sheet | Select, Move/scale key blocks, Retime | Clip/time editor tools |
| Timeline | Scrub, range drag, key ticks | Audio scrubbing |

The Graph Editor's key/tangent editing and later 3D Bezier/NURBS editing share one **path-component editing kernel** (§9.3).

### 6.4 Selection model

```ts
type SelectionItem =
  | { node: NodeId }                                                   // object
  | { node: NodeId; component: { kind: 'cv' | 'ep' | 'handleIn' | 'handleOut'; spline: number; index: number } }
  | { node: NodeId; component: { kind: 'vertex' | 'edge' | 'face'; index: number } }   // later
  | { clip: string; channel: string; key: string; part?: 'key' | 'inTan' | 'outTan' };  // graph/dope sheet

interface SelectionState {
  objects: SelectionItem[];         // ordered; last = active (Maya "lead object")
  components: SelectionItem[];      // current component mode
  keys: SelectionItem[];            // graph editor / dope sheet
  mode: 'object' | 'component';
}
```

- Per-user session state; broadcast as presence (collaborators see each other's selection highlight). Not stored in the document; recorded in undo metadata.
- Picking returns `PickTarget`s from `SceneView`'s reverse map; controls are picked by screen-space distance to their curve polyline (thicker hit area than the drawn line), joints optionally hidden from picking (animators pick controls, not bones).

---

## 7. Editors (panels) and layout

### 7.1 Editor registry

```ts
interface EditorDef<S = unknown> {
  id: string;                          // 'viewport', 'graphEditor', …
  title: string; icon?: string;
  component: React.ComponentType<{ instanceId: string; state: S; setState(s: S): void }>;
  defaultState(): S;                   // camera, zoom, filters, pinned channels…
  serialize?(s: S): unknown; deserialize?(v: unknown): S;
  keymapContext: string;               // 'viewport' | 'graph' | …
  tools?: string[];                    // tool ids available in this editor
  multiInstance: boolean;              // two viewports, two graph editors
}
```

Editor view state (camera of a free viewport, graph-editor framing, outliner expansion) is **per-user workspace state**, persisted locally, never in the document.

### 7.2 Catalog

| Editor | MVP | Purpose / notes |
|---|---|---|
| Viewport | yes (×N) | persp + ortho; shot-camera lock; display filters (joints, controls, mesh, x-ray joints) |
| Outliner | yes | DAG tree; drag to reparent → `scene.node.reparent` operator |
| Graph Editor | yes | curves of selected channels; normalize/stack views; tangent tools |
| Dope Sheet | yes (simple) | key ticks per channel/node; retime |
| Timeline / Time Slider | yes | playback, range, key ticks of selection, fps |
| Channel Box | yes | keyable attrs of selection; right-click → key/lock/mute operators |
| Attribute Editor | yes (generated) | all attrs from schema, grouped |
| Operator Log / Script | log in MVP | macro copy; console later |
| Control Picker | later | 2D button layout per character (Maya picker tools) |
| Curve / Modeling tool settings | later | tool options for CV/EP/pen, rebuild, generators |
| Node Editor | maybe never | only if generators/APEX-like rigs need it |

### 7.3 Layout

- Docking via a serializable layout library; **dockview** (MIT, 8.6.0) supports React, floating groups and popout windows; FlexLayout (MIT) is the alternative. Named workspaces: *Animate*, *Graph*, *Rig*, later *Model*.
- Trap: a popout window is a separate document → a viewport there needs **its own WebGL context** (geometry/textures re-uploaded); drei `View` (scissor-split single canvas) cannot span windows. Allow popouts for 2D editors first (graph editor on the second monitor is the common Maya setup); popout viewports later.

### 7.4 Viewports and cameras (the split-screen requirement)

- Multiple viewports in one window share one `<Canvas>` and one evaluated scene via drei `View` (uses `gl.scissor`, views follow tracking divs).
- Two camera kinds:
  - **Shot cameras** — `ekza.camera` document nodes; animatable, exportable, shared with collaborators. The "fixed camera" pane locks to one.
  - **View cameras** — per-viewport, per-user orbit/pan state; never in the document, so two collaborators tumbling do not fight.
- "Look through selected" = assign a shot camera to a viewport instance (editor state), Maya-style.

---

## 8. Plugin API and security

### 8.1 Contribution points

| Point | Shape | Tier allowed (see 8.3) |
|---|---|---|
| `nodeTypes` | `NodeTypeDef` incl. `evalOps` | T2 only (runs inside evaluation) |
| `operators` | `OperatorDef` | T2; T1 via async RPC (no `modal`) |
| `tools` | `ToolDef` | T2 |
| `editors` | `EditorDef` | T2; T1 as sandboxed iframe panel |
| `menus`, `keymaps`, `markingMenus` | data | T0, T1, T2 |
| `importers` / `exporters` / `exportProfiles` | `{ id, extensions, mime, read(bytes)→DocFragment / write(doc, opts)→bytes }` | T2; T1 for pure functions over serialized data |
| `controlShapes` | `CurveData` presets (circle, square, arrow, cube, gear…) | T0 |
| `rigTemplates` / `humanoidMaps` | data (bone name → VRM human bone; control placement) | T0 |
| `themes`, `presets` | data | T0 |
| `snapProviders`, `generators` (later) | functions | T2 |

```ts
export default defineExtension({
  id: 'acme.spring-tools',              // reverse-DNS-ish, globally unique
  version: '1.2.0',
  engines: { 'ekza-animator': '^0.4' },
  tier: 'trusted',                      // 'data' | 'sandboxed' | 'trusted'
  permissions: ['document:read', 'document:write', 'selection:read', 'ui:panel'],
  network: { allowedOrigins: [] },
  activate(ctx) {
    ctx.nodeTypes.register(SpringChainType);
    ctx.operators.register(BakeSpringOp);
    ctx.menus.contribute({ menu: 'rig', op: 'acme.spring.bake', group: 'dynamics' });
    return () => {/* dispose */};
  },
});
```

Built-in features use exactly this (`ekza.core-anim`, `ekza.rig-basic`, `ekza.io-gltf`, `ekza.io-vrm`, `ekza.ekza-upload`). The API is marked `@experimental` until the core reaches 1.0; semver on `engines` thereafter.

### 8.2 Threat model (web specifics)

Assets at risk: unreleased avatar/animation IP in the open project; the user's Ekza session (Studio/Registry upload rights); optional wallet layer; the user's keyboard/clipboard; availability (a busy loop freezes the editor).

Rules independent of tier:
1. Plugins never receive auth tokens, cookies or wallet handles. `ekza.upload` is a host-owned operator that always shows a confirmation with the exact bytes/profile.
2. All plugin writes go through operators/transactions → undoable and attributed (`origin: 'plugin:acme.spring-tools'`) in the operator log.
3. Plugin keymaps never silently override built-ins; conflicts surface in the keymap editor.
4. Missing plugin ⇒ its node types are preserved as opaque records (§3.1), not dropped.

### 8.3 Trust tiers

| Tier | What | Isolation | When |
|---|---|---|---|
| **T0 data packs** | JSON validated by schema: keymaps, marking menus, control shapes, rig templates, humanoid maps, export presets, themes | none needed (no code) | **MVP** |
| **T2 trusted extensions** | npm-style ES modules in-process: built-ins, self-hosted forks, and "developer mode" loading from a local dev server with a persistent warning banner | none (full trust, like Blender add-ons / Maya plug-ins) | **MVP (internal + dev mode only)** |
| **T1 sandboxed plugins** | third-party code from a catalog | opaque-origin iframe (`sandbox="allow-scripts"` without `allow-same-origin`), CSP from manifest (`default-src 'none'`, `connect-src` = declared origins), async RPC over `MessageChannel`, capability-checked host API, watchdog | after core API 1.0 |
| T1+ (optional) | CPU-bounded logic | QuickJS compiled to WASM (`quickjs-emscripten`, MIT, 0.32.0) with interrupt handler, inside the T1 iframe | if catalog plugins need deterministic limits |

Why not the alternatives for T1:

| Option | Verdict |
|---|---|
| In-process `eval`/`Function` with frozen globals | no isolation; prototype pollution, DOM and `fetch` with the user's cookies |
| SES / Hardened JS (`ses`, Apache-2.0, `lockdown()` + `Compartment`) | real in-realm isolation, but `lockdown()` freezes shared intrinsics for the **whole app** and can break libraries that patch prototypes; DoS still possible; reconsider inside the T1 iframe, not in the host realm |
| `ShadowRealm` | TC39 **Stage 2.7** as of the proposal README; not shippable |
| Dedicated Worker from the host | no DOM, can be `terminate()`d, but same-origin: `fetch` to Ekza APIs carries the user's cookies; only safe for host-authored code |
| Sandboxed opaque-origin iframe | cross-origin to the app (no cookies, CORS applies), CSP-limited network, message-only API; DoS mitigated by watchdog + reload; **chosen** |

High-frequency hooks (per-frame evaluation, per-mouse-move tools) cannot cross an async boundary at 60 Hz with acceptable latency, so **evaluation-time node types and interactive tools stay T2**. T1 plugins do batch jobs: generators-as-operators, importers/exporters over bytes, analysis panels, pipeline integrations.

### 8.4 Distribution (later)

The Ekza registry already runs a typed-asset lifecycle (upload → processing → curator publication → hash-pinned renditions; "extending to another kind means adding a typed kind, profile and consumer validator"). Plugins and animation clips could become further typed kinds (e.g. `ekza:animation:<uuid>`, `ekza:plugin:<uuid>`), giving review, hash pinning and revocation without a separate store. Not MVP; record as a direction.

---

## 9. How spline/NURBS modeling fits

### 9.1 Curves arrive before modeling

| Need | Phase | Uses `CurveData` as |
|---|---|---|
| Control shapes (circles, squares, arrows) | MVP | display-only shape under a control transform (Maya `nurbsCurve` shape) |
| Motion paths (object follows curve) | later anim | constraint input |
| Spline IK (spine, tail, tentacle) | later rig | IK solver input |
| Motion trail editing | later anim | evaluated output, editable handles |
| Spline modeling | modeling phase 1 | renderable curve + generators |

### 9.2 Data type

```ts
type SplineKind = 'poly' | 'bezier' | 'nurbs';

interface Spline {
  kind: SplineKind;
  closed: boolean;                 // periodic
  points: Float32Array;            // xyz per CV/anchor (local space of the shape node)
  // bezier only (Blender/Illustrator model): per-anchor handles + handle types
  handlesIn?: Float32Array; handlesOut?: Float32Array; handleTypes?: Uint8Array; // auto, autoClamped, aligned, vector, free
  // nurbs only (Maya model)
  degree?: number;                 // 1..7; 3 typical
  knots?: Float64Array;            // length = points + degree + 1 (open) — validated
  weights?: Float32Array;          // rational NURBS; default 1
}
interface CurveData { splines: Spline[]; v: 1 }
```

- Bezier ↔ NURBS: a cubic Bezier segment is a degree-3 NURBS with knot multiplicity 3 at segment joints; conversions are lossless in that direction and approximate the other way (knot insertion / fitting).
- Evaluation: de Boor (NURBS) and de Casteljau (Bezier); three.js ships `NURBSCurve`, `NURBSSurface`, `NURBSUtils` in addons — usable for display, but `geo` should own its math (testable in Node, no Object3D).
- USD alignment for future export: `UsdGeomBasisCurves` (`type` linear/cubic, `basis` bezier/bspline/catmullRom, `wrap` nonperiodic/periodic/pinned, `curveVertexCounts`) and `UsdGeomNurbsCurves` (order, knots, point weights) map cleanly onto `Spline`.

### 9.3 One editing kernel for graph-editor curves and 3D splines

An animation curve is a 2D Bezier path in (time, value); a 3D spline is a 3D Bezier/NURBS path. Shared kernel: component selection (anchor / in-handle / out-handle), handle-type rules, break/unify, weighted vs. unweighted handles, insert-anchor-on-curve (de Casteljau split), delete-and-refit, flatten, align.

| Concept | Maya graph editor | Blender handles | Kernel |
|---|---|---|---|
| automatic smooth | auto / spline / clamped | auto / auto-clamped | `auto`, `autoClamped` |
| linear | linear | vector | `vector` |
| flat | flat | (aligned, horizontal) | `flat` (curve-only constraint) |
| stepped | stepped | constant interpolation | segment interpolation, not handle type |
| broken / unified | break / unify | free / aligned | `free`, `aligned` |

Animation-specific constraints (monotonic time: handles may not cross neighbouring keys in X) are a 2D-only rule layered on top. Building the graph editor on this kernel is the cheapest single step toward spline modeling.

### 9.4 Modeling tools (later)

CV-curve tool (place CVs, degree 1/3), EP tool (interpolate through points), Bezier pen (click = corner, drag = smooth, Alt = break), edit: insert knot, rebuild (uniform parameterization, n spans), reverse, open/close, attach/detach, project on grid/surface; snapping providers (grid, point, curve). All are T2 tools + operators; no core changes required if §5–§6 exist.

### 9.5 Display

- Screen-space-width lines via three.js `Line2` / `LineSegments2` (addons) — WebGL `gl.lineWidth` is effectively 1 px on most platforms.
- Adaptive tessellation by chord error; CV hull and knot/EP markers in component mode; colour per control (Maya override colours).
- Picking: project tessellated polyline, distance-to-segment in screen pixels (threshold ~6 px), then refine parameter `u` by Newton on the true curve for CV insertion.

### 9.6 Construction history (generators)

`ekza.generator.sweep(profile, path) → MeshData`, `loft(curves[])`, `revolve(curve, axis)`, `extrude(curve, vector)`, `tube(path, radius)`. Generators are document nodes whose `geometry` op depends on input curves' `geometry` ops — this is where per-op dirty propagation (§4.3) starts to matter. "Delete history / Freeze" operator bakes the output into an `ekza.mesh` and removes the generator (Maya semantics).

### 9.7 Export of curves — options

glTF 2.0 has no curve primitive (only point/line/triangle topologies), and no ratified Khronos curve extension exists.

| Option | Preserves parametric data | Loads in three.js / Bevy | Verdict |
|---|---|---|---|
| Tessellated `LINE_STRIP` (mode 3) / `LINES` primitives | no | three: `Line`; Bevy 0.19 `bevy_gltf` maps `LineStrip`/`Lines` topologies | **fallback geometry** inside any curve export |
| Custom vendor extension `EKZA_curves` on nodes: accessor-backed `points`, `knots`, `weights`, handles; plus a `LINE_STRIP` fallback mesh so other viewers show something; listed in `extensionsUsed`, not `extensionsRequired` | yes | needs our GLTFLoader plugin (`parser.register`) and glTF-Transform `Extension` | **authoring/web exports** |
| Adopt `UTSUBO_curve_extension` (community, MIT; Blender exporter + three loader; node-level `splines` with inline JSON points/handles/knots; last commit 2025-10) | yes | three via its loader; Godot importer exists | evaluate for interop; inline JSON points do not scale — prefer accessors, or propose a joint `EXT_` |
| `extras` | partially | ignored | only for small metadata (IDs) |
| Bake to mesh (tube/ribbon/sweep) | no | everywhere | **runtime/game exports** |
| USD `BasisCurves` / `NurbsCurves` | yes | not glTF | later USD exporter |

Vendor prefixes are registered by opening an issue in the KhronosGroup/glTF repository; `EKZA` is not yet registered. Register it before the first public file carrying `EKZA_*` extensions (also needed for an `EKZA_animator` authoring extension and for `extras.ekza` ID conventions to be documented).

### 9.8 Mesh editing (much later) — constraints to remember now

- `MeshData` = n-gon faces + attribute layers in typed arrays, stored as a content-addressed blob; triangulated for display; `three-mesh-bvh` (MIT) for component picking.
- **Do not plan per-vertex CRDT collaboration**: mesh edits are coarse (per-mesh lock or whole-blob last-writer-wins with an operation log for undo).
- Component IDs are indices (Maya does the same); selections are invalidated by topology-changing operators, which must remap or clear them.
- Skinning weights editing (paint weights) belongs here too and is the first "modeling" feature animators will actually ask for.

---

## 10. Collaboration constraints accepted now (so the later feature is cheap)

| Constraint | Where it shows up |
|---|---|
| Client-generated IDs, flat records, fractional ordering | §3 |
| All edits as transaction patches with `origin` | §5.1 |
| Interactive drags are transient overlays; commit on release | §5.1 — remote users receive drag *previews* via presence (ephemeral), and one CRDT write on commit |
| Per-origin undo | §5.1 (Yjs `UndoManager` `trackedOrigins`) |
| Selection, view cameras, editor layout are per-user | §6.4, §7 |
| Key blocks are replaced per channel (channel-level last-writer-wins) | §3.3 — paired with soft locks: a user "holding" a control set is shown to others and their edits to it are refused or warned |
| "Four hands on one character" | assign control subsets (left arm / right arm) as soft-lock scopes, or give each animator an **additive animation layer** (`ekza.animLayer`) and merge — no per-key CRDT needed |
| Large binaries (GLB assets, later meshes) outside the CRDT | content-addressed blob store; the document stores hashes |

---

## 11. MVP must-haves vs. later

### MVP (cheap now, very expensive to retrofit)

1. Flat typed record store, namespaced types, per-type schema versions + migrations, unknown-type preservation.
2. Stable IDs; deterministic import IDs; `extras.ekza.id` round-trip.
3. Transaction/patch layer with undo/redo, interactive transactions, change events.
4. Operator registry with `poll/invoke/execute/modal`, JSON-schema args, operator log; all built-in UI calls operators.
5. Property-path addressing + mapping table to glTF core channels (and pointer channels behind a flag); humanoid channel targets.
6. Pure re-entrant evaluator (explicit time + buffers) with declared-dependency schedule; imperative `SceneView` sync.
7. Tool state machines per editor + manipulators; event routing order; `event.code` keymaps with Maya preset.
8. Selection model with components (keys/tangents now), per-user.
9. Editor registry + docking layout with named workspaces; multi-viewport with shot vs. view cameras.
10. `CurveData` type used for control shapes; shared Bezier editing kernel for the graph editor.
11. Importer/exporter/export-profile registries (authoring GLB vs. runtime GLB vs. VRMA).
12. Headless core packages tested in Node; no React/DOM/WebGL below `view-three`.
13. Data-only extension packs (T0) and internal/dev-mode trusted extensions (T2) using the same `defineExtension` API as built-ins.

### Later

- Sandboxed third-party plugins (T1), plugin catalog via Ekza registry, `when`-clause expressions, plugin panels.
- Scripting console and macro recording; MCP/agent bridge over the operator registry.
- Real-time collaboration binding (Yjs), presence, soft locks, per-user animation layers.
- Per-op dirty propagation, cached playback, Worker evaluation/baking.
- Animation layers, time editor/clips, control picker.
- Renderable curves, curve tools, generators/construction history, `EKZA_curves` export, USD export.
- `MeshData`, mesh tools, weight painting.
- Node editor UI (only if generators or graph rigs demand it).

---

## 12. Traps

1. **Using three.js as the document** (Object3D tree, `AnimationClip`, `AnimationMixer` as source of truth): name-based binding, no undo/schema/IDs; fine only as a preview of exported clips.
2. **Over-building a Maya-style plug/connection DG for the MVP.** Typed node attributes + declared eval deps + typed refs cover constraints; generic connections (drivers, set-driven keys) can be an op type later.
3. **Global current time/pose in the evaluator** — breaks onion skin, trails, bake, multi-view.
4. **React state for per-frame values** — re-render storms while scrubbing/dragging.
5. **Euler/quaternion confusion** — store Euler + order for editable rotations, Euler-filter on import, quaternions only at export; document units (degrees in UI, radians in glTF `yfov`).
6. **Relying on `KHR_animation_pointer` for game assets** — not in three.js core loader (r186), not in glTF-Transform, not in Bevy 0.19.
7. **Authoring data leaking into runtime GLBs** (controls, curve shapes, `EKZA_animator` blobs) — export profiles must strip them; registry profiles have size limits.
8. **Keymaps on `event.key`** — breaks non-Latin layouts; browser-reserved shortcuts cannot be overridden.
9. **Global undo under collaboration** — must be per-origin; drags must not create per-mousemove history.
10. **Fine-grained CRDT for keys or vertices** — memory blow-up; use channel/blob granularity + soft locks.
11. **Dropping unknown plugin data** on save — breaks trust in an open ecosystem.
12. **Licence contamination**: tldraw (proprietary licence, production key required) and `@theatre/studio` (AGPL-3.0, last release 2024-05) — read their designs, do not depend on them.
13. **Treating plugin "permissions" as security** without an isolation boundary (Blender's own docs say they cannot be enforced in-process).
14. **Popout windows with WebGL** — need separate contexts; start with 2D editors.
15. **Peer-range drift with sibling packages**: ekza-avatar-renderer declares `three >=0.137 <0.186` while current three is 0.186.1 — reuse its *ideas* (humanoid rest-relative clip format, retarget conventions) or bump its range in a coordinated release before importing it.

---

## 13. Reuse from existing Ekza code

| Source | Reuse? | What |
|---|---|---|
| ekza-avatar-renderer `humanoidRetarget.ts` / shared clip format | **ideas + possibly code** | per-VRM-human-bone, rest-relative, parent-local rotations; hips translation normalized by hips height; VRM 0.x yaw flip. Directly relevant to `kind: 'humanoid'` channel targets and VRMA export. Its peer range must be bumped for three 0.186 first. |
| ekza-avatar-renderer height/bounds normalization | maybe (viewport framing) | not part of the document model |
| core `src/engine` | **principle only** | dependency-direction rule and host-adapter pattern; its runtime types (player pose, input frames) are game-world concerns, not editor concerns |
| ekza-registry typed assets/profiles | **integration target** | export profiles map to registry profiles; future typed kinds for animations/plugins |

---

## 14. Open questions

1. Licence of Ekza Animator (MIT / Apache-2.0 vs. GPL-style like Blender) — affects whether proprietary plugins are allowed and which dependencies are acceptable.
2. Project container: standalone `.ekzanim` (zip of JSON + blobs) vs. "authoring GLB" carrying an `EKZA_animator` extension (opens in any glTF viewer).
3. Confirm Euler + `rotateOrder` storage for controls/joints (graph-editor note) and the tangent encoding inside `KeyBlock` (anim note).
4. Plain store + later Yjs adapter (recommended) vs. Yjs-native store from day one.
5. Do shot cameras and controls ever ship in runtime exports? (Proposed: no by default; cameras optional.)
6. Register the `EKZA` glTF vendor prefix now, and align or co-author a curve extension with the `UTSUBO_curve_extension` author?
7. Should plugins and animation clips become Ekza registry typed kinds, and who curates them?
8. Is a desktop wrapper (for unrestricted shortcuts, multi-window WebGL, filesystem) in scope after the web MVP?

---

## Sources

- KHR_animation_pointer spec (ratified): https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_animation_pointer/README.md
- glTF vendor prefixes: https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md
- three.js r186 `GLTFLoader` (supported extensions; external KHR_animation_pointer plugin): https://github.com/mrdoob/three.js/blob/r186/examples/jsm/loaders/GLTFLoader.js
- three.js r186 `PropertyBinding` (track-name parsing, `findNode` by name/uuid): https://github.com/mrdoob/three.js/blob/r186/src/animation/PropertyBinding.js
- three.js NURBS addons: https://github.com/mrdoob/three.js/tree/r186/examples/jsm/curves
- Needle three-animation-pointer: https://engine.needle.tools/docs/reference/changelogs/three-animation-pointer — npm `@needle-tools/three-animation-pointer`
- glTF-Transform extensions index: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/extensions/src/index.ts
- Bevy `bevy_gltf` 0.19.1 crate docs (extension support table): https://docs.rs/bevy_gltf/0.19.1/bevy_gltf/
- VRMC_vrm_animation 1.0: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.md
- UTSUBO curve extension: https://github.com/utsuboco/gltf_curve_exporter and https://discourse.threejs.org/t/gltfcurveextension-and-blender-gltf-exporter-curve-extension/67141
- OpenUSD BasisCurves: https://openusd.org/release/api/class_usd_geom_basis_curves.html
- Blender `bpy.types.Operator`: https://docs.blender.org/api/current/bpy.types.Operator.html
- Blender depsgraph design: https://developer.blender.org/docs/features/core/depsgraph/
- Blender extensions manifest & permissions: https://docs.blender.org/manual/en/latest/advanced/extensions/getting_started.html ; add-on online-access policy: https://docs.blender.org/manual/en/latest/advanced/extensions/addons.html
- Blender 4.4 slotted actions: https://devtalk.blender.org/t/blender-4-4-slotted-actions-feedback/38906
- Maya Evaluation Manager: https://help.autodesk.com/cloudhelp/2026/ENU/Maya-Customizing/files/GUID-190D97E7-9AC0-4D67-8A07-1AF3A9DBAF15.htm ; Using Parallel Maya: https://damassets.autodesk.net/content/dam/autodesk/www/html/using-parallel-maya/2025/UsingParallelMaya.html
- Maya `MPxCommand`: https://help.autodesk.com/cloudhelp/2025/ENU/MAYA-API-REF/cpp_ref/class_m_px_command.html
- Maya `animCurve` node: https://help.autodesk.com/cloudhelp/2027/ENU/Maya-Tech-Docs/Nodes/animCurve.html ; transform node (`offsetParentMatrix`): https://help.autodesk.com/cloudhelp/2025/CHS/Maya-Tech-Docs/Nodes/transform.html
- Houdini APEX graphs: https://sidefx.com/docs/houdini/character/kinefx/apexgraphs.html ; KineFX overview: https://sidefx.com/docs/houdini/character/kinefx/overview.html
- Figma how plugins run: https://developers.figma.com/docs/plugins/how-plugins-run/ ; manifest: https://developers.figma.com/docs/plugins/manifest/ ; plugin security update: https://www.figma.com/blog/an-update-on-plugin-security/ ; plugin system design: https://www.figma.com/blog/how-we-built-the-figma-plugin-system/
- tldraw tools: https://tldraw.dev/docs/tools ; tldraw licence: https://github.com/tldraw/tldraw/blob/main/LICENSE.md
- Excalidraw `Action` type: https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/actions/types.ts
- VS Code when-clause contexts: https://code.visualstudio.com/api/references/when-clause-contexts
- Theatre.js extensions: https://www.theatrejs.com/docs/0.5/manual/authoring-extensions
- Spline docs: https://docs.spline.design/basics/what-is-spline
- Yjs UndoManager: https://docs.yjs.dev/api/undo-manager
- ShadowRealm proposal (Stage 2.7): https://github.com/tc39/proposal-shadowrealm
- drei `View`: https://drei.docs.pmnd.rs/portals/view ; dockview popout groups: https://dockview.dev/docs/core/groups/popoutGroups
- npm registry (versions/licences checked 2026-10-17): quickjs-emscripten 0.32.0 MIT, ses 2.3.0 Apache-2.0, tldraw 5.5.2 (tldraw license), @theatre/studio 0.7.2 AGPL-3.0, dockview 8.6.0 MIT, fractional-indexing 4.0.0 CC0-1.0, uuidv7 1.2.1 Apache-2.0, nanoid 6.0.2 MIT, @needle-tools/three-animation-pointer 1.1.3 MIT.
