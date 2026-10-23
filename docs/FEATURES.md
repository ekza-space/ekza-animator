# Ekza Studio — feature catalogue

What the product can do today, by category: one line per feature, where it lives in the UI and since which release.
Live at [studio.ekza.io](https://studio.ekza.io); this file describes **v0.5.1** (2026-10-23, the tree of `dev` at the
time of writing). Machine-readable copy: [FEATURES.summary.json](FEATURES.summary.json). For how things are built see
[ARCHITECTURE.md](../ARCHITECTURE.md) and the specs linked per section; for what comes next see [ROADMAP](ROADMAP.md)
and [TODO](../TODO.md).

**Status legend**

| Status | Meaning |
|---|---|
| `v0.x.y` | Shipped in that release (still in the current one) |
| **Experimental** | In the code and usable, but its acceptance test is still pending or it is a stretch item |
| **Next release** | Built on an integration branch, not on `dev` yet |
| **Planned (Mx)** | Specified or on the roadmap, not built; Mx is the milestone in [ROADMAP](ROADMAP.md) |

**Releases**

| Tag | Date | Milestone |
|---|---|---|
| `v0.1.0` | 2026-10-18 | M1 — first testable alpha: open, control rig, keying, Graph Editor, export |
| `v0.2.0` | 2026-10-19 | M2a — game-clip daily driver: limb IK, Dope Sheet, tweens, buffer curves, autosave |
| `v0.3.0` | 2026-10-20 | M6a — low-poly modeling base (Model workspace); layout presets and focus mode |
| `v0.3.1` | 2026-10-21 | Basic shading (Lambert / Blinn swatch shaders) |
| `v0.3.2` | 2026-10-22 | Code renamed Ekza Animator → Ekza Studio |
| `v0.4.0` | 2026-10-22 | M6b MVP — Rig & Skin workspace |
| `v0.5.0` | 2026-10-23 | Auto-Rig mode (and the A-pose path in Studio) |
| `v0.5.1` | 2026-10-23 | Auto-Rig size gate (0.3–3 m) |

## At a glance

