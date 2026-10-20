# 19 — Rig & Skin workspace UI (skeleton, skinning, weights, constraints, control shapes)

| | |
|---|---|
| Status | Research / proposed spec (v0.1) for the M6b build spec |
| Date | 2026-10-19 |
| Scope | The Rig & Skin workspace as a whole: tab, layout, modes (Object, Skeleton, Skin, Shapes), the pose view (bind / test / clip), joint display, the Joint tool and joint hierarchy editing, Orient Joint, Mirror Joint, templates and Quick Rig, Bind Skin, the Paint Skin Weights panel with the influences list (hold/lock), the Component Editor weight table, weight utilities, constraints (parent/point/orient/aim with weights and maintain offset), control shape editing (FR-RIG-13), the Validation panel and export hand-off, onboarding, menus, marking menus, the keymap rows, the React component tree and the D/U/P state classification |
| Out of scope | Algorithms and data contracts owned by the sibling notes of this planning round and by research 14: Quick Rig fitting, projected-centre maths, auto-skin solvers, the normalization contract, constraint evaluation (research 07 §7), the VRM/GLB writers. This note fixes only what the UI needs from them (§21) |
| Builds on | Research [09](09-ui-ux-spec.md) (shell, Channel Box, tokens, marking-menu geometry), [16](16-model-workspace-ui.md) (workspace tabs, Model layout, key-scope chain), [14](14-skinning-own-models.md) (skeleton, skin, weights, writers), [17](17-maya-rigging-basics.md) (sibling note of this round: joint orientation, Joint tool, hierarchy ops, mirror, the move/rotate/test rule, bind options, paint semantics; this note follows its decisions J1–J8, S1–S6, R1–R5 and lists the one key it resolves differently, §25 Q-RIG-UI-11), [07](07-rig-controls-math.md) (control model §3, shapes §5.4, constraints §7, rig format §19); [M6A-SPEC](../M6A-SPEC.md) §4.6, §5.17, §5.18, §7, §8 (the contracts this workspace reuses); [M2A-SPEC](../M2A-SPEC.md) §5.5, §7 (IK display, Limb section); [MODELING-PLAN](../MODELING-PLAN.md) §3.10, §5; ADR [0016](../adr/0016-modeling-interaction-paradigm.md); the shipped code in `packages/rig`, `packages/doc/src/records.ts`, `packages/editor-core/src/keymap/maya.ts`, `packages/editor-core/src/workspaces` |

Reading guide: §0 decisions; §1 starting point; §2 the verified Maya reference; §3 the tab; §4 layout; §5 modes and the
pose view; §6 viewport display; §7 Skeleton mode; §8 Skin mode; §9 constraints; §10 control shapes; §11 test
deformation and bind pose; §12 onboarding; §13 Validation and export; §14 Outliner; §15 Channel Box and Attributes;
§16 menus; §17 marking menus; §18 keymap; §19 component tree; §20 state; §21 contracts; §22 accessibility; §23
collaboration; §24 build slice and acceptance; §25 open questions; §26 non-goals; §27 sources.

---

## 0. Decisions in one screen

