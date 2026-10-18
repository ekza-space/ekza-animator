# 16 — Model workspace UI (low-poly modeling, Maya-first)

| | |
|---|---|
| Status | Research / proposed spec (v0.1) for the modeling iteration |
| Date | 2026-10-18 |
| Scope | Workspace tabs; the Model workspace layout; component modes and their hotkeys; RMB, Shift+RMB, Ctrl+RMB and Q marking menus; the Modeling Toolkit panel; tool settings and the Adjust Last Operation card; modal numeric input; viewport overlays (component display, normals, poly count HUD, wireframe on shaded, X-ray, backface culling, flat shading); snapping; pivot editing; symmetry; soft selection; selection constraints; the Outliner for meshes and objects; the face-colour palette; UV editor placement (later); empty states and onboarding; the hand-off to Rig & Skin and Animate; the full modeling keymap; React component tree; D/U/P state classification |
| Out of scope | Mesh data structure, mesh operator algorithms, auto-skinning maths, export writers and AI generation back ends. Sibling notes of this iteration own them. This note fixes only what the UI needs from them (§22) |
| Builds on | Research 09 (UI/UX spec). This note extends it and, **for the Model workspace only**, replaces 09 §7.5's "F2–F12 not bound". Also research 08 §9.8, ARCHITECTURE §4.1 (D/U/P) and §10, and the shipped shell in `packages/editor`, `packages/editor-core` and `packages/viewport` (read on `dev`, 2026-10-18). Sibling notes of this iteration: [10](10-maya-poly-modeling.md) (Maya tool map), [11](11-blender-vs-maya-modeling-ux.md) (Blender vs Maya UX), [12](12-lowpoly-workflow.md) (low-poly workflow, colour rule), [14](14-skinning-own-models.md) (skeleton and skinning); this note follows their decisions and records the two places where it differs (§19, §26) |

Reading guide: §0 decisions; §1 the Maya-or-Blender answer; §2 what the shell has today; §3 workspace tabs; §4 layout; §5–6 component modes and marking menus; §7 Modeling Toolkit; §8 tool settings and Adjust Last Operation; §9 modal input; §10 overlays; §11 snapping and pivots; §12 symmetry, soft selection and constraints; §13 Outliner; §14 palette; §15 UV editor; §16 onboarding; §17 hand-off; §18 menus; §19 keymap; §20 component tree; §21 state; §22 contracts; §23 accessibility; §24 collaboration; §25 build slice and acceptance; §26 open questions; §27 sources.

---

## 0. Decisions in one screen

| # | Decision | Why |
|---|---|---|
| U1 | **The Maya interaction model is the base**: component modes on F8–F10, RMB / Shift+RMB / Ctrl+RMB marking menus, `Ctrl+E` extrude, Shift+drag smart extrude, `B` soft select, `D` pivot, `X`/`C`/`V` snapping, a Modeling Toolkit tab next to the Channel Box, and symmetry in the status line. | The owner models in Maya. The Animate side is already Maya-first (09 §1), so the whole pipeline keeps one muscle memory. Maya's mouse-driven marking menus survive the browser; many keyboard chords do not (§1). |
| U2 | **Four Blender ideas on top**: the Adjust Last Operation card, numeric input during any modal drag, symmetry as a persistent mode, and the **Industry Compatible digits `1`/`2`/`3`** for vertex/edge/face. | Blender's redo panel is the fastest way to tweak parameters without construction history. The digits are the only component-mode keys that work on every laptop: F-keys are media keys on Macs, and no browser lets a page have F11. |
| U3 | **No mesh construction history.** One live *last operation* keeps editable arguments until the next edit (Blender redo semantics). They show in the Last-op card and in the Channel Box `INPUTS` section, where Maya users look. | Mesh state stays one blob per mesh (08 §9.8, 06), and undo stays simple. Maya users still find their parameters in the usual place. |
| U4 | **Workspaces are pipeline steps**: tabs `Model › Rig & Skin › Animate › Review` on the menu bar. Each owns a menu set, status-line groups, a dock layout, a default tool, a key scope and timeline visibility. Switching keeps the document, object selection and time. | Workspaces replace Maya menu sets (09 §1.1). The pipeline order makes the turnkey flow visible. |
| U5 | **The key scope chain becomes hierarchical**: `model.viewport.<mode>` → `model.viewport.component` → `model.viewport` → `viewport` → `model` → `global`. | `Ctrl+E` can extrude in component mode while staying Export everywhere else. `K`, `M` and `Home` get Model meanings only where they apply. `KeymapManager.resolve` already walks string scopes, so only the DOM adapter's chain builder changes. |
| U6 | **Component selection lives in an imperative `ComponentSelection` service** (bitsets + a version counter), not in zustand. React reads counts only. | Thousands of indices change at pointer rate during marquee and paint selection. 09 §13.3 already bans per-frame React state. |
| U7 | **Low-poly defaults**: flat shading on, wireframe on shaded on, the poly count HUD on with a triangle budget bar, primitives with minimal segments, and a face-colour palette as the primary "material". | The targets are stylized game assets for OMOBA and Ekza Space, not subdivision surfaces. |
| U8 | **Marking menus (FR-SHELL-09), the command palette (FR-SHELL-08), workspaces (FR-SHELL-11) and the hotkey editor (FR-SHELL-10) are prerequisites.** Pull them into the first package of this iteration; they are planned for M2c today. | Every modeling surface depends on them. Today the only radial in the code is the Space-hold camera radial. |
| U9 | **Modeling acts on the bind pose.** A skinned mesh shows a `BIND POSE` badge and a skin-state badge. A topology change after binding raises "Skin out of date", followed by an automatic weight transfer that the user reviews in Rig & Skin. | The loop model → rig → animate → back to model must never silently break weights. |
| U10 | **Licence gate.** "Make editable" on an imported avatar follows VRM `meta.modification`, the same rule as the bake-into-model gate (09 §10.3). | Editing a mesh is modification. |
| U11 | **Templates are generated in-repo (MIT) or CC0** (Polybot, ADR 0012). The default build ships no third-party template whose licence has changed. | ADR 0012: the file's own licence wins. Quaternius now publishes under the QAL licence (§16.2). |
| U12 | **The colour truth is a per-face palette index** (note 12 L2). The palette panel edits it. Export derives a palette texture (default), vertex colours or one material per colour. | One palette edit recolours a model or a team variant. MToon ignores vertex colours, so the palette texture is the only mode that works everywhere (§14.4). |

---

## 1. Maya or Blender? The answer, with evidence

**Answer for the owner:** keep Maya as the base and borrow four Blender ideas. Ship a Blender keymap preset later as a data pack. The reasons are below.

| Question | Maya | Blender | What the browser allows | Ekza choice |
|---|---|---|---|---|
| Component modes | F8 toggle, F9 vertex, F10 edge, F11 face, F12 UV; Alt+F9 vertex-face; `<`/`>` shrink/grow (Autodesk shortcut list) | `1`/`2`/`3` in Edit Mode; Shift adds modes (manual). Blender's own *Industry Compatible* (Maya-like) keymap moved to `1`/`2`/`3` vertex/edge/face and `4` object in 2019 "due to popular demand" | Mac F-keys are media keys unless the user changes a system setting. macOS takes F11 for Show Desktop. Browsers keep F11 for fullscreen (even Chromium's fullscreen Keyboard Lock leaves F11 and Esc to the browser; Firefox's tests treat F11 as reserved) and F12 for DevTools | F8/F9/F10 **plus** digits `1`/`2`/`3`, plus the RMB marking menu; F11 and F12 unbound (§19.2) |
| Tool access | Marking menus: RMB (modes), Shift+RMB (polygon tools: Target Weld, Multi-Cut, Insert Edge Loop, Extrude, Fill Holes…), Ctrl+RMB (convert selection) | Single-letter modal keys (E, I, K, M, F) and Ctrl-chords (`Ctrl+R` loop cut, `Ctrl+B` bevel, `Ctrl+N` recalc normals, `Ctrl+Tab` select-mode pie) | `Ctrl+R` reloads, `Ctrl+N` and `Ctrl+Tab` are reserved, and `Alt+E` opens browser menus on Windows | **Marking menus first**; a few Blender single letters as Ekza additions where nothing collides (`K`, `M`) |
| Parameter tweak | Construction history: the `INPUTS` node in the Channel Box and the In-View Editor (`T` brings it back) | Adjust Last Operation panel, bottom-left of the viewport, `F9` popup | — | **Both views of one last-op state** (§8) |
| Precision | Channel Box, tool settings | Type numbers during G/R/S, `Tab` between axes | — | Numeric typing during any modal drag (§9) |
| Symmetry | Status-line dropdown: Object/World X/Y/Z, Topology; Preserve Seam; tolerance | Per-mesh X/Y/Z mirror, topology mirror | — | Maya placement and options; Blender's per-mesh memory (§12) |
| Stats | Poly Count HUD with scene, selected-object and selected-component columns | Statistics overlay; face orientation overlay | — | Maya HUD plus a budget bar; Blender's face orientation (§10) |

Supporting points:

- **Owner muscle memory and product consistency.** Animate already ships Maya's Q/W/E, Channel Box, time slider and Graph Editor (09). A Blender-style Model workspace would make one product with two hands.
- **Browser fit favours Maya.** Maya's heaviest modeling paths are pointer gestures: marking menus and Shift+drag extrude. Blender's are keyboard chords, and several of them are browser-reserved (above, and 09 §7.6).
- **Blender itself validates the hybrid.** Its Industry Compatible keymap is Maya-style Q/W/E/R with digit component modes, which is exactly the fallback this note needs.
- **Precedent for workspace tabs in a web low-poly tool.** Blockbench (GPL, web and desktop) switches Edit / Paint / Animate / Display modes with tabs, and its panels change per mode. It is a design reference only, because GPL code cannot enter this MIT project (ADR 0009).
- **What Blender does better, and we take:** the redo panel, numeric input on drags, symmetry remembered per mesh, the face orientation overlay and the statistics overlay.

---

## 2. Starting point: what the shipped shell has (dev, 2026-10-18)

| Area | Today | Needed for the Model workspace |
|---|---|---|
| Workspaces | One: `WORKSPACE_ID = 'animate'` (`editor/src/shell/layout.ts`). The layout storage key already carries the workspace (`ekza-animator:layout:v2:<workspace>`). No tabs: DECISIONS-OPEN Q-UI-1 hides the Model tab in the MVP | `WorkspaceTabs`, a layout builder per workspace, and per-workspace menus and status-line groups |
| Key scopes | A scope is a panel kind or `'global'`. The DOM adapter builds the chain from the panel under the pointer (`editor/src/input/keyboard.ts`); `KeymapManager.resolve` walks it in order | A hierarchical chain (§19.1); the manager needs no change |
| Selection | `Selection { controls, keys, channels }` and a `SelectionMask { controls, joints, meshes }` (`editor-core/src/types.ts`) | Mesh objects as selectable objects, a component mode, and the `ComponentSelection` service (§21) |
| Display | `DisplayFlags { mesh, skeleton, controls, grid, xray, hud, springBones }`; camera layers always/mesh/grid/skeleton/controls (`viewport/src/layers.ts`). No shading modes, no wireframe | Shading modes and the overlay set (§10); new layers 6–9 |
| Tools | Viewport select, move and rotate. No viewport scale tool | Scale plus the modeling tools |
| Marking menus | Only the Space-hold camera radial (`CameraRadial.tsx`). FR-SHELL-09 is planned for M2c | A generic `MarkingMenu` (09 §7.4 spec) before any modeling UI |
| Menus | Top menus appear when registered items exist (`TOP_MENUS`, `topMenus()`) | `MenuItemDef.workspaces` filter |
| Status line | Fixed Animate groups (`StatusLine.tsx`) | A status-line group registry keyed by workspace |
| Empty state | Drop a file, Open, three animation samples (`EmptyState.tsx`) | The Model start card (§16) |

