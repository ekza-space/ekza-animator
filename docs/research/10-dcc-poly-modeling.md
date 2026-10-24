# 10 · Desktop-DCC polygon modeling for low-poly assets and characters → Ekza feature map

> Research note · 2026-10-18 · input for the modeling iteration that replaces and expands ROADMAP M6.
> Scope: how a leading commercial desktop DCC (below: **the desktop DCC**) does polygonal box modeling, judged for
> **low-poly game assets and characters that will be rigged and animated**: modes, selection, the Modeling Tools panel,
> every core topology tool, normals, snapping, pivots, history, cleanup and the HUD. For each feature: what it does,
> what it is worth for low-poly, a priority (BASE / NEXT / LATER), the desktop DCC's hotkey and a browser-safe Ekza
> binding, plus the precise geometric behaviour an implementer needs (§4). A popular open-source DCC (below: **the
> open-source DCC**) is cited where it does something better or where its desktop-DCC-style keymap is evidence for a
> binding.
> Reference versions: the desktop DCC's 2027 release (March 2026; 2027.1 in May 2026) and its 2026 help; older help
> pages (2015–2017) are cited where the current page carries the same text or the current page is incomplete. The
> open-source DCC: 5.2 LTS. Reference products are named generically; Ekza is not affiliated with any DCC vendor.

---

## 0. TL;DR (decisions this note recommends)

1. **The desktop DCC's interaction model is the base; the open-source DCC contributes three ideas.** Keep the
   desktop DCC's component modes, right-click marking menus (RMB = modes, Shift+RMB = tools, Ctrl+RMB = convert),
   Ctrl+E extrude, smart extrude (Shift+drag a manipulator), double-click loops, `B` soft selection, `>`/`<`
   grow/shrink, `D` pivot, `G` repeat and the Multi-Cut gestures. This continues the `dcc` keymap preset the
   animation side already ships, and it matches the owner's muscle memory. Evidence that this costs open-source-DCC
   users little: the open-source DCC's own *Industry Compatible* keymap (5.2 LTS) is desktop-DCC-flavoured for
   modeling (`1`–`3` selection modes, `Ctrl+E` extrude, `Ctrl+B` bevel, double-click loop, `B` soft selection,
   `Ctrl+D`, `P`) (open-source DCC manual: Industry Compatible keymap).
   Take from the open-source DCC: **Adjust Last Operation** instead of construction history, **modal numeric
   entry** inside tools, and a **live mirror** preview. An alternative keymap preset (open-source-DCC style) is a
   later data pack, not a fork of the UX.
2. **Scope is polygonal box modeling for low poly**: n-gons allowed, quads where the mesh deforms. No NURBS
   surfaces, no sculpting, no subdivision-surface workflow in BASE (Smooth Mesh Preview is LATER), booleans
   LATER and optional.
3. **No construction history.** The desktop DCC's history is what powers its In-View Editor and Channels panel
   INPUTS; the vendor help says the extrude manipulator (Show Manipulator Tool) appears only when Construction
   History is on.
   We replace it with (a) live primitive parameters until the first topology edit, (b) an Adjust-Last-Operation
   panel generated from operator arg schemas, (c) `G` = repeat last operator, and (d) history only for the
   curve-driven generators of note 08 §9.6. Reasons in §5.
4. **Every topology operator is a pure function** `(mesh, selection, args) → (mesh′, selection′, provenance)`.
   `selection′` keeps the desktop DCC's chaining (extrude → extrude again); `provenance` (which old elements each
   new vertex/corner came from, with weights) drives **attribute propagation for UVs, colours, skin weights and morph
   deltas**. That is the bridge to animation: editing a skinned VRM or a rigged model must not break skinning or
   expressions, which is exactly where the desktop DCC needs "Delete Non-Deformer History".
5. **BASE = 65 rows of the §3 matrix** (the six primitives count separately): object/component modes, the
   three marking menus, click/marquee/loop/ring/grow/shrink/convert/border/shell, camera-based selection,
   volume soft selection, Object/World symmetry, six
   primitives with low-poly defaults, component W/E/R with normal orientation, smart extrude, grid/vertex snap,
   pivot edit, Extrude (faces, border edges), Bevel (edges), Bridge, Fill Hole, Multi-Cut, Insert Edge Loop,
   Connect, Target Weld, Merge, Merge to Center, Collapse, Delete Edge/Vertex, Spin/Flip Edge, Combine, Separate,
   Extract, Mirror, Triangulate, Soften/Harden, Reverse/Conform normals, Cleanup lints, Freeze/Reset transforms,
   Center Pivot, Duplicate, poly-count HUD with profile budgets, Toolkit panel, Adjust Last Operation, `G`.
6. **Browser keymap reality**: the desktop DCC's `F11` (face mode) is browser full screen, `F12` (UV mode) is dev
   tools, `Ctrl+Tab` (multi-component) switches tabs. The **RMB marking menu is the primary mode switch** (it is in
   the desktop DCC too); `F8`/`F9`/`F10` stay; digits `1`/`2`/`3` are added for vertex/edge/face (as in the
   open-source DCC's Industry Compatible keymap; laptop-safe). `Ctrl+E` is Export in Ekza today; §6.3 resolves it.
7. **Low-poly specifics the tool must make easy**: a triangle counter against the export profile's budget, one
   deterministic triangulation shared by the viewport and the exporter, hard edges and an auto-smooth angle,
   Spin Edge to control triangulation, symmetry plus Mirror, lints for non-planar/concave n-gons, lamina and
   non-manifold geometry, and primitives whose defaults are low poly (the desktop DCC's default sphere is 760
   triangles).
8. **BASE acceptance** (§7): a tester builds a symmetric low-poly humanoid (≤ 2,000 triangles) from a cube using
   only BASE tools; the mesh is closed, manifold and consistently wound; the GLB passes glTF-Validator and loads
   in three.js and Bevy 0.19; the scripted version of the same build runs as an e2e scenario through operators.

---

## 1. Legend

| Tag | Meaning |
|---|---|
| **BASE** | First modeling iteration: enough to box-model a low-poly prop or character end to end |
| **NEXT** | Second iteration: speed and comfort tools, AI-mesh cleanup (decimate), live mirror |
| **LATER** | Large or niche: subdivision preview, UV editor, booleans, retopology, topology symmetry |

Key columns: **DCC** = the desktop DCC's default (help pages listed in §Sources; † = widely used convention not
re-verified against a current official table). **Ekza** = proposed binding; **M** = same as the desktop DCC, **E** =
Ekza addition, **—** = menus only (as in the desktop DCC). Browser column (§6): ✓ safe · ⚠ needs `preventDefault`
and QA per browser · ✗ unavailable to web pages.

---

## 2. Desktop DCC vs open-source DCC: what to copy from each

| Aspect | Desktop DCC | Open-source DCC | Ekza choice |
|---|---|---|---|
| Mode switch | RMB marking menu on the mesh, `F8` object/component, `F9`–`F12` vertex/edge/face/UV, `Alt+F9` vertex-face, `F7`/`Ctrl+Tab` multi-component (vendor help: Select menu, modeling-tools hotkeys) | `Tab` edit mode, `1`/`2`/`3`; Industry Compatible: `1`–`3` modes, `4` object | RMB menu (primary) + `F8`/`F9`/`F10` + `1`/`2`/`3` |
| Tool model | Persistent tools picked from Shift+RMB / Modeling Tools, then clicked on the mesh (Multi-Cut, Target Weld, Quad Draw) | Modal operators started by a key, finished by a mouse move + click or typed number | Both: tools are state machines (note 08 D7); modal commands accept typed numbers (`Tab` into the field, `Enter` commits) |
| After-the-fact tweak | In-View Editor / Channels panel INPUTS on the history node | **Adjust Last Operation** panel, `F9` (open-source DCC manual: Undo & Redo) | Adjust Last Operation (no history) |
| Extrude | `Ctrl+E` + manipulator with in-view fields; **smart extrude**: `Shift`+drag the Move/Rotate/Scale manipulator (vendor help) | `E` then move | Both desktop-DCC gestures; numeric entry while dragging |
| Symmetry | Selection-based symmetry modes (Object/World X/Y/Z, Topology), Mirror command, "Instance" mirror | Mirror modifier (live, with clipping) and mesh symmetry options | Desktop-DCC symmetry + Mirror in BASE; live mirror (instance preview) NEXT |
| Loops | Multi-Cut `Ctrl`-click, Insert Edge Loop tool, double-click to select | Loop Cut and Slide, `Alt`+click to select | Desktop-DCC gestures |
| Merge | Target Weld drag, Merge, Merge to Center, Collapse | `M` merge menu | Desktop-DCC tools + `M`-hold merge marking menu (E) |
| History | Construction history on by default; "Delete by Type › History" to bake (vendor help) | None for mesh edits; modifiers for live ops | None (§5); live primitives; generators only for curves |