| # | Decision | Why |
|---|---|---|
| RU1 | **Maya's Rigging menu set is the base**: menus `Skeleton`, `Skin`, `Constrain`, `Control`, with Maya's item names (Create Joints, Insert Joints, Mirror Joints, Orient Joint, Bind Skin, Go to Bind Pose, Paint Skin Weights, Mirror Skin Weights, Copy Skin Weights, Hammer Skin Weights, Prune Small Weights, Parent/Point/Orient/Aim). | The owner rigs in Maya; ADR 0016 keeps one paradigm (Maya) across the product; the menus and tools are documented by Autodesk (§2). |
| RU2 | **One workspace, four modes**: Object, **Skeleton** (joints), **Skin** (vertex weights) and **Shapes** (control shapes). `F8` toggles object ↔ last mode; `1`/`2`/`3` pick Skeleton/Skin/Shapes and the active digit again returns to Object: the same rule as Model's `1`/`2`/`3`. Each mode sets the pick mask, the default tool, the overlays, the right-dock tab and a key scope. | Joints sit inside the mesh and controls sit on it; without modes every click is ambiguous. Maya solves this with selection masks and tool context; a mode per job is the simpler web equivalent, and the digit rule is already learned in Model. |
| RU3 | **Pose view = `Bind │ Test │ Clip`**, one status-line toggle. Rest edits (joint positions, orient, binding) happen in Bind; after binding, rotating a joint or a control switches to Test (research 17 §6 owns the per-state rule); Clip plays the ROM clip or any clip. **Test poses are session state and never keys.** | Bind = rest (research 14 D2), so "Go to Bind Pose" is a view change, not a document edit. Maya's habit "rotate a bound joint to test it" stays; keys stay Animate's job. |
| RU4 | **Layout `rig-side`**: Outliner (Rig variant) left; viewport `front │ persp`; right dock **Rig Toolkit · Paint Weights · Channels · Attributes**; bottom dock **Validation · Component Editor**; timeline row shown (test clips). | Joint fitting needs an ortho view next to a test view; weights need a table; the Validation list is the export gate and must stay one click away. |
| RU5 | **Paint Skin Weights is Maya's Artisan tool**: Replace / Add / Scale / Smooth, Flood, Value, Opacity, Paint / Select modes (`Ctrl+<` / `Ctrl+>`; Paint Select later), an influences list with filter, sort, pin and **lock icons (Hold)**, Copy/Paste/Hammer/Move weights buttons, a **weight-numbers overlay** (Maya 2026 *Show Numbers*, research 17 S4); Artisan keys `B` radius, `M` opacity, `N` value, `U`+LMB operation menu, `Alt+C` colour feedback, `Alt+R` mirror stroke. **`Alt+F` flood is not bound** (Windows browser menu); Flood is a button and a marking-menu slot. | Documented Maya behaviour and keys (§2, research 17 §11.1); one browser-forced divergence. |
| RU6 | **Component Editor (Smooth Skins)** as a bottom-dock table: rows = selected vertices, columns = influences, a **Hold** row, a Total column, typed values normalized interactively with holds respected. | The precise fix tool for low-poly meshes where one wrong vertex shows; Maya users look there. |
| RU7 | **Validation panel = the export gate**: VRM required bones, unique names, parent map, T-pose, symmetry, grounding, max 4 influences, unweighted vertices, weight sums, non-uniform or non-unit scale, transforms not frozen, bind-pose consistency, stale skin, constraint cycles; each row has *Select* and, where safe, *Fix*. Severity follows the chosen export profile. The tab glyph and the Export dialog read the same results. | One source of truth for "can I ship this character"; research 14 §4.2, §7.4 and §9.4 define the codes. |
| RU8 | **Onboarding is a setup checklist** for a modeled mesh: *Template humanoid → Fit joints (symmetry) → Bind (auto weights) → Test pose → Fix weights → Control rig → Animate*. Each step is a button that opens the right mode and tool; state glyphs come from the same derived checks. | The owner's turnkey loop (MODELING-PLAN §2.1) made visible and resumable; nothing is a modal wizard except Quick Rig's marker step. |
| RU9 | **Constraints the Maya way**: select target(s) first, the driven control last, `Constrain › Parent/Point/Orient/Aim` with an option box (Maintain Offset, axes, weight); the constraint appears in the Outliner under its driven control, its target weights and blend as Channel Box rows, its settings in Attributes. Pole Vector routes to limb IK. Available in Rig & Skin and Animate. | Autodesk documents the selection order and options (§2); research 07 §7 already defines the maths; a constraint drives the control's space, so the control stays animatable. |
| RU10 | **Control shapes are edited in Shapes mode**: library picker, colour (side / palette / custom), size, line width; `W`/`E`/`R` move/rotate/scale the **shape offset**, never the control; CV editing (`F9` or RMB › Control Vertex) turns a library shape into a custom one; Mirror Shape L→R; copy/paste; reset. **No edit in Shapes mode can create a key** (FR-RIG-13). | Maya users reshape controls by editing CVs; Blender's custom-shape transform (scale/translation/rotation override) is the cleaner data model; both are covered by `ControlShape.offset` + `custom`. |
| RU11 | **Moving a joint after binding keeps the mesh where it is** (Maya's *Move Skinned Joints* semantics are the only behaviour); there is no "joint drags the skin at rest" mode. | Bind = rest: inverse bind matrices are derived (research 14 D2), so a rest move cannot deform the rest mesh. Stated as a divergence (§18.5). |
| RU12 | **Selection undo on in Rig & Skin** (`prefs.modeling.undoSelection.rig = true`): joint, vertex, control and CV selections are coalesced "Select" steps as in Model. | A hand-built vertex selection for the weight table is as precious as a loop selection in Model. |
| RU13 | **Hot paths stay imperative**: brush strokes, weight display, joint overlays and the brush ring never render React; the weight display switches influences with a shader uniform (no upload). | Research 09 §13.3; research 14 §6.2 and §7.3 budgets (≤ 4 ms per pointer frame at 10k vertices). |
| RU14 | **Every marking-menu item is also a menu item and a command-palette entry**; slots are fixed per menu id and grouped in families (N = the mode's main tool, S = the mode's build step, SW = its removal command). Positions are provisional until the owner calibrates them (Q-RIG-UI-1). | ADR 0016 §10, M6A-SPEC §5.18. |
| RU15 | **Key scopes** `rig.viewport.<mode>` → `rig.viewport` → `viewport` → `rig` → `global` (panels: `rig.<panel>` → `<panel>` → `rig` → `global`). Animate keying rows (`S`, `Shift+W/E/R`, `Alt+S`, `Alt+M`, pose copy/paste) are shadowed by `rig.animateOnly`, so a test pose is never keyed by habit. | Same mechanism as Model (M6A-SPEC §5.17); `KeymapManager.resolve` is unchanged. |
| RU16 | **Non-goals**: set driven keys, node editor, rig scripting, blendshape authoring, muscle systems, skin layers, interactive bind manipulators, dual-quaternion skinning, scale constraint, space switching (M5). | Coordinator's direction; glTF skinning is linear blend with one set of four influences (research 14 §5.1). |

---

## 1. Starting point

### 1.1 What ships today (`dev` after M2a, plus the M6a B0a contracts on this branch)

| Area | Shipped | Used here |
|---|---|---|
| Rig records | `RigRecord`, `ControlRecord` (`shape: ControlShape { kind, size, offset, custom: SplineSet \| null, color: 'side' \| '#hex', lineWidth }`, `mirror`, `attrs`), `ConstraintRecord` (**schema slot**: `type parent│point│orient│aim`, `driven`, `targets {target, weight, offset?}`, `maintainOffset`, `params`, `enabled`; compiles to a disabled op), `SolverRecord` (`ik2`, `footRoll` live since M2a) | Constraints UI writes `ConstraintRecord`; Shapes mode writes `ControlRecord.shape` |
| Rig operators | `rig.addLimbIk`, `rig.ikFk.match`, `rig.ikFk.matchRange`, `rig.ikFk.switch`, `rig.setControlSize`, `rig.setFootParams`, `rig.setRotateOrder`, `rig.toggleSecondary` | Kept; the Rig & Skin menus list them where they fit |
| Shapes | `registerControlShape(kind, SplineSet)` registry in anim-core; auto-rig picks kinds and sizes (`rig/src/autorig/shapes.ts`) | The library picker reads the registry |
| Panels | Outliner, Channel Box (field states incl. `--cb-constrained`), Attributes (Limb section), Clips, Graph, Dope Sheet, Timeline | Rig variants and new sections |
| Display | `DisplayFlags.skeleton` (`Alt+J`), `controls` (`Alt+C`), `xray` (`Alt+X`); joint glyphs exist as a debug layer | Joint display becomes a first-class overlay (§6) |
| Workspaces | `WORKSPACE.rig = 'rig'` reserved; Model's B9 registers Rig & Skin as a **disabled** tab ("Arrives with characters from your own models (v0.4)") | M6b enables it |

### 1.2 What M6a delivers that this workspace reuses unchanged

Workspace tabs and per-workspace layouts/menus/status groups; the generic `MarkingMenu`; the command palette;
hierarchical key scopes and the keyboard adapter order; `ComponentSelection` (vertex bitsets, hide bitsets, version);
BVH picking in `mesh-view`; the Last-op card and Channel Box INPUTS (`params: ParamDef[]`, `edit.adjustLast`); the modal
tool contract and the narrow numeric-capture window; selection undo; hide/isolate; overlay camera layers 6–9; the
halo rule for overlay tokens; the `BIND POSE` badge; the MMB stand-in for trackpad profiles (M6A-SPEC §5.17).

### 1.3 What this round adds to M6b's plan

MODELING-PLAN §5 already plans the Rig & Skin workspace (package C6, 3 agent-days) with skeleton templates, Quick Rig,
auto-skin, weight tools, the ROM loop and the writers. The coordinator widened M6b into a full but bounded rigging
workspace: **Orient Joint, Mirror Joint, joint hierarchy editing, the Component Editor table, constraints (FR-RIG-10,
pulled from M2c) and control shape editing (FR-RIG-13, pulled from M2c)**. This note specifies the UI for all of it.

---

## 2. Maya reference (verified 2026-10-19)

| Maya feature | What Autodesk documents | Our use | Source |
|---|---|---|---|
| Skeleton menu | Create Joints (Joint Tool), Insert Joints, Mirror Joints, Orient Joint, Remove Joints, Reroot Skeleton, Connect/Disconnect, Joint Labelling | `Skeleton` menu (§16); Connect/Disconnect and Reroot later | [Skeleton menu](https://help.autodesk.com/cloudhelp/ENU/MayaCRE-CharacterAnimation/files/GUID-5A485049-D0BD-4BBB-BE08-C3D502F17483.htm) |
| Joint Tool | click places joints; **middle-click drag moves the last placed joint**; Enter/Return completes the chain; **Snap to Projected Center** on the Status Line centres joints in the model | Joint tool gestures (§7.2) | [Create a joint chain](https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-142CB5D5-5609-4D23-B40E-F26FB08A55AB.htm) |
| Joint Tool settings | Symmetry Off/X/Y/Z, Scale compensate, Auto joint limits, Create IK handle, Projected Centering; Orientation: Orient Joint to World, Primary Axis, Secondary Axis, Secondary Axis World Orientation; bone radius settings | Joint tool settings in the Toolkit (§7.2); IK handle creation is not offered (limb IK is template-driven) | [Joint Tool settings](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-CharacterAnimation/files/GUID-4357347C-D00F-409F-8938-D0E81E54C8B8.htm) |
| Orient Joint | Orient Joint to World; Primary/Secondary axis; Secondary Axis World Orientation; **Orient children of selected joints** | Orient Joint option box (§7.4) | [Orient Joint Options](https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-29DF5D0F-1BDE-4464-850C-45769B3CF1CA.htm) |
| Mirror Joints | Mirror across XY/YZ/XZ; Mirror function **Behavior** (opposite orientation) / **Orientation** (same orientation); Search for / Replace with names | Mirror Joint option box (§7.5) | [Mirror Across](https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-B4004DD2-FB80-487A-BD2B-3A3757A0C2E9.htm), [`mirrorJoint`](https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Tech-Docs/CommandsPython/mirrorJoint.html) |
| Skin menu (2026) | Bind Skin, Unbind Skin, **Go to Bind Pose**, Paint Skin Weights, Mirror Skin Weights, Copy Skin Weights, Smooth Skin Weights, Hammer Skin Weights, Copy/Paste Vertex Weights, Prune Small Weights, Normalize Weights, Move Skinned Joints, Move Weights to Influences; Rigid Bind menu items were removed ("a Rigid bind using smooth skin with 1 influence per vertex") | `Skin` menu (§16); our rigid islands are exactly "smooth skin with 1 influence" | [Skin menu](https://help.autodesk.com/cloudhelp/2026/ENU/Maya-CharacterAnimation/files/GUID-35ECFBC1-A65B-46AF-9542-213BD304C632.htm) |
| Paint Skin Weights tool | Influences list (sort Alphabetically / By Hierarchy / Flat, filter, **pin**, **lock icons**, influence colour buttons); Copy weights, Paste weights, Weight hammer, Move weights, Show Influences, Invert Selection, Reveal Selected; **Mode Paint / Select / Paint Select (`Ctrl+<`, `Ctrl+>`)** with Add/Remove/Toggle; operations Replace/Add/Scale/Smooth; Normalize Off/Interactive (default)/Post; Opacity; Value; Min/Max; colour ramp or greyscale; reflection disabled (use Mirror Skin Weights) | Paint Weights panel (§8.2) | [Paint Skin Weights Tool](https://help.autodesk.com/cloudhelp/2022/ENU/Maya-CharacterAnimation/files/GUID-99189E9D-237F-471E-A02C-BE6593B4828B.htm) |
| Influence picking while painting | right-click a joint → *Select Influence*; middle-click a joint and use the up/down arrows to walk the hierarchy | RMB-on-joint menu in Skin mode, arrow walk of the active influence (§8.3) | [Paint skin weights](https://help.autodesk.com/cloudhelp/2022/ENU/Maya-CharacterAnimation/files/GUID-7D773C38-F9CF-4141-8ADD-4E0454838BB7.htm) |
| Artisan hotkeys | `Alt+F` flood; `Alt+A` show wireframe; `Alt+C` colour feedback; `Alt+R` reflection; `U`+LMB paint-operation marking menu; `B` upper radius; `Shift+B` lower radius; `N` paint value / pick colour mode | §18 rows; `Alt+F` not bound (browser) | [Paint operation hotkeys](https://download.autodesk.com/global/docs/maya2014/en_us/files/Paint_operation_hotkeys.htm) |
| Tool hotkeys | `Return` completes the current tool; `Insert` enters tool edit mode | Joint tool `Enter` (§7.2) | [Maya hotkeys](https://download.autodesk.com/us/maya/2011help/files/PC_Maya_Hotkeys.htm) |
| Parent constraint | select target(s) **first**, then the constrained object; options **Maintain Offset**, Constraint Axes (All or X/Y/Z), Weight (useful with several targets) | Constrain menu and option boxes (§9) | [Parent constraint options](https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-093A13E1-5DF1-454B-B5D3-BCAA5427B51A.htm), [Create a parent constraint](https://help.autodesk.com/cloudhelp/ENU/MayaCRE-CharacterAnimation/files/GUID-2FC0EE9E-A8D5-4B2A-A751-8B926389497A.htm) |
| Maya 2027 (March 2026) | **ngSkinTools integrated**: non-destructive layer-based skinning, masking and mirroring when painting | Landscape fact; skin layers are a non-goal here (§26) | [CG Channel: Maya 2027](https://www.cgchannel.com/2026/03/autodesk-releases-maya-2027-and-maya-creative-2027/) |
| ngSkinTools 2 | layers, any-pose mirroring; "hold **S** and drag over the surface to select dominant influence" (on-screen influence picking, "#1 requested feature") | `I`+click picks the dominant influence (§8.3) | [Autodesk Marketplace: ngSkinTools 2](https://marketplace.autodesk.com/apps/e97508b4-58a2-43d0-a14b-0b7176b04065) |
| Blender bone custom shape (reference only) | custom shape scale, translation, rotation, override transform, scale to bone length, wireframe width; display only, never rendered | Shapes mode transforms the shape offset, not the control (§10) | [Blender manual 4.3: bone viewport display](https://docs.blender.org/manual/en/4.3/animation/armatures/bones/properties/display.html) |
| VRM 1.0 humanoid | 15 required bones (`hips`, `spine`, `head`, left/right `UpperArm`, `LowerArm`, `Hand`, `UpperLeg`, `LowerLeg`, `Foot`); unique bones; fixed parent relationships; positive scale | Validation rows (§13) | [VRMC_vrm-1.0 humanoid](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md) |

**Not verified in Autodesk documentation; to calibrate on a Maya install with Q-RIG-UI-1**: `Shift` while placing
joints constraining the bone to 45° steps; holding `D` (pivot edit) to move a joint without its children; RMB compass
positions of every rig marking menu. The spec must keep these marked provisional. Research 17 verified further Maya
details used here (Bind Skin options, Maya 2026 *Show Numbers* and `M`+drag opacity, Remove Joints vs Delete).

---

## 3. The Rig & Skin tab

### 3.1 `WorkspaceDef` (M6b enables the tab B9 registered as disabled)

| Field | Value |
|---|---|
| `id`, `label`, `shortLabel`, `order` | `'rig'`, `'Rig & Skin'`, `'Rig'`, 1 (between Model 0 and Animate 2) |
| `keyScope` | `'rig'` |
| `menus` | `file`, `edit`, `create`, `select`, `modify`, `display`, **`skeleton`, `skin`, `constrain`, `control`**, `windows`, `help` |
| `statusGroups` | `tools`, `rigMode`, `poseView`, `rigSymmetry`, `rigSnap`, `jointDisplay`, `brush` (Skin mode only), `moveSpace`, `layout` |
| `defaultTool` | `select` (each mode overrides it, §5.1) |
| `pickMask` | `{ controls: false, joints: true, meshes: true, groups: false }` (Object mode; modes override) |
| `timeline` | `true` (test clips, ROM) |
| `layout` | `'rig-side'` |
| `status(app)` | glyph rules §3.2 |

### 3.2 Status glyph (text tooltip, never colour alone)

| Glyph | Condition (derived from the Validation results of the active export profile, §13) |
|---|---|
| ○ not started | the active character has no skeleton (`source.kind === 'model'` without joints, or a static mesh) |
| ◐ needs attention | any error row; or warnings `skin.stale` ("Weights transferred after a topology change: review"), `skin.unweighted-vertex`, `skel.tpose`; the tooltip lists the reasons |
| ● done | skeleton complete for the profile, every skinned mesh bound, every vertex weighted, ≤ 4 influences, sums within tolerance, no error rows |

### 3.3 Entering and leaving

- **Entering** keeps the document, the object selection, scene time and pane cameras (M6A-SPEC §5.17); restores the Rig
  workspace's layout, the last rig mode and the pose view **Bind**; skinned meshes show in bind pose with the
  `BIND POSE` badge. Entering with a static (unbound) model-sourced mesh selected and no skeleton opens the setup
  checklist (§12).
- **Leaving** cancels a running modal tool (Joint tool chain, brush stroke, Quick Rig marker step) with Esc semantics,
  closes the Last-op card, **clears the test pose** (session; Animate shows the clip at the current frame) and
  schedules the character display rebuild (the synthesized container, MODELING-PLAN §3.10) when skeleton or weights
  changed.
- Entry points: the tab; Model Toolkit footer `Rig & Skin ▸` (enabled in M6b); Outliner RMB `Rig & Skin this mesh ▸`;
  the Animate Rig menu items that need rest edits (`Edit Skeleton…`, `Edit Control Shapes…`); the command palette
  ("Workspace: Rig & Skin"). No default hotkey (Q-MOD-UI-5).

---

## 4. Layout

### 4.1 Default `rig-side` (1440×900 reference), Skeleton mode

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│◆ File Edit Create Select Modify Display Skeleton Skin Constrain Control Windows Help ┃Model● › Rig◐ › Anim○┃│ 28
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│[Q][W][E][R]│Mode[Obj|Joint|Skin|Shape]│Pose[Bind|Test|Clip]│Sym X ✓│Snap ◎Ctr #X .V ~J│Joint ⊖⊕ ◌Xray ⊹Axes│▥│ 32
├───────────────┬───────────────────────────────┬──────────────────────────────┬───────────────────────────┤
│Outliner       │front▾ │Shading▾ Show▾ │ ⤢       │persp▾ │Shading▾ Show▾ │ ⤢    │Toolkit│Paint│Chan│Attr│
│/ filter… ⚬▢◯⛓ │JOINT · SYM X · BIND POSE      │JOINT · BIND POSE             │Lowpoly Lad · Standard 33  │
│▾ ☺ Lowpoly Lad│          ◯ head               │                              │─ Setup ─────────────────  │
│ ▾ ⚬ Skeleton  │          │                    │            ◯                 │✓ Template   ✓ Fit joints  │
│  ▾ root       │   ◯──◯──◯┼◯──◯──◯             │         ◯──┼──◯              │◐ Bind       ○ Test        │
│   ▾ hips  ⇋   │          ◯ spine              │            ◯                 │○ Fix weights○ Control rig │
│     spine     │          ◯ hips               │           ◯ ◯                │─ Skeleton ──────────────  │
│     ▸ chest   │         ◯   ◯                 │           │ │                │Template [Standard 33 ▾]   │
│     ▸ L leg ⇋ │         │   │   ← guides fit  │           ◯ ◯                │[Quick Rig…] [Joint Tool]  │
│     ▸ R leg ⇋ │         ◯   ◯                 │                              │[Insert Joint][Mirror ⋯]   │
│ ▾ ▢ Meshes    │        ◯─   ◯─                │                              │[Orient ⋯]  [Apply as Rest]│
│   body  skin○ │  ┌ ⟲ Mirror Joint ─ ⌄ ✕ ┐     │                              │Joint tool ─ Sym X ✓       │
│ ▸ ◯ Rig (—)   │  └──────────────────────┘     │                    BIND POSE │ Projected centre ✓        │
├───────────────┴───────────────────────────────┴──────────────────────────────┴───────────────────────────┤
│Validation (3) │ Component Editor                                                          ⤢ ⌄            │ 26+
│ ✕ skel.required-bones  leftLowerArm missing                         [Select] [Fix: add from template]   │ 120
│ ⚠ skel.symmetry        2 joint pairs differ by > 0.01 H              [Select] [Fix: mirror L → R]        │
│ ⚠ skin.unbound         body has no skin                              [Bind Skin…]                        │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│0    5    10   15   20  ▌24   30 …                          │Clip[— bind pose —▾] 30fps│⏮ ◀ ▶ ⏭│↻ 1×  │ 30+28
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Joint mode · click joint · W move rest · E rotate · Shift+RMB skeleton tools · 1 2 3 modes      33 joints│ 22
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Regions

| Region | Default | Notes |
|---|---|---|
| Menu bar | 28 px | common menus + the Rigging menu set (§16) + workspace tabs |
| Status line | 32 px | groups of §3.1; Skin mode swaps `rigSymmetry`/`rigSnap`/`jointDisplay` for the **brush strip** (op, value, opacity, radius, surface/volume, mirror X) |
| Left dock | 240 px | Outliner, Rig variant (§14) |
| Centre | flex | Viewport panel, preset **R-Side** (`front │ persp`, 50/50) |
| Right dock | 300 px (min 260) | tabs **Rig Toolkit** · **Paint Weights** · Channels · Attributes; the active tab follows the mode (§5.1) unless the user changed it in that mode (remembered per mode, U) |
| Bottom dock | 160 px, open | tabs **Validation** · **Component Editor**; Skin mode activates Component Editor, other modes Validation (same per-mode memory) |
| Timeline + range | 30 + 28 px | shown; the clip selector lists the `__rom` test clip first, marked "test, not exported" |
| Help line | 22 px | mode hints, resolved keys under the pointer, joint/vertex counts |

Vertical budget at 900 px: chrome 28 + 32 + 26 + 58 + 22 = 166 px plus the 120 px bottom-dock body; the panes get
≈ 614 px. `⌄` collapses the bottom dock to its tab strip (≈ 734 px for the panes).

### 4.3 Skin mode (same workspace, mode `2`)

```
├[Q][W][E][R]│Mode[Obj|Joint|Skin|Shape]│Pose[Bind|Test|Clip]│[Rep|Add|Scl|Smo] Val 1.00 Opa 0.50 r 24px Surf▾ ⇋X│
├───────────────┬───────────────────────────────┬──────────────────────────────┬───────────────────────────┤
│Outliner       │front▾                         │persp▾                        │Toolkit│Paint│Chan│Attr│
│ …             │SKIN · leftLowerArm · BIND     │SKIN · TEST POSE              │Mode (•)Paint ( )Sel ( )PS │
│               │        ░░▒▒▓▓██               │       ╲   ← elbow bent       │/ filter…  Sort [Hier ▾] 📌│
│               │      ░▒▓█  ◯  █▓▒░            │        ╲__                   │▾ hips          ■  🔓      │
│               │       ( greyscale weights )    │      ◯ ⊙ ← brush ring        │ ▾ spine        ■  🔓      │
│               │                               │       0.62 leftLowerArm      │  ▾ L shoulder  ■  🔓      │
│               │                               │                              │   ▾ L upperArm ■  🔒 hold │
│               │                               │                              │    ● L lowerArm■  🔓 ◀ act│
│               │                               │                              │      L hand    ■  🔓      │
│               │                               │                              │[Copy][Paste][Hammer][Move]│
│               │                               │                              │Op (•)Replace ( )Add …     │
│               │                               │                              │Value [1.000] Opacity[0.50]│
│               │                               │                              │[Flood]  Brush r 24 px ▾   │
│               │                               │                    TEST POSE │Display Greyscale▾ ☐LockRel│
├───────────────┴───────────────────────────────┴──────────────────────────────┴───────────────────────────┤
│Validation (1) │ Component Editor   12 vertices · rows: each ▾ · [Prune < 0.01] [Normalize] [Hammer]      │
│         │ L upperArm │ L lowerArm │ L hand │ spine │ Total │                                            │
│ Hold    │    ☑       │    ☐       │   ☐    │  ☐    │       │                                            │
│ vtx 412 │   0.700    │   0.300    │        │       │ 1.000 │                                            │
│ vtx 413 │   0.500    │   0.500    │        │       │ 1.000 │                                            │
│ vtx 418 │            │   0.900    │ 0.100  │       │ 1.000 │                                            │
```

### 4.4 Layout presets

| Preset | Shape | Use |
|---|---|---|
| R-Single | `[persp]` | small screens, painting |
| **R-Side** (default) | `front │ persp` 50/50 | joint fitting with symmetry in front, test in persp |
| R-Quad | `top │ persp` / `front │ side` | depth checks (projected centre, toes, elbows) |
| R-Paint | `persp` 70 % │ `persp` 30 % (second persp locked to the bind pose) | before/after while painting on the posed mesh |

Per-pane display flags are remembered per workspace (M6A-SPEC §4.6), so Rig's `xrayJoints` never leaks into Animate.

---

## 5. Modes and the pose view

### 5.1 Modes

| | **Object** | **Skeleton** (`1`) | **Skin** (`2`) | **Shapes** (`3`) |
|---|---|---|---|---|
| Purpose | pick characters, meshes, controls; create constraints; run the control rig | create and edit joints | bind, edit weights | edit control shapes |
| Pick mask | meshes, joints, controls (if a rig exists) | joints only | vertices of the hilited skinned meshes; joint glyphs (click = active influence, research 17 §11.3; RMB = influence menu) | controls; CVs in CV edit |
| Default tool | Select | Select (`Y` brings back the Joint tool) | **Paint Skin Weights** | Select |
| `W` / `E` / `R` | test pose on controls (switches to Test) | research 17 §6: `W` moves joint **rest** positions (with the subtree; `D` held = this joint only) in Bind; `E` before binding rotates the subtree's rest about the joint (fitting), after binding it is a **test pose** (switches to Test), `D`+`E` re-orients one joint; `R` disabled ("joints keep scale 1", VRM/glTF rule) | transform vertices: disabled ("Model edits geometry; Rig & Skin edits weights") | transform the **shape offset** of the selected controls, or the selected CVs |
| Mesh display | lit or colours | X-ray mesh 50 % (pane option) | weight overlay on the skinned surface | dimmed 60 % |
| Overlays | joints (small), controls, constraint lines | joints (full), local axes (toggle), humanoid labels (hover), symmetry ghosts, projected-centre preview | brush ring, weight readout, joints of the active influence highlighted | controls with CVs, shape pivot |
| Right dock tab | Channels | Rig Toolkit | Paint Weights | Attributes (Control Shape section) |
| Bottom dock tab | Validation | Validation | Component Editor | Validation |
| Key scope | `rig.viewport` | `rig.viewport.skeleton` | `rig.viewport.skin` | `rig.viewport.shape` |
| Help line | "Shift+RMB constraints · Q+LMB pick mask" | "Click a joint · W move rest · E rotate (test pose once bound) · Shift+RMB skeleton tools" | "LMB paint · B+drag radius · N+drag value · U+LMB operation · I sample · Shift+I pick influence" | "Click a control · W/E/R shape offset · F9 CVs · Shift+RMB shape tools" |

### 5.2 Switching

- `F8` toggles Object ↔ the last rig mode (Maya's object/component toggle); `1`/`2`/`3` go to Skeleton/Skin/Shapes
  and pressing the active digit again returns to Object (Model's rule, Q-MOD-UI-2). The status-line switcher
  (`role="radiogroup"`, names with key hints) and the RMB mode menu (§17) do the same.
- Selection is remembered **per mode** (joint selection, vertex bitsets, control and CV selections), like Model's
  per-mode component memory. A mode switch is not an undo step; selection changes inside a mode are (RU12).
- A mode switch cancels a running modal tool (Esc semantics) and closes the Last-op card unless the operation belongs
  to the new mode.
- Skin mode needs a skinned mesh: with none, `2` poll-fails "Bind a mesh first (Skin › Bind Skin)" and the help line
  shows the reason. Shapes mode needs a control rig: "Create the control rig first (Control › Create Control Rig)".

### 5.3 Pose view: `Bind │ Test │ Clip`

| View | Viewport shows | Editable | Badge |
|---|---|---|---|
| **Bind** (default) | the rest pose = bind pose (research 14 D2) | joint rest positions, Orient/Mirror Joint, templates, Quick Rig, Bind Skin, weights, constraints, shapes | `BIND POSE` |
| **Test** | the bind pose plus the **test pose**: session overrides on the joints' driving controls (the control rig exists from the moment of binding, research 14 D10 and 17 J7; a joint rotated with `E` writes its control's override) | weights (painting on the posed mesh, research 14 §7.3), shapes, constraints; joint **rest** moves are disabled ("Go to Bind Pose to move joints") | `TEST POSE` (`--pose-test`, light pink as the Channel Box "changed" state) |
| **Clip** | the active clip at the current frame (the `__rom` test clip by default; any clip of the character) | weights (paint on the posed mesh), shapes, constraints; rest moves disabled; channel edits are Animate's ("Clips are edited in Animate") | `CLIP walk · f24` |

- **Go to Bind Pose** (Maya's name; status line `Bind`, Skin menu, RMB E slot) clears every test override, as Maya
  does (research 17 §6), and keeps a copy in memory: `Test` restores that last test pose (one non-document step) for a
  before/after check. **Reset Test Pose** forgets the copy too. R-Paint shows both poses at once.
- After binding, rotating a joint with `E` in Skeleton mode, or moving/rotating a control in Object mode, switches the
  view to Test automatically (one toast the first time per session: "Test pose: not keyed; Go to Bind Pose to edit
  joints"). Before binding, `E` on joints is a rest edit (fitting a chain), so the view stays Bind.
- Test-pose edits are **editor-history override steps** (ADR 0013 overrides: undoable, never in the document); `S`
  and every keying chord are shadowed (§18), so nothing becomes a key.
- `Clip` with the ROM clip: **Skin › Test › Range of Motion** (`skin.test.rom`) generates or refreshes `__rom`
  (research 14 §7.2); the timeline plays it; scrubbing while painting is the deformation test.

---

## 6. Viewport display

### 6.1 Joints

| Element | Look | Notes |
|---|---|---|
| Joint | instanced sphere, radius `jointSize × 0.012 H`, at least 4 CSS px on screen (research 17 §7), side colour (`--rig-left` / `--rig-right` / `--rig-center`) with the 1 px halo | Maya draws joints as balls scaled by *Joint Size*; side colour shows symmetry at a glance |
| Bone | octahedral wedge (Blender-style; Maya draws a wedge too) from joint to child, `--joint-bone` | leaf joints draw to their `tail` |
| Joint without a humanoid bone (in a humanoid skeleton) | hollow sphere, dashed bone | tails, hair, props: not in the VRM map; no extra colour token |
| Hover / selected / lead | `--sel-hover` / `--sel` (white) / `--sel-lead` (green), research 09 §5.7 | |
| Humanoid label | VRM bone name chip on hover and for the selection (option: always) | "leftLowerArm" |
| Missing required bone | dashed `--danger` ghost ring at the template's guess with a label "leftLowerArm missing" (Skeleton mode) | click = Validation row |
| Symmetry ghost | during a joint drag or placement, the partner joint previews at `(−x, y, z)`; centre joints clamp to `x = 0` with a tick on the symmetry plane | `SkeletonRecord.symmetry` |
| Projected-centre preview | while hovering with the Joint tool: a short line through the mesh slab (entry/exit hits) and a dot at its midpoint | research 14 §4.2 |
| Local axes | RGB tripod per joint (`--axis-x/y/z`), 0.6 × ring size; pane flag `jointAxes` (Maya *Display › Transform Display › Local Rotation Axes*) | humanoid joints show the identity frame |
| X-ray joints | joints drawn after a `clearDepth()` (always visible), occluded part at 35 % like the control passes | pane flag `xrayJoints`, default on in Rig |
| Joint size | status-line `⊖ ⊕` (P `rigging.jointSize`, default 1.0; Maya *Display › Animation › Joint Size*) | |

### 6.2 Weights and influences (Skin mode)

| Display | Rule |
|---|---|
| **Greyscale** (proposed default, Maya *Color feedback*) | weight of the active influence per vertex: 0 black → 1 white, interpolated across faces; flat-shaded palette colours are replaced, not blended |
| **Ramp** | colour-blind-safe sequential ramp (dark violet → orange → pale yellow; no red/green pair), same data; research 17 §11.3 proposes Blender's blue → red heat ramp as the default (Q-RIG-UI-5) |
| **Influence colours** | each influence its colour (deterministic golden-angle hue per joint, research 17 §7; user override per joint name, P), vertex colour = Σ wᵢ·cᵢ (Maya *Multi-color feedback*) |
| **Numbers** | the active influence's weight as a 2-decimal label per visible vertex, 0.00 hidden; above 2,000 labels only selected vertices (research 17 §11.5, Maya 2026 *Show Numbers*); combinable with any colour display |
| **Lock-Relative** (Blender option) | display as if held influences were removed (research 14 §6.1) |
| Problem vertices | > 4 influences (imports) or \|Σ − 1\| > 1e-6: `--lint-error` dot; unweighted (Σ = 0): `--danger` ring; Validation *Select* highlights the same set |
| Implementation | shader-side `w = dot(skinWeight, vec4(equal(skinIndex, vec4(uActive))))`: switching the active influence changes a uniform, uploads nothing; stroke writes use `addUpdateRange` partial uploads (research 14 §6.2) |
| Brush ring | circle at the pointer projected on the surface (radius in px), `--brush-ring` with halo; Volume mode draws a second, dashed ring for the sphere; mirror stroke draws the partner ring |
| Readout | chip under the pointer: `0.62 · leftLowerArm` (value of the active influence at the nearest vertex) and, with `Alt` held, the vertex's full list (≤ 4 rows) |

### 6.3 Controls, constraints, shapes

- Controls draw as shipped (two passes, side colours, M2a IK rules §5.5). In Object mode they are pickable; in Shapes
  mode their CVs draw as `--comp-vertex` dots when CV edit is on, with the shape pivot as a small cross.
- **Constraint lines**: a dashed `--constraint-line` line from each target to the driven control while the driven
  control or the constraint is selected (Maya draws no such line; it explains a "why does it move" question at once).
- Pole lines stay as M2a (`--rig-pole-line`).

### 6.4 HUD

Top-left mode badge line (`JOINT · SYM X`, `SKIN · leftLowerArm`, `SHAPE · CV`), pose badge bottom-right
(`BIND POSE`, `TEST POSE`, `CLIP walk · f24`), the Last-op card bottom-left, the modal readout chip (M6A-SPEC §8.7),
and in Skeleton mode a joint count (`33 joints · 15/15 required`).

### 6.5 Tokens (additions to `packages/ui/css/tokens.css`; values proposed, CI contrast check adds rows)

| Token | Value | Use |
|---|---|---|
| `--joint-bone` | `#aeb2bb` | bone wedges |
| `--joint-missing` | `--danger` | missing required bone ghosts |
| `--brush-ring` | `#ffd84d` (= `--axis-active`) + halo | paint brush |
| `--constraint-line` | `#6f95ff` | target → driven lines |
| `--pose-test` | `#f2a5b8` (= `--cb-altered`) | `TEST POSE` badge |
| `--marker-quickrig` | `#ff9f43` (= `--rig-ik`) | Quick Rig markers |
| `--weight-0` / `--weight-1` | `#000000` / `#ffffff` | greyscale display |
| `--weight-ramp-0…4` | `#2d1b4e`, `#6a2c70`, `#c2410c`, `#f59e0b`, `#fde68a` | ramp display |

Every overlay line and glyph keeps the 1 px `--comp-halo` (M6A-SPEC §8.9) so it meets 3:1 on both viewport gradient
ends and on any palette colour.

---

## 7. Skeleton mode

### 7.1 Templates and Quick Rig

- **Create › Skeleton Template ▸ VRM Humanoid: Lite 17 · Core 21 · Standard 33 (default) · Full 52**
  (`skel.template.create {preset}`; Q-SKIN-7). A template created for a mesh from Model's humanoid body generator is
  **pre-fitted** (the generator stores the joint positions); otherwise the template is scaled to the mesh height and
  the setup checklist offers **Fit to mesh** (Quick Rig, below). One undo step; adjustable (Last-op: preset).
- **Quick Rig** (`Skeleton › Quick Rig…`): a stepper in the Rig Toolkit, not a modal dialog. The viewport switches to
  `front` (single pane) for the marker step and back afterwards.

```
┌ Quick Rig ───────────────────────────────────────── ✕ ┐
│ ① Geometry  ② Markers  ③ Guides  ④ Skeleton  ⑤ Bind  │
│ ───────────────────────────────────────────────────── │
│ ② Markers (front view, symmetry X)                    │
│   ● chin     ● groin    ○ wrist L   ○ elbow L  ○ knee L│
│   optional: ○ ankle L  ○ shoulder L                   │
│   Click the glowing marker's place on the model.      │
│   [One-Click guess]                 [◀ Back] [Next ▶] │
│ Checks: facing +Z ✓ · grounded ✓ · symmetric ✓        │
└───────────────────────────────────────────────────────┘
```

  Steps (research 14 §4.3): ① Geometry (meshes; checks facing +Z, Y-up, grounded, roughly symmetric, with fixes
  *Center and ground*, *Rotate to face +Z*); ② Markers (five clicks with symmetry; the next marker pulses in
  `--marker-quickrig`; markers drag; *One-Click guess*); ③ Guides (template joints fitted; drag guides with symmetry;
  *Mirror L → R*); ④ Skeleton (writes skeleton + joints in one step); ⑤ Bind (opens the Bind Skin option box with Auto
  (low-poly)). Each finished step shows ✓; Back returns without losing markers (U state until ④). Esc on the stepper
  closes it; markers stay until leaving Rig.

### 7.2 Joint tool (`Skeleton › Create Joints`, Shift+RMB N in Skeleton mode)

| Gesture | Behaviour | Origin |
|---|---|---|
| Click | place a joint; the next click places its child (a bone appears) | Maya |
| First click on an existing joint (≤ 8 px) | the new chain branches from that joint | Ekza (R14 §4.2); calibrate against Maya |
| MMB-drag (or the trackpad stand-in), `Insert`/`Home` then drag | move the last placed joint | Maya (documented; research 17 J3) |
| `Shift` held while placing | constrain the new bone to 45° steps in the view plane | Maya habit, **to calibrate** |
| `Backspace` | remove the last placed joint of the chain in progress | Ekza (as Multi-Cut) |
| `Enter`, `NumpadEnter`, RMB | complete the chain: **one undo step** "Create Joints (n)" | Maya (`Enter`); RMB completes as in Multi-Cut (ADR 0016 D8, research 17 J3) |
| `Esc` | cancel the chain in progress, no step | ADR 0016 D8 |
| Placement depth | in an ortho view the in-plane coordinates come from the click, depth from **Snap to Projected Center** (status-line toggle, default on in Rig); off → depth of the parent joint, or 0 | Maya status-line icon |
| Symmetry X | placing a left/right joint places the partner (ghost while placing, written on commit); joints within the tolerance band of x = 0 snap to the plane and become side C | Maya Joint Tool symmetry |
| Naming | `joint1…` for generic chains; inside a humanoid template, *Add Chain* names `tail_01…`; side suffixes `_L`/`_R` added by symmetry | |

Tool settings (Rig Toolkit › Active tool): Symmetry (Off/X), Projected centre, Orientation (Orient to World ✓
default; Primary/Secondary axis for generic chains), Side naming pattern. Numeric capture is armed during an MMB drag
of the last joint (type a distance along the drag axis).

### 7.3 Editing joints and the hierarchy

| Action | UI | Notes |
|---|---|---|
| Move / rotate rest | `W` on joints (Bind view); children follow; **`D` held** (or the `Insert`/`Home` toggle): this joint only, children keep their world rest; `E` before binding rotates the subtree's rest (research 17 §6) | `D` = Maya pivot-edit habit, **to calibrate**; `X`/`V`/`J` snaps as in Model; symmetry moves the partner |
| Insert Joint | `Skeleton › Insert Joints` tool: click on a bone inserts at that parameter; drag slides along the bone before release | Maya Insert Joint Tool |
| Delete (subtree) | `Delete` / `Backspace` in Skeleton mode: the joint **and its subtree** (Maya's Delete), weights folded into the nearest surviving ancestor; refused when the subtree holds a required VRM bone, with the reason | research 17 R4 |
| Remove Joint (splice) | `Skeleton › Remove Joints`: children re-parent to its parent, its weights move to the nearest surviving ancestor; toast "Removed leftToes · weights → leftFoot · Undo" | Maya *Remove Joints*; research 14 §6.4, 17 §4 |
| Reparent / Unparent | `P` (select child joints, then the new parent, Maya order) / `Shift+P`; Outliner drag | humanoid parent-map lint re-runs |
| Map Humanoid Bone | Attributes › Joint › Humanoid ▾ (list filtered to bones whose parent map fits; taken bones disabled with the owner joint named) and RMB › Map ▸ | uniqueness enforced |
| Set Side | RMB › Side ▸ L / R / C; Attributes | drives colours, mirror pairing |
| Rename | `F2` / `Enter` in the Outliner, Attributes field; renaming a paired joint offers "Also rename leftHand_R → …" with the pattern swapped | names must be unique per skeleton (lint) |
| Add Chain | `Skeleton › Add Chain` (tails, ears, hair, skirts): the Joint tool with surface projected centre and a name prefix | R14 §4.2 |
| Lock joint | Outliner lock column: a locked joint is not pickable or movable (session U, like Maya's *template* display) | |

### 7.4 Orient Joint (`Skeleton › Orient Joint ⋯`, adjustable)

Option box (research 17 §2.4 owns the arguments and the algorithm): a **preset row** World (VRM; identity, the
template default) · Maya (+X down the bone, +Y up) · Blender (+Y down the bone), then the Maya fields **Orient Joint to
World** · Primary Axis · Secondary Axis (or Auto) · Secondary Axis World Orientation · **Orient children of selected
joints** ✓ · Symmetry (write mirror partners) ✓ · Show local axes after orienting ✓. Orientation never changes
deformation or humanoid animation (research 17 §2.3), so the operator is allowed on every joint; when a re-oriented
joint drives a **bone-aligned** control with rotation keys, the option box shows "n keys on generic controls will be
converted" before running, and the toast repeats it. Attributes › Joint shows the rest orientation as Euler degrees,
editable (one undo step per commit, same conversion rule).

### 7.5 Mirror Joint (`Skeleton › Mirror Joints ⋯`, adjustable)

Option box (research 17 §5 owns the semantics): Direction L → R / R → L / auto · Mirror function **Orientation**
(default when the subtree has humanoid bones: identity stays identity) / **Behavior** (default otherwise) ·
Replacement names: Search for / Replace with (empty = the shipped L/R name swap) · **Update existing counterparts in
place** ✓ (IDs, weights and curves survive). No plane option: the plane is always YZ through the origin (character
left = +X; Maya's XY default suits a character facing +X). A read-only line says "Weights are not mirrored · Mirror
Skin Weights…" with the button. With symmetry on, most users never need it; it fixes chains built before symmetry was
on and generic skeletons.

### 7.6 Apply Pose as Rest

`Skeleton › Apply Pose as Rest` (research 14 §4.4): needs the Test view with a pose (usually *T-Stance* from the
template, offered as a one-click pose in the Toolkit). A confirm dialog states the consequence: "Clips authored on the
old rest shift by the pose delta (n clips). Do this before animating." One undo step. Blocked by the licence gate on
`modification: prohibited` imports (Q-SKIN-2).

---

## 8. Skin mode

### 8.1 Bind Skin and Unbind

- **Skin › Bind Skin ⋯** (`skin.bind`; Shift+RMB S in Skin mode; setup checklist): option box generated from the
  operator `params` (research 17 §8 owns the argument set) — Meshes (the character's meshes, checklist) · Method
  **Auto (low-poly)** (default) / Bone heat / Rigid islands / Closest · Dropoff (closest; 4) · Stiffness (heat; 1.0) ·
  Rigidify above (off / 0.9) · Prune below (0.025) · Symmetrize (on when the mesh has a partner map) · Max influences
  **4 (fixed: glTF/three.js/Bevy read one set)** shown read-only with its reason · Joints: all / selected (Maya's
  "bind to selected joints"; one joint = a rigid attach for hats and helmets) · Vertices: all / selected (mask). Runs in a worker with a progress pill; one undo step; **adjustable** through the Last-op card and INPUTS
  (undo + re-run, ADR 0016 D6), so changing Stiffness re-solves without a new step.
- **Auto weights for selected joints** (the same operator with the joint mask preset) after adding a joint.
- **Unbind Skin** (`skin.unbind`): removes the skin from the selected meshes; confirm "Weights are discarded (undo
  restores them)".
- Bind requires frozen transforms on the mesh (glTF ignores a skinned mesh node's transform): with a non-identity
  placement, the option box shows "Freeze Transformations first" with a button running Model's freeze operator
  (allowed from Rig, one step).

### 8.2 Paint Weights panel (right dock)

```
┌ Paint Weights ─────────────────────────────── body ▾ ┐
│ Mode   (•) Paint  ( ) Select   (Paint Select: later)  │
│        Ctrl+< / Ctrl+> switch                         │
│ ── Influences ── / filter…    Sort [Hierarchy ▾]  📌  │
│ ▾ root                                    ■  🔓   0  │
│  ▾ hips                                   ■  🔓 118  │
│   ▾ spine                                 ■  🔓  96  │
│    ▾ leftShoulder                         ■  🔓  12  │
│      ▾ leftUpperArm                       ■  🔒  40  │  🔒 = Hold (locked)
│        ● leftLowerArm               ◀ active ■ 🔓  38 │  ● = paint target
│          leftHand                         ■  🔓  44  │  number = vertices with w > 0
│ [Copy] [Paste] [Hammer] [Move ▸] [Show influences]   │
│ [Invert sel.] [Reveal selected] [Hold all] [Release] │
│ ── Operation ──                                       │
│ (•) Replace ( ) Add ( ) Scale ( ) Smooth              │
│ Value   [ 1.000 ]────●   Opacity [ 1.000 ]────●       │
│ [ Flood ]   (applies to the selection, else all)      │
│ ── Brush ──                                           │
│ Radius [ 40 px ]  Falloff [Smooth ▾]  (•)Surface ( )Volume │
│ ☑ Front faces only   ☑ Mirror stroke (X, = symmetry) │
│ ── Display ──                                         │
│ [Greyscale ▾] ☐ Numbers ☐ Lock-Relative ☐ Wireframe  │
│ Normalization: interactive · max 4 influences         │
└───────────────────────────────────────────────────────┘
```

| Element | Behaviour |
|---|---|
| Mesh selector | the hilited skinned meshes; the list shows the union of their influences |
| Influences list | virtualized ARIA tree (or flat list); **Sort** Alphabetically / By Hierarchy / Flat (Maya); filter matches names and VRM names; **pin** shows only selected influences; click = active influence (paint target, ●); Shift/Mod-click multi-select (for Move weights, Hold); the swatch opens the influence colour (P per joint name); **lock icon = Hold**; the count column shows vertices with weight > 0 |
| Hold (lock) | U state per mesh and joint (§20); held influences are never changed by any tool (research 14 §6.1); the Component Editor's Hold row is the same state |
| Buttons | Copy / Paste vertex weights (active vertex → selection), Hammer (selected vertices ← neighbours), **Move ▸** (weights of the selected vertices from the first selected influence to the others, Maya *Move Weights to Influences*), Show influences (select every influence of the selected vertices), Invert selection, Reveal selected (scroll), Hold all / Release all |
| Mode | Paint / Select (Maya; `Ctrl+<` / `Ctrl+>`); Select edits the vertex selection that the Component Editor and Flood read (the mask); Paint Select is later (research 17 §11.3) |
| Operation | Replace / Add / Scale / Smooth (research 14 §6.2 formulas); Value and Opacity with virtual sliders; Min/Max are not offered (Maya's negative-value trick is covered by Scale) |
| Flood | applies the operation to the selected vertices, else to every vertex of the meshes: one undo step |
| Brush | radius in screen px (40 by default); falloff Smooth/Linear/Constant; Surface (connected vertices within the radius: no painting through to the other leg) or Volume; front faces only (default on); **Mirror stroke** (X: partner vertex, partner joint; on when the skeleton's symmetry is on, research 17 §11.3); one stroke applies once to the stroke-start weights (research 17 §11.2) |
| Display | Greyscale / Ramp / Influence colours; Numbers; Lock-Relative; wireframe on shaded |
| Footer | normalization is always interactive with max 4 (read-only line with the reason; research 14 D7) |

### 8.3 Brush gestures and keys

| Input | Effect | Origin |
|---|---|---|
| LMB drag | paint stroke: preview overlay, **one undo step per stroke** | Maya |
| `B` + LMB drag / `B` + MMB drag | brush radius, relative / from zero | Maya `B` (Model's soft-select gesture) |
| `M` + LMB drag | change Opacity (horizontal) | Maya 2026 Paint Skin Weights (research 17 §1.3) |
| `N` + LMB drag | change Value (horizontal) | Maya `N` |
| `I` + click | sample: Value ← the active influence's weight at the vertex | research 17 §11.3 (Blender *Sample Weight*; Paint Colour's eyedropper key) |
| LMB on a joint glyph | make it the active influence (joints never take paint clicks) | research 17 §11.3 |
| `U` + LMB | paint-operation marking menu (§17) | Maya `U` |
| `Shift+I` + click | make the **dominant influence at that vertex** active | Ekza; ngSkinTools' hold-`S`-and-drag precedent (Q-RIG-UI-11) |
| RMB on a joint | influence menu: Paint weights for this joint, Hold, Select affected vertices, … (§17) | Maya *Select Influence* |
| `↑` / `↓` | walk the active influence to its parent / first child; `←` / `→` siblings | Maya (documented for Paint Skin Weights) |
| `Ctrl+<` / `Ctrl+>` | cycle Paint / Select / Paint Select | Maya |
| `Alt+C` | weight display on/off (colour feedback) | Maya Artisan |
| `Alt+R` | mirror stroke on/off | Maya Artisan reflection (disabled for skin in Maya; ours mirrors through the joint map) |
| `Alt+A` | wireframe on shaded | Maya Artisan |
| digits while armed | numeric capture during a `B`/`N` drag (radius px, value) | ADR 0016 D8 |
| Flood | button, `U` menu NE, palette — **no key** (`Alt+F` is a Windows browser menu) | divergence |

### 8.4 Component Editor (bottom dock)

- Rows: the selected vertices of the hilited skinned meshes (welded duplicates shown once; edits write every
  duplicate, research 14 R3), virtualized; `rows: each ▾ / averaged` switches to one averaged row for large
  selections (typing then sets every selected vertex).
- Columns: influences with a non-zero weight in the selection, ordered by hierarchy, plus **Total**; `+ influence`
  adds a column (a joint picked from a list).
- **Hold row** (Maya) at the top: checkboxes, the same state as the panel's lock icons.
- Cells: typed values with the research 09 §6.4 grammar (`0.3`, `+=0.1`, `*0.5`); commit = `skin.weights.set`
  (normalization with holds, research 14 §6.1); the row re-reads after normalization and briefly highlights the cells
  that moved. One undo step per commit; `Tab`/arrows move between cells; `Esc` reverts.
- Problem rows: > 4 influences or a bad sum render the Total cell in `--danger` with a tooltip.
- Toolbar: Prune `< [0.01]` (`skin.weights.prune`), Normalize, Hammer, Copy/Paste, Mirror ▸, Select vertices of the
  selected column.
- Empty state: "Select vertices (Skin mode, Select tool or Paint › Select)".

### 8.5 Weight utilities (Skin menu, Toolkit, Shift+RMB list)

| Utility | Operator | Option box / behaviour |
|---|---|---|
| Assign to Joint | `skin.weights.assign` | selected vertices/faces/islands → weight 1 on the active influence (the low-poly 80 % tool) |
| Rigid Islands | `skin.weights.rigidIslands` | selected islands → the joint nearest each centroid |
| Mirror Skin Weights | `skin.weights.mirror` | direction +X → −X (default) / −X → +X; surface association closest point (default) / vertex partners; influence association: mirror links, humanoid map, name patterns, closest joint (research 14 §6.3); adjustable |
| Copy Skin Weights | `skin.weights.transfer` | from another skinned mesh of the same skeleton, closest point + barycentric (Maya's name for transfer) |
| Smooth Skin Weights | `skin.weights.smooth` | iterations, strength; selection or all |
| Hammer Skin Weights | `skin.weights.hammer` | selected ← unselected neighbours |
| Copy / Paste Vertex Weights | `skin.weights.copyVertex` / `pasteVertex` | `Mod+C` / `Mod+V` in Skin mode |
| Prune Small Weights | `skin.weights.prune` | Prune below (0.01); renormalizes; adjustable |
| Normalize Weights | `skin.weights.normalize` | |
| Remove Unused Influences | `skin.influences.removeUnused` | palette cleanup, preview count first |
| Move Weights to Influences | `skin.weights.moveToInfluence` | first selected influence → the others |

### 8.6 Painting on the posed mesh and the out-of-date flow

- In Test and Clip views the brush picks against the CPU-skinned copy (research 14 §7.3) and edits bind-pose weights;
  the readout and ring follow the posed surface. R-Paint keeps a second pane in the bind pose.
- **Skin out of date** (a topology edit in Model after binding): leaving Model transfers weights by closest point
  (MODELING-PLAN §5.2 C4); in Rig & Skin the mesh's Outliner badge reads `skin ⚠`, the Validation row
  `skin.stale` ("Weights transferred after a topology change: review") selects the changed vertices, and
  **Mark reviewed** clears the warning (D: the stale flag is part of the skin data, so it survives reload).

---

## 9. Constraints (FR-RIG-10, pulled from M2c)

### 9.1 Creating

- **Selection order (Maya)**: select the target(s), then the driven control last (the lead). `Constrain › Parent /
  Point / Orient / Aim` (and Shift+RMB in Object mode) runs `rig.constraint.create {type}` with the option-box
  defaults; `⋯` opens the option box. One undo step; adjustable (maintain offset, axes, weights, aim settings).
- Option box (per type, generated from params): **Maintain Offset** ✓ (default on, Maya default for parent) · Axes
  (Translate All / X Y Z; Rotate All / X Y Z: `skip` axes, research 07 §19.1) · Weight (1.0) · Aim: Aim vector (+X),
  Up vector (+Y), World up type Vector / Object / Object rotation / None with its vector or object · Blend (1.0).
- Driven must be a control (research 07 §7: a constraint drives the control's **space**, so the control stays
  animatable on top); a joint or mesh as the driven object poll-fails "Constrain a control (create the control rig
  first)". Targets may be controls or joints (`SpaceTarget` bone refs).
- **Pole Vector** in the Constrain menu routes to limb IK: on an IK limb it selects the pole control; elsewhere it runs
  `rig.addLimbIk` (shipped M2a) with a note "Pole vectors are part of limb IK".
- A constraint that would close a cycle is refused before writing ("leftHand ← prop ← leftHand"), as research 07 §8
  breaks only merge-created cycles.

### 9.2 Showing and editing

- **Outliner**: the constraint is a child row of its driven control (`⛓ parent → L Hand, prop_grip`), like Maya's
  constraint node under the constrained transform; filter toggle `⛓`.
- **Channel Box** (driven control or constraint row selected): the driven channels show the `--cb-constrained` state
  (shipped token); a **constraint section** lists `Blend` and one weight row per target (`L Hand W0`, `prop W1`),
  editable with virtual sliders. In Rig & Skin they are rest values (D); keying them is Animate's (the M2a custom
  attribute mechanism: the operator creates keyable `@` attributes on the driven control, Maya's `blendParent`; the
  exact attribute names are the constraint note's contract).
- **Attributes › Constraint** (wireframe):

```
┌ Constraint · parent ─────────────────────── [Enabled ✓] ┐
│ Driven   prop_grip (control)                              │
│ Targets  L Hand   ■────────●  1.00   [Offset ⟲] [✕]       │
│          R Hand   ■●────────  0.00   [Offset ⟲] [✕]       │
│          [+ Add selected as target]                       │
│ Maintain offset ✓   [Update offset from current pose]     │
│ Translate  All ✓  X ☐ Y ☐ Z ☐   Rotate All ✓  X ☐ Y ☐ Z ☐ │
│ Blend    ■──────────●  1.00                                │
│ [Select driven] [Select targets] [Delete constraint]       │
└───────────────────────────────────────────────────────────┘
```

  *Update offset from current pose* captures the offset from the Test pose (stored explicitly, research 07 §7);
  *Offset ⟲* per target resets to the rest-derived offset.
- Delete: `Delete` on a constraint row (Outliner focus), Attributes button, Shift+RMB SW in Object mode; the driven
  control keeps its channels and curves.
- **Animate** lists the same operators under `Rig › Constrain ▸` (operators with `workspaces: ['rig', 'animate']`), so
  an animator can attach a prop mid-shot without changing tabs.

---

## 10. Control shapes (FR-RIG-13, pulled from M2c)

### 10.1 Shapes mode

| Action | UI | Data |
|---|---|---|
| Replace shape | Shift+RMB N ▸ library, Attributes › Shape picker: a popover grid of the registered kinds (circle, square, cube, sphere, diamond, arrow4, star, foot, cross, plus registry extensions), each a 32 px preview | `shape.kind` |
| Colour | Side (default) · palette of 12 rig colours · custom hex; `side` keeps L blue / R red / C yellow | `shape.color` |
| Size | Attributes slider, `rig.setControlSize` (shipped) | `shape.size` |
| Line width | 1–4 px or theme default | `shape.lineWidth` |
| Move / rotate / scale the shape | `W` / `E` / `R` on selected controls transform **the shape offset**, never the control's rest or channels; the manipulator sits at the shape's pivot; symmetry mirrors the edit to the partner when "Mirror edits" is on (status line) | `shape.offset` |
| Edit CVs | `F9` or RMB › Control Vertex (Maya's component mode for curves): CVs of the selected controls become pickable; `W`/`E`/`R`, marquee, `Shift+.`/`Shift+,` grow/shrink along the curve; the first CV edit converts a library shape to `custom` (its points copied into a `SplineSet`), the Outliner badge `◯ circle` → `◯ custom` | `shape.custom` |
| Mirror Shape | `Control › Mirror Shape ▸ L → R / R → L` (selected or all): partner gets the mirrored offset and custom points | partner `shape` |
| Copy / Paste Shape | `Control › Copy Shape`, `Paste Shape` (kind, size, offset, custom, colour) | |
| Size from Mesh | re-run the auto-rig sizing for the selection (research 07 §5.4) | |
| Reset Shape | back to the auto-rig default for that template key | |

Rules: every shape edit is one undo step per gesture; **nothing in Shapes mode can create or change a key** (the
keymap shadows keying chords, and the operators touch only `ControlRecord.shape`); edits survive
`rig.autoRig.update` (research 14 §7.1 keeps "user display overrides (size, colour, visibility)", extended here to
`offset` and `custom`).

### 10.2 Attributes › Control Shape

```
┌ Control Shape · L Upper Arm (fk.upperArm.L) ───────────────┐
│ Shape  [◯ circle ▾]   Colour [● side ▾]   Line [2 px ▾]     │
│ Size   ■────●─────── 0.055 m       [Size from mesh]         │
│ Offset T  0.060  0.000  0.000  m                            │
│        R  0.0    0.0   -90.0   °                            │
│        S  1.00   (uniform)                                   │
│ [Edit CVs (F9)] [Mirror → R Upper Arm] [Copy] [Paste] [Reset]│
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Test deformation and bind-pose management

| Need | UI |
|---|---|
| Rotate joints to test (no control rig yet) | Skeleton mode, `E` on joints → Test view; Channel Box shows `Rotate X/Y/Z` test rows in the "changed" pink |
| Pose with the control rig | Object mode, select controls, `W`/`E` (IK legs work: M2a) → Test |
| Range of motion | `Skin › Test › Range of Motion` creates/refreshes `__rom`; Pose view `Clip`; `Alt+V` plays; the timeline shows its poses |
| Any clip | Clip selector in the timeline; Pose view switches to `Clip` |
| Back to rest | `Go to Bind Pose` (status line `Bind`, Skin menu, RMB E) |
| Compare | `Bind` ↔ `Test` keeps the last test pose; R-Paint shows both at once |
| Clear | `Reset Test Pose` (Skin › Test, RMB list) |
| Rest edits after binding | `W` on joints moves the rest; the mesh stays; IBMs are re-derived; the deformation in Test/Clip updates live (RU11) |
| A-pose models | `Apply Pose as Rest` (§7.6) |

Bind-pose consistency is a Validation row (`pose.bind-mismatch`, imports whose IBMs disagree with the node rest
pose; fix = *Rebind at rest*, research 14 §8.3).

---

## 12. Onboarding

### 12.1 Setup checklist (Rig Toolkit header; also the viewport empty state)

```
┌ Set up Lowpoly Lad ───────────────────────────────────────────┐
│ ① Skeleton template   [Standard 33 ▾] [Create]            ✓   │
│ ② Fit joints          [Quick Rig…] [Joint mode (1)]   sym X ◐ │
│ ③ Bind                [Bind Skin (Auto low-poly)…]        ○   │
│ ④ Test pose           [Range of motion ▶] [Test pose]     ○   │
│ ⑤ Fix weights         [Paint (2)] [Mirror L → R]          ○   │
│ ⑥ Control rig         [Create control rig]  legs IK ✓     ○   │
│ ⑦ Animate             [Open in Animate ▸]                 ○   │
│ Validation: 1 error · 2 warnings  [Show]   Export… [Character]│
└───────────────────────────────────────────────────────────────┘
```

| Step | Done when (derived) | Button runs |
|---|---|---|
| ① Template | a skeleton exists | `skel.template.create {preset}` (pre-fitted for the generated humanoid body) |
| ② Fit joints | no `skel.*` errors; symmetry within 0.01 H | Quick Rig stepper; Skeleton mode |
| ③ Bind | every mesh of the character bound | Bind Skin option box (Auto (low-poly)) |
| ④ Test | the ROM clip exists or a test pose was made this session | `skin.test.rom` + Pose view Clip |
| ⑤ Fix weights | no `skin.*` errors or warnings | Skin mode + Paint; Mirror Skin Weights |
| ⑥ Control rig | the character has a control rig in sync (`rig.autoRig.update` not pending) | `rig.autoRig.update` (creates or updates; legs IK default, Q-RIG-2) |
| ⑦ Animate | — | switches to Animate with the character active (MODELING-PLAN §3.10) |

Steps are never locked: any button works at any time and the glyphs only report. The checklist collapses to one line
(`Setup 4/7 · ◐`) once ⑥ is done.

### 12.2 Other entry states

| State | Shown |
|---|---|
| No character selected | viewport card: "Select a model-sourced character or a mesh" + Outliner hint + `Edit a sample: Polybot (CC0)` |
| Imported skinned VRM (`modification: prohibited`) | banner "This avatar's licence forbids modification: skeleton and weights are read-only; animation exports stay available" (Q-SKIN-2); edit operators poll-fail with the same reason |
| Imported skinned GLB/VRM that allows modification | the setup checklist starts at ⑤ (weights exist) with `char.makeEditable` offered when a step needs it |
| Static mesh, no skeleton | the checklist at ① |
| Getting started (first visit) | dismissible card: ① Template ② `1` Joint mode, drag a knee joint (symmetry) ③ Bind ④ `E` on the elbow to test ⑤ `2` Skin mode, paint ⑥ Control rig ⑦ Animate; keys from `KeymapManager.label` |

### 12.3 Panel empty states

| Panel | Text | Action |
|---|---|---|
| Paint Weights | "No skinned mesh selected" | Bind Skin… |
| Component Editor | "Select vertices in Skin mode" | Select tool |
| Validation | "No issues for profile ekza/space-avatar-v1" ✓ | Export character… |
| Outliner Constraints | "No constraints" | Constrain menu hint |

---

## 13. Validation panel and export hand-off

```
┌ Validation ── Profile [ekza/space-avatar-v1 ▾] ── ✕ 1  ⚠ 2  ℹ 1 ── [Re-run] ─────────────────────┐
│ ✕ skel.required-bones   VRM requires leftLowerArm               [Select] [Fix: add from template]│
│ ⚠ skin.unweighted-vertex 4 vertices have no weight (body)       [Select] [Fix: closest joint]    │
│ ⚠ xform.not-frozen      body placement is not identity          [Select] [Fix: freeze]           │
│ ℹ skin.joint-without-weights  tail_03 influences nothing        [Select]                         │
│ ───────────────────────────────────────────────────────────────────────────────────────────────── │
│ Ready for: Space ✕ · OMOBA humanoid ✕ · plain GLB ✓            [Export character…]               │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Code | Check | Severity (VRM profiles / plain GLB) | Fix |
|---|---|---|---|
| `skel.required-bones` | the 15 VRM required bones mapped | error / — | add missing joints from the template |
| `skel.unique-names`, `skel.unique-human-bone` | uniqueness | error / error (names) | rename with suffix |
| `skel.parent-map` | humanoid ancestry matches VRM | error / — | Select |
| `skel.tpose` | VRM T-pose within 5° per bone | error / warning | Apply Pose as Rest (§7.6) |
| `skel.symmetry` | pairs mirror within 0.01 H | warning | Mirror L → R |
| `skel.grounded`, `skel.facing` | min Y ≈ 0; toes in front | warning | Center and ground; rotate to +Z |
| `xform.scale` | joints and skinned mesh nodes: positive uniform scale 1 | error | Freeze |
| `xform.not-frozen` | skinned mesh placement = identity | error | Freeze Transformations |
| `pose.bind-mismatch` | imported IBMs disagree with the rest pose | warning | Rebind at rest |
| `skin.unbound` | a mesh of the character has no skin | error (VRM) / warning | Bind Skin… |
| `skin.unweighted-vertex` | Σ = 0 | error | assign closest joint |
| `skin.influences` | > 4 non-zero (imports) | error | prune to 4 |
| `skin.weight-sum` | \|Σ − 1\| > 1e-6 | error | normalize |
| `skin.unreachable-island` | heat found no visible bone | warning | rigid islands |
| `skin.stale` | weights transferred after a topology change | warning | Mark reviewed |
| `skin.cross-side` | left vertex > 0.5 on a right joint | warning | Select |
| `skin.dangling-joint` | palette joint deleted | warning | Select |
| `skin.joint-without-weights` | joint influences nothing | info | — |
| `rig.constraint-cycle`, `rig.constraint-dangling` | constraint graph | error | Select / Delete |
| `rig.out-of-sync` | control rig older than the skeleton | warning | Update control rig |
| `vrm.meta-required`, `vrm.thumbnail-square` | export dialog checks | error at export | in the Export dialog |

- Rows group by area (Skeleton, Skin, Transforms, Rig, Export) and sort by severity; *Select* sets the selection and
  mode (joints → Skeleton, vertices → Skin) and frames it; *Fix* runs a named operator (one undo step, never silent).
- The **profile selector** changes severities only; results are derived and never stored. The tab glyph (§3.2), the
  setup checklist and the Export dialog read the same results.
- **Export hand-off**: *Export character…* opens the Export dialog's **Character (VRM 1.0 / GLB)** section
  (research 14 §9; the writer note owns it) with the profile preselected; error rows of that profile block the export
  button with the list; the interop banner (MODELING-PLAN §5.1) shows there.

---

## 14. Outliner (Rig variant)

```
/ filter…                     [⚚joint][▢mesh][◯ctrl][⛓cns]  [⚙]
▾ ☺ Lowpoly Lad (model) · VRM 1.0 · Standard 33          vis lock
  ▾ ⚚ Skeleton (33)  sym X
     ▾ root
       ▾ hips                       C
          spine · chest · neck …
         ▾ leftUpperLeg   ⇋ rightUpperLeg    L
            leftLowerLeg · leftFoot · leftToes
         ▸ tail_01 (extra)
  ▾ ▢ Meshes
       body        612 tris   skin ✓ (4 max)
       sword_hand   88 tris   skin ⚠ out of date
  ▾ ◯ Rig (71 controls)
     ▸ fk.upperArm.L …
       prop_grip  ⛓ parent → L Hand
```

| Item | Behaviour |
|---|---|
| Joint rows | humanoid name as secondary text, side chip, `⇋` partner on hover, lock column (pickable), missing required bones as greyed placeholder rows with *Add* |
| Drag | reparent joints (allowed in Rig; a drag onto a mesh row is refused); Maya `P` order also works |
| Mesh rows | skin badge `skin ✓` / `skin ⚠` / `unbound`, influence count; click in Skin mode hilites the mesh |
| Control rows | as Animate, plus shape kind badge; constraint children |
| RMB | joint: Select Hierarchy, Mirror Joint, Orient Joint, Map Humanoid ▸, Side ▸, Rename, Remove; mesh: Bind Skin…, Unbind, Paint Weights, Mirror Skin Weights, Copy Skin Weights from…; control: Constrain ▸, Edit Shape, Mirror Shape, Reset Shape; constraint: Select Targets, Enable/Disable, Delete |
| Filters | type toggles; "Only problems" (rows with Validation hits) |
| Keys (scope `rig.outliner`) | `F2`/`Enter` rename, arrows tree navigation, `Delete` remove (joint or constraint by row type), `H`/`Shift+H` hide/show, `P`/`Shift+P` |

---

## 15. Channel Box and Attributes in Rig & Skin

| Selection | Channel Box | Attributes sections |
|---|---|---|
| Joint (Bind) | `Rest Position X/Y/Z` (character space, D, editable; symmetry writes the partner); INPUTS of the last joint op | **Joint**: name, humanoid bone, side, mirror partner, parent, rest position, rest orientation (Euler), tail, locked; **Skeleton**: template, preset, symmetry, joint count |
| Joint (Test) | `Rotate X/Y/Z` test rows (pink "changed"), rest rows read-only | same |
| Skinned mesh | — | **Skin**: skeleton, method of the last bind (args, research 14 `bindMethod`), influences, max 4, stale flag; *Rebind…*, *Unbind* |
| Control | shipped rows (Test: pink); constraint section with Blend and target weights (§9.2); INPUTS | Control (shipped), **Control Shape** (§10.2), Limb (shipped M2a), **Constraint** for its constraints |
| Constraint row | `Blend`, `W0…Wn`, `Enabled` | **Constraint** (§9.2) |
| CVs (Shapes) | `X/Y/Z` of the lead CV (control space) | Control Shape |

The Last-op card and INPUTS show adjustable rig operators (Bind Skin, Mirror Joint, Orient Joint, Prune, Mirror Skin
Weights, Smooth Skin Weights, Template, Create Constraint) exactly as for mesh operators (M6A-SPEC §8.6).

---

## 16. Menus (Rig & Skin; every item an operator with `workspaces: ['rig']` unless noted)

| Menu | Items |
|---|---|
| Create | Skeleton Template ▸ (Lite 17, Core 21, Standard 33, Full 52) · Empty Skeleton (generic) |
| Select | Mode ▸ (Object `F8`, Skeleton `1`, Skin `2`, Shapes `3`) · Hierarchy · Mirror Counterpart · Joints of Selected Vertices · Vertices of Active Influence · Unweighted Vertices · Grow / Shrink (Skin) · All / Invert / None |
| Modify | Freeze Transformations (meshes) · Reset Test Pose |
| Display | Joint Size ▸ · X-Ray Joints · Local Rotation Axes · Humanoid Labels · Weight Display ▸ (Greyscale, Ramp, Influence Colours, Lock-Relative) · Constraint Lines · Hide/Show/Isolate · Shading ▸ |
| **Skeleton** | Create Joints · Insert Joints · Mirror Joints ⋯ · Orient Joint ⋯ · Remove Joints (splice) · Delete Joint and Children `Delete` · Reparent `P` · Unparent `Shift+P` · Map Humanoid Bone ▸ · Set Side ▸ · Add Chain · Quick Rig… · Apply Pose as Rest · Symmetry X ✓ · Snap to Projected Center ✓ · Reroot (later, disabled) |
| **Skin** | Bind Skin ⋯ · Unbind Skin · Go to Bind Pose · Paint Skin Weights · Mirror Skin Weights ⋯ · Copy Skin Weights ⋯ · Smooth Skin Weights ⋯ · Hammer Skin Weights · Copy Vertex Weights `Mod+C` · Paste Vertex Weights `Mod+V` · Prune Small Weights ⋯ · Normalize Weights · Remove Unused Influences · Move Weights to Influences · Assign to Joint · Rigid Islands · Auto Weights for Selected Joints · Test ▸ (Range of Motion, Reset Test Pose) · Component Editor |
| **Constrain** (also in Animate's Rig menu) | Parent ⋯ · Point ⋯ · Orient ⋯ · Aim ⋯ · Pole Vector (→ limb IK) · Add Target · Remove Target · Update Offset · Enable / Disable · Delete Constraint · Scale (disabled, "later") · Bake to Keys (disabled, "later") |
| **Control** | Create / Update Control Rig · Replace Shape ▸ · Shape Colour ▸ · Edit CVs `F9` · Mirror Shape ▸ · Copy Shape · Paste Shape · Size from Mesh · Reset Shape · IK/FK ▸ and Add Limb IK (shipped) · Show Secondary Controls (shipped) |
| Windows | Paint Weights · Component Editor · Validation · Rig Toolkit · (shared panels) |

---

## 17. Marking menus (data; positions provisional until Q-RIG-UI-1)

Slot families: **N** = the mode's main tool, **S** = its build step, **SW** = its removal command, **E** = its
mirror/symmetry command. Every item is also in a menu-bar menu and the command palette.

| Menu id (trigger) | Slots | List |
|---|---|---|
| `rig.modes` (RMB, any mode, except Skin mode over a joint and Shapes mode over a control) | N Skeleton · W Skin · S Shapes · NE Object · E Bind ⟷ Test pose · SE Select ▸ (Hierarchy, Mirror counterpart, Joints of vertices) · SW Isolate · NW X-Ray Joints ✓ | Hide Selected · Show All · Frame · Rename… · Attributes |
| `rig.tools.object` (Shift+RMB, Object mode) | N Parent Constraint · NE Point Constraint · E Orient Constraint · SE Aim Constraint · S Create / Update Control Rig · SW Delete Constraint · W Pole Vector (limb IK) · NW Go to Bind Pose | Constraint Options… · Add Target · Remove Target · Update Offset · Enable/Disable |
| `rig.tools.skeleton` (Shift+RMB, Skeleton mode) | N Joint Tool · NE Insert Joint · E Mirror Joint… · SE Orient Joint… · S Quick Rig… · SW Remove Joint · W Template ▸ (Lite, Core, Standard, Full) · NW Apply Pose as Rest | Reparent `P` · Unparent `Shift+P` · Map Humanoid ▸ · Side ▸ · Add Chain · Projected Center ✓ · Symmetry X ✓ |
| `rig.tools.skin` (Shift+RMB, Skin mode) | N Paint Skin Weights · NE Hammer · E Mirror Skin Weights… · SE Prune Small Weights… · S Bind Skin… · SW Unbind Skin · W Copy / Paste Vertex Weights ▸ · NW Smooth Skin Weights | Assign to Joint · Rigid Islands · Copy Skin Weights… · Normalize · Remove Unused Influences · Move Weights to Influences · Auto Weights for Selected Joints · Component Editor |
| `rig.tools.shape` (Shift+RMB, Shapes mode) | N Replace Shape ▸ · NE Colour ▸ · E Mirror Shape ▸ · SE Line Width ▸ · S Edit CVs · SW Reset Shape · W Copy / Paste Shape ▸ · NW Size from Mesh | Shape offset: reset T / R / S |
| `rig.skin.joint` (RMB on a joint, Skin mode) | N Paint Weights for This Joint · E Hold ✓ · W Select Affected Vertices · S Assign to Selected Vertices · NE Hold All Others · NW Release All Holds · SE Mirror Weights for This Pair · SW Prune This Influence | Show in Influences List · Colour… |
| `rig.shape.control` (RMB on a control, Shapes mode) | N Control Vertex · NE Object · E Replace Shape ▸ · W Colour ▸ · S Reset Shape · SE Mirror Shape · SW Copy Shape · NW Paste Shape | Select Mirror · Attributes |
| `rig.paint.ops` (`U` + LMB, Skin mode) | N Replace · E Add · S Smooth · W Scale · NE Flood · SE Mirror Stroke ✓ · SW Weight Display ▸ · NW Sample (`I`) | Value 0 · 0.25 · 0.5 · 0.75 · 1 · Opacity 0.1 · 0.25 · 0.5 · 1 |
| `rig.pickMask` (`Q` + LMB, Object mode) | N Joints · E Controls · S Meshes · W All · NE Joints + Controls · SE Meshes + Controls | — |
| `rig.options` (Ctrl+Shift+RMB) | N Symmetry X ✓ · NE Projected Center ✓ · E X-Ray Joints ✓ · SE Local Axes ✓ · S Joint Size ▸ · SW Mesh X-Ray ✓ · W Humanoid Labels ✓ · NW Lock-Relative ✓ | Symmetry tolerance… |

Contract delta: `MarkingMenuDef.when.over` gains `'joint' | 'control'` (§21); `workspaces: ['rig']`; the generic
component (M6A-SPEC §5.18) is unchanged.

---

## 18. Keymap (preset `maya`)

### 18.1 Scopes

`r` = `rig`, `rv` = `rig.viewport` (Object mode starts here), `rvj` = `rig.viewport.skeleton`, `rvw` =
`rig.viewport.skin`, `rvc` = `rig.viewport.shape`, `ro` = `rig.outliner`, `rpw` = `rig.paintWeights`, `rce` =
`rig.componentEditor`, `V` = `viewport` (all workspaces), `G` = `global`. Chain over a pane: `rig.viewport.<mode>` →
`rig.viewport` → `viewport` → `rig` → `global`; over a panel: `rig.<panel>` → `<panel>` → `rig` → `global`
(M6A-SPEC §5.17 builder, one more prefix). Origin: **M** Maya default, **M~** Maya-inspired, **E** Ekza.

### 18.2 Rows

| Chord | Operator (args) | Scope | Origin | Notes |
|---|---|---|---|---|
| `F8` | `rig.mode {mode: 'toggle'}` | rv | M~ | object ↔ last rig mode (Maya object/component) |
| `Digit1` / `Digit2` / `Digit3` | `rig.mode {mode: 'skeleton' / 'skin' / 'shape'}` | rv | E (Model's digit rule) | active digit again → Object; `4`–`7` stay shading (`V`) |
| `KeyQ` / `KeyW` / `KeyE` / `KeyR` | `view.tool {select / move / rotate / scale}` | V | M (shipped) | meanings per mode (§5.1) |
| `KeyG` / `KeyT` / `KeyY` | `edit.repeatLast` / `view.lastOpCard {expand, focusPrimary}` / `tool.last` | rv | M / M~ / M | `Y` brings back the Joint tool or the brush |
| `KeyP` / `Shift+KeyP` | `skel.joint.reparent` / `skel.joint.unparent` | rvj, ro | M | Maya order: children first, parent last |
| `Delete`, `Backspace` | `skel.joint.delete {subtree: true}` | rvj | M | Maya's Delete (research 17 R4); weights fold into the nearest surviving ancestor; *Remove Joints* (splice) is menu-only |
| `Delete`, `Backspace` | `rig.outliner.delete` (joint or constraint by row) | ro | M | |
| `Delete`, `Backspace` | `rig.animateOnly` | rv | E | shadows `key.deleteAtFrame` ("Keys are deleted in Animate") |
| `ArrowUp/Down/Left/Right` | `select.pickWalk {direction}` (joints) | rvj, ro | M | |
| `ArrowUp/Down/Left/Right` | `skin.influence.walk {direction}` | rvw, rpw | M (Paint Skin Weights) | parent / child / siblings |
| `Shift+Period` / `Shift+Comma` | `select.mesh.grow` / `shrink` (vertices); along the curve for CVs | rvw, rvc | M | unshifted `,`/`.` stay key navigation |
| `Mod+KeyA` | `select.joints {all}` / `select.mesh.all` / `select.controls {all}` | rvj / rvw / rv, rvc | M~ | |
| `Mod+KeyC` / `Mod+KeyV` | `skin.weights.copyVertex` / `skin.weights.pasteVertex` | rvw, rce | M~ (Maya menu items, no chord) | |
| `Ctrl+Shift+Comma` / `Ctrl+Shift+Period` | `skin.paint.mode {step: −1 / +1}` | rvw, rpw | M (`Ctrl+<` / `Ctrl+>`) | literal Ctrl on every platform |
| `Alt+KeyC` | `view.display.toggle {flag: 'weights'}` | rvw | M (Artisan colour feedback) | shadows the shipped `Alt+C` (controls) in Skin mode only, where controls are hidden |
| `Alt+KeyR` | `skin.paint.mirrorToggle` | rvw | M~ (Artisan reflection) | |
| `Alt+KeyA` | `view.display.toggle {flag: 'wireOnShaded'}` | rvw | M (Artisan wireframe) | |
| `F9` | `rig.shape.cvMode {toggle}` | rvc | M (component/CV mode) | Mac: fn+F9; RMB › Control Vertex |
| `KeyH` / `Shift+KeyH` / `Alt+KeyH` | `view.hide {selected}` / `view.showAll` / `view.hide {unselected}` | rv, ro | M~ | joints, meshes, controls |
| `Shift+KeyL` | `view.isolate` | rv | M | |
| `KeyS`, `Shift+KeyW/E/R`, `Alt+KeyS`, `Alt+KeyM`, `Mod+Shift+KeyV`; `Mod+KeyC`/`Mod+KeyV` outside `rvw`/`rce` | `rig.animateOnly` | rv | E | test poses and shape edits are never keyed or pasted unseen (as `model.animateOnly`) |
| `Mod+KeyE`, `Mod+Shift+KeyE` | `ui.open {dialog: 'export'}` | G | shipped / E | Model's `Mod+E` extrude is `model` scope only |
| `Mod+KeyK` | `ui.commandPalette` | G | E | |

### 18.3 Tool modifiers (read by tools through `ToolKeyEvent`, not keymap rows; the conformance test reserves them)

- **Joint tool**: `Enter`/`NumpadEnter` complete; `Backspace` remove last; `Esc` cancel; MMB-drag move the last joint;
  `Shift` 45° steps (to calibrate); `V` snap to vertex, `X` to grid.
- **Move on joints**: `D` held = this joint only (to calibrate); `X`/`V`/`J` snaps (holds, as Model).
- **Paint**: `B`+LMB/MMB radius; `M`+LMB opacity; `N`+LMB value; `U`+LMB operation menu; `I`+click sample value;
  `Shift+I`+click pick the dominant influence; LMB on a joint glyph = active influence;
  digits during `B`/`N` drags (numeric capture).
- **Drag speed** everywhere: `Shift` ×0.1, `Mod` ×10 (shipped rule).

### 18.4 Never bound (additions to the M6a conformance list)

`Alt+F` (Maya flood: Windows browser menu; also Firefox's File menu), `Shift+B` (Maya lower radius: no lower radius
here, and auto-repeat with `B` held would fire it), F11/F12, `Ctrl+H`, `Mod+1…9`, `Tab` outside modal tools; no
workspace-switch chord.

### 18.5 Deliberate divergences from Maya

| Maya | Ekza | Why |
|---|---|---|
| `Alt+F` flood | Flood button, `U` menu NE, palette | browser menu chord on Windows |
| Moving a bound joint at bind pose deforms the skin; *Move Skinned Joints* is a separate tool | moving a joint's rest never moves the mesh | bind = rest; IBMs derived (RU11) |
| Rotating a bound joint poses it (scene state) | rotating a joint is a **test pose** (session), never a key or a document change | rest stays clean; keys are Animate's |
| Reflection disabled while painting skin | Mirror stroke through the joint map | low-poly symmetric characters; Maya's alternative (Mirror Skin Weights) is also offered |
| Influence lock (`liw`) is a scene attribute | Hold is per-user session state | a collaborator's holds must not freeze your painting (§23) |
| `1`/`2`/`3` smooth-mesh preview | rig modes | Model's digit rule; no subdivision in scope |
| Normalize Off / Post modes | always interactive, max 4 | WYSIWYG with glTF's four influences (research 14 D7) |
| Joint labelling as a separate menu | side + humanoid bone in Attributes and RMB | VRM mapping is the labelling |

### 18.6 Conformance additions (B0b's test extended by M6b)

Every `rig.*`, `skel.*`, `skin.*` binding names a registered operator; no binding uses `Alt+F` or `Shift+B`; through
the DOM adapter: `S` in every Rig scope never creates a key; `Mod+E` opens Export in Rig; `Alt+C` toggles controls in
Rig Object mode and weights in Skin mode; with the Joint tool in phase `placing`, `Backspace` removes the last joint
and never runs `skel.joint.delete`.

---

## 19. React component tree (additions to research 09 §13.1 and research 16 §20)

```
<EditorShell workspace="rig">
 <MenuBar> <AppMenus workspace/> <WorkspaceTabs/> <ExportButton/> </MenuBar>
 <StatusLine workspace="rig">
   <ToolGroup/> <RigModeSwitch/> <PoseViewToggle/>
   <SkeletonSymmetryToggle/> <RigSnapToggles/>                 // projected centre, grid, vertex, increment
   <JointDisplayControls/>                                     // size ⊖⊕, x-ray joints, axes
   <BrushStrip/>                                               // Skin mode only: op, value, opacity, radius, surface/volume, mirror
   <ManipulatorSpaceSelect/> <LayoutPresetPicker/>
 </StatusLine>
 <DockHost workspace="rig">
   <OutlinerPanel variant="rig"> <OutlinerFilterBar types={['joint','mesh','control','constraint']}/>
     <OutlinerTree/> <JointRow/> <SkinBadge/> <ConstraintRow/> <MissingBoneRow/>
   <ViewportPanel> <PaneHeader/> <PaneSurface/>
     <PaneHud> <RigModeBadge/> <PoseViewBadge/> <WeightReadout/> <JointCountChip/>
               <LastOpCard/> <ModalReadout/> <QuickRigCoach/> </PaneHud>
     <RigEmptyState/>                                          // setup checklist when nothing is set up
   <RigToolkitPanel> <RtkTargetHeader/> <RigModeSwitch compact/> <SetupChecklist/>
     <SkeletonSection/> <QuickRigStepper/> <SkinSection/> <ConstraintSection/> <ShapeSection/>
     <ActiveToolSettings/> <HandOffFooter/>
   <PaintWeightsPanel> <MeshSelect/> <PaintModeRadio/> <InfluenceListToolbar/>
     <InfluenceList/> (virtualized) <InfluenceRow/> <WeightActions/> <PaintOperationRadio/>
     <ValueOpacityFields/> <FloodButton/> <BrushSection/> <MirrorSection/> <WeightDisplaySection/>
   <ChannelBoxPanel> … <JointRows/> <TestPoseRows/> <ConstraintWeightRows/> <InputsSection/>
   <AttributesPanel> … <JointSection/> <SkeletonSection/> <SkinSection/> <ConstraintSection/>
     <ControlShapeSection/> <LimbSection/> (shipped)
   <ComponentEditorPanel> <WeightTableToolbar/> <HoldRow/> <WeightTable/> (virtualized grid)
   <ValidationPanel> <ProfileSelect/> <LintGroup/> <LintRow/> <ReadyForSummary/> <ExportCharacterButton/>
 </DockHost>
 <TimelineBar/>                                                // shown; clip selector lists __rom
 <HelpLine/>
</EditorShell>
<GLHost> … imperative, no React (packages/viewport + mesh-view):
   JointOverlay · JointAxesOverlay · SymmetryGhost · ProjectedCenterPreview · QuickRigMarkers ·
   WeightSurface (shader on the skinned surface) · BrushRing · ConstraintLines · ShapeCvOverlay
<Overlays>
   <MarkingMenu/> <CommandPalette/> <OptionBoxPopover/> <ShapeLibraryPopover/> <RigColourPopover/>
   <ConfirmDialog/> (Apply Pose as Rest, Unbind) <ExportDialog section="character"/> <GettingStartedCard/>
</Overlays>
```

Rules: HUD leaves subscribe to versions and counts throttled to rAF; the influence list re-renders on
holds/active/count changes only (counts recomputed on stroke end, not per sample); the brush, weight surface, joint
overlays and markers draw imperatively; the Component Editor reads `ComponentSelection.version` and the skin
revision, never per pointer frame.

---

## 20. State classification (D / U / P)

| State | Class | Owner | Persistence | Collaboration |
|---|---|---|---|---|
| Skeletons, joints (rest position, rest rotation, parent, name, humanoid bone, side, mirror, tail), skeleton symmetry flag | D | `skeletons`, `joints` tables (schema v3) | project | per field; exclusive `rig` claim while editing (research 14 R12) |
| Skin binding and weights, bind arguments, stale flag | D | mesh revision skin layers + `MeshRecord.skin` (MODELING-PLAN §11 #1) | project | per-mesh claim |
| Constraints (type, driven, targets, weights, offsets, maintain offset, axes, aim settings, blend, enabled) | D | `constraints` table | project | per field |
| Control shapes (kind, size, offset, custom, colour, line width) | D | `ControlRecord.shape` | project | per field (shape is one atomic value) |
| ROM clip `__rom` | D (flagged non-exported) | clips | project | per clip |
| Rig mode, last rig mode, per-mode selections (joints, vertices, controls, CVs) | U | session; `ComponentSelection` for vertices; a `ShapeCvSelection` service for CVs | — | presence (counts) |
| Pose view, test pose (joint rotations, control channel values) | U | session + editor-history overrides | — | presence only |
| Active influence, holds (locks) per mesh × joint | U | session | — | never shared (§18.5) |
| Quick Rig markers and stepper position | U | session | — (cleared on leaving Rig) | — |
| Paint mode, operation, value, opacity, radius, falloff, surface/volume, mirror stroke | U, defaults P | session tool state; `prefs.rigging.brush` | localStorage (defaults) | — |
| Snap toggles (projected centre default on, grid, vertex, increment), shape "mirror edits" | U, defaults P | session | — | — |
| Joint size, weight display mode, influence colours, Lock-Relative, influence sort, humanoid labels, right/bottom tab per mode | P | prefs | localStorage | never |
| Per-pane flags (`jointAxes`, `xrayJoints`, `weights`, `constraintLines`, `shapeCvs`, `humanoidLabels`) | U | `ViewportManager` pane memory per workspace | layout JSON | — |
| Validation results, tab glyph, setup-checklist state | derived | selectors over D + runtime | never stored | — |
| Hover joint/vertex, brush position, stroke preview, marker drag | transient | tool state machines | — | — |

The ARCHITECTURE §4.1 hard rule holds: no U or P value is written to the document.

Hot paths: a stroke writes weights into a preview overlay (no React, no document writes until release), commits one
transaction on release; the weight surface updates partial ranges; joint overlays rebuild on a skeleton version
change, not per frame; idle renders 0 frames (E2E-00 gate extended to Rig & Skin).

---

## 21. Contracts this UI needs (proposals; the M6b spec owns the final shapes)

```ts
// editor-core (types.ts), additive
export type RigMode = 'object' | 'skeleton' | 'skin' | 'shape';
export type PoseView = 'bind' | 'test' | 'clip';
export type PaintMode = 'paint' | 'select' | 'paintSelect';
export type PaintOp = 'replace' | 'add' | 'scale' | 'smooth';
export interface BrushSettings {
  readonly op: PaintOp; readonly value: number; readonly opacity: number;
  readonly radiusPx: number; readonly falloff: 'smooth' | 'linear' | 'constant';
  readonly reach: 'surface' | 'volume'; readonly frontOnly: boolean; readonly mirror: boolean;
}
export interface RigSessionState {
  readonly mode: RigMode;
  readonly lastMode: Exclude<RigMode, 'object'>;            // F8 target; 'skeleton'
  readonly poseView: PoseView;                               // 'bind' on entering Rig & Skin
  readonly testPose: { readonly version: number; readonly joints: number; readonly controls: number };   // counts; values live in the override store
  readonly activeInfluence: { readonly mesh: MeshId; readonly joint: JointId } | null;
  readonly holds: ReadonlyMap<MeshId, ReadonlySet<JointId>>;
  readonly paint: { readonly mode: PaintMode; readonly brush: BrushSettings };
  readonly snap: { readonly projectedCenter: boolean; readonly grid: boolean; readonly vertex: boolean; readonly increment: boolean };
  readonly shapeCvMode: boolean;
  readonly shapeMirrorEdits: boolean;
  readonly quickRig: { readonly step: 1 | 2 | 3 | 4 | 5; readonly markers: Readonly<Record<string, Vec3>> } | null;
  readonly tabMemory: Readonly<Record<RigMode, { readonly right: string; readonly bottom: string }>>;
}
export interface SessionState { …; readonly rig: RigSessionState }                       // changed (additive)
export interface Selection { …; readonly joints: readonly JointId[]; readonly constraints: readonly ConstraintId[] }   // changed (additive); lead = last
export interface DisplayFlags { …; readonly jointAxes: boolean; readonly xrayJoints: boolean;
  readonly weights: 'off' | 'greyscale' | 'ramp' | 'influences'; readonly weightNumbers: boolean; readonly lockRelative: boolean;
  readonly constraintLines: boolean; readonly shapeCvs: boolean; readonly humanoidLabels: boolean }   // Rig defaults: true, true, 'greyscale', false, true, true, false
export interface Prefs { …; readonly rigging: {
  readonly jointSize: number;                                  // 1.0
  readonly brush: BrushSettings;                               // replace, 1, 1, 40, smooth, surface, true; mirror follows skeleton symmetry
  readonly influenceSort: 'alpha' | 'hierarchy' | 'flat';      // 'hierarchy'
  readonly influenceColours: Readonly<Record<string, string>>; // by joint name
  readonly bindDefaults: Readonly<Record<string, ParamValues>>; // option boxes (as modeling.optionDefaults)
} }
// prefs.modeling.undoSelection gains `rig: true`.
// MarkingMenuDef.when.over: + 'joint' | 'control' (picked under the pointer at trigger time).
// UiDialog: + 'applyPoseAsRest' | 'unbindSkin'.
// ToolDef ids: 'jointTool', 'insertJoint', 'paintSkinWeights', 'shapeCv'.
```

Operator ids this UI calls (owners: the skeleton, skinning, constraint and shape notes; research 14 names kept):
`rig.mode`, `rig.pose.view`, `rig.pose.resetTest`, `skel.template.create`, `skel.quickRig.{start,setMarker,guess,fit,
commit}`, `skel.joint.{create,insert,move,delete,reparent,unparent,setHumanBone,setSide,rename,orient,mirror}`,
`skel.chain.add`, `skel.pose.applyAsRest`, `skin.bind`, `skin.unbind`, `skin.weights.{set,assign,rigidIslands,paint,
mirror,transfer,smooth,hammer,copyVertex,pasteVertex,prune,normalize,moveToInfluence}`, `skin.influences.removeUnused`,
`skin.influence.{walk,hold}`, `skin.paint.{mode,mirrorToggle}`, `skin.test.rom`, `skin.stale.markReviewed`,
`rig.constraint.{create,addTarget,removeTarget,setWeight,updateOffset,setEnabled,delete}`, `rig.shape.{set,setColor,
setLineWidth,transform,cvMode,mirror,copy,paste,sizeFromMesh,reset}`, `rig.autoRig.update`, `rig.animateOnly`; shipped:
`rig.addLimbIk`, `rig.setControlSize`, `rig.toggleSecondary`, `rig.ikFk.*`.

`data-testid` additions: `ws-tab-rig`; `status-rigmode-<mode>`, `status-poseview-<view>`, `status-brush-<field>`;
`rtk-panel`, `rtk-step-<n>`, `rtk-btn-<operatorId>`; `quickrig-step-<n>`, `quickrig-marker-<name>`;
`pw-panel`, `pw-influence-<jointId>`, `pw-hold-<jointId>`, `pw-op-<op>`, `pw-flood`; `ce-panel`, `ce-cell-<vertex>-<jointId>`,
`ce-hold-<jointId>`; `val-panel`, `val-row-<code>`, `val-select-<code>`, `val-fix-<code>`; `attr-joint-<field>`,
`attr-cns-<field>`, `attr-shape-<field>`; `mm-rig.*` via the generic ids; `hud-pose-<paneId>`.

---

## 22. Accessibility and responsiveness

- Mode switcher and pose view are radiogroups with key hints in names ("Skin mode, 2"); paint operation and mode are
  radiogroups; the influences list is an ARIA tree with lock buttons labelled "Hold leftUpperArm".
- Colour is never the only cue: joint sides also show a side chip in the Outliner and hover labels; weights have a
  numeric readout and the Component Editor; Validation rows carry ✕/⚠/ℹ glyphs and text; held influences show a lock
  glyph, not a tint.
- Keyboard-only path: Outliner → select joints/meshes → Skeleton/Skin menu operators → Component Editor cells for
  exact weights; painting itself needs a pointer (stated in the help).
- Live region announcements: "Bound body: 612 vertices, 33 influences", "Stroke: 14 vertices changed",
  "Validation: 1 error".
- `prefers-reduced-motion`: no marker pulse animation, no marking-menu animation.
- Width: ≥ 1280 px full layout; 1024–1279 px right dock 260 px, Toolkit icon-only, Paint Weights keeps the list,
  Outliner becomes a rail; below 1024 px Rig & Skin is view-only (test poses, Validation) with the research 09 §11.2
  banner.
- Pen and tablet (later): pressure → opacity, research 09 §11.3.

---

## 23. Collaboration affordances (M3 and later, designed now)

- Skeleton and skin edits take the exclusive `rig` claim for the character (research 14 R12); others see "Anna is
  rigging Lowpoly Lad" in the Outliner and the Rig tab tooltip; their Rig & Skin is read-only for that character
  except test poses and Validation.
- Holds, active influence, brush settings and test poses are per user and never shared; presence shows mode and pose
  view ("Anna · Rig · Skin · TEST POSE").
- The Last-op card of Bind Skin goes stale on a remote change to the skeleton or the mesh (M6A-SPEC §5.7 rule).

---

## 24. Build slice and acceptance

### 24.1 Packages (proposal for the M6b spec; sizes in agent-days, UI side only)

MODELING-PLAN §5.2 sizes C6 `rig-skin-ui` at 3 days for layout, Skin panel, joint list, Validation and glyph. The
widened scope splits the UI as follows; the kernel, solver, constraint-op and writer work is sized by the sibling notes.

| Package | Scope | Size | Depends on |
|---|---|---|---|
| C6a `rig-shell` | WorkspaceDef, modes and digits, pose view, status groups, layout presets, key scopes and §18 rows (stubs that poll-fail until owners land), menus §16, marking-menu data §17, Outliner Rig variant, joint overlay + display flags, Validation panel + glyph, setup checklist, empty states | 5 | C0; M6a B0b, B9 |
| C6b `skeleton-ui` | Joint tool, Insert Joint, `D`/symmetry/projected-centre interaction, Quick Rig stepper and markers, Orient/Mirror option boxes, Attributes › Joint/Skeleton, Channel Box rest/test rows | 3 (inside C1's 6) | C6a, C1 kernel |
| C6c `skin-ui` | Paint Weights panel, brush tool and keys, weight surface display modes, influence list with holds, Component Editor, utilities wiring, `U` menu, posed-mesh painting UI | 4 (inside C3's 6) | C6a, C3 kernel, M6a B6/B10/B12a |
| C8 `constraints` | constraint op registration (research 07 §7) + Constrain menu, option boxes, Outliner rows, Channel Box weights, Attributes › Constraint, constraint lines, Animate menu entries | ≈ 4 (UI ≈ 2) | C6a, rig compiler |
| C9 `control-shapes` | Shapes mode, library popover, colour, offset transforms, CV edit with conversion to custom, mirror/copy/paste/reset, `rig.autoRig.update` keeps overrides | ≈ 3 | C6a, C4 |

### 24.2 Acceptance scenarios (`E2E-RIG-UI-*`, Chrome; mouse and trackpad profiles)

1. **Turnkey checklist**: humanoid body from Model → Rig & Skin → ① Standard 33 (pre-fitted) → ② move the left knee in
   front view, the right follows (symmetry) → ③ Bind (Auto low-poly) → ④ Range of Motion plays → ⑤ paint a seeded
   bad shoulder vertex, mirror L → R → ⑥ control rig → ⑦ Animate shows IK legs; every step's glyph turns ✓ and the tab
   glyph turns ●.
2. **Modes and scopes**: `1`/`2`/`3` and `F8` switch modes; the active digit again returns to Object; `S` in every Rig
   scope creates no key (DOM adapter); `Mod+E` opens Export in Rig.
3. **Joint tool**: three clicks in front view with projected centre (joints within 0.01 H of the slab midpoints),
   MMB-drag moves the last one, `Backspace` removes it, `Enter` (or RMB) commits one undo step; `Esc` on a new chain leaves no
   step; symmetry creates the mirrored chain.
4. **Paint**: a Replace stroke fixes a seeded vertex; a held influence's weights stay bit-equal; one stroke = one undo
   step; a `U` flick to Smooth switches the operation without drawing the menu; `Shift+I`+click on the forearm
   makes `leftLowerArm` active; `I`+click samples its weight into Value.
5. **Component Editor**: typing `0.3` into a cell normalizes the row with holds respected; Prune `< 0.01` removes the
   seeded 0.004 weight; every row ≤ 4 influences.
6. **Pose view**: `E` on the elbow switches to Test; `W` on a joint then poll-fails "Go to Bind Pose to move joints";
   Bind ↔ Test restores the last test pose; leaving Rig clears it; Animate shows the clip frame.
7. **Constraint**: select `L Hand` then a secondary control, Constrain › Parent with Maintain Offset: the Outliner row
   appears under the driven control, Channel Box shows Blend and W0; moving the hand in Test moves the control;
   one undo removes the constraint; Animate's Rig › Constrain lists the same items.
8. **Shapes**: `3`, select `fk.upperArm.L`, Replace with square, colour custom, `R` scales the shape offset 1.5×,
   Mirror Shape L → R; the keys table is unchanged (count and hashes); undo restores.
9. **Validation**: remove `leftLowerArm` → `skel.required-bones` error, Export character blocked with the reason;
   *Fix: add from template* restores it in one step.
10. **Mac trackpad**: scenario 1 completes without F-keys and without a middle button (digits, RMB menus, the
    `Alt+Shift` stand-in for the Joint tool's MMB move).
11. **Budgets** (report, gate where research 14 sets one): brush ≤ 4 ms per pointer frame at 10k vertices; switching
    the active influence uploads 0 bytes; idle Rig workspace renders 0 frames.

---

## 25. Open questions for the owner

| ID | Question | Proposal |
|---|---|---|
| Q-RIG-UI-1 | Calibrate the rig marking-menu slots and the unverified Maya habits (Joint tool `Shift` 45°, `D` to move a joint without children) on a Maya install? | Yes, once, with Q-MOD-UI-1; until then provisional |
| Q-RIG-UI-2 | Digits `1`/`2`/`3` for Skeleton/Skin/Shapes in Rig & Skin (Model's rule, different meaning)? | Yes; RMB menu and switcher as alternatives |
| Q-RIG-UI-3 | A default key for the Joint tool (Maya has none)? | None: Shift+RMB N, `Y` last tool, palette; bindable |
| Q-RIG-UI-4 | Default layout `front │ persp` (R-Side) or Maya's four view? | R-Side; R-Quad one click away |
| Q-RIG-UI-5 | Weight display default: Maya greyscale, a colour-blind-safe ramp, or Blender's blue → red heat ramp (research 17 §11.3)? | Greyscale (Maya's *Color feedback*, no hue reading needed); Ramp, Influence colours and Numbers as options. The M6b spec picks one for both notes |
| Q-RIG-UI-6 | Clear the test pose when leaving Rig & Skin? | Yes; Bind ↔ Test inside Rig keeps it |
| Q-RIG-UI-7 | Constraints also in Animate (`Rig › Constrain ▸`)? | Yes, same operators |
| Q-RIG-UI-8 | Holds (influence locks) per user, not saved? | Yes (diverges from Maya's scene attribute; collaboration-safe) |
| Q-RIG-UI-9 | Joint rest moves after binding never move the mesh (no "drag skin" mode)? | Yes (bind = rest) |
| Q-RIG-UI-10 | Selection undo on in Rig & Skin? | Yes, as Model (research 17 Q-RIGB-5 asks the same) |
| Q-RIG-UI-11 | Paint keys: research 17 binds `I`+click to *sample weight*; this note also needs *pick the dominant influence under the pointer* (ngSkinTools' most requested viewport feature) | `I`+click = sample (as 17), **`Shift+I`+click** = pick the dominant influence, LMB on a joint glyph = active influence (as 17); Maya's `N` tap (pick-colour mode) is not used, `N`+drag stays Value |

---

## 26. Non-goals (and where each goes)

| Not in this workspace | Why | Where |
|---|---|---|
| Set driven keys, node editor, rig scripting | over-engineering for the turnkey low-poly loop | not planned |
| Blendshape (morph target) authoring, expressions UI | separate milestone (research 14 §12 "later") | after M6b |
| Muscle systems, deformer stacks, DQ skinning | glTF is linear-blend skinning with four influences | not planned |
| Skin layers (Maya 2027's integrated ngSkinTools) | non-destructive layers double the weight model; low-poly fixes are few | later, on demand |
| Interactive bind manipulators (Maya Interactive Skin Bind) | auto (low-poly) + paint cover the need | not planned |
| Scale constraint, space switching, spline IK, HumanIK | research 07 later; M5 space switching | later / M5 |
| Bake constraints to keys | needs the bake path for Animate | rest of M2c |
| Geodesic voxel binding | AI/polygon-soup meshes | M7 G2 (research 14 §5.5) |
| Spring-bone authoring, lookAt | VRM extensions beyond humanoid | after M6b |

---

## 27. Sources

Autodesk Maya documentation (fetched 2026-10-19)
- Skeleton menu: https://help.autodesk.com/cloudhelp/ENU/MayaCRE-CharacterAnimation/files/GUID-5A485049-D0BD-4BBB-BE08-C3D502F17483.htm
- Create a joint or joint chain (MMB moves the last joint, Snap to Projected Center): https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-142CB5D5-5609-4D23-B40E-F26FB08A55AB.htm
- Joint Tool settings (2024): https://help.autodesk.com/cloudhelp/2024/ENU/Maya-CharacterAnimation/files/GUID-4357347C-D00F-409F-8938-D0E81E54C8B8.htm
- Orient Joint Options: https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-29DF5D0F-1BDE-4464-850C-45769B3CF1CA.htm
- Mirror Joint (Mirror Across, function, replacement names): https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-B4004DD2-FB80-487A-BD2B-3A3757A0C2E9.htm ; `mirrorJoint`: https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Tech-Docs/CommandsPython/mirrorJoint.html
- Skin menu (2026; Rigid Bind removed, Go to Bind Pose, Move Skinned Joints, Move Weights to Influences): https://help.autodesk.com/cloudhelp/2026/ENU/Maya-CharacterAnimation/files/GUID-35ECFBC1-A65B-46AF-9542-213BD304C632.htm
- Paint Skin Weights Tool (influence list, locks, modes `Ctrl+<`/`Ctrl+>`, operations, normalization): https://help.autodesk.com/cloudhelp/2022/ENU/Maya-CharacterAnimation/files/GUID-99189E9D-237F-471E-A02C-BE6593B4828B.htm
- Paint skin weights (RMB a joint → Select Influence; MMB + arrows): https://help.autodesk.com/cloudhelp/2022/ENU/Maya-CharacterAnimation/files/GUID-7D773C38-F9CF-4141-8ADD-4E0454838BB7.htm
- Paint operation hotkeys (Artisan): https://download.autodesk.com/global/docs/maya2014/en_us/files/Paint_operation_hotkeys.htm
- Maya hotkeys (Return completes the tool, Insert tool edit mode, pick-walk): https://download.autodesk.com/us/maya/2011help/files/PC_Maya_Hotkeys.htm
- Parent constraint options: https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-093A13E1-5DF1-454B-B5D3-BCAA5427B51A.htm ; Create a parent constraint (selection order): https://help.autodesk.com/cloudhelp/ENU/MayaCRE-CharacterAnimation/files/GUID-2FC0EE9E-A8D5-4B2A-A751-8B926389497A.htm

Landscape
- CG Channel, "Autodesk releases Maya 2027 and Maya Creative 2027" (2026-03-25; ngSkinTools integrated, layers, masking, mirroring): https://www.cgchannel.com/2026/03/autodesk-releases-maya-2027-and-maya-creative-2027/
- Autodesk Marketplace, ngSkinTools 2 (IP acquired by Autodesk, effective 2025-05-15; hold S to pick the dominant influence): https://marketplace.autodesk.com/apps/e97508b4-58a2-43d0-a14b-0b7176b04065
- Blender manual 4.3, bone Viewport Display (custom shape transform, wire width; reference only, GPL code not used): https://docs.blender.org/manual/en/4.3/animation/armatures/bones/properties/display.html

Specifications
- VRM 1.0 humanoid (required bones, uniqueness, parent rules, positive scale): https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md
- Further glTF/VRM rules as cited in research 14 §5.1 and §9 (glTF 2.0 skins, VRM T-pose, meta).

Repository (read-only, this branch)
- `packages/doc/src/records.ts` (`ControlShape`, `ConstraintRecord`, `SolverRecord`, `SkeletonRecord`, `JointRecord`, `MeshRecord.skin`), `packages/editor-core/src/keymap/maya.ts` (shipped chords), `packages/editor-core/src/workspaces/index.ts` (`WORKSPACE.rig`), `packages/editor-core/src/types.ts` (`Selection`, `SelectionMask`, `DisplayFlags`), `packages/rig/src/autorig/shapes.ts`, `packages/anim-core/src/spline/index.ts` (shape registry), `packages/editor/src/panels/*` (shipped panels).
- Project documents: ARCHITECTURE §4.1, §10; MODELING-PLAN §2.1, §3.7, §3.10, §5; M6A-SPEC §4.2, §4.6, §5.17, §5.18, §7, §8; M2A-SPEC §5.5, §7; REQUIREMENTS FR-RIG-10, FR-RIG-13, FR-SHELL-08…11, FR-MOD-31…34; DECISIONS-OPEN §G; ADR 0013, 0016; research 07, 09, 14, 16.