---

## 3. Workspace tabs

### 3.1 Placement and look

```
 ◆ File Edit Create Select Modify Mesh EditMesh MeshTools MeshDisplay Windows Help ┃ Model ● › Rig & Skin ○ › Animate ◐ › Review ┃ Hero ✱ [Export]
```

- A segmented `role="tablist"`, 26 px high, on the right of the menu bar before the project title (09 §2 already reserves this slot). The active tab uses `--bg-pressed` with a 2 px `--accent` underline (09 §8.7).
- A **status glyph** follows each label: `●` done (`--ok`), `◐` needs attention (`--warn`), `○` not started (`--text-3`). The tooltip lists the reasons, so the state is never shown by colour alone. Derived checks: **Model** = Mesh check clean and triangles within the target budget; **Rig & Skin** = skeleton fitted, bound, weights normalized and ≤ 4 influences; **Animate** = at least one clip with keys. **Review** carries no glyph.
- The chevrons are reading aids, not a wizard: every tab is reachable at any time.
- Below 1280 px the labels shorten (`Mdl`, `Rig`, `Anim`, `Rev`) and the full names move to tooltips.

### 3.2 What a workspace owns

| Owned per workspace | Model | Rig & Skin (later) | Animate (shipped) | Review (09) |
|---|---|---|---|---|
| Layout JSON (`ekza-animator:layout:v<N>:<ws>`) | §4 | Outliner (Skeleton) · persp X-ray · Skin panel · Validation | 09 §2 | 09 P6 |
| Menu set (after File Edit Create Select Modify Display Windows Help) | Mesh, Edit Mesh, Mesh Tools, Mesh Display | Skeleton, Skin | Key, Pose, Clip, Graph, Playback, Rig | — |
| Status-line groups | §4.2 | Joint tool, Bind, brush | 09 §4.2 | none |
| Default tool and pick mask | Select · meshes and groups | Select · joints | Select · controls | none (view only) |
| Key scope prefix | `model.` | `rig.` | `animate.` (none needed today) | `review.` |
| Timeline row | hidden (Windows › Timeline shows it) | shown (test poses) | shown | shown |
| Pose shown | **bind pose** | bind pose or test clip | current frame | current frame |

### 3.3 Switching rules