The owner's question "the desktop DCC, or maybe the open-source DCC?" therefore resolves to: the desktop DCC for
*where things are and which keys do them* (continuity with the animation side, owner's habits); the open-source DCC
for *what happens after an operation* (adjust last, typed values, live mirror). Neither choice costs extra
architecture: both sit on the operator and tool registries that already exist (ADR 0008).

---

## 3. Feature matrix

### 3.1 Modes and menus

| Feature | What it does in the desktop DCC | Low-poly value | Pri | DCC | Ekza |
|---|---|---|---|---|---|
| Object / component toggle | Switches between object and last-used component mode | Core | BASE | `F8` | `F8` (M) + RMB "Object Mode" |
| Vertex / edge / face mode | Component selection type | Core | BASE | `F9` / `F10` / `F11` | `F9`/`F10` (M), `1`/`2`/`3` (E), RMB menu |
| UV mode | UV components | Needed only with a UV editor | LATER | `F12` | RMB menu only |
| Vertex-face mode | Per-face-per-vertex components (split normals, colours) | Niche | LATER | `Alt+F9` | RMB menu only |
| Multi-component | Vertices, edges and faces at once; marquee picks by what is selected, priority vertex → edge → face (vendor help) | Convenience | NEXT | `F7` / `Ctrl+Tab` | RMB "Multi" |
| RMB marking menu | On a mesh: component modes in the upper half, selection and material items below (vendor help: Marking menus) | Primary mode switch | BASE | RMB | RMB (§6.2) |
| Shift+RMB marking menu | Context tools: nothing selected → primitives; object → mesh tools; vertex/edge/face → tools for that type (same page) | Primary tool access | BASE | `Shift`+RMB | same (§6.2) |
| Ctrl+RMB marking menu | Convert selection (+ Contiguous Edges, perimeters) (vendor help) | Fast conversions | BASE | `Ctrl`+RMB | same |
| Ctrl+Shift+RMB | Settings of the active tool: smart extrude, preserve UVs, tweak mode, symmetry, soft select; Insert Edge Loop options (vendor help: Marking menus, Insert Edge Loop) | Tool options without a panel | NEXT | `Ctrl+Shift`+RMB | same |
| Modeling Tools | Docked panel: selection modes, symmetry, soft select, pick styles, tool buttons with their options | Discoverability | BASE | panel | "Toolkit" panel in the Model workspace |
| Tweak mode | Click-drag an unselected component moves it at once | Fast vertex pushing | BASE (v0.2) | `` ` `` | `` ` `` (M), Move tool option, off by default. *Corrected: MMB-drag does **not** already move the selection in the shipped viewport (plain MMB runs the Channels panel virtual slider when channels are selected and does nothing otherwise); the desktop DCC's "middle drag anywhere … to move" is added in M6a B12a (MODELING-PLAN v0.2 §3.7)* |

### 3.2 Selection

| Feature | What it does in the desktop DCC | Low-poly value | Pri | DCC | Ekza |
|---|---|---|---|---|---|
| Click / marquee | Shift toggles, Ctrl removes, Ctrl+Shift adds; Marquee or Drag style (vendor help: Select Tool) | Core | BASE | LMB | same as note 09 §6.1 |
| Preselection highlight | Highlights the nearest component under the cursor (on by default in the Toolkit) | Precision on dense areas | BASE | — | hover highlight |
| Camera-based selection | Only components not hidden from the camera; automatic in shaded, off in wireframe/X-ray | Marquee without grabbing the back side | BASE | option | on in shaded, off in X-ray (`Alt+X`) |
| Edge loop | Double-click an edge: loop both ways, stops at non-quads (vendor help) | Core | BASE | double-click | M |
| Partial loop | Select an edge, `Shift`+double-click a later edge on the same loop | Core | BASE | `Shift`+double-click | M |
| Edge ring | Select an edge, `Shift`+double-click a parallel edge in its ring (vendor help) | Core (ring → Connect = loop) | BASE | `Shift`+double-click | M (relation of the two edges decides loop vs ring) |
| Face loop | Faces along a quad strip | Limbs, belts | BASE | `Shift`+double-click adjacent face † | M† |
| Grow / shrink | Expand / contract the region | Core | BASE | `Shift+.` / `Shift+,` (`>` / `<`) | M |
| Convert selection | To vertices/edges/faces/UVs, perimeter, contained, edge loop/ring | Core | BASE | `Ctrl+F9`–`Ctrl+F12`, Ctrl+RMB (vendor help: Modeling hotkeys) | Ctrl+RMB, `Ctrl+F9`/`Ctrl+F10` ⚠ |
| Border edges | Select open-boundary edges | Fill Hole, Bridge, Mirror seams | BASE | menu | Ctrl+RMB |
| Shell | Select the connected piece | Combined meshes | BASE | menu | Ctrl+RMB; double-click a face in face mode (E†) |
| Select all / invert / none | | | BASE | `Ctrl+Shift+A` / `Ctrl+Shift+I` / `Alt+D` | `Ctrl+A` (E); invert and none via menu, click on empty space (`Ctrl+Shift+I`, `Alt+D` ✗ browser) |
| Pick-walk components | Arrow keys walk along loops and rings | Comfort | NEXT | arrows | arrows (already pick-walk controls) |
| Shortest edge path | Path of edges between picked vertices | Seams, cuts | NEXT | tool | tool |
| Lasso / paint select | Freeform and brush selection | Comfort | NEXT | `Q`-hold menu | `Q`-hold menu |
| Select similar / constraints | By size, sides, angle… | Lint-driven selection covers BASE | LATER | menu | via Cleanup "select matching" |

### 3.3 Soft selection and symmetry

| Feature | What it does in the desktop DCC | Low-poly value | Pri | DCC | Ekza |
|---|---|---|---|---|---|
| Soft selection | Falloff around the selection: **Volume** (sphere), **Surface** (follows the mesh), Global, Object; curve with Smooth interpolation by default (vendor help: Select Tool) | Shaping heads, terrain, bellies without per-vertex pushing | BASE (Volume) / NEXT (Surface) | `B`; `B`+drag radius, `B`+MMB-drag absolute | `B`, `B`+LMB-drag (M) |
| Symmetry modes | Off (default), Object X/Y/Z, World X/Y/Z, Topology; MMB on the status-line button toggles last mode | Characters, vehicles | BASE (Object/World) / LATER (Topology) | status line | status line + Toolkit (no default key, as in the desktop DCC) |
| Symmetry tolerance | How close a mirror partner must be; ignored while soft selection is on; keep it a small fraction of vertex spacing (e.g. 0.001 for 0.1 spacing) | Robust pairing | BASE | option | option, default **0.001 m** (in metres, shown in scene units; *revised in MODELING-PLAN v0.2 §3.14, was 0.001 × bbox diagonal*) |
| Preserve seam | Seam vertices cannot leave the plane, may slide along it; Seam tolerance + falloff | Keeps the centre line closed | BASE | option | on by default |
| Topology symmetry | Pairs components by connectivity from a picked seam edge; works on posed meshes; partial symmetry allowed (vendor help) | Editing posed or skinned avatars | LATER | option | — |
| Flip / Symmetrize | Swap with mirror partners / move components to the mirrored position (vendor help: Edit Mesh) | Repair drift between halves | NEXT | menu | menu |

### 3.4 Primitives

The desktop DCC's command defaults, from its 2026 command reference: cube 1×1×1, 1×1×1 subdivisions; sphere radius
0.5, 20×20; cylinder radius 1, height 2, 20 axis × 1 height, 0 cap subdivisions (n-gon caps); cone radius 1, height 2,
20 × 1, 0 caps; plane 1×1, 10 width subdivisions (10 height †); torus radius 1, section 0.5, 20×20
(vendor command reference: `polyCube`, `polySphere`, `polyCylinder`, `polyCone`, `polyPlane`, `polyTorus`).

| Primitive | Desktop-DCC default → triangles | Ekza low-poly default → triangles | Pri |
|---|---|---|---|
| Cube | 1 subdiv → 12 | same → 12 | BASE |
| Sphere (UV) | 20×20 → 760 | 12 axis × 8 height → 168 | BASE |
| Cylinder | 20 axis, n-gon caps → 76 | 8 axis → 28 | BASE |
| Cone | 20 axis → 58 | 8 axis → 14 | BASE |
| Plane | 10×10 → 200 | 1×1 → 2 | BASE |
| Torus | 20×20 → 800 | 12 × 6 → 144 | BASE |
| Pipe, prism, disc, platonic solids, helix | various | — | LATER |

- A primitive stays **live** (its parameters editable in Attributes and Adjust Last Operation) until the first
  topology edit; then it becomes a plain mesh. This is the part of desktop-DCC history low-poly modelers use most
  (changing subdivisions on a fresh cylinder) without the rest of history.
- A preference "Primitive defaults: Low poly | DCC" (`primitiveDefaults: 'dcc'`) keeps parity with the desktop DCC for
  those who want it.
- Interactive creation (click-drag on the grid) is NEXT; BASE creates at the origin or at the pivot of the
  selection, sized to the grid unit.

### 3.5 Component transforms, pivots and snapping

| Feature | What it does in the desktop DCC | Low-poly value | Pri | DCC | Ekza |
|---|---|---|---|---|---|
| W/E/R on components | Move/rotate/scale about the selection centre; axis orientation World / Object / **Component (normal)** | Pushing faces along normals is daily work | BASE | `W`/`E`/`R`, hold + LMB for orientation | M; orientation `Normal` added to the `W`/`E` hold menus |
| Smart extrude | `Shift`+drag the Move/Rotate/Scale manipulator extrudes then transforms | Fastest extrude | BASE | `Shift`+drag | M |
| Numeric entry | Channels panel / In-View Editor values | Exact dimensions | BASE | fields | status-line fields + type-while-dragging |
| Snap to grid / curve / point | Hold `X` grid, `C` curve, `V` vertex/CV/pivot; status line also has face centres, view planes, projected centre, Make Live (vendor help: status line) | Grid for props, vertex for welding | BASE (grid, vertex) / NEXT (edge, face, live surface) | `X` / `C` / `V` | `X` / `V` hold (M); `C` LATER |
| Edit pivot | Custom pivot editing mode | Rotating doors, wheels, limbs | BASE | `D` hold; `Insert`/`Home` toggle (older docs) | `D` hold (M); `Insert` where it exists |
| Center / Zero / Bake pivot | Pivot to bbox centre / origin; bake custom orientation into the transform (vendor help: Modify menu) | Clean transforms before export | BASE (Center) / NEXT (Bake) | menu | menu |
| Freeze / Reset transformations | Freeze: current transform becomes zero (baked into vertices); Reset: back to zero/last freeze | Mandatory before skinning (§4.19) | BASE | menu (`A`-hold menu has Freeze) | menu; `A`-hold menu NEXT |
| Slide edge / vertex | Move along adjacent edges | Topology tuning without shape change | NEXT | tool | tool |
| Average vertices / relax | Smooth positions without new geometry | Organic shapes | NEXT | menu | menu |

### 3.6 Topology tools

| Feature | What it does in the desktop DCC | Low-poly value | Pri | DCC | Ekza |
|---|---|---|---|---|---|
| **Extrude** faces | New side faces; options Keep Faces Together (default on), Offset, Thickness, Divisions (1), Local Translate (Z = normal), Curve, Taper, Twist, Smoothing angle 30° (vendor help: options, `polyExtrudeFacet`) | The primary low-poly tool | BASE | `Ctrl+E`; `Ctrl+Shift`+RMB toggles Keep Faces Together | `Ctrl+E` (§6.3), toggle in the in-view fields |
| Extrude edges | New faces off edges; thickness along connected face normals (vendor help: `polyExtrudeEdge`); interior edges can produce non-manifold geometry | Skirts, wings, hair cards, extending planes | BASE (border edges) | `Ctrl+E` | M |
| Extrude vertices | Spike along the vertex normal: Width, Length, Divisions | Horns, spikes | NEXT | `Ctrl+E` | M |
| Extrude along curve | Uses a path curve (Selected/Generated), Taper, Twist | Tails, tentacles; needs splines | LATER | option | with M6 splines |
| **Bevel** edges | Offset type Fractional (default) or Absolute, Width, Segments (1), Depth (1), Mitering Auto/Uniform/Patch/Radial/None, Miter Along, Chamfer (on), Smoothing angle 30° (vendor help: options, `polyBevel3`) | Chamfers that catch light on props; 1–2 segments | BASE (edges, ≤ 3 segments) | none verified; `Ctrl+B` in the open-source DCC's Industry Compatible keymap | `Ctrl+B` (E) ⚠ |
| Bevel faces | Bevels the boundary of a face region | Panels | NEXT | menu | menu |
| Smart Bevel (2027 release) | Bevel that follows surface shape rather than topology, for meshes after booleans; non-destructive; refined in 2027.1 (release news: Digital Production 2026-03-26; 80.lv) | Only matters with booleans | LATER | menu | — |
| **Bridge** | Faces between two sets of border edges: Divisions (rows = divisions + 1), Linear / Blend / Curve, Twist, Taper, Bridge offset, start vertices (vendor help: `polyBridgeEdge`) | Joining arms to torsos, closing gaps after Combine | BASE (equal counts, faces variant) | menu | — (Shift+RMB) |
| Append to Polygon | Click a border edge, then place points to grow a face; Divisions 1, Keep new faces planar on (vendor help) | Manual patching | NEXT | tool | tool |
| **Fill Hole** | One n-sided face over a hole fully enclosed by border edges (vendor help) | Caps, mirror halves | BASE | menu | — |
| **Multi-Cut** | Click edges/vertices to cut faces; `Ctrl`-click edge loop; `Ctrl`+MMB centred loop; `Ctrl+Shift` snap to Snap Step %; `Shift`-click snaps on an edge; MMB-drag quick slice; RMB completes; `Backspace` removes points; `Esc` cancels (vendor help: hotkeys). Successor of the older Split Polygon / Cut Faces tools † | "Split": the owner's second named tool | BASE (edge/vertex points, loops, snap) / NEXT (in-face points, slice plane) | tool | tool, `Enter` also completes |
| **Insert Edge Loop** | Splits faces across a full or partial edge ring; Relative (default) / Equal distance / Multiple loops (2); Auto complete on; Fix Quads off; Smoothing angle 180; edge flow off (vendor help: options, `polySplitRing`); a triangle stops the loop | Joint loops for deformation | BASE (relative, equal, multiple) / LATER (edge flow, profile) | tool | tool; also Multi-Cut `Ctrl`-click |
| Offset Edge Loop | Two new loops either side of selected edges; end triangles optionally converted to quads (vendor help: `polyDuplicateEdge`) | Support loops at joints, sharp borders | NEXT | tool | tool |
| **Connect** | Edges between selected vertices or across selected edges; Connect tool: click edge = loop, `Shift`-click = connect components (vendor help: modeling-tools hotkeys) | Precise vertex-to-vertex cuts | BASE | menu/tool | menu/tool |
| **Target Weld** | Drag one vertex/edge onto another: merges at the target (default) or, with MMB, at the centre; same mesh only (vendor help: options) | Cleaning up, closing seams | BASE | tool | tool |
| **Merge** | Merges vertices within a distance; `distance` 0 = coincident only; "always merge two vertices" option (vendor help: `polyMergeVertex`) | Seams after Mirror/Combine | BASE | menu | `M`-hold menu (E) |
| **Merge to Center** | All selected vertices → one at the selection centre | Poles, tips | BASE | menu | `M`-hold menu |
| **Collapse** | Each selected edge (or face †) collapses to its centre (vendor help: Edit Mesh) | Fast poly reduction | BASE | Shift+RMB | `M`-hold menu |
| **Delete Edge/Vertex** | Removes edges/vertices and their now-redundant vertices; plain `Delete` on edges keeps the end vertices (vendor help: delete edges, delete vertices) | Removing loops, simplifying | BASE | `Ctrl+Delete` / `Ctrl+Backspace`; `Delete` | M |
| Delete faces | Removes faces (and unused vertices/edges) | Halving for symmetry | BASE | `Delete` | M |
| **Spin Edge** | Rotates an edge shared by two faces one vertex along its winding; one edge per face; IDs unchanged (vendor help) | **Controls triangulation and silhouette** | BASE | `Ctrl+Alt+→` / `Ctrl+Alt+←` | M ⚠ (some Windows graphics drivers rotate the screen) |
| Flip Triangle Edge | Reconnects the diagonal of two triangles | Same, for triangles | BASE | Shift+RMB | Shift+RMB |
| Add Divisions | Subdivides edges or faces | Quick density | NEXT | menu | menu |
| Poke / Wedge / Chamfer Vertex / Circularize | Centre vertex; arc extrude; vertex → face; make circular | Stylised details | NEXT (Poke, Chamfer) / LATER | menu | menu |
| Edit Edge Flow | Moves edges to follow curvature | Subdivision modeling | LATER | menu | — |
| Crease | Subdivision creases | Not for low poly | LATER | tool | — |

### 3.7 Mesh-level operations

| Feature | What it does in the desktop DCC | Low-poly value | Pri | DCC | Ekza |
|---|---|---|---|---|---|
| **Combine** | Objects → one mesh; UV sets: No merge / By name / By UV links; pivot Center / Last object / World origin (vendor help: options); skinned variant `polyUniteSkinned` | One mesh per character before binding | BASE | menu | menu |
| **Separate** | Mesh → one object per shell | Undo a Combine, split parts | BASE | menu | menu |
| **Extract** | Detach faces; "Separate extracted faces" on by default; Offset (vendor help: options) | Armour pieces, accessories | BASE | menu | menu |
| Duplicate Face | Copy faces as a new shell/object, Offset (vendor help: options) | Shells, armour from body faces | NEXT | menu | menu |
| **Mirror** | Cut Geometry; type Copy (default) / Instance / Flip; axis position World (default) / Object / Bounding box; axis X, direction +; Border: Merge border vertices (default) / Bridge border edges / Do not merge; threshold Automatic; Combine with original on; Smoothing angle 30; Flip UVs off (vendor help: options) | Model half, mirror once | BASE (Copy + merge) / NEXT (Instance = live mirror) | menu | menu |
| **Triangulate** | Faces → triangles | Export control, "show tris" | BASE | menu | menu |
| Quadrangulate | Merge triangle pairs under an angle threshold (30°) keeping group borders, hard edges, texture borders (vendor help: `polyQuad`) | Cleaning imported/AI meshes | NEXT | menu | menu |
| **Cleanup** | Cleanup or *select* matching: fix by tessellation (4-sided, > 4-sided, concave, holed, non-planar); remove lamina, non-manifold (normals+geometry / geometry only), zero-length edges, zero-area faces, zero-map-area faces, invalid components; tolerances (vendor help: options) | Export safety, AI meshes | BASE (lint subset, §4.17) | menu | Cleanup panel + export lint |
| Reduce | Decimate to a target | **AI-generated meshes** | NEXT | menu | menu (meshoptimizer, §8) |
| Smooth (apply) | Subdivide the mesh | Stylised "low-poly cage → smooth" | NEXT | menu | menu |
| Booleans | Union/difference/intersection | Hard-surface props; produces n-gons and T-junctions | LATER | menu | menu (manifold-3d / three-bvh-csg, §8) |
| Retopologize | Automatic remesh on a duplicate, `polyRetopo` node, target face count (vendor help) | AI meshes → animatable topology | LATER | menu | — |
| Quad Draw | Retopology on a live surface: `Shift`-drag relax / fill, `Ctrl`-click loop, `Tab`-drag extend strips, `Ctrl+Shift`-click delete (vendor help: hotkeys) | Manual retopo of AI meshes | LATER | tool | tool |

### 3.8 Normals, display and HUD

| Feature | What it does in the desktop DCC | Low-poly value | Pri | DCC | Ekza |
|---|---|---|---|---|---|
| **Soften / Harden edge** | Normal angle 180 / 0 on selected edges; **Set Normal Angle**: angles above the value render hard; locked normals unaffected (vendor help: Mesh Display) | Faceted look vs smooth groups | BASE | Shift+RMB (edge) | Shift+RMB |
| **Reverse / Conform** | `polyNormal` modes reverse, propagate, conform, reverse-and-cut, reverse-and-propagate (vendor help: `polyNormal`) | Fix flipped faces (imports, AI) | BASE | menu | menu |
| Vertex normal edit / lock | Per-vertex custom normals | Foliage, stylised shading | LATER | tool | — |
| Smooth Mesh Preview | `1` cage only, `2` cage + smooth, `3` smooth; `Page Up`/`Page Down` levels; display only (vendor help: overview) | Subdiv workflow only | LATER | `1`/`2`/`3` | `Shift+1`/`2`/`3` (digits are component modes) |
| **Poly Count HUD** | Verts, edges, faces, tris, UVs; columns: visible totals / selected objects / selected components (vendor help) | **The low-poly budget** | BASE | Display › HUD | HUD row + export-profile budget |
| Show triangulation / backfaces / wire on shaded | Display options | Judge silhouette and triangulation | BASE | menu | `Show ▾` layers |
| Face centres / normals display | Display options | Picking in wireframe, debugging normals | NEXT | menu | `Show ▾` layers |

### 3.9 Object operations and history

| Feature | What it does in the desktop DCC | Low-poly value | Pri | DCC | Ekza |
|---|---|---|---|---|---|
| Duplicate / duplicate with transform | Copy; repeat the last offset | Fences, teeth, bolts | BASE / NEXT | `Ctrl+D` / `Shift+D` † | `Ctrl+D` (M) / `Shift+D` (M†) |
| Group / parent / unparent | Hierarchy edits | Props with parts | BASE | `Ctrl+G` / `P` / `Shift+P` | M (Model workspace) |
| Repeat last / last tool | `G` repeats last command, `Y` reactivates last tool | Extrude-extrude-extrude | BASE | `G` / `Y` | M |
| Adjust last operation | Desktop DCC: In-View Editor / Channels panel INPUTS on the history node; open-source DCC: Adjust Last Operation panel, `F9` | Change segments, offset, divisions after the fact | BASE | (history) | panel generated from the operator's arg schema (§5) |
| Construction history | Upstream poly* nodes, editable until deleted | — | **skipped** (§5) | toggle | — |
| Delete history | Bakes history | — | n/a | menu, `A`-hold menu | — |

### 3.10 UV and colour (minimum for low poly)

Full UV editing is LATER. BASE keeps low-poly assets shippable without it:

- Primitives generate UVs; every operator propagates UVs by provenance (§4.0), as the desktop DCC's "Preserve UVs"
  does for transforms (NEXT for component transforms).
- Per-face material slots (glTF primitives per material) and per-face colour by **palette swatch**: a face
  assignment collapses its UVs onto one texel of a small palette texture (the common low-poly "colour atlas"
  workflow), or writes `COLOR_0` vertex colours. glTF clamps `COLOR_0` to [0, 1]
  ([glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#meshes)).
- Planar/box/cylindrical projection and a UV editor are LATER.

---

## 4. Geometric behaviour notes (implementation spec)

These are the behaviours Ekza should implement. Where the desktop DCC's exact internal rule is undocumented, the text
says "our rule" and gives the behaviour we choose; tests in §9 pin it.

### 4.0 Mesh conventions every operator obeys

- **Storage and edit structure** belong to the mesh-kernel note (13: BMesh-style radial edges over
  struct-of-arrays, n-gons, attribute layers per vertex, corner, edge and face). This note fixes behaviour only;
  every rule below must hold whatever the structure. Two of them matter for the structure: an operator leaves no
  edge without a face and no vertex without an edge unless it says so (orphan cleanup is part of the operator),
  and it detects non-manifold input (an edge with ≥ 3 faces) and refuses or warns.
- **Winding**: counter-clockwise when the face normal points at the viewer (glTF front face). A face normal is the
  Newell normal (robust for non-planar n-gons). Two faces sharing an edge must traverse it in opposite directions
  ("consistent winding").
- **Component identity**: indices, as in the desktop DCC. Every topology operator returns `selection′` in index space
  of the new mesh (what the desktop DCC leaves selected after the operation), and `provenance`, from which callers
  remap anything else (symmetry maps, lints).
- **Attribute propagation by provenance**:

| New element arises by | Positions | UVs, colours (corner) | Skin weights | Morph deltas |
|---|---|---|---|---|
| Duplicating a vertex (extrude, rip) | copy then offset | copy the source corner | copy | copy |
| Splitting an edge at `t` (cut, loop, bevel) | lerp | lerp along the face's corners | lerp, keep top 4, renormalise | lerp |
| Inserting a vertex inside a face (poke, in-face cut) | barycentric/mean | mean value coordinates of the face | same weights, top 4 | same |
| Merging vertices (weld, collapse) | target or centroid | keep per-face corners (UV seams survive) | target's or average, top 4 | target's or average |
| Mirroring | reflect | copy (+ optional U flip) | swap left/right joints by humanoid map / `.L`/`.R` names | reflect deltas (negate x for an x-mirror) |

  Without this table a modeling edit on a VRM breaks expressions and skinning silently; with it, modeling and
  animation share one mesh.

### 4.1 Selection algorithms

- **Edge loop** from edge `e = (a→b)`: at vertex `b`, continue through the edge opposite `e` in `b`'s edge fan
  (skip two edges in the cyclic fan) **only if `b` is interior with valence 4 and its four faces are quads**.
  Stop otherwise (pole, triangle, n-gon), or when the loop closes. On a border edge, continue along the next
  border edge (border loop). Run both directions from `e`. The desktop DCC's loop likewise stops at faces that are not
  four-sided.
- **Partial loop / ring**: compute the full loop/ring through the first edge; if the second edge is on it, take
  the shorter arc between them. The relation decides the gesture: same loop → partial loop; same ring → ring
  (the desktop DCC uses `Shift`+double-click for both).
- **Edge ring** from `e`: in each adjacent **quad**, step to the opposite edge; stop at border or non-quad.
- **Face loop**: the faces crossed by an edge ring (the ring through the edge shared by the two clicked faces).
- **Grow**: add every component that shares a vertex with the selection (faces across corners included, as both
  DCCs do by default). **Shrink**: remove components that touch an unselected neighbour.
- **Convert**: "To X" selects touching components (the desktop DCC's default); "To contained X" selects only those
  fully inside (edges with both ends selected, faces with all corners selected). Perimeters: boundary edges/vertices
  of the selected region.
- **Border**: edges with exactly one face. **Shell**: flood fill over shared vertices.
- **Picking**: vertex = nearest projected vertex within 8 CSS px; edge = nearest projected segment within 6 px
  (then the edge parameter by projection); face = BVH ray hit (or the face-centre dot in wireframe).
- **Camera-based visibility**: a component is visible if a ray from the camera to it hits nothing closer than
  `ε·distance` (BVH). For a marquee over ≤ 20k vertices this CPU test is fast enough; a GPU ID buffer is the
  scale-up path.
- **Soft selection weights**: Volume = `f(d/r)` with `d` the Euclidean distance to the nearest selected vertex;
  Surface = Dijkstra geodesic distance over edges from the selected set (cut at `r`). Default falloff curve:
  smoothstep (the desktop DCC's "Smooth" interpolation). Weights scale the transform delta per vertex.
- **Symmetry map** (Object/World axis): reflect every vertex, look its reflection up in a spatial hash with the
  tolerance; unmatched vertices get no partner (partial symmetry). Seam vertices (`|x| < tol`) are their own
  partner; with Preserve Seam their delta's normal component is zeroed. Selections expand to partners before an
  operator runs, so every selection-driven topology operator gets symmetry for free; the map is rebuilt from
  `provenance` after the operator. *Refined (MODELING-PLAN v0.2 §3.14): tool-driven operators carry pointer
  arguments (Multi-Cut `{edge, t}`, loop seeds, weld pairs, bridge picks) that need edge and face partner maps and
  `t`/`1 − t` mapping by edge orientation, plus seam rules (one loop for a seam-crossing ring, one symmetric cut, welds
  onto seam vertices).*

### 4.2 Extrude

**Faces, Keep Faces Together on (region extrude).**
1. Region `R` = selected faces; region boundary = edges with exactly one face in `R` (mesh-border edges of faces
   in `R` count).
2. Duplicate every vertex on the region boundary (`v → v′`); interior vertices of `R` are reused and move with
   the cap.
3. Remap the corners of faces in `R` to `v′` (the **cap keeps the original face indices**, so materials, palette
   colours and selection survive).
4. For each boundary edge `(a→b)` as traversed by its face in `R`, add the side quad `(b, a, a′, b′)`; this
   winding makes the side face outward-facing and consistent with both neighbours. With `divisions = n`, add
   `n − 1` intermediate vertex rings at `i/n` of the final offset and `n` quads per boundary edge.
5. Offsets: **Local Translate Z** moves the cap along the region's area-weighted average normal; **Thickness**
   moves each cap vertex along its own *even-thickness* normal (angle-weighted average of its region-face
   normals, scaled by `1/max(0.25, min_f dot(n_v, n_f))` so walls keep constant thickness on corners);
   **Offset** insets the region boundary inside the region surface (each boundary vertex moves along the in-plane
   bisector of its two boundary edges by `offset / sin(θ/2)`, clamped so it does not cross the next vertex).
6. `selection′` = the cap faces. Bowtie case (a region-boundary vertex that the region touches in two separate
   fans) duplicates the vertex once per fan.

**Faces, Keep Faces Together off (individual).** Each face is its own region: all its vertices are duplicated,
side quads on all its edges, offset along its own normal. With Thickness 0 and Offset > 0 this is the inset used
for panels and eyes.

**Edges.** Allowed on border edges by default; on an interior edge it creates a fin (non-manifold) and needs an
explicit option, which the desktop DCC allows with a Cleanup warning. Connected selected edges share new
vertices (together). Default frame per edge: X along the edge, Z = average of adjacent face normals, Y = in-plane,
pointing away from the adjacent face. `selection′` = new outer edges.

**Vertices** (NEXT): chamfer the vertex into a small polygon of `width` on its incident edges, then pull a new
apex along the vertex normal by `length` (a spike with `valence` triangles).

**Smart extrude.** `Shift` at drag start on a Move/Rotate/Scale handle runs extrude (together) and then the
transform on the cap; Scale with `Shift` is the fastest inset. It is **one `mesh.extrude` step** whose drag is
recorded as `localTranslate`/`localScale`/`localRotate`, so the card is titled "Extrude" and Divisions stays editable
(MODELING-PLAN v0.2 §3.4).

**Extrude session (v0.2).** After `Ctrl+E` the extrude manipulator stays up; its own drags and `W`/`E`/`R` drags on
the cap are absorbed into the extrude's `local*` arguments (one undo step, card live) until the selection changes or
a non-transform operator runs — the desktop DCC's `polyExtrudeFace` flow without construction history.

**Cancel and zero moves (our rule).** `Esc` during the first drag cancels the whole extrude (no geometry left);
**RMB never cancels** (*corrected*, ADR 0016 D8). A session that **ends** with zero translate, rotate, scale,
thickness and offset is dropped with a hint, because the desktop DCC leaves coincident duplicate faces in that case
and they are invisible until export (lamina/zero-area lints catch any that slip through).

### 4.3 Bevel (edges)

- **Width**: Fractional mode (default) slides each new vertex along the adjacent unselected edge by
  `fraction × length(edge)`, clamped to 0.5 of the shortest adjacent edge so bevels from both ends never cross
  (in the desktop DCC, a fractional width of 1 is the largest distance, based on the shortest edge, that does not
  turn the bevel inside out). Absolute mode
  uses scene units and may invert; we clamp and warn.
- **Valence cases at an endpoint `v`** (selected edges meeting at `v`):
  - 1 selected edge: `v` splits into two vertices on the two neighbouring edges; the face opposite the bevel
    gains a corner (quad → pentagon), which is the desktop DCC's Uniform mitering. One cube edge: V 8→10, E 12→15,
    F 6→7.
  - 2 selected edges: the new vertices follow the bisector between the two bevel strips (Miter Along = Center).
  - 3+ selected edges: fill the corner with one polygon whose corners are the new vertices (segments = 1);
    all 12 cube edges: V 24, E 48, F 26 (6 shrunken quads, 12 strips, 8 corner triangles).
- **Segments `n`**: `n − 1` intermediate rows on a profile between the two offset lines; roundness 0.5 gives a
  circular arc (the desktop DCC's `roundness` 0.5 when auto-fit is off). BASE supports `n ≤ 3` and fills 3+-edge
  corners with a fan (a warning names the corner); Patch/Radial corner grids are LATER.
- **Normals**: new edges hard when the dihedral angle exceeds the smoothing angle (the desktop DCC's UI default 30°;
  *v0.2: the default resolves to 0°, all hard, on meshes flagged `faceted`, MODELING-PLAN §3.2*).
  `selection′` = the new bevel faces.

### 4.4 Bridge

- Input: two chains of border edges (open or closed) on **one** mesh (Combine first, as the desktop DCC requires), or
  two faces (delete them, then bridge their boundaries).
- Pair vertices: for closed loops pick the start offset and direction that minimise the sum of squared distances;
  the direction must also make each new face traverse the border edge opposite to its existing face (correct
  winding). `twist` rotates the pairing by whole steps; `taper` scales intermediate rings.
- Divisions: rows = `divisions + 1` (the desktop DCC's definition); interpolation Linear, or Blend using the adjacent
  faces' tangents (cubic Hermite).
- Unequal counts (our rule): BASE refuses with "Bridge needs the same number of edges on both sides (12 vs 10)";
  NEXT adds a zipper (pair greedily by shortest diagonal, emitting triangles where counts differ).

### 4.5 Fill Hole and Append

- Fill Hole: walk the border loop from a selected border edge; emit one n-gon with the loop's vertices **reversed**
  relative to the existing faces' traversal (so its normal agrees). Multiple selected loops → one face each.
  Optional NEXT: triangle-fan or grid fill instead of an n-gon.
- Append (NEXT): face from a border edge plus clicked points/edges; new face coplanar by default.

### 4.6 Multi-Cut (face split)

- Points snap to vertices or to edges (parameter `t`, `Shift` snaps `t` to the Snap Step %); BASE does not allow
  points inside a face. Consecutive points must share a face; that face is split along the chord between them.
- Splitting an edge inserts the new vertex into **both** adjacent faces, so the neighbour of a cut becomes an
  `n+1`-gon (the desktop DCC does the same; its `fixQuads` option exists for this). Our rule: no automatic fix in
  BASE, the n-gon lint shows it.
- `Ctrl`-click/drag on an edge = Insert Edge Loop at the cursor `t`; `Ctrl`+MMB = loop at `t = 0.5`;
  `Ctrl+Shift` = loop at the nearest snap step.
- Completion: RMB or `Enter`; `Backspace` removes the last point; `Esc` cancels. `selection′` = new edges.

### 4.7 Insert Edge Loop (ring walk)

- From the clicked edge `e₀` and parameter `t`, walk the ring both ways through quads (opposite edge). Keep a
  consistent side: entering quad `(a, b, c, d)` across edge `a→b`, the opposite edge is `d→c` and `t` measured
  from `a` maps to `t` measured from `d`.
- **Termination**: border edge, closed ring, or a non-quad face. At a non-quad the shared edge is split and the
  new vertex is added to that face (triangle → quad, n-gon → (n+1)-gon), which is where the desktop DCC's loop
  "stops" (in the vendor help's words, a triangle "stops the edge loop from forming all the way around the neck").
  Fix Quads (off by default, as the desktop DCC): split such a face from the new vertex to the opposite vertex.
- Placement: **Relative** = same `t` on every ring edge; **Equal distance** = same absolute distance from the
  side the cursor was on, clamped to each edge length; **Multiple** = `n` loops at `i/(n+1)` (the desktop DCC's
  default 2).
- Preview the whole loop while hovering; commit on release. `selection′` = the new loop edges.

### 4.8 Offset Edge Loop (NEXT)

For each selected loop insert two loops at `±offset` (a fraction of the crossing edges). Where an open loop ends at
an interior vertex the ends become triangles; the `deleteEdge` option of `polyDuplicateEdge` removes the end edges
"so the end triangles are converted to quads".

### 4.9 Connect

- Vertices: for every face containing two or more selected vertices that are not adjacent along the face boundary,
  split the face by chords between them (in boundary order). Two selected vertices with no common face: nothing,
  with a hint.
- Edges: in every face with exactly two selected edges, split the face between their midpoints (or `t`); a
  selected ring therefore becomes an inserted loop. Faces with three or more selected edges get a centre vertex
  (poke-like) only when an option allows it.

### 4.10 Merge family

- **Merge (distance)**: cluster selected vertices with a union-find over a spatial hash (threshold `d`; `d = 0`
  means coincident); each cluster becomes its first-selected vertex at the cluster centroid. With exactly two
  vertices and "always merge two" the threshold is ignored (the desktop DCC's `alwaysMergeTwoVertices`).
- **Merge to Center**: every selected vertex → one vertex at the selection's centroid. Top face of a cube →
  pyramid (V 5, E 8, F 5).
- **Target Weld**: source → target position (or midpoint with MMB); edges weld endpoint to endpoint by
  proximity.
- **Collapse**: per selected edge, merge its endpoints at the midpoint; per selected face, merge its vertices at
  its centroid. A cube edge: V 7, E 11, F 6.
- **After any merge**: drop repeated consecutive corners; delete faces left with < 3 distinct corners; detect
  edges now used by > 2 faces (non-manifold) and report them; merge exactly coincident duplicate faces (lamina).

### 4.11 Delete

- **Edges, plain `Delete`** (desktop-DCC behaviour): remove the edge and merge its two faces into one polygon; end
  vertices stay.
  A cube edge: V 8, E 11, F 5 (one hexagon).
- **Delete Edge/Vertex** (`Ctrl+Delete`): additionally delete vertices left with valence 2 by this deletion,
  joining their two edges. Note that this can change the shape: one cube edge becomes a triangular prism
  (V 6, E 9, F 5). Only non-border edges can be deleted this way (`polyDelEdge`); border edges go with their
  face.
- **Vertex**: interior vertex → its incident faces merge into one n-gon; a border vertex with two edges → its
  edges join.
- **Faces**: remove; vertices no longer used disappear.
- Lint, not auto-fix: valence-2 vertices whose edges are collinear within 1° ("stray vertices") are flagged with
  a one-click fix.

### 4.12 Spin and flip

Spin: for an edge shared by faces `F1`, `F2`, detach it and reattach each end one vertex further along the
winding of the joined quad/polygon; reject edges with < 2 faces and selections with two edges in one face (the
desktop DCC's rules). Flip Triangle Edge is the same move on two triangles. Vertex and edge counts never change,
which makes these the cheapest way to fix a bad triangulation in a low-poly silhouette.

### 4.13 Combine, Separate, Extract, Duplicate

- Combine: transform vertices into the new object's space (pivot Center by default), concatenate layers, union
  material slots, keep each source's skin if all sources are bound to the same skeleton (the desktop DCC's
  `polyUniteSkinned`), otherwise warn.
- Separate: one object per shell (flood fill over shared vertices), each keeping the original transform.
- Extract = detach faces (duplicate the boundary vertices of the face set so it becomes its own shell) and, by
  default, separate into a new object. Duplicate Face = copy without removing. Both take an inward offset.

### 4.14 Mirror and symmetry transforms

1. Reflect across the plane (World by default; Object or bounding-box side).
2. **Cut geometry**: clip faces crossing the plane on the target side first; vertices within the threshold of the
   plane snap onto it.
3. Copy faces with **reversed corner order** (a reflection flips orientation; without this every mirrored
   normal points inward).
4. Border handling: merge seam vertices with their partners (Automatic threshold = a fraction of the average
   border edge length), or bridge the borders, or keep them apart.
5. Propagate layers: UVs copied (optional U flip), skin joints swapped by side, morph deltas reflected (§4.0).
6. Instance type (NEXT): a live, read-only mirrored copy that redraws from the source each frame and is applied
   on export or on demand. This is the "live mirror" open-source-DCC users expect from its Mirror modifier.

### 4.15 Normals

- Hard edges split shading normals; vertex normal = angle-weighted average of the face normals in its smooth fan
  (fans separated by hard edges). Soften = 180°, Harden = 0°, Set Normal Angle = harden every edge whose dihedral
  angle exceeds the value.
- Export: split vertices along hard edges into separate glTF vertices. Fully faceted meshes may omit `NORMAL`,
  since glTF says that "when normals are not specified, client implementations MUST calculate flat normals"
  ([spec](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#meshes)); test three.js and Bevy before
  relying on it, and keep normals when a morph target or skin is present.
- Reverse: reverse corner order of selected faces (and their corner layers). Conform: BFS over each shell making
  neighbours traverse shared edges oppositely; then, for closed shells, flip the whole shell if its signed volume
  is negative (outward normals).

### 4.16 Triangulation

- One function serves the viewport, picking, the HUD and the exporter, so what the modeller sees is what ships:
  quads split along the **shorter diagonal** (ties broken by vertex index for determinism; Flip Triangle Edge on a
  quad stores an override); n-gons by ear clipping on the Newell-normal plane with a quality pass (note 13 picks
  `earcut` with its refine step).
- Triangulate (the command) writes those triangles as faces. Quadrangulate (NEXT) greedily pairs triangles whose
  dihedral angle is below 30° and whose union is the most rectangular, keeping hard edges and material borders
  (the desktop DCC's `polyQuad` defaults).

### 4.17 Cleanup lints (BASE subset)

| Lint | Detection | Fix |
|---|---|---|
| Non-manifold edge / vertex | edge with > 2 faces; vertex whose fan is not one disc | select; split |
| Lamina faces | two faces with the same vertex set | delete one |
| Zero-length edges / zero-area faces | below tolerance (1e-6 × bbox diagonal) | collapse |
| Inconsistent winding | neighbours traverse an edge the same way | Conform |
| Non-planar n-gons | max distance from the Newell plane > 1 % of face size | triangulate or select |
| Concave n-gons | any reflex corner on the plane | triangulate or select |
| Isolated vertices, stray valence-2 vertices | | delete |
| Open borders on a mesh meant to be closed | border edges exist | select border |
| Triangle budget | tris > profile budget | HUD turns red; export lint |

"Select matching" (the desktop DCC's Cleanup operation) is the default action; fixes are explicit.

### 4.18 Primitives

Generated with consistent CCW winding, UVs and seams on a fixed side (cylinder seam on −Z, sphere seam on −Z),
hard edges on box edges and caps, soft on curved sides (auto angle 30°). Live parameters until the first topology
edit (§3.4).

### 4.19 Freeze transforms and the glTF skin rule

glTF ignores the transform of a skinned mesh node: "Only the joint transforms are applied to the skinned mesh;
the transform of the skinned mesh node MUST be ignored"
([spec](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#joint-hierarchy)). Freeze Transformations
(bake the node's matrix into the vertices, normals transformed by the inverse transpose, winding reversed when
the determinant is negative) is therefore BASE, and the later Bind Skin operator must freeze or refuse unfrozen
meshes.

---

## 5. Construction history: what the desktop DCC does and why Ekza skips it

**What it is.** Each modeling command in the desktop DCC adds a node (`polyExtrudeFacet`, `polyBevel3`,
`polySplitRing`, …) upstream of the mesh shape. The node's attributes stay editable in the Channels panel INPUTS and the
In-View Editor until history is deleted (Edit › Delete by Type › History bakes it, which the help credits with better
performance and smaller files), and "Non-Deformer History" exists to remove modeling nodes from under skin clusters
and blend shapes (vendor help).

**Why we skip it.**

1. **Index fragility**: later nodes address components by index; editing an early node changes topology and the
   later nodes apply to the wrong components. Modelers learn to delete history often; the feature mostly helps
   for the most recent operation.
2. **It fights rigging**: history under deformers is the reason "Delete Non-Deformer History" exists. Our goal is
   modeling on rigged meshes (§4.0), which history makes worse.
3. **Cost in the architecture**: a node chain needs per-op dirty propagation and re-evaluation (note 08 §4.3) and
   a much finer collaboration model than "a mesh is a blob" (note 06 D8, P3).
4. **The useful 80 % is cheaper**: Adjust Last Operation (operator args edited until the next operation, done as
   undo + re-execute inside the same history entry), live primitives, `G` repeat, and generators for curve-driven
   geometry (note 08 §9.6), where history is the whole point and topology is regenerated from scratch anyway.

**Consequence for the operator registry**: modeling operators must have complete JSON-schema args (the Adjust Last
Operation panel and `G` are generated from them) and must be deterministic given `(mesh, selection, args)`.

---

## 6. Keymap and marking menus for the Model workspace

### 6.1 Bindings (Model workspace, viewport scope unless noted)

| Action | DCC | Ekza | Browser |
|---|---|---|---|
| Object / component toggle | `F8` | `F8` | ✓ |
| Vertex / edge / face | `F9` / `F10` / `F11` | `F9` / `F10` (M), `1` / `2` / `3` (E) | `F9` ✓, `F10` ⚠ (Windows menu focus), `F11` ✗ (full screen) |
| UV / multi-component | `F12` / `F7`, `Ctrl+Tab` | RMB menu only | `F12` ✗ (dev tools), `F7` ⚠ (caret browsing), `Ctrl+Tab` ✗ |
| Convert to vertices / edges / faces | `Ctrl+F9` / `Ctrl+F10` / `Ctrl+F11` | same + Ctrl+RMB | ⚠ |
| Grow / shrink | `Shift+.` / `Shift+,` | same | ✓ (matched on `code`) |
| Soft selection, radius | `B`, `B`+drag | same | ✓ |
| Tweak mode | `` ` `` | same (NEXT) | ✓ |
| Snap grid / point (hold) | `X` / `V` | same | ✓ |
| Edit pivot | `D` hold, `Insert` | same | ✓ |
| Extrude | `Ctrl+E` | `Ctrl+E` (§6.3) | ⚠ (address-bar search in Chrome Win/Linux; already intercepted for Export) |
| Bevel | — | `Ctrl+B` (E, as in the open-source DCC's Industry Compatible keymap) | ⚠ (Firefox bookmarks sidebar) |
| Merge menu (hold) | — | `M` hold: N Center · E Target/Last · S By distance · W Collapse (E) | ✓ |
| Delete / Delete Edge/Vertex | `Delete` / `Ctrl+Delete`, `Ctrl+Backspace` | same | ✓ |
| Spin edge forward / back | `Ctrl+Alt+→` / `Ctrl+Alt+←` | same | ⚠ (screen rotation hotkeys on some Windows drivers) |
| Repeat last / last tool | `G` / `Y` | same | ✓ |
| Duplicate / with transform | `Ctrl+D` / `Shift+D` † | same | ⚠ (`Ctrl+D` bookmark, already intercepted in other panels) |
| Group / parent / unparent | `Ctrl+G` / `P` / `Shift+P` | same | ⚠ `Ctrl+G` (find next) |
| Smooth preview (LATER) | `1` / `2` / `3`, `Page Up` / `Page Down` | `Shift+1` / `2` / `3`, `Page Up` / `Page Down` | ✓ |
| Multi-Cut, Insert Edge Loop, Connect, Target Weld, Bridge, Fill Hole, Mirror, Combine | no default keys | Shift+RMB menu, Toolkit, command palette; bindable | — |

### 6.2 Marking menus (fixed slot geometry, as note 09 §7.4)

| Trigger | Slots |
|---|---|
| RMB on a mesh | N Edge · W Vertex · S Face · E UV · NE Object Mode · NW Multi · SW Vertex Face · SE Select Shell (believed desktop-DCC layout †; calibrate on a real desktop-DCC install, Q-MOD-10-1) |
| Shift+RMB, nothing selected | N Cube · NE Sphere · E Cylinder · SE Cone · S Plane · SW Torus · W Primitive options… · NW Last primitive |
| Shift+RMB, mesh object | N Extrude (all faces) · NE Multi-Cut · E Mirror · SE Combine · S Separate · SW Normals ▸ · W Cleanup… · NW Insert Edge Loop; list: Triangulate, Quadrangulate, Fill Hole, Freeze Transformations, Center Pivot |
| Shift+RMB, components (same slot = same family in every mode) | N Extrude · NE Multi-Cut · E Bevel (vertex: Chamfer, NEXT) · SE Bridge (vertex: Connect) · S Delete Edge/Vertex (face: Delete) · SW Normals ▸ (Soften, Harden, Set Angle, Reverse, Conform) · W Merge ▸ (Center, Target Weld, Collapse, By distance) · NW Insert Edge Loop; list per mode as in the desktop DCC's menu: edge Spin ▸, Flip, Fill Hole, Connect, Offset Edge Loop; face Extract, Duplicate, Poke, Triangulate/Quadrangulate, Assign palette colour |
| Ctrl+RMB | N To Edges · W To Vertices · S To Faces · E To UVs · NE Edge Loop · NW Edge Ring · SE Edge Perimeter · SW Vertex Perimeter; list: Border Edges, Shell, Contained Edges, Contained Faces, Grow, Shrink |
| Ctrl+Shift+RMB | N Symmetry ▸ · E Soft Select ▸ · S Smart Extrude ✓ · W Tweak Mode ✓ · NE Camera-based Selection ✓ · SE Snap ▸ · NW Orientation ▸ (World, Object, Normal) · SW Tool options… |

The desktop DCC's own item sets per component mode (vertex adds Average Vertices, Chamfer Vertex; edge adds
Flip/Spin, Bevel, Soften/Harden, Offset Edge Loop, Insert Edge Loop, Slide Edge, Edit Edge Flow, Add Divisions,
Bridge, Fill Hole; face adds Poke, Bevel, Wedge, Smooth, Invisible faces, Add Divisions, Triangulate, Quadrangulate,
Reduce, Bridge, Extract, Duplicate, Target Weld, Mapping) are listed on the vendor help's Marking menus page; the
table above keeps those items and fixes their positions for gesture memory.

### 6.3 Conflicts with today's Ekza keymap (`packages/editor-core/src/keymap/dcc.ts`)

| Binding | Today | Proposal |
|---|---|---|
| `Ctrl+E` | Export dialog (global) | Viewport scope in the Model workspace: Extrude (the more specific scope already wins in `KeymapManager.resolve`). Export gains `Ctrl+Shift+E` everywhere and keeps `Ctrl+E` outside the Model viewport. Owner decision (Q-MOD-10-2). |
| `Delete` / `Backspace` | Delete keys (timeline, Graph Editor, Dope Sheet; viewport = keys at the current frame) | In component mode the viewport deletes components; in object mode behaviour unchanged |
| `1`–`7` | Graph Editor / Dope Sheet tangents; viewport `4`–`7` display modes | Viewport `1`/`2`/`3` component modes; no clash (different scope, `4`–`7` untouched) |
| `B` | Graph Editor break tangents | Viewport soft selection; no clash |
| F-keys | deliberately unbound (note 09 §7.5) | Bind `F8`, `F9`, `F10` in the Model workspace only; Mac laptops use `1`/`2`/`3` and the RMB menu |
| `Q`-hold menu | selection mask | In the Model workspace: N Marquee · E Lasso (NEXT) · S Paint (NEXT) · W Camera-based ✓ |

---

## 7. Low-poly character workflow with BASE tools (acceptance scenario)

Target: a stylised humanoid, ≤ 2,000 triangles, symmetric, closed, quads in the shoulders, elbows, hips and
knees. Common practice for deforming low-poly characters is about three edge loops per bending joint and no
triangles at elbows and knees (Polycount community advice, e.g.
[help with topology](https://polycount.com/discussion/161450/help-with-topology)).

1. Cube (live: 2×3×1 subdivisions) → Freeze → Symmetry Object X on.
2. Faces: extrude legs down (Keep Faces Together off for the two leg faces), arms out with smart extrude;
   `G` repeats extrudes for segments.
3. Insert Edge Loop: three loops at each knee/elbow (Multiple loops = 3), one at the waist.
4. Bevel shoulders and the head box (segments 1, fractional 0.3); Multi-Cut for the face plane and hands.
5. Target Weld / Merge to Center to remove poles where they pinch; Spin Edge where triangles pinch the silhouette.
6. Delete the −X half, Mirror (Cut, Merge border vertices); Conform; Soften the body, Harden the hair/armour edges.
7. Cleanup lint is clean (no non-manifold, lamina, concave or non-planar n-gons); the HUD shows ≤ 2,000 tris.
8. Export GLB (per-face palette colour) → glTF-Validator 0 errors → loads in three.js and in Bevy 0.19.

Acceptance: the same build as a scripted operator sequence (an e2e scenario) produces identical V/E/F counts on
every run; the symmetry map covers every off-seam vertex; the round trip export → import keeps V/E/F after
triangulation. The bridge to animation (humanoid skeleton template, auto-skin, weight paint, VRM export) is the
next step in this pipeline and depends on §4.0 propagation and §4.19 freezing.

Later, for AI-generated meshes (dense triangle soup with baked textures): Merge (by distance) → Conform → Cleanup
→ Reduce to the budget → Quadrangulate → (Retopologize/Quad Draw, LATER) → skeleton template + auto-skin.

---

## 8. Implementation implications

- **Package**: the pure-TypeScript mesh kernel of note 13 (no three.js, no DOM) hosts every §4 operator, the
  selection algorithms, the triangulator, normals and lints. It is tested in Node with the §9 oracles; `viewport`
  only renders and picks.
- **Document**: a `mesh` table registered through `TableDef`; the record holds the blob hash of the mesh data, the
  live-primitive parameters (if any) and the transform. Per note 06 D8, mesh bytes are content-addressed blobs and
  a modeling commit replaces the blob (coarse last-writer-wins; per-mesh soft lock in collaboration). Low-poly
  meshes (≤ 10k vertices ≈ a few hundred KiB) make whole-blob undo steps acceptable; structural diffs are a later
  optimisation.
- **Interactive tools** run on a transient copy (interactive transaction) and commit once on release (note 08
  §10); remote users see a preview through presence.
- **Picking and visibility**: `three-mesh-bvh` 0.9.16 (MIT, peer `three >= 0.159`) for raycasts, camera-based
  selection and later Quad Draw's live surface; the existing `MeshPicker` (`packages/viewport/src/picking`) stays
  the animation-mode picker.
- **Later libraries**: decimation via `meshoptimizer` 1.3.0 (MIT); booleans via `manifold-3d` 3.5.4
  (Apache-2.0, WASM) or `three-bvh-csg` 0.0.18 (MIT, pre-1.0). Versions from the npm registry on 2026-10-18;
  pin with the usual minimum release age.
- **Budgets (proposal)**: any BASE operator on a 10k-face mesh < 16 ms on the main thread; component pick < 1 ms;
  marquee over 20k vertices with camera-based visibility < 8 ms; heavier work moves to a worker.
- **Selection model**: note 08 §6.4 already reserves `{ node, component: { kind: 'vertex' | 'edge' | 'face',
  index } }`; indices are only valid for one topology revision, so every topology operator returns the new
  selection (§4.0) instead of letting the selection go stale.

---

## 9. Test oracles

Every operator test asserts V − E + F against the expected Euler characteristic (2 for a closed genus-0 shell),
consistent winding, no non-manifold edges, and the counts below.

| Case | V / E / F after |
|---|---|
| Cube | 8 / 12 / 6 |
| Extrude one cube face (together) | 12 / 20 / 10 |
| Extrude two adjacent faces together | 14 / 24 / 12 |
| Extrude two adjacent faces individually | 16 / 28 / 14 |
| Insert edge loop around the four sides | 12 / 20 / 10 |
| Bevel one edge, 1 segment | 10 / 15 / 7 |
| Bevel all 12 edges, 1 segment | 24 / 48 / 26 |
| Delete one edge (plain / Delete Edge/Vertex) | 8 / 11 / 5 · 6 / 9 / 5 |
| Merge to Center on the top face | 5 / 8 / 5 |
| Collapse one edge | 7 / 11 / 6 |
| Triangulate cube | 8 / 18 / 12 |
| Half cube (centre loop, −X faces deleted) → Mirror with merge | 8 / 12 / 5 → 12 / 20 / 10 |
| Open 8-sided cylinder → Fill Hole ×2 | 16 / 24 / 8 → 16 / 24 / 10 |
| Desktop-DCC default sphere 20×20 | 382 / 780 / 400 (760 tris) |
| Desktop-DCC default cylinder 20 × 1, n-gon caps | 40 / 60 / 22 (76 tris) |
| Spin any edge | counts unchanged; both faces keep their sides |

Property tests: random sequences of BASE operators on random low-poly meshes never produce non-manifold edges
(except edge-extrude of interior edges with the option on), never lose a skin weight sum (each vertex sums to 1
± 1e-6), and undo returns the byte-identical blob.

---

## 10. Open questions for the owner

| ID | Question | Default proposed |
|---|---|---|
| Q-MOD-10-1 | Exact slot positions of the desktop DCC's RMB component menu in your install: confirm or correct §6.2 row 1 | as in §6.2 |
| Q-MOD-10-2 | `Ctrl+E`: Extrude in the Model viewport and Export moves to `Ctrl+Shift+E` (Export keeps `Ctrl+E` elsewhere)? | yes |
| Q-MOD-10-3 | Digits `1`/`2`/`3` for vertex/edge/face (as in the open-source DCC's Industry Compatible keymap) while the desktop DCC's smooth preview moves to `Shift+1/2/3`? | yes |
| Q-MOD-10-4 | Primitive defaults low poly (sphere 12×8, cylinder 8) with a "DCC defaults" preference (`primitiveDefaults: 'dcc'`)? | yes |
| Q-MOD-10-5 | Plain `Delete` on edges keeps vertices (desktop-DCC behaviour) and `Ctrl+Delete` cleans, or clean by default? | desktop-DCC behaviour + stray-vertex lint |
| Q-MOD-10-6 | Live mirror (instance preview) in BASE instead of NEXT, given it is open-source-DCC users' main habit? | NEXT |
| Q-MOD-10-7 | Triangle budget source: per export profile (OMOBA, Space) or a user target in the HUD? | both: profile budget when an Ekza profile is chosen, user target otherwise |

---

## Sources

Desktop DCC help (vendor documentation; page titles kept, URLs omitted):

- Select menu (component modes, Grow)
- Modeling Tools hotkeys
- Modeling hotkeys (1/2/3, Ctrl+F9–F12, Page Up/Down)
- Marking menus (RMB, Shift+RMB per mode, Ctrl+RMB, Ctrl+Shift+RMB)
- Select Tool settings (soft selection, symmetry, camera-based selection)
- Symmetrical editing
- Multi-component selection
- Select an edge loop
- Select an edge ring
- Convert selection (perimeters, Ctrl+RMB)
- Primitive commands (2026): `polyCube`, `polySphere`, `polyCylinder`, `polyCone`, `polyPlane`, `polyTorus`
- Extrude a polygon face, edge or vertex
- Extrude Options (2026)
- `polyExtrudeFacet` / `polyExtrudeEdge` (2026)
- Edit Mesh menu
- Bevel Options
- `polyBevel3` (2026)
- `polyBridgeEdge` (2026)
- Fill holes
- Append to Polygon Tool
- Multi-Cut Tool hotkeys
- Insert Edge Loop Tool Options (2026)
- Insert an edge loop (2026)
- `polySplitRing` (2026)
- `polyDuplicateEdge` (2026)
- Target Weld Tool Options
- `polyMergeVertex` (2026)
- Delete edges / Delete vertices
- `polyDelEdge` node (2027)
- Spin polygonal edges
- Combine / Extract / Duplicate Faces options
- Mirror Options
- `polyMirrorFace` (2026)
- Smooth mesh preview overview
- Mesh Display (soften/harden, normal angle)
- `polyNormal`
- Status line (snapping)
- Modify menu (freeze, reset, pivots)
- Delete by Type (history)
- Quad Draw hotkeys
- `polyQuad` (2026)
- Cleanup Options
- Poly count in the scene view
- Automatically retopologize (2026)
- `polySmartBevel` node (2027)

Release news (URLs omitted):

- Desktop DCC 2027 release report (Digital Production, 2026-03-26)
- Smart Bevel in the vendor's 2027 releases (80.lv)

Open-source DCC (5.2 LTS manual; URLs omitted):

- Industry Compatible keymap
- Undo & Redo, Adjust Last Operation

Formats and libraries:

- glTF 2.0 specification (meshes, flat normals, `COLOR_0`; joint hierarchy rule): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- three-mesh-bvh (MIT): https://www.npmjs.com/package/three-mesh-bvh
- three-bvh-csg (MIT): https://www.npmjs.com/package/three-bvh-csg
- manifold-3d (Apache-2.0): https://www.npmjs.com/package/manifold-3d
- meshoptimizer (MIT): https://www.npmjs.com/package/meshoptimizer

Community practice:

- Polycount, joint loops on low-poly characters: https://polycount.com/discussion/161450/help-with-topology