| Category | Key capabilities | Status |
|---|---|---|
| [Two modes](#1-overview-and-the-two-modes) | Start chooser: full **Studio** or the five-step **Auto-Rig** wizard, one shared document and undo history | `v0.5.0` |
| [Workspaces and UI](#2-workspaces-and-ui) | Model / Animate / Rig & Skin tabs, dockview panels, layout presets, focus mode, Maya keymap, marking menus, command palette | `v0.1.0`–`v0.5.0`; Review tab planned (V1) |
| [Modeling](#3-modeling-model-workspace) | Low-poly box modeling: primitives, templates, component modes, extrude session, bevel, loops, multi-cut, symmetry, soft selection, snapping, palette colour, Mesh Check, static GLB export | `v0.3.0` |
| [Rig & Skin](#4-rig--skin) | Quick Rig markers, VRM skeleton templates, Create Skeleton with auto control rig, Bind Skin, weight painting, test poses, Validation gate, VRM 1.0 export | `v0.4.0` (A-pose path `v0.5.0`) |
| [Auto-Rig mode](#5-auto-rig-mode) | GLB/VRM → checks with one-click fixes → markers → one-click rig → CC0 clips → OMOBA/Space VRM, GLB, VRMA or OMOBA test kit | `v0.5.0`, `v0.5.1` |
| [Animation](#6-animation) | Circle-control rig, leg/arm IK with foot roll, keying, breakdowns, tweens, Dope Sheet, Graph Editor (Maya tangents, buffer curves), clips, pose tools, Clip Library | `v0.1.0`, `v0.2.0`, `v0.4.0` |
| [Shading](#7-shading) | Every palette swatch is a Lambert or Blinn shader; exported as glTF PBR | `v0.3.1` |
| [Import / export](#8-import-and-export) | GLB, VRM 0.x/1.0, VRMA, `.ekzanim`; bake into the original file, VRMA, animation GLB, static GLB, VRM 1.0 character, OMOBA kit; profiles and lints | `v0.1.0`–`v0.5.0` |
| [Project and data](#9-project-and-data) | `.ekzanim` projects, autosave + crash recovery, transactional undo, collaboration-ready document model | `v0.1.0`, `v0.2.0` |
| [Ekza ecosystem](#10-ekza-ecosystem) | Space/OMOBA-ready exports (Tier 0), Ekza metadata and slots, OMOBA runtime lints; Hub publish planned | `v0.1.0`, `v0.4.0`; publish planned (M4a) |
| [AI control via MCP](#11-ai-control-via-mcp-m-ai) | `ekza-studio-mcp` server: an AI agent (Claude Code, …) edits, rigs, animates and exports through undoable `AI: …` steps | **Next release** |
| [Platform and limits](#12-platform-and-limits) | Chrome/Edge, local-only and telemetry-free, performance budgets, bundle gates, MIT | `v0.1.0`+ |
| [Not yet](#13-known-limitations-and-not-yet) | FBX/BVH/OBJ, UV editor, constraints, layers, collaboration, AI generation, … | Planned |

---

## 1. Overview and the two modes

Ekza Studio is an open-source, browser-based 3D package for glTF and VRM characters: model low-poly meshes, rig and
skin them, animate with a Maya-grade workflow and export to glTF/VRM/VRMA. It has two front ends over **one app, one
document and one undo history** ([ADR 0021](adr/0021-autorig-mode.md)).

| Feature | What it does | Where | Status |
|---|---|---|---|
| Start chooser | Landing page with two cards: **Start Auto-Rig** and **Open Studio** | `/` | `v0.5.0` |
| Remembered choice | "Remember my choice on this device" skips the chooser next time; `/?chooser=1` shows it again | `/`; Edit › Preferences… › *Start in* (Ask / Auto-Rig / Studio) | `v0.5.0` |
| Studio | The full package: Model, Animate and Rig & Skin workspaces | `/editor` (`?ws=` picks the workspace) | `v0.1.0` |
| Auto-Rig | Five-step Mixamo-style wizard from a static humanoid to an animated VRM | `/autorig` (`?step=`, `?sample=`) | `v0.5.0` |
| Switch Studio → Auto-Rig | Hands the current document (selection, else visible meshes, else the character) to the wizard, with undo | File › Auto-Rig This Model…; Help › Switch to Auto-Rig; first-run dialog | `v0.5.0` |
| Switch Auto-Rig → Studio | Same document and undo history into Rig & Skin (Animate from step ④); or a copy in a new tab | header **Open in Studio ▸**; `⋯` › Open in Studio (new tab) | `v0.5.0` |
| Getting Started | First-run dialog: what do you want to do first | Help › Getting Started | `v0.1.0` |

## 2. Workspaces and UI

Specs: [MVP-SPEC](MVP-SPEC.md) §4.10–4.11, [M6A-SPEC](M6A-SPEC.md) §7–8, [LAYOUT-PRESETS](LAYOUT-PRESETS.md).

### 2.1 Workspaces and panels

| Feature | What it does | Where | Status |
|---|---|---|---|
| Animate workspace | Viewport, Outliner, Clips, Channel Box, Attributes, Graph Editor, Dope Sheet, Clip Library, time slider | workspace tab **Animate** | `v0.1.0` (Dope Sheet `v0.2.0`, Clip Library `v0.4.0`) |
| Model workspace | Viewport, Outliner, Toolkit, Channel Box, Attributes, Palette, Mesh Check; time slider hidden | tab **Model** | `v0.3.0` |
| Rig & Skin workspace | Viewport with the Rig checklist, Rig Toolkit, Paint Weights, Validation panels | tab **Rig & Skin** | `v0.4.0` |
| Review workspace | Read-only review tab | tab shown disabled ("Arrives in V1") | Planned (V1) |
| Docked panels | dockview layout: drag, tab, split and float panels; Windows › *panel name* reopens one | Windows menu; Windows › Reset Workspace | `v0.1.0` |
| Viewport layouts | Single / Shot \| Free split (locked shot camera + free camera) / Four View; Model: Front \| Persp; Rig: Front \| perspective, Front \| side \| perspective | Windows › Layout | `v0.1.0` (Model `v0.3.0`, Rig `v0.4.0`) |
| Rig view-only on small screens | Studio's Rig & Skin is view-only below 1024 px (Auto-Rig has its own small-screen layouts) | automatic | `v0.4.0` |

### 2.2 Layout presets and focus

| Feature | What it does | Where | Status |
|---|---|---|---|
| Built-in presets | Animate (default), Blocking (viewport + time slider), Polish (viewport over a large Graph Editor), Review (viewport + playback) | `Alt+1`…`Alt+4`; Windows › Presets | `v0.3.0` |
| User presets | Save the current layout; rename or delete (stored in the browser) | Windows › Presets › Save Current Layout as… / Rename or Delete Presets… | `v0.3.0` |
| Focus mode | Only the viewport; again restores exactly | `Ctrl+Space` or `Alt+0`; Windows › Focus Mode | `v0.3.0` |
| Chrome toggles | Show/hide Tool Strip, Help Line, Time Slider per workspace | Windows menu | `v0.3.0` |
| Full screen | Browser full screen | `Shift+F`; Windows › Full Screen | `v0.3.0` |
| Maximize panel | Tap Space maximizes the panel under the pointer (or play/stop, per preference) | `Space` (tap) | `v0.1.0` |

### 2.3 Input: keys, menus, palette

| Feature | What it does | Where | Status |
|---|---|---|---|
| Maya keymap | Layout-independent Maya hotkeys (`Q/W/E/R`, `S`, `F/A`, `,` `.`, `Alt+V`, `1`–`7` tangents, …), `Mod` = ⌘ on macOS | Help › Keyboard Shortcuts (`Shift+/`) | `v0.1.0`, extended `v0.2.0`/`v0.3.0` |
| Marking menus | Maya radial menus: RMB component modes and Shift+RMB tools in Model, `M` merge menu; RMB rig-mode menus in Rig & Skin | viewport RMB / Shift+RMB | `v0.3.0` (rig `v0.4.0`) |
| Camera radial | Hold Space in the viewport for a camera radial | `Space` (hold) | `v0.1.0` |
| Command palette | Search and run any operator by name | `Mod+K` | `v0.3.0` |
| Repeat / adjust last | Repeat last operation, re-open its Last-op card, re-activate last tool | `G`, `T`, `Y` (Model); Edit menu | `v0.3.0` |
| Navigation profiles | Maya three-button mouse (Alt+drag), trackpad (scroll/pinch), one-button mouse (Option+drag) | Edit › Preferences… › Navigation | `v0.1.0` |
| Preferences | Start in, navigation, Space key, auto-key channels, key reduction on import, Graph Editor handles | Edit › Preferences… | `v0.1.0` (Start in `v0.5.0`) |
| Pick-walk | Arrow keys walk the control hierarchy (Animate) or components (Model) | arrows | `v0.2.0` / `v0.3.0` |
| MMB virtual slider | Middle-drag in the viewport changes the selected channel | MMB drag | `v0.2.0` |
| Channel Box | Numeric channel values, lock channels | Channel Box panel | `v0.1.0` |

### 2.4 Viewport

| Feature | What it does | Where | Status |
|---|---|---|---|
| Manipulators | Move / Rotate / Scale with object, world and gimbal spaces; size `-`/`=` | `W`/`E`/`R`; View menu | `v0.1.0` (Scale `v0.3.0`) |
| Framing | Frame selection / all | `F` / `A` | `v0.1.0` |
| Selection | Click, marquee, click-cycling through overlaps, mesh click selects the control | viewport | `v0.1.0` |
| Display toggles | X-ray, skeleton, controls, camera lock | `Alt+X`, `Alt+J`, `Alt+C`, `Alt+L` | `v0.1.0` |
| Shading modes | Wireframe / Shaded / Colours / Lit | `4`–`7`; Display › Shading | `v0.3.0` |
| Hide / isolate | Hide selected / unselected, show all, isolate select | `H`, `Alt+H`, `Shift+H`, `Shift+L` | `v0.3.0` |
| Copy view to shot camera | Store the free camera as the locked shot camera | View menu | `v0.1.0` |
| Idle = zero frames | No WebGL or canvas redraw while nothing changes (CI gate) | — | `v0.1.0` |

## 3. Modeling (Model workspace)

Low-poly box modeling with Maya's hands. Spec: [M6A-SPEC](M6A-SPEC.md), [ADR 0014–0016](adr/). All in the **Model**
tab, `v0.3.0` unless noted.

### 3.1 Create

| Feature | What it does | Where |
|---|---|---|
| Polygon primitives | Cube, Sphere, Cylinder, Cone, Plane, Torus with editable parameters | Create › Polygon Primitives |
| Templates | Prop, Handheld, Humanoid Guides, Humanoid Body (Smooth / Segmented) | Create › Templates |
| Reference images | Image planes in the front / side / top views | Create › Reference Image |
| Groups and hierarchy | Empty group, group, parent, unparent, duplicate, rename, delete | Create, Edit; `Mod+G`, `P`, `Shift+P`, `Mod+D` |
| Static model import | Import an unskinned GLB as editable scene meshes (operator `mesh.importStatic`, used by Auto-Rig ①; no Studio menu item) | Auto-Rig ①, then *Open in Studio* |
| Make editable | Turn an imported character's mesh into an editable mesh; bakes back with skin weights, expressions and MToon looks | Mesh › Make Editable |

### 3.2 Select

| Feature | What it does | Where |
|---|---|---|
| Component modes | Object / Vertex / Edge / Face | `F8`, `1`/`2`/`3` (`F9`/`F10`), RMB marking menu, Select menu |
| Loops and rings | Maya loop/ring picks (double-click), Edge Loop, Edge Ring, Border, Shell | Select menu |
| Grow / shrink / invert | Grow, shrink, invert, all, none | `Shift+.`, `Shift+,`, Select menu |
| Convert selection | To vertices / edges / faces / loop / ring / shell / border, contained, perimeters | Select › Convert Selection; `Mod+F9`…`F11` |
| Select by swatch | Faces painted with the active swatch | Select › By Swatch |
| Soft selection | Falloff selection for organic moves | `B` (tap); settings in Toolkit |
| Selection undo | Selection changes are undo steps in Model | `Mod+Z` |
| Backfaces / camera-based / selection style | Selection options | Toolkit |

### 3.3 Edit and tools

| Feature | What it does | Where |
|---|---|---|
| Extrude session | Adjustable extrude: drag the cap with W/E/R, Divisions on the Last-op card, undo one drag at a time, type a value with `T` | `Mod+E`; Edit Mesh › Extrude |
| Inset, Bevel, Bridge, Connect | Core topology ops with Last-op parameters | Edit Mesh; Bevel `Mod+B` |
| Insert / Offset Edge Loop | Insert a loop (tool) or offset one | Mesh Tools; Edit Mesh |
| Multi-Cut | Cut edges across faces | `K`; Mesh Tools › Multi-Cut |
| Slide Edge, Average Vertices | Slide along edges, relax vertices | Mesh Tools; Edit Mesh |
| Merge family | Merge, Merge to Center, Merge by Distance, Collapse, Target Weld | `M` marking menu; Edit Mesh › Merge; Mesh Tools |
| Face ops | Extract, Duplicate Face, Delete Edge/Vertex, Flip Triangle Edge, Spin Edge | Edit Mesh; `Mod+Del`, `Ctrl+Alt+←/→` |
| Mesh ops | Combine, Separate, Fill Hole, Mirror, Symmetrize, Triangulate, Quadrangulate, Cleanup… | Mesh menu |
| Symmetry per mesh | Remembered per mesh; every tool mirrors | status line Symmetry; Toolkit |
| Snapping | Grid, vertex, increment snaps | Modify › Snap |
| Pivots | Center, Bottom Center, Reset, Bake, edit pivot | Modify › Pivot; `Insert`/`Home` |
| Transforms | Freeze / Reset Transformations | Modify |
| Normals | Soften / Harden Edge, Set Normal Angle, Reverse, Conform; show normals, face orientation, triangulation, hard edges, wire-on-shaded, backface culling | Mesh Display |
| UV projections | Planar, Automatic (box), Cylindrical (no UV editor) | UV menu |
| Modeling Toolkit | Tool options with option boxes | Toolkit panel |

### 3.4 Colour, checks and export

| Feature | What it does | Where |
|---|---|---|
| Palette colour | One palette slot per face; Ekza Default 16; add / edit / replace swatches; palette variants | Palette panel; Edit Mesh › Assign Colour |
| Paint Colour, Fill Shell | Brush faces or whole shells with the active swatch | Mesh Tools › Paint Colour |
| Poly Count HUD | Triangle count against a budget preset (hero 3,000, NPC 1,000, boss 6,000, handheld 600, props, building) | viewport HUD |
| Mesh Check | Game-readiness checks of the model | Mesh › Mesh Check (panel) |
| Static GLB export | Writes the model as GLB with Ekza provenance; colour as one palette texture, vertex colours or one material per colour; profile `ekza/omoba-handheld-v1` | File › Export… (`Mod+Shift+E`) |

## 4. Rig & Skin

Turn a mesh you modelled into a VRM 1.0 character. Spec: [M6B-SPEC](M6B-SPEC.md) §0 (the MVP cut),
[ADR 0020](adr/0020-m6b-mvp-cut.md). All in the **Rig & Skin** tab, `v0.4.0` unless noted.

| Feature | What it does | Where |
|---|---|---|
| Rig checklist | Guided steps: Quick Rig → fit joints → Bind Skin → fix weights → try clips → export | viewport checklist |
| Rig modes | Object / Skeleton / Skin modes with their own tools and marking menus | Select › Mode; RMB |
| Model checks | Centred, grounded, facing +Z with one-click fixes (*Center and ground*, *Rotate to face +Z*) | Quick Rig |
| Quick Rig markers | Nine markers (head top, chin, pelvis, shoulder, elbow, wrist, knee, ankle, toe) guessed from the silhouette; drag in front view = x/y, side view = depth; left mirrors right | Skeleton › Quick Rig… |
| VRM skeleton templates | Lite 17, Core 21, Standard 33, Full 52 humanoid templates; live preview while markers move | Create / Skeleton › Skeleton Template |
| Create Skeleton | One undo step: character + skeleton + control rig (IK legs, FK arms) | Quick Rig › Create Skeleton |
| Character from selection | Make a character from selected meshes | Create › Character from Selection |
| Joint editing | `W` moves a joint with children, `D`+`W` alone, `E` rotates the rest; symmetry X; snap to projected center | Skeleton mode |
| Orient / Mirror Joints | Joint orientation and mirroring | Skeleton › Orient Joints… / Mirror Joints… |
| Map Humanoid Bone | Assign the VRM humanoid bone of a joint | Skeleton › Map Humanoid Bone ▸ |
| Update Control Rig | Re-derive controls after joint edits | Skeleton › Update Control Rig |
| Joint display | Joint size, X-ray joints, local rotation axes, joint labels | Display menu |
| Bind Skin | One-click automatic low-poly weights in a worker; ≤ 4 influences, normalized, symmetric | Skin › Bind Skin… |
| Unbind / bind pose | Unbind skin; return to bind pose | Skin menu |
| Paint Skin Weights | Replace / Add / Scale / Smooth, Flood, influence holds, X-mirrored stroke, `B`/`M`/`N` brush drags | `2` in Skin mode; Skin › Paint Skin Weights; Paint Weights panel |
| Weight utilities | Mirror, Smooth, Prune Small, Normalize weights; Remove Unused Influences | Skin menu |
| Weight display | Greyscale, Ramp, Influence Colours | Display › Weight Display |
| Test poses | `E` on a joint tries a pose (never a key); paint on the posed mesh; Reset Test Pose | Skin mode; Modify |
| Validation | Rows with severity and Fix buttons; errors gate the export; profile switch | Validation panel |
| A-pose path | T-Stance (test pose), Apply Pose as Rest, **Straighten to T-Pose** so an A-posed model exports as a T-pose VRM | Skeleton menu; Validation `skel.tpose` Fix — `v0.5.0` |
| Size check | `skel.height` row: a humanoid must be 0.3–3 m tall | Validation — `v0.5.0` |
| Clip Library | 14 CC0 clips (Quaternius UAL) previewed on the character; **Use Clip** makes an editable clip | Clip Library panel |
| VRM meta and thumbnail | Name, authors, licence presets (CC0 first, CC BY 4.0, Personal, Custom); rendered square thumbnail | File › VRM Meta…, Render Thumbnail |
| Export Character | VRM 1.0 for Space and OMOBA (or plain GLB) behind the Validation gate | File › Export Character… |

## 5. Auto-Rig mode

A five-step wizard built only from Studio's operators. Guide: [guides/autorig.md](guides/autorig.md); spec:
[AUTORIG-SPEC](AUTORIG-SPEC.md). Route `/autorig`, `v0.5.0` unless noted.

| Feature | What it does | Where |
|---|---|---|
| Step frame | Five numbered steps with progress; main button `Ctrl/⌘+Enter`; `Alt+1`…`Alt+5` jump | header |
| Samples | Cube Lad, Polybot (T-pose, A-pose, VRM), Seed-san | ① *Try a sample*; `?sample=` |
| **① Model** intake | Drop or choose a `.glb`/`.gltf`/`.vrm` (or a project); a VRM skips to animations | ① |
| Model checks + fixes | Centred, grounded, facing +Z, upright, human size, pose (T or A); fixes *Center and ground*, *Face forward*, *Stand up*, *Set height* — one undo step each | ① report |
| Multi-part characters | Parts touching the body (directly or through other parts) belong to the character; separate things are left out; tick/untick parts, *Tick all* | ① parts list |
| Heavy meshes | Warns above 60,000 triangles, refuses above 200,000 with Blender advice | ① |
| **② Markers** | Nine markers guessed from the silhouette, front/side drag rule, list pick, arrow nudge 1 cm (Shift 1 mm), `G` re-guess | ② |
| Finger detail | None / thumb + 1 / full hands | ② |
| Arms gate | *Auto-rig* waits for Shoulder, Elbow, Wrist markers when arms are not found | ② |
| Size gate | *Auto-rig* waits while the character is outside 0.3–3 m tall | ② — `v0.5.1` |
| **③ Rig** — *Auto-rig* | Creates the VRM skeleton, binds the skin and straightens an A-pose to T-pose; each part its own undo step | ③ |
| Rigid separate parts | Parts reaching two limbs move rigidly with their own region (default on for multi-part characters) | ③ option |
| Motion test | The character plays Walk at once (Sword, Dance too); `Esc` stops | ③ |
| Adjust joints | Front / side / 3D joint editing; *Done* re-aligns hands and rebinds | ③ |
| Paint weights | Studio's brush (Replace, Add, Smooth, mirror) — not on phones | ③ |
| Rig checks + fixes | Named problems with fixes (arm off the T-pose line, bones moving no part, …) | ③ |
| **④ Animations** | Search the CC0 library, preview on the character, Speed / Trim / Mirror / In place / Arm space, add many, edit ✎, remove ✕ | ④ |
| OMOBA slots | Clips map to idle, walk, run, attack, cast, hit, death, dance, jump; slot-less clips flagged | ④, ⑤ |
| Own VRMA | Drop your own `.vrma` clips | ④ |
| **⑤ Export** targets | Ekza avatar VRM 1.0 (recommended); VRM 0.x kept as it is; GLB with animations; rigged GLB; animations as `.vrma`; OMOBA local test kit (`.zip`) | ⑤ |
| Export checklist | VRM 1.0 humanoid, 15 required bones, standard parents, T-pose rest, every part skinned, plain transforms, name/author, licence, thumbnail, size ≤ 50 MiB, ≤ 4,096 nodes, ≤ 64 humanoid bones, allowed extensions, read-back, human size; errors block *Download* | ⑤ |
| Metadata | Author, licence, rendered thumbnail saved in the file | ⑤ "About this avatar" |
| Session restore | *Continue where you left off* after a reload | on load |
| Devices | Desktop and tablet full; phone: all but weight painting | responsive layouts |

## 6. Animation

Specs: [MVP-SPEC](MVP-SPEC.md), [M2A-SPEC](M2A-SPEC.md), [ADR 0003](adr/0003-time-rotation-and-curve-engine.md),
[ADR 0004](adr/0004-rig-model.md), [ADR 0007](adr/0007-graph-editor-canvas2d.md).

### 6.1 Control rig and IK

| Feature | What it does | Where | Status |
|---|---|---|---|
| Auto FK control rig | Circle controls sized from the mesh, offset groups (zero = rest), side colours, `root`/`cog`/hips; 1:1 FK rig for any skinned GLB | on load | `v0.1.0` |
| Secondary controls | Show/hide secondary controls; control size; rotate order (pose-preserving) | Rig menu; Attributes | `v0.1.0` |
| Leg and arm IK | Two-bone IK with knee/elbow poles, soft IK, twist; legs IK by default, arms FK with IK one click away | Attributes › Limb; Rig › IK/FK | `v0.2.0` |
| IK/FK switch and match | Blend, match, seamless switch, Match Range | Rig › IK/FK | `v0.2.0` |
| Foot roll | Heel, ball, toe, bank, twists with pivots from the foot mesh; Edit Foot Pivots | Attributes | `v0.2.0` |
| Add Limb IK | Upgrades an M1 (FK) rig in one undoable step | Rig › Add Limb IK | `v0.2.0` |
| Pin / Plant Feet | Keep FK feet on the ground | Pose › Pin Feet / Plant Feet / Unpin Feet | `v0.1.0` |
| VRM constraints | VRM node constraints evaluated in the preview | — | `v0.1.0` |

### 6.2 Keying and poses

| Feature | What it does | Where | Status |
|---|---|---|---|
| Set key | All / translate / rotate / scale channels | `S`, `Shift+W/E/R`; Key menu | `v0.1.0` |
| Auto key | Keys channels as you edit (keyed-only or all, per preference) | `Shift+K` | `v0.1.0` |
| Breakdowns | Breakdown keys with proportional retiming; convert key ↔ breakdown | `Alt+S`; Key menu | `v0.2.0` |
| Tween family | Tween, blend to neighbour, ease, push/pull, blend to default, with overshoot | status-line Tween bar; Key menu (±50); curve panels | `v0.2.0` |
| Key target | Key selected controls, a body part or the whole character | Key › Key Target | `v0.2.0` |
| Unkeyed tweaks | Undoable edits that are not keyed yet | — | `v0.1.0` |
| Pose clipboard | Copy, paste, paste mirrored, flip, mirror L→R / R→L, reset to rest | `Mod+C/V`, `Mod+Shift+V`, `Alt+M`; Pose menu | `v0.1.0` |
| Mirror animation | Writes the other side half a cycle later | Pose › Mirror Animation | `v0.2.0` |

### 6.3 Time, Dope Sheet, Graph Editor

| Feature | What it does | Where | Status |
|---|---|---|---|
| Time slider | Key ticks, scrub, Shift-drag range move/scale/delete/copy/paste, playback range | bottom | `v0.1.0` |
| Playback | Loop / once / oscillate; real time, every frame, half/double speed; play backwards; step, prev/next key | `Alt+V`, `,` `.`, `Alt+,` `Alt+.`; Playback menu | `v0.1.0` |
| Scene clock | Shared clock for several characters; per-clip fps | — | `v0.1.0` |
| Dope Sheet | Summary, character, body-part, control and channel rows, hold bars; select/move/scale tools | Dope Sheet panel (`Q/W/R`) | `v0.2.0` |
| Retiming | Ripple edit, `Mod`+drag copy, MMB pose carry, insert/remove frame, delete time, key nudge (arrows) | Dope Sheet, time slider; Key › Ripple Edit; Playback › Insert Frame / Remove Frame / Delete Time | `v0.2.0` |
| Graph Editor | Canvas2D, exact curves; select keys/handles (click, box, double-click curve), move with axis lock, insert key, numeric fields | Graph Editor panel | `v0.1.0` |
| Tangents | Auto, spline, clamped, linear, flat, stepped, plateau (also stepped next, fixed); break/unify; weighted with lock/free weight | `1`–`7`, `B`, `U`; Graph › Tangents | `v0.1.0` |
| Curve tools | Pre/post infinity (constant, linear, cycle, cycle with offset, oscillate), Euler filter, Simplify, key curves at the current frame | Graph › Curves | `v0.1.0` |
| Buffer curves | Snapshot, swap, clear | Graph › Buffer Curves | `v0.2.0` |
| Views and Scale tool | Normalized and stacked views; Scale tool with a region box | `N`, `Shift+N`, `R` | `v0.2.0` |
| Cycle-aware tangents | Loop clips get seamless auto tangents at the seam | automatic | `v0.2.0` |

### 6.4 Clips

| Feature | What it does | Where | Status |
|---|---|---|---|
| Clips per character | New, duplicate, rename, delete, set active; Ekza slot, contact frame, tags, provenance, fps | Clips panel; Clip menu; Clip Settings | `v0.1.0` |
| Clip Library | 14 CC0 starter clips (Idle, Walk, Run, Jog, Sword attack, Punch, Cast, Hit, Death, Dance, Pistol shoot, Jump start/loop/land) with preview and Use Clip | Clip Library panel | `v0.4.0` |
| Embedded clip import | A model's clips import at their own frame rate with optional key reduction | Import… | `v0.1.0` |

## 7. Shading

Spec: [SHADING-SPEC](SHADING-SPEC.md), [ADR 0019](adr/0019-swatch-shaders.md). All `v0.3.1`.

| Feature | What it does | Where |
|---|---|---|
| Swatch shaders | Every palette swatch is a shader: Lambert (default) or Blinn with glossiness and specular colour | Palette panel › Shader |
| Assign New Material | New Lambert/Blinn on selected faces or objects, one undo step | Edit Mesh › Assign New Material |
| Flat / smooth | Follows hard/soft edges; Blinn highlight per face or continuous | Mesh Display |
| Viewport preview | Blinn highlight in Colours and Lit shading, matching the exported roughness | `6`/`7` |
| glTF export | Lambert → roughness 1 / metallic 0; Blinn → roughness from glossiness + `KHR_materials_specular` | Export |

## 8. Import and export

Specs: [ADR 0005](adr/0005-export-strategy.md), [ADR 0010](adr/0010-ekza-integration-tiers.md), research
[02](research/02-formats-gltf-vrm.md).

### 8.1 Import

| Feature | What it does | Where | Status |
|---|---|---|---|
| glTF / VRM models | `.glb`, `.vrm` (VRM 0.x and 1.0); Draco, meshopt and KTX2 display | File › Open… (`Mod+O`), Import… (`Mod+I`), drag-and-drop | `v0.1.0` |
| VRMA clips | `.vrma` onto a humanoid character | Import… | `v0.1.0` |
| Animation-only GLB | Adds clips to the loaded character by node name (content-sniffed) | Import… | **Experimental** (acceptance test pending, FR-IO-10) |
| Static GLB meshes | Unskinned `.glb`/`.gltf` imported as editable scene meshes | Auto-Rig ① (drop or *Choose file…*) | `v0.5.0` |
| Samples | Seed-san (VRM 1.0), Polybot (VRM 0.x), Quaternius Animation Library (GLB) | File › Samples | `v0.1.0` |

### 8.2 Export

| Feature | What it does | Where | Status |
|---|---|---|---|
| Bake into original | Clips written back into the original GLB/VRM — append-only, every original JSON value and buffer byte preserved, safe re-bake | File › Export… (`Mod+E`) | `v0.1.0` |
| VRMA | One clip per `.vrma` file | Export… | `v0.1.0` |
| Animation-only GLB | Clips without the mesh | Export… | `v0.1.0` |
| Key reduction | Error-bounded, on by default, never makes a file larger | Export dialog | `v0.2.0` |
| Root motion "In place" | Removes a clip's travel, keeps its sway | Export dialog | `v0.2.0` |
| IK bake | IK limbs baked to bones like FK | automatic | `v0.2.0` |
| Static model GLB | See §3.4 | Export… (Model) | `v0.3.0` |
| VRM 1.0 character | See §4; also from Auto-Rig ⑤ | File › Export Character… | `v0.4.0` |
| VRM 0.x kept | A VRM 0.x avatar exports as 0.x with clips baked in | Auto-Rig ⑤ | `v0.5.0` |
| OMOBA local test kit | Zip with the VRM, thumbnail, manifest entry and validator steps | Auto-Rig ⑤ › For developers | `v0.5.0` |
| Read-back check | Every written file is re-read; a failed read-back blocks the download | automatic | `v0.1.0` |

### 8.3 Profiles and lints

| Profile | For | Status |
|---|---|---|
| `ekza/space-avatar-v1` | Ekza avatar — Space and OMOBA (VRM 1.0); OMOBA runtime rules are errors | `v0.4.0` |
| `ekza/omoba-humanoid-v1` | OMOBA humanoid GLB with the five game clips | `v0.1.0` |
| `ekza/vrma-humanoid-v1` | Ekza humanoid clip (VRMA) | `v0.1.0` |
| `ekza/omoba-handheld-v1` | Static handheld prop | `v0.3.0` |
| `local/generic` | Local file, generic checks (≤ 256 MiB) | `v0.1.0` |

Lint families: Ekza (Tier 0 metadata, slots, provenance), `bevy.*` (named node paths, ≤ 256 joints per skin),
`vrm.*` (OMOBA's runtime rules: one `VRMC_vrm` 1.0, GLB ≤ 50 MiB, JSON chunk ≤ 4 MiB, ≤ 4,096 nodes, ≤ 64 humanoid
bones, 15 required bones with standard parents), and the M6b validation rows (`skel.tpose`, `skel.height`,
`skin.cross-limb`, …).

## 9. Project and data

Specs: [ADR 0002](adr/0002-document-store-and-collaboration-readiness.md), [ADR 0011](adr/0011-project-file-format.md),
[ADR 0013](adr/0013-editor-history.md), [ADR 0015](adr/0015-mesh-storage-in-the-document.md).

| Feature | What it does | Where | Status |
|---|---|---|---|
| `.ekzanim` projects | Zip with the document and source models by SHA-256; JSON debug variant | File › Save (`Mod+S`), Save As… (`Mod+Shift+S`), Save Debug JSON, New Project | `v0.1.0` |
| Autosave + recovery | Autosave to IndexedDB, crash recovery, manual recovery point | File › Recover…, Save Recovery Point | `v0.2.0` |
| Undo / redo | Transactions: one gesture = one step (incl. unkeyed tweaks, tween drags, IK/FK switches); per-user stack | `Mod+Z`, `Mod+Shift+Z` / `Mod+Y` | `v0.1.0` |
| Last-op card | Re-adjust the last modeling operation's parameters | `T`; Edit › Adjust Last Operation | `v0.3.0` |
| Schema migration | Older projects open; newer ones open read-only | automatic | `v0.1.0` |
| Collaboration-ready model | Document records, partitions, store boundary with a conformance suite run against a test-only Yjs store | — (no live sessions yet) | `v0.1.0` |
| History panel | Browse undo history | — | Planned (M2c) |

## 10. Ekza ecosystem

Studio is part of Ekza and usable on its own. Guide: [characters-to-ekza.md](guides/characters-to-ekza.md);
tiers: [ADR 0010](adr/0010-ekza-integration-tiers.md).

| Feature | What it does | Status |
|---|---|---|
| Tier 0 exports | Space-compatible files with slot-named clips, Ekza provenance and metadata, registry-aligned lints | `v0.1.0` |
| Ekza Space | Shows the VRM 1.0 avatar and plays the clips in it | `v0.4.0` |
| OMOBA | Uses the VRM humanoid skeleton and plays its own motion library; Studio exports pass OMOBA's `validate-runtime-vrm` | `v0.4.0` |
| OMOBA handheld props | Static GLB under `ekza/omoba-handheld-v1` | `v0.3.0` |
| Ekza Hub | Upload the VRM to Hub by hand (Hub is the publishing site; Studio does not upload) | manual |
| Publish to Hub | One-click "Publish avatar to Ekza" (T3) | Planned (M4a; hidden until the Hub path exists) |
| Typed animation assets, open from Ekza | Upload as `ekza:animation`, open from Ekza (T1) | Planned (M4a) |

## 11. AI control via MCP (M-AI)

**In integration, coming next release.** Not on `dev` yet: built on `mai/port` and integrated on `mai/int`. Spec:
`docs/MCP-SPEC.md` v0.3 §0.4 and ADR 0022 on those branches; on `dev`, [ADR 0018](adr/0018-agent-bridge-mcp.md) and
[MCP-SPEC](MCP-SPEC.md) v0.2.

| Feature | What it does |
|---|---|
| `ekza-studio-mcp` server | One npm bin speaking stdio to MCP clients (Claude Code first; Claude Desktop, Cursor) |
| Live bridge | Loopback WebSocket to the open editor tab, paired with a one-time code; grants Read / Edit / Files / View |
| Headless projects | Up to 4 projects open in the server process, file IO sandboxed to a workspace folder |
| Undoable AI steps | One tool call = one `AI: …` History step; `Mod+Z` undoes it; the user's selection, playhead and layout are never touched |
| Agent panel | Connect, grants, Pause, Disconnect, audit log with Show and Undo per step, **Revert all AI changes**; status pill and toast |
| Animation tools | Read and write keys, poses and clips (the 25 core task tools) |
| `view_capture` | Image (or contact sheet ≤ 6 frames) of the user's view or preset cameras, ≤ 1,024 px |
| Character setup tools | `model_inspect`, `model_fix`, `rig_create`, `library_list`, `library_use`; import static models/samples; export VRM 1.0, GLB or OMOBA kit |
| Prompts | Seven motion recipes plus `rig_and_animate` ("rig this model and add a walk") |
| Security | Loopback only, Origin allow-list, no code-execution or network tool, no telemetry |

Deferred after the MVP: generic `operator_run`, motion analysis (`analyze_*`), headless rendering, Streamable HTTP,
resume after a dropped connection, weight-paint tools for agents, npm publish.

## 12. Platform and limits

| Topic | Fact |
|---|---|
| Browsers | Chrome and Edge supported; Firefox and Safari follow in V1 |
| Devices | Studio: best on a desktop (Rig & Skin edits need ≥ 1024 px). Auto-Rig: desktop and tablet full, phone without weight painting |
| Local-only | Files never leave the browser; no analytics, error reporting or third-party requests; autosave in IndexedDB |
| Language | English (Auto-Rig strings are in one message table; `ru`/`zh` planned) |
| Stack | Next.js 16 shell, React, three.js / React Three Fiber, @pixiv/three-vrm, glTF Transform, dockview, Canvas2D Graph Editor, AnimX curve engine |
| Bundle gates (gzip, first visit) | `/editor` ≤ 900,000 B, `/autorig` ≤ 660,000 B, enforced in CI; dockview never loads on `/autorig` before *Open in Studio* |
| Performance budgets | Idle = 0 frames (gate); pose eval ≤ 0.5 ms; 1 VRM × 4 panes playback ≤ 8 ms/frame; drag 1,000 keys ≤ 4 ms; Seed-san (10.9 MB) open ≤ 3 s; VRMA bake 10 s @ 30 fps ≤ 200 ms; bind 3k points ≤ 200 ms; Auto-rig ≤ 1–2.5 s — measured in [ROADMAP](ROADMAP.md#m1-budgets-architecture-14) |
| Model limits | Auto-Rig: warns > 60k, refuses > 200k triangles; human size 0.3–3 m. VRM export: ≤ 50 MiB, JSON ≤ 4 MiB, ≤ 4,096 nodes, ≤ 64 humanoid bones. Bevy: ≤ 256 joints per skin. Generic export ≤ 256 MiB |
| Licences | Code MIT; AnimX port Apache-2.0; fixtures CC0-1.0 or VRM Public License 1.0; clip library CC0 (Quaternius); third-party notices under Help › About |
| Quality gate | `pnpm run ci`: format, lint, typecheck, layering, fixtures, licences, unit tests, build, size gate, Playwright e2e in Chrome |

## 13. Known limitations and not yet

From the README's "said plainly" lists, [TODO](../TODO.md) (Parked, After the turnkey release), [ROADMAP](ROADMAP.md),
[DECISIONS-OPEN](DECISIONS-OPEN.md) and the `test.fixme` stretch scenarios.

| Area | Not yet | Planned in |
|---|---|---|
| Import | FBX, BVH, Mixamo with humanoid retarget; multi-file `.gltf`; OBJ | M2b |
| Animation | Onion skin, motion trails, camera bookmarks, audio, constraints, History panel | M2c |
| Animation | Space switching, "pole follows foot", stretch IK, animation layers, quaternion curves, pose library, clip sequencing | M5 |
| Animation stretch | IK/FK ghost, un-keyed Dope Sheet rows, mesh pick of IK controls, key hold / stepped preview, auto-Simplify after Match Range | M2a-stretch (fixme) |
| Export | VRMA expressions and lookAt; BVH/FBX export; in-app glTF-Validator in the dialog | M2c / M5 |
| Modeling | Subdivision preview, booleans, sculpting, UV editor, texture painting, Live Mirror | M6c and later |
| Modeling stretch | Extrude Manifold, Select Similar, lasso, Poke, edge snap, ramp swatches, `.gpl` palettes, selection constraints, unequal Bridge | M6a-stretch (fixme) |
| Rig & Skin | Constraints (parent/point/orient/aim, Attach Prop, sockets), control-shape editing, Joint tool, Component Editor weight table, weight transfer/inpainting, rig edits on imported avatars | M6b after the MVP |
| Auto-Rig | Humanoids only (no quadrupeds or tails), symmetric bodies, no facial expressions or spring bones, only base-colour textures written, decimation over 200k triangles, Publish to Hub | later |
| Collaboration | Live sessions with presence and claims; accounts and permissions | M3, M4b |
| AI generation | Text/image-to-3D through provider adapters | M7 |
| Splines | Splines and generators | M8 |
| Platform | Firefox and Safari, Review workspace, offline static build (NFR-09) | V1 |