- Switching is instant and keeps the document, object selection, scene time and each pane's camera (pane IDs persist, 09 §3).
- **Leaving Model** drops to object mode. The component selection stays in memory per mesh, so returning restores it (Maya's hilite behaviour). A running modal operation is cancelled first (Esc semantics), and the Last-op card closes.
- **Entering Model with a character selected** shows the bind pose and the `BIND POSE` HUD badge. Returning to Animate restores the frame's pose.
- **No default hotkey.** Blender's `Ctrl+PgUp/PgDn` and `Ctrl+Tab` are browser tab shortcuts, and so are `Mod+1…9`. `Alt+1…8` switches tabs in Linux Chrome, and `Alt+Shift` switches keyboard layouts on Windows and many Linux desktops, which bilingual RU/EN users depend on. The command palette lists `Workspace: Model` and the other workspaces, and the hotkey editor lets users bind them.
- Persistence: the active workspace is U state. `prefs.lastWorkspace` (P) restores it on the next load. First run asks (§16.1).

---

## 4. Model workspace layout

### 4.1 Default layout (1440×900 reference)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│◆ File Edit Create Select Modify Mesh EditMesh MeshTools MeshDisplay Windows Help ┃Model● › Rig○ › Anim◐┃ │ 28
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│[Q][W][E][R]│Mode[Obj|Vtx|Edg|Face|UV]│Sym[Object X▾]│Soft○ 0.50m│Cnst[Off▾]│Snap #X /C .V ~J│Piv D│▥     │ 32
├───────────────┬──────────────────────────────────────────────────────────┬───────────────────────────────┤
│Outliner       │Panel▾ persp▾ │ Shading▾ Show▾ │ Wire Flat Xray Cull │ ⤢  │Toolkit│Channels│Attrs│Palette │
│/ filter…      │FACE · SYM X · SOFT 0.50 m                    (gizmo)     │Hero_body · 816 tris           │
│▾ Scene        │       Scene  Object  Selected                            │[Obj][Vtx][Edg][Face][UV]      │
│ ▾ props       │Verts    412     212        24                            │─ Selection ─────────────────  │
│   crate  124t │Faces    410     208        20                            │Style (•)Marquee ( )Drag ( )Tw │
│   barrel  96t │Tris     816     412        40                            │[x]Camera-based [ ]Backfaces   │
│ ▾ Hero (VRM)  │Budget [██████████░░░░] 816/1500                          │Constraint [Off        ▾]      │
│  ▾ Meshes     │                                                          │─ Symmetry ──────────────────  │
│   Hero_body ✎ │                 ┌─────┐                                  │[Object X▾] tol 0.001 [x]Seam  │
│   Hero_hair ⊘ │              ┌──┘ ▰▰▰ └──┐   ← selected faces            │─ Soft Selection ────────────  │
│  ▸ Skeleton   │              │  low-poly  │                              │[ ]On (B) r[0.50 m] Volume▾    │
│ ▸ Cameras     │              └────────────┘                              │─ Components ────────────────  │
│               │  ┌ Extrude ──────────── ⌄ ✕ ┐                            │[Extrude^E][Bevel^B][Bridge]   │
│               │  │ Offset   [ 0.250 m ]     │  ← Last-op card            │[Inset][Merge M][Weld][Poke]   │
│               │  │ Divisions[ 1 ]           │                            │─ Tools ─────────────────────  │
│               │  └──────────────────────────┘                            │[Multi-Cut K][Edge Loop]       │
│               │  y                                                       │─ Next ──────────────────────  │
│               │  └x                                    BIND POSE         │Mesh check ✓ [Rig & Skin ▸]    │
├───────────────┴──────────────────────────────────────────────────────────┴───────────────────────────────┤
│Mesh Check │ UV Editor (later)                                                      ⌃ collapsed           │ 26
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Face mode · Ctrl+E extrude · Shift+drag extrude · Shift+RMB tools · B soft select   816 tris             │ 22
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Regions

| Region | Default | Notes |
|---|---|---|
| Menu bar | 28 px | Common menus + the Model menu set (§18) + workspace tabs |
| Status line | 32 px | Model groups: Tools · Mode switcher · Symmetry · Soft select · Constraint · Snap · Pivot · Manipulator space · Layout preset. The Animate groups (pick mask, key target, Tween, auto-key) are hidden |
| Left dock | 240 px | Outliner (§13) |
| Centre | flex | Viewport panel. Default preset **M-Quad** (top / persp / front / side) with **persp maximized**, so a Space tap toggles single ↔ four view as in Maya |
| Right dock | 300 px (min 260) | Tabs: **Toolkit** (default) · Channels · Attributes · Palette. 300 px fits the two-column tool grid |
| Bottom dock | collapsed to the 26 px tab strip | Mesh Check (lint list) · UV Editor (later) |
| Timeline | hidden | Windows › Timeline shows it; Model works on the bind pose |
| Help line | 22 px | Mode hints, modal readout mirror, scene triangle total |

Vertical budget at 900 px: chrome 28 + 32 + 26 + 22 = 108 px, so the viewport gets ≈ 792 px, about 336 px more than Animate (09 §2.1).

### 4.3 Model layout presets

| Preset | Shape | Use |
|---|---|---|
| M-Single | `[persp]` | Small screens |
| **M-Quad** (default) | `top | persp` / `front | side`, persp maximized at start | Maya four view; Space tap toggles it |
| M-Side | `front | persp` 50/50 | Symmetry work, silhouette checks |
| M-UV (later) | `UV Editor | persp` | UV layout |

---

## 5. Component modes

### 5.1 Modes

| Mode | Picks | Display | Maya key | Ekza default | Status |
|---|---|---|---|---|---|
| Object | mesh objects, groups, characters | normal | F8 toggles object ↔ last component mode | `F8`, or press the active mode's digit again | must |
| Vertex | vertices | dots on all hilited meshes | F9 | `F9`, `1` | must |
| Edge | edges | edges thickened under the pointer | F10 | `F10`, `2` | must |
| Face | faces (whole-face pick in shaded mode, centre dots in wireframe) | face centre dots | F11 (browser-reserved) | `3` | must |
| UV | UVs, in the UV editor only | — | F12 (DevTools) | none until the UV editor exists | later |
| Multi | nearest component (Maya Multi) | all | RMB › Multi | RMB menu | later |
| Vertex face | — | — | Alt+F9 | not offered: low-poly normals are handled by Soften/Harden | no |

### 5.2 Switcher

```
 Mode ┃ ▢ Obj ┃ • Vtx ┃ ╱ Edg ┃ ▰ Face ┃ ⊞ UV ┃          tooltip: "Vertex mode  F9 · 1"   UV: "UV editor arrives later"
```

- In the status line it is a `role="radiogroup"` of icon + text buttons. The same control repeats at the top of the Toolkit tab, as Maya's MTK does.
- The HUD badge in the pane's top-left (`VERTEX`, `EDGE`, `FACE`) shows the mode where the eyes are.

### 5.3 Semantics

1. **Hilite.** Entering a component mode with mesh objects selected *hilites* them, as Maya does: only their components are pickable. Other meshes ~~draw at 70 % opacity and~~ cannot be picked. RMB on another mesh opens the mode menu for that mesh and adds it to the hilite set. *Superseded (MODELING-PLAN v0.2 §3.5, Q-MOD-UI-15): other meshes stay opaque (Maya does not fade them; fitting work needs them at full opacity); "Dim unhilited" is a per-pane option.*
2. With nothing selected, `F9`/`1` hilites the mesh under the pointer. With no mesh there, the help line says "Select a mesh first" (no toast).
3. **Per-mode selections are remembered** (Maya): faces picked in Face mode come back after a trip to Vertex mode. Conversion is explicit: `Ctrl+F9/F10/F11`, Ctrl+RMB, or Select › Convert. A preference "Convert selection when switching modes" gives Blender's behaviour; it is off by default.
4. Back to object mode: `F8`, pressing the active digit again, RMB › Object Mode, or clicking `Obj`. Leaving the workspace also returns to object mode (§3.3).
5. A mode switch is not an undo step (U state). History steps record the component selection before and after, as they already do for selection (ARCHITECTURE §4.1). *Amended (MODELING-PLAN v0.2 §3.5, Q-MOD-UI-13): in Model, selection changes are undo steps of their own (coalesced "Select" steps, session-only), as in Maya and Blender.*
6. Topology-changing operators set the result as the new selection: the faces an extrude creates, the edges a bevel creates. That is how both Maya and Blender behave, and 08 §9.8 requires operators to remap or clear the selection anyway.

### 5.4 RMB marking menu: modes (RMB on a mesh, no modifier)

```
                  NW Multi (later)        N  Edge          NE Object Mode
            W  Vertex                       ( · )                       E  UV (later, disabled)
                  SW Vertex Face (hidden)  S  Face          SE Select ▸
               ───────────────────────────────────────────
               Select All · Select Shell · Hide Selected · Show All · Isolate (Shift+L)
               Assign Colour ▸ (palette recents) · Pivot ▸ · Rename… · Attributes
```

- The slot layout is **Maya-like but not yet calibrated**. Autodesk documents the item set (Vertex, Edge, Face, UV, Object Mode, Multi) but not the compass positions. Check against a Maya 2026/2027 install before freezing; it is an owner check item (Q-MOD-UI-1). Once frozen, positions never change between modes (09 §7.4).
- RMB on empty space keeps 09's view menu (Top/Side/Front/Persp…). On macOS, Ctrl+click is RMB (09 §5.1).

---

## 6. Polygon marking menus

### 6.1 Shift+RMB by mode

Fixed geometry across all component menus: **S = Extrude, W = Multi-Cut, SW = Delete/Dissolve**, and N is the mode's main topology tool. The hand learns three slots once.

| Slot | Nothing selected | Object (mesh) | Vertex | Edge | Face |
|---|---|---|---|---|---|
| N | Cube | Insert Edge Loop | Merge to Center | Insert Edge Loop | Inset |
| NE | Cylinder | Mirror… | Target Weld | Bevel | Bevel |
| E | Sphere | Combine | Connect | Bridge | Duplicate Faces |
| SE | Plane | Separate | Chamfer Vertex | Collapse | Extract |
| S | Cone | Center Pivot | **Extrude** | **Extrude** | **Extrude** |
| SW | Torus | Delete | Delete *(superseded: Maya plain Delete; Delete Vertex in the list)* | Delete *(superseded: Maya plain Delete; Delete Edge in the list)* | Delete Faces |
| W | Humanoid template… | **Multi-Cut** | **Multi-Cut** | **Multi-Cut** | **Multi-Cut** |
| NW | Primitive options… | Mesh Check… | Average Vertices | Soften/Harden ▸ | Poke |
| list | Import mesh… · Edit a sample ▸ · Generate… (later) | Freeze / Reset Transforms · Triangulate · Flip Normals · Cleanup… · Decimate… (later) | Snap to Grid · Weld threshold… | Fill Hole · Select Loop / Ring | Triangulate · Flip Normals · Assign Colour ▸ · Mirror |

Origin: Maya's Shift+RMB polygon menu contains Target Weld, Multi-Cut, Insert Edge Loop, Append to Polygon, Soften/Harden, Extrude and Fill Holes (Autodesk Marking Menus page). A Polycount answer reports Extrude at the south slot. Every other position is an Ekza layout, **provisional until the owner calibrates it on a real Maya (Q-MOD-UI-1)**. *Superseded for Delete (Q-MOD-UI-6): the SW slot runs Maya's plain Delete, which keeps the end vertices; Delete Edge/Vertex (`Mod+Delete`) is in the slot's list. Average Vertices (NW, vertex) is built in M6a (B4).*

### 6.2 Ctrl+RMB: convert selection

```
                 NW To Edge Ring        N  To Edges          NE To Edge Loop
          W  To Vertices                    ( · )                     E  To UVs (later)
                 SW To Border           S  To Faces          SE To Shell
```

The vertex/edge/face/UV positions match the RMB mode menu, so one map serves both. Maya has a Ctrl+RMB convert menu with the same commands under Select › Convert Selection; the compass positions are Ekza's.

### 6.3 Ctrl+Shift+RMB and Q+LMB: selection options (Model only)

N Symmetry: Object X · NE Symmetry: Off · E Soft Select on/off · SE Camera-based selection on/off · S Constraint ▸ (Off / Angle / Border / Edge Loop / Edge Ring / Shell) · SW Backface selection on/off · W Selection style ▸ (Marquee / Drag / Tweak) · NW Symmetry ▸ (World X/Y/Z, Object Y/Z, Topology later). Autodesk documents setting symmetry from the Ctrl+Shift+RMB or Q+click marking menus. In Animate, `Q`+LMB keeps the 09 §7.3 pick-mask menu.

**macOS:** RMB is a two-finger click or Ctrl+click. Ctrl+click opens the *plain* RMB menu, so the Ctrl+RMB family needs Ctrl + two-finger click or a mouse. Cmd is never a substitute: it removes from the selection (09 §6.1). Every item in these menus is also in a menu-bar menu and the command palette (§18).

---

## 7. Modeling Toolkit panel

The first tab of the right dock in Model, named **Toolkit**. Maya docks its Modeling Toolkit as a tab next to the Channel Box and Attribute Editor.

```
┌ Toolkit │ Channels │ Attributes │ Palette ─┐
│ Hero_body · mesh · 816 tris · 2 hilited  ⌕ │
│ [▢ Obj] [• Vtx] [╱ Edg] [▰ Face] [⊞ UV]    │
├ Selection ────────────────────────────── ▾ ┤
│ Style      (•) Marquee ( ) Drag ( ) Tweak  │
│ [x] Camera-based (Auto)  [ ] Backfaces     │
│ [x] Highlight nearest                      │
│ Constraint [ Off             ▾] Angle 30°  │
│ [Grow >] [Shrink <] [Loop] [Ring] [Shell]  │
├ Symmetry ─────────────────────────────── ▾ ┤
│ [ Object X ▾ ] Tolerance [0.001 m] [x]Seam │
├ Soft Selection ───────────────────────── ▾ ┤
│ [ ] On (B)   Radius [0.50 m]   [Volume ▾]  │
│ Falloff  ▁▂▄▆█▆▄▂▁   [Smooth ▾]            │
├ Components ───────────────────────────── ▾ ┤
│ [Extrude^E⋯] [Bevel^B⋯] [Bridge⋯] [Inset⋯] │
│ [Merge M⋯]  [Weld⋯]   [Connect] [Collapse] │
│ [Fill Hole] [Poke]    [Triang.] [Flip]     │
├ Tools ────────────────────────────────── ▾ ┤
│ [Multi-Cut K] [Edge Loop] [Paint Colour]   │
│ [Quad Draw · later]                        │
├ Mesh ─────────────────────────────────── ▾ ┤
│ [Combine] [Separate] [Mirror⋯] [Cleanup⋯]  │
├ Active tool: Multi-Cut ───────────────── ▾ ┤
│ Snap step [25 %]   [x] Slice  [ ] Edge flow│
│ Ctrl+click edge loop · Ctrl+MMB centred    │
├ Next ──────────────────────────────────────┤
│ Mesh check ✓   816 / 1 500 tris            │
│ [ Rig & Skin ▸ ]          [ Export model… ]│
└────────────────────────────────────────────┘
```

Behaviour:

- Every button runs an operator. Buttons that do not apply to the mode are disabled, and the tooltip gives the poll reason ("Bridge needs two edge borders"); 09 §8.7.
- `⋯` on a button opens its **option box**: a non-modal popover with that operator's defaults for the next run (Maya ❒, 09 principle 4). These defaults are P state.
- The header names the target meshes, the hilite count and the triangles. With no mesh selected, the panel shows an empty state with the primitive buttons (§16.4).
- Double-clicking a tool in the status line or the Toolkit scrolls to and expands **Active tool**, Maya's double-click-for-Tool-Settings habit.
- Section collapse state is P. Narrow (≤ 260 px): buttons become icon-only with tooltips, two columns.
- The **Next** footer is the hand-off (§17).

---

## 8. Tool settings and Adjust Last Operation

### 8.1 Three kinds of parameters

| Kind | Example | When edited | Where | State |
|---|---|---|---|---|
| Tool settings | Multi-Cut snap step, soft-select falloff, selection style | Before or while using an interactive tool | Toolkit › Active tool; popover from the status line | P (remembered per user) |
| Operator defaults | Extrude divisions, Bevel segments for the next run | Before running a one-shot operator | Option box `⋯` | P |
| **Last operation** | The extrude you just did: offset 0.25 m, 1 division | After running it, until anything else changes | **Last-op card** (pane, bottom-left) and **Channel Box › INPUTS** | U |

### 8.2 Placement

**Last-op card.** Blender puts its redo panel at the bottom-left of the viewport. Here the card sits 8 px above the axis triad of the pane where the operation ran. It starts **collapsed** as a pill (`⟲ Extrude · 0.250 m ▸`) and expands on click or `T`. Maya's `T` (Show Manipulator Tool) is the key Autodesk support gives for bringing back the In-View Editor after an extrude or bevel.

```
┌ ⟲ Extrude ─────────────────── ⌄ ✕ ┐
│ Local Z       [   0.250 m ]  ⟷    │   primary field; ⟷ = virtual slider (drag the label; 09 §4.5)
│ Offset        [   0.000 m ]       │   inset of the cap (secondary)
│ Thickness     [   0.000 m ]       │
│ Divisions     [   1 ]  ◂ ▸        │
│ Keep faces together  [x]          │
│ Direction  (•) Normal  ( ) World  │
│ Reset ⟲               on 6 faces  │
└───────────────────────────────────┘
```

**Channel Box › INPUTS** shows the same state, where Maya users click `polyExtrudeFace1`. Here it is one live entry, not a history list:

```
 Hero_body
 Translate X      0.000   …   Visibility  on
 ── SHAPES ──────────────────────────────
 Hero_bodyShape
 ── INPUTS ──────────────────────────────
 ▾ extrude  (last operation)
   Local Translate Z 0.250
   Offset            0.000
   Thickness         0.000
   Divisions         1
   Keep Together     on
```

Both views edit one session `lastOp`. MMB-drag in the viewport runs the virtual slider on the selected INPUTS field, the existing Channel Box behaviour (`prefs.virtualSlider.viewportMmb`); with no channel or INPUTS field selected, MMB-drag moves the selection (Maya rule, MODELING-PLAN v0.2 §3.7). *Corrected (MODELING-PLAN v0.2 §3.4): the extrude's primary field is Local Translate Z (along the normal), not Offset, which insets the cap.*

### 8.3 Lifecycle

```
 idle ──(operator with flags.register + args schema finishes)──► live { op, args, step, targets, docVersions, paneId }
 live ──(field edit)──► amending ──► history.amend(step): undo step, execute(args'), replace step ──► live
 live ──(any other document edit · selection change · mode change · workspace switch · undo/redo ·
         remote change to a target mesh · claim lost)──► stale (card closes; INPUTS entry disappears)
```

- An edit **replaces** the operation's history step, so `Z` still removes the whole operation in one press.
- While a field's virtual slider is dragged, re-runs go through a preview session (ARCHITECTURE: preview then commit) at most once per frame. If a re-run takes more than 50 ms, the card switches to "update on release".
- `Esc` in a field reverts it. `✕` closes the card and keeps the arguments, so `G` (Repeat Last, Maya) still applies the same operation and arguments to a new selection.
- Operations without parameters (Delete, Flip) show no card. Primitive creation shows its segment counts, which replaces Maya's interactive creation options.
- **Primitive parameters stay live longer** (note 10, TL;DR 3): until the mesh's first ~~topology~~ **component** edit, Attributes › Primitive and Channel Box INPUTS keep the primitive's sizes and segment counts editable, even after transforms, selection changes and other objects' edits. The first component edit of any kind (a vertex nudge included) freezes them, and the Outliner badge changes from `prim` to `✎` (*amended, Q-MOD-UI-17: regenerating after tweaks would lose or misplace them*).
- *Superseded (MODELING-PLAN v0.2 §3.4, Q-MOD-K-4): `history.amend` is replaced by undo + re-run (`edit.adjustLast`); after `Ctrl+E` an **extrude session** keeps the card live while the extrude manipulator and `W`/`E`/`R` drags on the cap edit the extrude's local translate/rotate/scale.*
- A remote change to a target mesh disables the card with "Changed by Anna" (§24).

### 8.4 Comparison

| | Maya | Blender | Ekza |
|---|---|---|---|
| Where | In-View Editor in the viewport; Channel Box INPUTS | HUD panel, bottom-left; `F9` popup | Pane card, bottom-left, plus Channel Box INPUTS |
| How long editable | Until history is deleted (any later time) | Until the next operator | Until the next document edit or selection change |
| Storage | History nodes in the scene | Undo step re-run | Undo step amended; nothing extra in the document (Blockbench does the same in a web stack with `Undo.amendEdit`, note 11 D3) |
| Key | `T` (with Show Manipulators) | `F9` | `T` (`F9` is Vertex mode) |

---

## 9. Modal tools and numeric input

Two kinds of modal interaction share one readout and one grammar:

1. **Manipulator drags**: W/E/R handles, Shift+drag extrude (Maya smart extrude) and the extrude/bevel handles.
2. **Parameter drags**: bevel width, inset, `B`+drag soft-select radius, the Multi-Cut slide.

```
           ┌ Extrude ──────────────────────────────────────┐
  pointer ◥│ Local Z  0.25▌ m       Divisions  1           │   chip: 16 px right/below the pointer,
           │ Enter ✓ · Esc ✕ · Tab next · Shift fine · J   │   flips at pane edges, z-order 20 (HUD)
           └───────────────────────────────────────────────┘
```

Rules:

- Typing a digit, `-` or `.` during a drag starts numeric entry for the active field (Blender). From then on the pointer no longer changes that field. `Backspace` edits, `Tab` moves to the next field, `Enter` or LMB release confirms, and `Esc` cancels. **RMB never cancels** (it is ignored during a drag and completes Multi-Cut; ADR 0016 D8, *corrected*). Cancel restores the pre-drag state with no undo entry (09 §6.2). Right after a keyboard-invoked operator the same entry is armed until the first pointer move, click or non-numeric key; `T` opens the card with the primary field focused (MODELING-PLAN v0.2 §3.4).
- Input follows 09 §6.4: expressions, relative `+=`, `deg`/`rad` suffixes. Units are displayed (m, °).
- `Shift` is fine adjustment ×0.1 (09). `J` held snaps to increments.
- **Presets do not mix.** In the Maya preset, holding `X`/`C`/`V` snaps to grid/edge/vertex during a drag too, and the grabbed handle gives the axis. In the Blender preset (later), `X`/`Y`/`Z` constrain the axis and `Ctrl` snaps.
- The help line mirrors the chip text. A polite `aria-live` region announces the committed value ("Extrude offset 0.25 metres, 6 faces").
- A drag starts after 3 px (09 §6.2). Parameter drags request Pointer Lock and fall back to pointer capture.
- If re-evaluation exceeds 50 ms, the chip shows `…` and the preview updates at a lower rate.

---

## 10. Viewport overlays and display

### 10.1 Pane header in Model

```
[Panel▾] persp▾ │ Shading▾ │ Show▾ │ [Wire] [Flat] [Xray] [Cull] │ [Count] │ ◎ │ ⤢
```

Toggles collapse into `Show ▾` below 520 px (09 §4.4).

### 10.2 Overlay catalog

| Overlay | Model default | Toggle | Implementation |
|---|---|---|---|
| Shading: Wireframe / Shaded / **Colours** / Lit | Colours (palette face colours under a soft clay light rig) | `4` / `5` / `6` / `7` (Maya, 09 §5.6; not shipped yet) | Per-pane material override; Colours = the face palette colours |
| Wireframe on shaded | on | `Wire` | `LineSegments2` from the mesh edge buffer, 1 px, `--wire`; the mesh uses `polygonOffset` |
| Flat shading (display) | on | `Flat` | `flatShading` on the display material. Real hard/soft normals are mesh data, edited with Soften/Harden; the toggle tooltip says so |
| Backface culling | off (Maya draws both sides) | `Cull` | `side: FrontSide`; culled faces cannot be picked |
| X-ray | off | `Alt+X` (shipped flag) | Mesh at 50 %; components stay visible through it |
| Component display | on in component modes | Show ▸ Components | Vertex dots 5 px (7 px selected), edges, face centre dots in Face mode; `Points` with a screen-size shader and `LineSegments2`; 1 px halo |
| Normals | off | Show ▸ Normals ▸ Face / Vertex / Both + length | `LineSegments2`, optional constant screen length (Blender) |
| Face orientation | off | Show ▸ Face orientation | Front `--face-front`, back `--face-back` fill (Okabe–Ito blue/orange; Blender uses blue/red) |
| Hard edges | on | Show ▸ Hard edges | Hard edges drawn 2 px |
| Mesh check (lint) | off; on while the Mesh Check panel is open | Mesh Check tab | n-gons (> 4 sides) ◇ amber, non-manifold ✕ red, zero-area faces, near-coincident vertices; feeds the tab status glyph |
| Symmetry plane | on when symmetry ≠ Off | Show ▸ Symmetry | Dashed `--sym-plane` rectangle at the mesh bounds; seam edges highlighted when Preserve Seam is on |
| Soft-selection ramp | on while soft select is on | `B` | Per-vertex weight tint `--soft-1…4` plus a radius ring at the pointer during `B`-drag |
| Poly count HUD | on | `Count` | DOM HUD, §10.4 |
| Grid | on | Show ▸ Grid | Existing layer; Model grid 0.1 m minor, 1 m major |
| Isolate | — | `Shift+L` (09) | Per-pane layer mask |
| `BIND POSE` badge | when the mesh is skinned | — | HUD, bottom-right (Model has no frame number) |

New camera layers (`viewport/src/layers.ts`): 6 components, 7 normals, 8 lint, 9 symmetry and soft-select helpers. The new per-pane `DisplayFlags` fields are listed in §22.

### 10.3 Tokens (WCAG 2.x contrast, computed)

The mesh shades from light grey through to the dark viewport, so no single colour reaches 3:1 everywhere. **Rule: every component glyph and overlay line is drawn with a 1 px `--comp-halo` (`#14151a`) outline.** The glyph contrasts with its halo, and the halo contrasts with light shading.

| Token | Value | vs halo | vs viewport top `#3e4047` | vs clay `#6e7179` | Use |
|---|---|---|---|---|---|
| `--comp-halo` | `#14151a` | — | 1.76 | 3.73 (9.08 on `#b4b7be`) | outline of every glyph |
| `--comp-vertex` | `#d17bff` | 6.93 | 3.94 | 1.86 | unselected vertex dots |
| `--comp-selected` | `#ffa31a` | 9.12 | 5.18 | 2.44 | selected vertices/edges; faces at 35 % fill |
| `--comp-hover` | `#ffe58a` (= `--sel-hover`) | 14.61 | 8.29 | 3.91 | pre-selection |
| `--wire` (shaded) / `--wire-wiremode` | `#14151a` / `#c8ccd4` | — / 11.32 | 1.76 / 6.43 | 3.73 / 3.03 | wireframe |
| `--normal-face` / `--normal-vertex` | `#3fd1d9` / `#b18cff` | 9.84 / 7.00 | 5.59 / 3.97 | 2.63 / 1.88 | normals |
| `--face-front` / `--face-back` | `#56b4e9` / `#e69f00` | 7.90 / 8.09 | 4.48 / 4.59 | 2.12 / 2.17 | face orientation |
| `--sym-plane` | `#5cc8ff` | 9.69 | 5.50 | 2.59 | symmetry plane |
| `--lint-ngon` / `--lint-error` | `#e3b34a` / `#ef6b6b` | 9.39 / 6.06 | 5.33 / 3.44 | 2.51 / 1.62 | Mesh check |
| `--soft-1…4` | `#ffd84d` → `#ff8a3d` → `#d9363e` → `#4a1a1e` | ≥ 3.95 (1–3) | — | — | soft-select weight 1 → 0 (Maya-like yellow → red → dark) |

Every glyph reaches ≥ 3.95:1 against its halo, and the halo reaches ≥ 3.73:1 against clay and lighter shading, which meets SC 1.4.11 (3:1). On the dark viewport the glyph colour carries it. None of these tokens uses the brand accent (09 §8.1). The tokens CI contrast check (09 §8.3) gains these rows.

### 10.4 Poly count HUD

```
 FACE · SYM X · SOFT 0.50 m
              Scene   Object   Selected
 Verts          412      212         24
 Edges          820      418         44
 Faces          410      208         20
 Tris           816      412         40
 Budget  [██████████░░░░░] 816 / 1 500 tris · OMOBA prop   ← text + bar; ok / warn ≥ 90 % / danger > 100 %
```

- The three columns follow Maya's Poly Count HUD: everything visible, the selected objects, and the selected components. Rows: Verts, Edges, Faces, Tris (+ UVs when UVs exist). Game work tracks **Tris**, so the budget bar uses triangles.
- The budget comes from the object's export target: a D attribute `targetBudget`, or the export profile's default.
- Position: top-left under the camera name (Maya's placement). Numbers use `tnum`. The HUD updates on mesh version change, not every frame.

---

## 11. Snapping and pivot editing

### 11.1 Snapping

Status-line group `Snap  [# Grid X] [/ Edge C] [. Vertex V] [~ Incr J]  ⚙`:

- Click makes a snap sticky; holding the key snaps temporarily (Maya). `J` is the existing increment snap (09).
- The `⚙` popover sets the grid step (0.1 m default for low-poly), increments (move 0.1, rotate 15°, scale 0.1; 09) and the vertex snap radius (12 px).
- Feedback: a ring on the snap candidate, and the readout shows `→ vertex 128 · Hero_body`.
- Live surface snapping (Maya "Make Live") comes later.

### 11.2 Pivot editing

| Input | Behaviour | Origin |
|---|---|---|
| `D` held | Pivot edit while held; drag the pivot handle; `X`/`C`/`V` snap it to grid/edge/vertex | Maya (Autodesk Mac hotkeys doc; Polycount for the snapping) |
| `Insert` (Win/Linux), `Home` (macOS) | Sticky pivot-edit toggle. `Home` overrides time.goToStart only in the Model viewport scope | Maya: Insert, or Home on Mac |
| Status line `Piv` toggle | Same as the sticky toggle | E |
| Modify / RMB › Pivot ▸ | Center Pivot · Pivot to Selection · **Pivot to Bottom Center** (props sit on the ground) · Reset Pivot · Bake Pivot (move the geometry so the pivot becomes the origin) | M + E |

- Visual: the custom pivot handle is an `--axis-active` ring with axis arrows. While editing, the manipulator draws dashed.
- The object pivot offset is D (an object attribute; Maya stores rotate/scale pivots on the transform). In component mode the transform pivot is U: the selection centre by default. "Pin component pivot" holds it.

---

## 12. Symmetry, soft selection, selection constraints

### 12.1 Symmetry

- **Status-line dropdown** (Maya places it there): Off · Object X · Object Y · Object Z · World X · World Y · World Z · Topology (later; needs a seam edge, as in Maya).
- **Remembered per mesh**, the Blender idea: a session map `meshId → mode`, defaulting from P. Templates default to Object X.
- **Live Mirror** (note 11 D7) is a separate, per-mesh, non-destructive mirror (axis, merge distance, clipping), stored on the mesh as D and baked at export. You model one half and see both. The Toolkit Symmetry section has a `[ ] Live mirror` toggle with its options, and the Outliner shows a `mirror` badge. Symmetry mode (editing both sides of real geometry) and Live Mirror (generating the other half) are mutually exclusive on one axis, and the UI disables the conflicting option with a tooltip.
- **Tolerance** defaults to 0.001 m (in metres, shown in scene units; MODELING-PLAN v0.2 §3.14 also fixes the per-tool mirroring of Multi-Cut, loops, weld, slide and bridge). **Preserve Seam** is on by default, so seam vertices stay on the plane. Both are Maya Select Tool options.
- Visual: the symmetry plane overlay. Pre-selection highlights the mirrored counterpart too. Selected counterparts draw `--comp-selected` at 60 %.
- When a counterpart is missing, the help line says "12 vertices have no mirror within tolerance" and offers **Show asymmetric** (a lint overlay) and **Symmetrize** (Mesh menu).

### 12.2 Soft selection

- `B` toggles it. `B`+LMB drag changes the radius relative to its current value; `B`+MMB drag sets it from zero (Maya). Trackpad users get `B`+drag only.
- The status line shows `Soft ○ 0.50 m`; the falloff mode (Volume / Surface, Maya) and the curve preset live in the Toolkit.
- It applies to components only. Soft selection on objects is not offered.
- The weight ramp is the `--soft-1…4` tint, with the radius ring at the pointer while `B` is held.

### 12.3 Selection constraints, styles and gestures

- **Constraints** (Toolkit and Q menu): Off · Angle (tolerance °) · Border · Edge Loop (edge mode only) · Edge Ring · Shell. As in Maya's MTK, they highlight on hover and propagate on click.
- **Camera-based selection**: Auto. It is on in shaded and off in wireframe/X-ray, as Maya's default does. Backface selection is a separate toggle.
- **Styles**: Marquee, Drag (paint over components) and **Tweak** (drag a component to move it directly, Maya Tweak/Marquee). Tweak is the biggest speed win for low-poly shaping; it is in the M6a base as a Move tool option, off by default.
- **Gestures**: click, Shift toggle, Mod remove, Mod+Shift add (09 §6.1); marquee. Double-clicking an edge selects its loop (Maya). *Corrected to Maya's table (MODELING-PLAN v0.2 §3.5):* Shift+double-click an **adjacent** component selects the full loop, a **non-adjacent** one the partial loop between them (vertices, edges, faces); a parallel edge gives the ring; Ctrl+double-click deselects the loop or partial loop. `>` grows and `<` shrinks. Arrow keys pick-walk to the adjacent component.

---

## 13. Outliner integration

```
/ filter…                         [mesh][group][char][joint]  [⚙]
▾ Scene
  ▾ ⊞ props                                   vis  lock
     ▢ crate            124 tris   ✎          ●    ○
     ▢ barrel            96 tris   ✎ ⇋X       ●    ○
  ▾ ☺ Hero (VRM 1.0) · modification: allowed
     ▾ Meshes
        ▢ Hero_body     816 tris   ✎ skin ✓ ⇋X
        ▢ Hero_hair     220 tris   ⊘ asset   [Make editable]
     ▸ Skeleton (54)
     ▸ Rig
  ▸ Cameras
  ▸ Reference (later)
```

| Item | Behaviour |
|---|---|
| Types | Mesh ▢, group ⊞, character ☺, joint, camera. Shape nodes are hidden (Maya's "Show Shapes" is off by default) |
| Badges | Triangles (tabular figures); **✎ editable** vs **⊘ asset** (imported meshes stay immutable content-addressed assets until "Make editable", 08 §3.1); skin state `skin ✓` / `skin ⚠ out of date`; `prim` (primitive parameters still live, §8.3); `⇋X` symmetry; `mirror` (Live Mirror, §12.1); lint dot; claim chip (§24). Every badge has text or a glyph plus a tooltip |
| Drag | Reparent is **allowed in Model** (`scene.node.reparent`) and stays disabled in Animate (09 §4.3). A skinned mesh cannot be dragged out of its character without "Unbind" |
| Component mode | Clicking a mesh row adds it to the hilite set |
| RMB | Make editable · Rename (`F2`/`Enter`) · Duplicate · Group · Isolate · Select hierarchy · Center pivot · Mesh check · Rig & Skin this mesh ▸ · Export selected… |
| Filters | Type toggles; "Only editable" |

**Make editable** works inline with no dialog. It converts the mesh primitive into editable mesh data (owned by the mesh-data note) after the licence check. VRM `modification: prohibited` blocks it with the reason and a link to the licence badge. `allowModification` allows editing, and the export redistribution gate still applies (09 §10.3).

---

## 14. Palette panel (face colours)

Note 12 (L2, L3) sets the data rule: **the editable colour truth is a per-face palette index**. Vertex colours, a palette texture or one material per colour are derived at export. This panel is the UI for that rule.

### 14.1 Placement and layout

The Palette is a right-dock tab. The Toolkit's Tools section has a **Paint Colour** tool that uses the active swatch.

```
┌ Palette ──────────────────────────────┐
│ Project palette [ Ekza Default 16 ▾ ] │
│ [■][■][■][■][■][■][■][■]              │   20 px swatches, 8 per row; index 0–7
│ [■][■][■][■][■][■][■][✓]              │   ✓ = active (ring + glyph, not colour alone)
│ Active  ■ 12 · #c8553d  [ #c8553d ] ✎ │
│ [Apply ⏎]  [Pick from mesh  I]  [+]   │
│ Recent  [■][■][■][■][■]               │
│ Used on mesh: 9 of 16 · [Select faces]│
│ Export colours as                     │
│   (•) Palette texture (default)       │
│   ( ) Vertex colours (COLOR_0)        │
│   ( ) One material per colour         │
│ Import .gpl / .hex      Export .gpl   │
└───────────────────────────────────────┘
```

### 14.2 Behaviour

- Click a swatch to make it active. Double-click opens a colour popover (HSV, hex). Dragging a swatch onto the viewport colours the face under the drop point; Shift-drop fills the shell.
- **Paint Colour tool**: click a face to paint it, Shift+click fills the connected shell, `I` held picks the index from the mesh, and drag paints across faces.
- `Enter` in the Model viewport applies the active swatch to the selected faces when the Palette tab is active.
- **Editing a swatch recolours every face that uses it** (one palette edit, note 12 L2). "Select faces" selects the faces that use the active swatch.
- Vertex-colour gradients are not part of this iteration; faces carry one index each, which gives the hard colour borders of the flat low-poly look.

### 14.3 Data and state

| State | Class | Note |
|---|---|---|
| Project palettes (swatch list, names, sRGB values) | D | Shared with collaborators; saved in the project |
| Per-face palette index | D | Part of the mesh data (mesh-data note); survives topology edits through attribute propagation (note 10, TL;DR 4) |
| Export colour mode per model | D | Default palette texture |
| Active swatch | U | — |
| Recent swatches | P | — |

The UI edits sRGB hex values. When the exporter writes `COLOR_0`, it converts to linear, because glTF defines `COLOR_0` as a linear multiplier of the base colour. Import accepts GIMP `.gpl` and Lospec `.hex` (Lospec offers several download formats); export writes `.gpl`.

### 14.4 Export colour mode

| Mode | Writes | Good for | Caveat |
|---|---|---|---|
| **Palette texture** (default, note 12 L3) | One material, a small palette PNG, and every face corner's UV on its swatch centre | Everything, including VRM/MToon; one draw call | One small texture; UVs are generated, so no UV editor is needed |
| Vertex colours | `COLOR_0` with a white base colour | three.js, Bevy (`Mesh::ATTRIBUTE_COLOR` multiplies the `StandardMaterial` base colour) | Ignored by MToon |
| One material per colour | A material per used swatch | OMOBA's current prop style (note 12 §1.2) | More draw calls |

VRM exports **force the palette texture**, and the Export dialog explains why: the MToon 1.0 spec says vertex colours are ignored, and three-vrm's `MToonMaterial` defaults `ignoreVertexColor` to true (note 12 L3).

---

## 15. UV editor (later): placement

- A **pane type** `UV Editor`, drawn with Canvas2D like the Graph Editor (ADR 0007 reasoning). It can sit in the viewport grid (preset M-UV) or as a bottom-dock tab.
- UV mode (Maya F12, which is DevTools in browsers) is reachable only from RMB › UV and the switcher, and only when a UV Editor pane is open. Ctrl+RMB › To UVs stays disabled until then, with "Coming later".
- It is not on the critical path: the palette workflow generates its own UVs (§14.4).

---

## 16. Empty states and onboarding

### 16.1 First run

`FirstRunDialog` (which already asks for the navigation profile) adds one question: **"What do you want to do first?  (•) Animate an avatar  ( ) Model something new"**. The answer sets the start workspace and `prefs.lastWorkspace`. Mac users on the Trackpad profile also see "Component modes: 1 · 2 · 3 (F-keys are media keys on this Mac)".

### 16.2 Model start card (empty scene, or Create › New model)

```
┌───────────────────────────── persp (empty) ──────────────────────────────┐
│                          Start a low-poly model                          │
│   [▣ Cube]   [◯ Cylinder 8]   [◍ Sphere 8×6]   [▭ Plane]   [△ Cone 8]    │
│                                                                          │
│   [☺ Humanoid template ▾]  Stylized · Chibi · Blocky    height [1.60 m]  │
│        one mesh · symmetry X · ~600 tris · VRM humanoid skeleton ready   │
│                                                                          │
│   [Import mesh…  .glb .gltf .vrm]       [Edit a sample: Polybot (CC0)]   │
│   [Generate with AI…]  Coming later                                      │
│                                                                          │
│   3 face mode · Ctrl+E extrude · Shift+drag extrude · B soft select      │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Low-poly primitive defaults**: cube 1 m with one segment; cylinder 8 sides, 1 height segment, capped; sphere 8×6; plane 1×1; cone 8 sides. A new primitive appears at the world origin, or where the pointer's ray hits the ground plane when the pointer is over a pane. The Last-op card then opens with the segment counts.
- **Humanoid template**: generated by code in this repository (MIT). It is parametric (height, proportion preset, head ratio, limb segments): one mesh with X-symmetric topology, about 400–900 triangles, and a **skeleton template** record holding VRM humanoid joint positions, so Rig & Skin starts pre-fitted. It is authored in the VRM 1.0 T-pose, grounded at Y = 0 and facing +Z, which is the bind pose notes 12 (L5) and 14 (D2) require. The skeleton presets are note 14's Lite 17, Standard 33 and Full 52 joints.
- **Polybot** (CC0 1.0, already bundled, ADR 0012) is the editable sample: real low-poly VRM topology to learn from.
- **Not bundled**: Quaternius Universal Base Characters. Itch lists it as CC0, but it averages about 13k triangles (not low-poly), and Quaternius now publishes new assets under the QAL licence. ADR 0012 requires the file's own licence.
- **Generate with AI** stays disabled with "Coming later" until the generation note's back end exists. Generated meshes then land in Model with Mesh Check and Decimate offered.

### 16.3 Getting started (Model)

A dismissible card at the top-right of the pane. Coach marks never block input (09 §10.1).

① Create a primitive or template ✓ → ② Face mode (`3`, `F11` on a desktop build, or RMB › Face) → ③ Extrude (`Ctrl+E`, or Shift+drag a Move arrow) and type a value → ④ Symmetry › Object X → ⑤ Colour faces from the Palette → ⑥ Rig & Skin ▸ → ⑦ Animate ▸

### 16.4 Panel empty states

| Panel | Empty text | Primary action |
|---|---|---|
| Toolkit | "Select a mesh, or create one" | Primitive buttons |
| Palette | "No palette in this project" | Use Ekza Default 16 · Import .gpl/.hex |
| Outliner | "Nothing here yet" | "Shift+RMB on empty space creates primitives" |
| Mesh Check | "No issues" ✓ | — |

---

## 17. Hand-off: Model → Rig & Skin → Animate

```
 Toolkit footer                         Workspace tabs (pipeline)
 ─ Next ──────────────────────────      Model ● › Rig & Skin ◐ › Animate ○
  Mesh check ✓   816 / 1 500 tris        ◐ tooltip: "Weights transferred after a topology change: review"
  [ Rig & Skin ▸ ]  [ Export model… ]
```

1. **Model**: the Model glyph turns ● when Mesh Check is clean (manifold, no zero-area faces, no stray n-gons if the target forbids them) and the triangles are within budget.
2. **Rig & Skin ▸** (Toolkit footer, Outliner RMB, or the tab) opens Rig & Skin with the mesh selected:
   a. **Skeleton**: the **Quick Rig** wizard of note 14 (D5): markers → guides → skeleton → skin. Pick a template (VRM humanoid by default). It comes pre-fitted for the template humanoid; **Fit to mesh** handles other meshes. Joint placement happens in X-ray with symmetry X, then the 09 §9.3 Validation list checks the humanoid mapping.
   b. **Bind**: automatic weights (the skinning note owns the algorithm), then a range-of-motion test clip plays.
   c. **Paint weights** for fixes: brush, Add/Replace/Smooth, a joint list, and heat display.
3. **Animate ▸** runs the existing auto control rig (`Rig › Auto control rig`) if the character has none, switches to Animate with the character active, and offers the Ekza clip library (09 §4.3).
4. **Return trips.** Animate → Model shows `BIND POSE`. Moving vertices keeps weights. A topology change sets the Outliner badge to `skin ⚠`. On leaving Model, weights transfer by closest point, and the Rig & Skin glyph turns ◐ "Review weights (transferred)". Nothing is dropped silently.
5. **Export from any step.** The Export dialog gains **Static model (GLB)** and **Character (VRM 1.0 / GLB)** sections with profile checks: triangle budget, colour export mode versus target (§14.4), ≤ 4 influences, and the licence gate.

The Rig & Skin layout is later work. The hand-off needs only its entry point, its status glyph and the out-of-date flow.

---

## 18. Menus in the Model workspace

The common menus stay (File, Edit, Create, Select, Modify, Display, Windows, Help), and Model adds Maya's Modeling menu set. Each item is an operator (09 principle 7) contributed with `workspaces: ['model']`. Operator IDs are proposals; the mesh-operations note owns the catalog.

| Menu | Items (operator) |
|---|---|
| Edit | Adjust Last Operation `T` (`edit.adjustLast`) · Repeat Last `G` (`edit.repeatLast`) · Duplicate `Mod+D` · Duplicate with Transform `Shift+D` · Group `Mod+G` · Parent `P` / Unparent `Shift+P` |
| Create | Polygon Primitives ▸ Cube / Cylinder / Sphere / Plane / Cone / Torus (`mesh.create {primitive}`) · Humanoid Template… (`mesh.create {template:'humanoid'}`) · Empty Group · Reference Image (later) |
| Select | Object Mode / Vertex / Edge / Face (`select.mode`) · Convert Selection ▸ (`select.convert {to}`) · Grow `>` / Shrink `<` · Edge Loop / Edge Ring / Shell / Border · Invert · Select Using Constraints ▸ |
| Modify | Center Pivot · Pivot ▸ · Freeze Transforms · Reset Transforms · Snap ▸ |
| Mesh | Combine · Separate · Mirror… · Symmetrize · Triangulate · Cleanup… · Mesh Check · Decimate… (later) |
| Edit Mesh | Extrude `Mod+E` · Bevel `Mod+B` · Bridge · Inset · Merge `M` · Merge to Center · Target Weld · Connect · Collapse · Chamfer Vertex · Poke · Duplicate Faces · Extract · Delete Edge/Vertex · Flip Normals · Soften/Harden Edge ▸ |
| Mesh Tools | Multi-Cut `K` · Insert Edge Loop · Paint Colour · Quad Draw (later) |
| Mesh Display | Normals ▸ · Face Orientation · Flat Shading · Backface Culling · Vertex Colours ▸ (store as / show) |

---

## 19. Default keymap for modeling (`maya` preset)

### 19.1 Implementation rules (additions to 09 §7.1)

1. **Scope chain.** With the pointer over a viewport in Model's face mode, the chain is `model.viewport.face` → `model.viewport.component` → `model.viewport` → `viewport` → `model` → `global`. In object mode it starts at `model.viewport`. In other panels it is `model.<panel>` → `<panel>` → `model` → `global`. Only `scopeChain()` in the DOM adapter changes. `KeymapManager.resolve` already returns the first match in chain order, and existing bindings keep their scopes. Note 11 (D10) calls `model.viewport.component` the `mesh` scope; the spec should pick one name. The extra workspace levels here are needed because `K`, `M`, `Home` and `T` change meaning in the Model viewport even in object mode.
2. A binding in a deeper scope **shadows** a shallower one. The help line shows the resolved meaning for the panel under the pointer ("Ctrl+E Extrude"), and the hotkey editor lists shadowing as intended, not as a conflict.
3. `event.code` only (09 §7.1). The tap/hold set grows from `Space` to `Space`, `B`, `D`, `X`, `C`, `V` and `I`; `Q`/`W`/`E`/`R`+LMB are 09's.
4. **F-keys** follow the availability matrix (§19.2). Keys that a browser or OS takes are not bound, so they cannot trigger two actions at once.

### 19.2 F-key availability

| Key | Maya meaning | Windows Chrome/Edge | Linux Chrome | Firefox (Win/Linux) | macOS (any browser) | Ekza default |
|---|---|---|---|---|---|---|
| F8 | object ↔ component | ok | ok | ok | media play/pause unless fn or "standard function keys" | **bound** |
| F9 | vertex | ok | ok | ok | media next; fn+F9 | **bound** + `1` |
| F10 | edge | browser accelerator (focus toolbar); `preventDefault` on keydown, QA per release | ok | shows the menu bar; `preventDefault`, QA | mute; fn+F10 | **bound** + `2` |
| F11 | face | fullscreen (even Keyboard Lock leaves it to Chromium) | same | reserved (Firefox fullscreen tests) | Show Desktop (OS default) | **not bound**; `3` |
| F12 | UV | DevTools | DevTools | DevTools | volume up | not bound |
| Ctrl+F9/F10/F11 | convert to vertices/edges/faces (Maya hotkey list) | ok, QA | ok | ok | fn needed; Ctrl+F1–F8 are macOS keyboard-navigation keys, F9–F11 believed free; QA | bound (convert) |

### 19.3 Full table

Legend: **M** Maya default · **M~** Maya-inspired, adapted · **E** Ekza addition (**E-B** from Blender). Scopes: `mv` = `model.viewport`, `mvc` = `model.viewport.component`, `mo` = `model.outliner`, `modal` = while a modal tool or drag is active. `Mod` = Ctrl on Win/Linux, Cmd on macOS.

**Modes and selection**

| Action | Win/Linux | macOS | Scope | Origin | Notes |
|---|---|---|---|---|---|
| Object ↔ last component mode | `F8` | `F8` (fn) | mv | M | |
| Vertex mode | `F9`, `1` | `1`, fn+`F9` | mv | M / E-B (Industry Compatible) | Pressing `1` again returns to object mode |
| Edge mode | `F10`, `2` | `2`, fn+`F10` | mv | M / E-B | F10 QA (§19.2) |
| Face mode | `3` | `3` | mv | E-B | Maya F11 is browser/OS-reserved |
| Convert to vertices / edges / faces | `Ctrl+F9` / `Ctrl+F10` / `Ctrl+F11` | fn+`Ctrl+F9`… | mvc | M | Also Ctrl+RMB and Select › Convert |
| Grow / shrink selection | `Shift+.` (`>`) / `Shift+,` (`<`) | same | mvc | M | Unshifted `,`/`.` stay prev/next key |
| Select edge loop / full or partial loop / deselect loop | double-click edge / Shift+double-click adjacent or non-adjacent / Ctrl+double-click | same | mvc | M | Maya table (§12.3, corrected) |
| Select all components of hilited meshes | `Mod+A` | `Cmd+A` | mvc | E (09) | |
| Invert selection | — (menu, palette) | — | — | — | Maya's `Ctrl+Shift+I` opens DevTools |
| Pick-walk to adjacent component | arrows | arrows | mvc | M | |
| Hide selected / show all / hide unselected | `H` / `Shift+H` / `Alt+H` | same | mv | M~ (09) | Components too |
| Isolate selection | `Shift+L` | same | mv | M (09) | |
| Frame selected / all | `F` / `A` | same | mv | M | |

**Tools and operations**

| Action | Win/Linux | macOS | Scope | Origin | Notes |
|---|---|---|---|---|---|
| Select / Move / Rotate / **Scale** tool | `Q` / `W` / `E` / `R` | same | mv | M | Viewport scale tool is new |
| Last used tool | `Y` | `Y` | mv | M | Also re-activates Multi-Cut (Autodesk) |
| Adjust Last Operation (expand/collapse card) | `T` | `T` | mv | M~ | Maya `T` brings back the In-View Editor |
| Repeat last operation | `G` | `G` | mv | M | 09 listed `G` as later |
| **Extrude** | `Ctrl+E` | `Cmd+E` | mvc | M | Shadows Export (`Mod+E`) only here |
| Export dialog (alias, everywhere) | `Ctrl+Shift+E` | `Cmd+Shift+E` | global | E | Notes 10 §6.3 and 11 D10. QA: Firefox binds `Ctrl+Shift+E` to its Network Monitor |
| Smart extrude | Shift+drag a manipulator handle | same | mvc | M | In object mode Shift+drag duplicates (Maya smart duplicate) |
| Bevel | `Ctrl+B` | `Cmd+B` | mvc | E-B | Firefox `Ctrl+B` = bookmarks sidebar: `preventDefault`, QA |
| Multi-Cut | `K` | `K` | mv | E-B (knife) | In Animate `K`+drag stays the virtual time slider (09) |
| Insert edge loop | `Ctrl`+click in Multi-Cut; Shift+RMB › N | same | mv | M | Blender's `Ctrl+R` reloads the page |
| Spin edge (controls triangulation) | `Ctrl+Alt+→` / `Ctrl+Alt+←` | `Ctrl+Option+→` / `←` | mvc | M | Some Windows graphics drivers rotate the screen on this chord (note 10); menu fallback |
| Merge (menu: at center / to last / by distance) | `M` | `M` | mvc | E-B | `Alt+M` stays Mirror pose |
| Delete components | `Delete`, `Backspace` | same | mvc | M | *Superseded (Q-MOD-UI-6):* Maya's plain Delete — edges merge their faces and keep the end vertices; `Mod+Delete`/`Mod+Backspace` = Delete Edge/Vertex (clean); faces delete |
| Delete objects | `Delete`, `Backspace` | same | mv, mo | M | |
| Duplicate (objects; faces in face mode) | `Ctrl+D` | `Cmd+D` | mv, mo | M | Browser "bookmark" prevented, as 09 already does |
| Duplicate with transform | `Shift+D` | same | mv | M | |
| Group | `Ctrl+G` | `Cmd+G` | mv, mo | M | Browser "find next" prevented |
| Parent / unparent | `P` / `Shift+P` | same | mv, mo | M | |

**Snapping, pivot, soft selection, symmetry**

| Action | Key | Scope | Origin | Notes |
|---|---|---|---|---|
| Snap to grid / edge / vertex (hold) | `X` / `C` / `V` | mv, modal | M | Also snaps the pivot while `D` is held |
| Increment snap (hold) | `J` | viewport | M (09) | |
| Pivot edit (hold) | `D` | mv | M | |
| Pivot edit (toggle) | `Insert` (Win/Linux), `Home` (macOS) | mv | M | `Home` keeps go-to-start everywhere else |
| Soft select on/off | `B` (tap) | mv | M | |
| Soft radius: relative / from zero | `B` + LMB drag / `B` + MMB drag | mv | M | |
| Selection-options menu (symmetry, constraints) | `Q` + LMB, Ctrl+Shift+RMB | mv | M | Animate keeps 09's Q menu |
| Manipulator size | `-` / `=` | viewport | M (09, shipped) | |

**Display (pane under the pointer)**

| Action | Key | Origin | Notes |
|---|---|---|---|
| Wireframe / shaded / colours / lit | `4` / `5` / `6` / `7` | M (09 §5.6) | To build; Model needs it first |
| X-ray | `Alt+X` | E (09, shipped) | |
| Wire on shaded, flat, culling, normals, face orientation, poly count | header toggles and Show ▾ (unbound) | — | Rebindable |

**Modal (during any drag or modal tool)**

| Action | Key | Origin |
|---|---|---|
| Numeric entry | digits, `.`, `-`, `=` | E-B |
| Next field | `Tab` | E-B |
| Confirm / cancel | `Enter`, LMB release / `Esc` (RMB never cancels: ignored during a drag, completes Multi-Cut; corrected per ADR 0016 D8) | M + B |
| Fine adjustment | `Shift` | 09 |
| Axis constraint | `X` / `Y` / `Z` (Blender preset only) | B |

**Marking menus (Model viewport)**: RMB (modes, §5.4) · Shift+RMB (polygon tools, §6.1) · Ctrl+RMB (convert, §6.2) · Ctrl+Shift+RMB and `Q`+LMB (selection options, §6.3) · `W`/`E`/`R`+LMB (spaces; 09; Move adds **Component/Normal** space) · `Space` hold (camera radial, shipped).

**Paint Colour tool**: `I` held = eyedropper (E; the Graph Editor's `I` is unaffected); Shift+click = fill shell; `Enter` = apply the active swatch to the selection.

**Inherited unchanged in Model**: undo/redo, `Mod+S`, `Mod+O`, `Mod+K` (palette), `?`, Space tap/hold, `Shift+[`/`Shift+]`, `Alt+L`, `Alt+V`, `Esc`.

**Never bound by default** (09 §7.6 plus modeling cases): `Mod+R` (reload; Blender loop cut), `Ctrl+N` (new window; Blender recalc normals; use Mesh Display › Conform Normals), `Ctrl+Tab` (Blender select-mode pie), `Mod+Shift+I` (DevTools; Maya invert), `F11`, `F12`, `Alt+E`/`Alt+F` on Windows (browser menus; Blender extrude menu), `Tab` outside modal tools (focus traversal and WCAG 2.1.2; Blender's edit-mode toggle).

### 19.4 Deliberate divergences from Maya

| Maya | Ekza | Why |
|---|---|---|
| F11 face mode | `3` | Fullscreen / Show Desktop |
| F12 UV mode | Switcher and RMB only, later | DevTools |
| `1`/`2`/`3` smooth mesh preview | Vertex/edge/face mode; smooth preview later on `Shift+1`/`2`/`3` (note 10) | No subdivision preview in low-poly scope; Blender's Industry Compatible precedent |
| `Ctrl+Shift+I` invert | Menu and palette | DevTools |
| Insert on macOS | `Home` | Maya's own Mac docs |
| ~~Delete on edges leaves winged vertices~~ | ~~Dissolves cleanly~~ | *Superseded (Q-MOD-UI-6): no divergence; Delete behaves as in Maya, with a stray-vertex lint and one-click fix* |
| No default bevel / multi-cut / merge keys | `Mod+B` / `K` / `M` | Blender habits that collide with nothing in the browser |
| Construction history (INPUTS list) | Last operation only | U3 |

### 19.5 Blender preset (later, T0 data pack)

`G`/`R`/`S` modal transforms with `X`/`Y`/`Z`, `E` extrude, `I` inset, `Ctrl+B` bevel, `K` knife, `M` merge, `F` fill, and `Alt`+click loop select. `Alt`+click works only with the Trackpad/Blender navigation profile, because in the Maya profile `Alt`+LMB tumbles. `Ctrl+R`, `Ctrl+N` and `Ctrl+Tab` cannot be offered; the preset maps them to `Alt+R`, menu entries and the RMB menu, with a note in the cheat sheet.

---

## 20. React component tree (additions to 09 §13.1)

```
<EditorShell workspace={ws}>
 <MenuBar>
   <AppMenus workspace={ws}/>                    // MenuItemDef.workspaces filter
   <WorkspaceTabs/>                              // tablist + status glyphs from derived selectors (mesh check, skin, clips)
   <ExportButton/>
 </MenuBar>
 <StatusLine workspace={ws}>                     // group registry keyed by workspace
   Model: <ToolGroup/> <ComponentModeSwitch/> <SymmetrySelect/> <SoftSelectControl/> <ConstraintSelect/>
          <SnapToggles/> <PivotToggle/> <ManipulatorSpaceSelect/> <LayoutPresetPicker/>
 </StatusLine>
 <DockHost workspace={ws}>                       // one dockview; layout JSON swapped per workspace
   <OutlinerPanel variant="model">  <OutlinerFilterBar/> <OutlinerTree/> <MakeEditableInline/>
   <ViewportPanel>  <PaneHeader/> <PaneSurface/>
     <PaneHud> <ModeBadges/> <PolyCountHud/> <BindPoseBadge/> <LastOpCard/> <ModalReadout/> <SnapTargetChip/>
     <ModelEmptyState/>
   <ModelingToolkitPanel> <MtkTargetHeader/> <ComponentModeSwitch compact/> <MtkSelectionSection/>
     <MtkSymmetrySection/> <MtkSoftSelectionSection/> <MtkComponentsGrid/> <MtkToolsGrid/> <MtkMeshGrid/>
     <ActiveToolSettings/> <HandOffFooter/>
   <ChannelBoxPanel> … <InputsSection/>          // last-op args (Maya INPUTS)
   <AttributesPanel> … <MeshSection/> <PivotSection/> <ExportTargetSection/>
   <PalettePanel> <PaletteSelect/> <SwatchGrid/> <ActiveColour/> <ApplyControls/> <ExportColourModeRadio/>
   <MeshCheckPanel/>                             // lint list ⇄ overlay
   <UvEditorPanel/>                              // later
   <SkinPanel/> <ValidationPanel/>               // Rig & Skin, later
 </DockHost>
 <TimelineBar hidden={ws === 'model'}/>
 <HelpLine/>
</EditorShell>
<GLHost> … <ViewportRenderer/>                   // + imperative overlays in packages/viewport (no React):
          ComponentOverlay · NormalsOverlay · LintOverlay · SymmetryOverlay · SoftSelectOverlay · PivotHandle
<Overlays>
  <MarkingMenu/>                                 // generic, FR-SHELL-09; data layouts per menu id
  <CommandPalette/> <OptionBoxPopover/> <ColourPickerPopover/> <ModelGettingStartedCard/> <FirstRunDialog/>
</Overlays>
```

Rules: HUD leaves subscribe to the `ComponentSelection` version and to counts, throttled to rAF. Overlays and pre-selection are drawn imperatively. React re-renders only on human-speed changes: mode, panel toggles, a committed operation.

---

## 21. State classification (D / U / P)

| State | Class | Owner | Persistence | Collaboration |
|---|---|---|---|---|
| Mesh geometry (blob hash), per-face palette indices, hard edges, material slots | D | document (mesh table, mesh-data note) | project file + autosave | per-mesh last-writer-wins + claim (06, 08 §9.8) |
| Object transform, pivot offset, parent, name, visibility | D | document | project | per field |
| Project palettes | D | document (palette table) | project | per record |
| Skeleton template placement, skin binding, weights | D | document | project | per-mesh claim |
| Target budget / export target per model | D | document | project | per field |
| Active workspace | U | session | `prefs.lastWorkspace` (P) | presence: "Anna is in Model" |
| Component mode, hilite set | U | session | — | presence |
| Component selection per mesh per mode | U | `ComponentSelection` service; the session holds `{version, counts}` | — | presence sends counts and bounds, not indices |
| Last operation (op, args, step, targets) | U | editor history + session | — | invalid after a remote change |
| Symmetry mode per mesh | U | session map | — (default from P) | — |
| Live Mirror settings per mesh | D | document (mesh modifier, note 11 D8) | project | per field |
| Primitive parameters (until the first topology edit) | D | document (mesh record) | project | per field |
| Soft select on/radius · constraint · selection style · sticky snaps · pivot edit | U | session tool state | — | — |
| Hover component, snap candidate, marquee, modal numeric buffer | transient | tool state machine | — | — |
| Per-pane shading and overlays | U | `ViewportManager` pane config | layout JSON | — |
| Tool settings, option-box defaults, falloff preset, increments | P | prefs | localStorage | never |
| Toolkit sections collapsed, palette recents, start choice, "convert on mode switch" | P | prefs | localStorage | never |

The ARCHITECTURE §4.1 hard rule is unchanged: no U or P value is written to the document.

Hot paths:

- `ComponentSelection` keeps one bitset per mesh per mode (`Uint32Array` words sized to the element count) and a monotonic version, and exposes `subscribe`. Undo metadata stores compact index ranges.
- Pre-selection picking runs a three-mesh-bvh raycast (0.9.16, MIT, peer `three >= 0.159`; checked on npm 2026-10-18), then picks the nearest vertex or edge in screen space within 8 px. No React is involved.
- Overlay buffers are rebuilt when a mesh's document version changes, not every frame. Selection colours update vertex-attribute sub-ranges (`addUpdateRange`).
- Budgets, to measure in the first spike: hover pick ≤ 1 ms and marquee ≤ 8 ms at 20k triangles; a Last-op re-run ≤ 16 ms at 5k triangles (typical low-poly).

---

## 22. Contracts this UI needs (proposals; the spec owns the final shapes)

```ts
export type WorkspaceId = 'model' | 'rig' | 'animate' | 'review' | (string & {});
export type ComponentMode = 'object' | 'vertex' | 'edge' | 'face' | 'uv';
export type SymmetryMode = 'off' | `object-${'x' | 'y' | 'z'}` | `world-${'x' | 'y' | 'z'}` | 'topology';

export interface ModelSessionState {                 // joins SessionState
  readonly workspace: WorkspaceId;
  readonly componentMode: ComponentMode;
  readonly hilite: readonly MeshId[];
  readonly componentSelection: { readonly version: number; readonly vertex: number; readonly edge: number; readonly face: number };
  readonly symmetry: Readonly<Record<MeshId, SymmetryMode>>;
  readonly softSelect: { readonly on: boolean; readonly radius: number; readonly falloff: 'volume' | 'surface' };
  readonly constraint: 'off' | 'angle' | 'border' | 'loop' | 'ring' | 'shell';
  readonly selectionStyle: 'marquee' | 'drag' | 'tweak';
  readonly snap: { readonly grid: boolean; readonly edge: boolean; readonly vertex: boolean };
  readonly pivotEdit: boolean;
  readonly lastOp: LastOpState | null;
}
export interface LastOpState {
  readonly op: OperatorId; readonly args: unknown; readonly step: string;
  readonly targets: readonly MeshId[]; readonly paneId: string | null;
  readonly invalid: string | null;                  // 'Changed by Anna' etc.
}
// DisplayFlags (per pane) additions; Model defaults in brackets:
//   shading 'wire' | 'shaded' | 'colours' | 'lit' ['colours'] · wireOnShaded [true] · flat [true] · cull [false]
//   components [true] · normals 'off' | 'face' | 'vertex' | 'both' ['off'] · faceOrientation [false]
//   polyCount [true] · meshCheck [false] · symmetryPlane [true]
// MenuItemDef:    + readonly workspaces?: readonly WorkspaceId[]
// OperatorDef:    + flags.register (Last-op, Repeat Last, operator log) + argsSchema (labels, units, min/max, step)
// EditorHistory:  + amend(stepId, apply): replaces one step (Last-op edits; ADR 0013 needs an amendment)
// Keymap:         scope strings 'model.viewport.component' etc.; DOM adapter builds the chain (§19.1)
// ToolDef:        + workspaces?: readonly WorkspaceId[]; + modes?: readonly ComponentMode[]
```

---

## 23. Accessibility and responsiveness

- The mode switcher is a radiogroup with key hints in names ("Vertex mode, F9 or 1"). Selection changes are announced through a polite live region ("24 vertices selected").
- Every marking-menu item is also in a menu-bar menu and the command palette (§18, 09 §7.4).
- Colour is never the only cue: badges carry text, swatches show a check glyph and hex tooltips, lint uses shapes (◇ n-gon, ✕ non-manifold), and soft-select weights show numerically in the readout under the pointer.
- Overlay contrast comes from the halo rule (§10.3).
- Keyboard-only path: select a mesh in the Outliner, `F8`/`1`/`2`/`3`, then Select-menu commands, Edit Mesh operators and Toolkit fields. Canvas content is not screen-reader accessible (09 §11.1); counts and fields are.
- `prefers-reduced-motion`: marking menus and the Last-op card appear without animation.
- Width: ≥ 1280 px gives the full layout. At 1024–1279 px the right dock is 260 px, the Toolkit is icon-only in two columns, and the Outliner becomes a rail. Below 1024 px Model is view-only (orbit, counts, Mesh Check) with the 09 §11.2 banner.
- Pen/touch (later): long-press = RMB menu, barrel button = RMB, two-finger tap = undo (09 §11.3).

---

## 24. Collaboration affordances (M3 and later, designed now)

- **Mesh claims.** Entering component mode on a mesh claims it. Research 06 and 08 §9.8 choose coarse per-mesh locks over per-vertex CRDT. Other users see an Outliner chip "Anna is modeling" and a dashed outline in her presence colour. For them the mesh's components are read-only; its transform stays editable unless claimed. "Ask to take over" follows 09 §12's soft-lock pattern.
- The Last-op card goes stale on a remote change to its target (§8.3).
- Palettes are shared D records, and swatch edits merge per record.
- The presence tooltip shows workspace and mode ("Anna · Model · face mode · Hero_body").

---

## 25. Build slice for this iteration (UI side) and acceptance

| Package | Scope | Depends on |
|---|---|---|
| U-0 Shell prerequisites | Workspace tabs, per-workspace layouts/menus/status line, hierarchical key scopes, generic `MarkingMenu` (FR-SHELL-09), command palette (FR-SHELL-08), viewport Scale tool, overlay layer infrastructure, display modes `4`–`7` | — (pulled forward from M2c) |
| U-1 Modes and selection | Component modes, `ComponentSelection`, component overlays, RMB and Ctrl+RMB menus, poly count HUD, Mesh Check panel + overlay | mesh data note |
| U-2 Operations UI | Toolkit panel, Shift+RMB menus, Last-op card + Channel Box INPUTS + `history.amend`, modal readout and numeric input | mesh operators note |
| U-3 Precision aids | Snapping, pivot editing, symmetry, soft selection, constraints, selection styles | U-1 |
| U-4 Content | Outliner for meshes + Make editable (licence gate), Palette panel + Paint Colour, Model start card, templates, Getting started | mesh data, templates |
| U-5 Hand-off | Pipeline glyphs, Rig & Skin entry, `BIND POSE`, skin out-of-date flow, Export dialog sections | skinning note, export note |

Acceptance scenarios (`E2E-MOD-*`, Chrome; mouse and trackpad profiles):

1. Empty scene → Cube → `3` → click the top face → `Ctrl+E` → type `0.5`, `Enter`. The Last-op card reads Offset 0.500 m. Setting Divisions to 2 creates no new undo step, and one `Z` restores the cube.
2. Symmetry Object X on the template: extruding a left-arm face extrudes the right arm too, and the HUD triangle count updates once.
3. **Mac without F-keys**: scenario 1 completes with `1`/`2`/`3` and the RMB menu only; `F11` is never needed.
4. With the pointer over a face-mode viewport, `Ctrl+E` extrudes. Over the Outliner it opens Export, and the help line shows each meaning.
5. Template humanoid → paint faces → Rig & Skin → Animate → keyed walk → export VRM. The file carries the palette texture, and the read-back shows no `COLOR_0` dependency.
6. Adding an edge loop after binding sets the badge to `skin ⚠`. Leaving Model turns the Rig & Skin glyph to ◐ and keeps the weights transferred.
7. "Make editable" on a VRM with `modification: prohibited` is blocked and gives the reason.
8. Performance: hover pre-selection p95 ≤ 1 ms, and marquee at 20k triangles ≤ 8 ms, in the bench harness.

---

## 26. Open questions for the owner

| ID | Question | Proposal |
|---|---|---|
| Q-MOD-UI-1 | Calibrate the RMB and Shift+RMB compass positions against a Maya install, or accept the Ekza layout? | Owner checks Maya 2026/2027 once; then freeze |
| Q-MOD-UI-2 | Digits `1`/`2`/`3` for component modes (lose Maya smooth-preview semantics)? | Yes (Blender Industry Compatible precedent; only portable keys) |
| Q-MOD-UI-3 | `Ctrl+E` extrudes in component mode and shadows Export there, with Export also on `Ctrl+Shift+E` (same as note 10 Q-MOD-10-2, note 11 Q2)? | Yes, with help-line feedback |
| Q-MOD-UI-4 | Last operation only, or a Maya-style history list per mesh? | Last operation only for this iteration |
| Q-MOD-UI-5 | Default Model layout: four view with persp maximized (Maya Space toggle), or single? | Four view, persp maximized |
| Q-MOD-UI-6 | `Delete` on edges dissolves (clean), not Maya's plain delete? | Dissolve — *overridden: Maya's plain Delete (DECISIONS-OPEN Q-MOD-UI-6)* |
| Q-MOD-UI-7 | Hide the timeline in Model by default? | Hide; Windows › Timeline |
| Q-MOD-UI-8 | Workspace switch hotkey: none by default? | None; command palette and hotkey editor |
| Q-MOD-UI-9 | Palette texture as the default colour export, forced for VRM (note 12 L3)? | Yes |
| Q-MOD-UI-10 | Make editable on `modification: prohibited` VRMs: block, or allow with acknowledgement for private use? | Block (same spirit as the bake gate) |
| Q-MOD-UI-11 | Close DECISIONS-OPEN Q-UI-1 (Model tab hidden) when U-0 lands | Yes |
| Q-MOD-UI-12 | Bind `F11` to face mode in web builds (note 11 D10 does)? | No: where a browser delivers the keydown it still goes fullscreen, so one press would do two things. Bind `F11`/`F12` only in a future desktop wrapper preset (note 10 agrees: "F11 ✗") |

---

## 27. Sources

Maya (Autodesk):
- Maya keyboard shortcuts (F8–F12, Alt+F9, `<`/`>`): https://www.autodesk.com/shortcuts/maya
- Maya 2011 hotkey reference (Ctrl+F9…F12 convert selection): https://download.autodesk.com/us/maya/2011help/files/PC_Maya_Hotkeys.htm
- Selection hotkeys (2014): https://download.autodesk.com/global/docs/maya2014/en_US/files/Selection_hotkeys.htm
- Marking Menus (Shift+RMB polygon tools): https://help.autodesk.com/cloudhelp/2025/ENU/Maya-Basics/files/GUID-8BA1A3AA-4C44-4779-8B22-0AAE3627E8EB.htm
- Convert Selection (Ctrl+RMB, Ctrl+F9/F10): https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Basics/files/GUID-DCE04BA9-A2CF-44AA-8045-FFF2392B6796.htm
- Extrude (Ctrl+E, Shift+drag smart extrude, In-View Editor): https://help.autodesk.com/cloudhelp/2022/ENU/Maya-Modeling/files/GUID-20202ED3-5EC7-420E-860E-EC29D101A7A8.htm · https://help.autodesk.com/cloudhelp/2016/ENU/Maya/files/GUID-20202ED3-5EC7-420E-860E-EC29D101A7A8.htm
- Bevel and the In-View Editor: https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-80605B6D-79ED-4435-99FB-928508248469.htm
- In-View Editor returns with `T` (Autodesk community): https://forums.autodesk.com/t5/maya-modeling/option-missing/td-p/7114969
- Multi-Cut hotkeys (`Y`, Ctrl+click loop): https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-21E402B5-1ABF-4DD3-A9CE-8B7957F6DF2B.htm
- Modeling Toolkit selection styles and options: https://help.autodesk.com/cloudhelp/2023/ENU/Maya-Modeling/files/GUID-7EC09146-E5E8-449E-83D7-BFE7C780C32D.htm
- Modeling Toolkit selection constraints: https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-CAF874D8-CD2A-4C94-8959-BDB2006EB0FB.htm
- Camera-based selection: https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Basics/files/GUID-72C0C337-FBA7-4009-9D91-57D0587A17BA.htm
- Select Tool (symmetry tolerance, Preserve Seam, falloff modes): https://help.autodesk.com/cloudhelp/2024/ENU/Maya-Basics/files/GUID-60FD5F79-AC1D-46DE-B66D-2FBE73E15A30.htm
- Activate symmetry (status line, Ctrl+Shift+RMB / Q+click): https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-7EC940BA-4B3A-4DB2-AC6B-8CDBA800EC61.htm
- Soft Selection falloff size (B+drag, B+MMB): https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-9D29FDE2-7715-4FD6-9F45-5D233A9C73CF.htm
- Poly Count HUD: https://help.autodesk.com/cloudhelp/2016/ENU/Maya/files/GUID-53E46D0C-4B7B-4404-AEB0-3BDD1FF8608A.htm · https://help.autodesk.com/cloudhelp/2019/ENU/Maya-Basics/files/GUID-0E9D9594-6664-4B69-B944-8B69E9551415.htm
- Hotkeys in Maya for macOS (`D` pivot; Insert/Home): https://help.autodesk.com/cloudhelp/2027/ENU/Maya-KeyboardShortcuts/files/GUID-4670578A-61B8-4A02-A003-9DBA6E53003B.htm
- Hotkey Editor (2027): https://help.autodesk.com/cloudhelp/2027/ENU/Maya-KeyboardShortcuts/files/GUID-36D24C0F-19E4-411E-8CA9-DB7B64C3E6EA.htm
- Pivot snapping while holding `D` (Polycount): https://polycount.com/discussion/comment/2047791
- Shift+RMB extrude at the south slot (Polycount): https://polycount.com/discussion/comment/2082948

Blender:
- Undo & Redo, Adjust Last Operation: https://docs.blender.org/manual/en/3.0/interface/undo_redo.html
- Mesh selection modes (1/2/3, Shift for multiple): https://docs.blender.org/manual/en/latest/modeling/meshes/selecting/introduction.html
- Viewport overlays (face orientation, mesh edit overlays, normals): https://docs.blender.org/manual/en/dev/editors/3dview/display/overlays.html
- Numeric input during transforms: https://docs.blender.org/manual/en/latest/scene_layout/object/editing/transform/control/numeric_input.html
- Mesh symmetry / mirror options: https://docs.blender.org/manual/en/2.80/modeling/meshes/editing/mesh_options.html
- Industry Compatible keymap, mode order Vert/Edge/Face/Object: https://developer.blender.org/rB1fce0460d5222604e7007518bc246c97286312f3 · https://lists.blender.org/pipermail/bf-blender-cvs/2019-May/123495.html

Other tools and assets:
- Blockbench overview (mode tabs Edit/Paint/Animate/Display): https://www.blockbench.net/wiki/guides/blockbench-overview-tips
- Quaternius Universal Base Characters (listing, ~13k tris): https://quaternius.itch.io/universal-base-characters; licence change to QAL reported in: https://app.cinevva.com/de/guides/free-rigged-3d-character-models
- Lospec palette import formats: https://lospec.com/palette-list/importing-palettes

Browser and OS:
- Chromium Keyboard Lock in fullscreen leaves F11/Esc to the browser: https://codereview.chromium.org/2636013002
- Firefox fullscreen keydown reservation test: https://searchfox.org/firefox-main/source/browser/base/content/test/fullscreen/browser_fullscreen_keydown_reservation.js
- Chrome keyboard shortcuts: https://support.google.com/chrome/answer/157179
- macOS F-keys and Show Desktop (F11): https://setapp.com/how-to/show-desktop-on-mac · https://www.webnots.com/shortcuts-and-functions-of-f1-f12-keys-on-mac/
- WCAG 2.2 (1.4.11, 2.1.2): https://www.w3.org/TR/WCAG22/

Formats and libraries:
- glTF 2.0 (`COLOR_0` linear multiplier): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- Bevy vertex colours example: https://bevy.org/examples/3d-rendering/vertex-colors/
- three-mesh-bvh: https://www.npmjs.com/package/three-mesh-bvh (0.9.16, MIT, checked 2026-10-18)
- Okabe–Ito palette: https://jfly.uni-koeln.de/color/

In-repo inputs: research 06, 08 (§3.1, §5.2, §9.8), 09 (whole), and this iteration's 10, 11, 12 and 14; ARCHITECTURE §4.1, §8, §10; ADR 0007, 0009, 0012, 0013; REQUIREMENTS FR-SHELL-08…11, FR-MOD-05; DECISIONS-OPEN Q-UI-1; code `packages/editor-core/src/keymap/{maya,manager}.ts`, `packages/editor-core/src/types.ts`, `packages/editor/src/input/keyboard.ts`, `packages/editor/src/shell/{StatusLine.tsx,MenuBar.tsx,layout.ts,workspace.ts}`, `packages/editor/src/panels/viewport/{PaneView,CameraRadial,EmptyState}.tsx`, `packages/viewport/src/layers.ts`.
