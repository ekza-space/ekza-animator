# 11 — Modeling UX: two reference DCCs for low-poly work, and what Ekza Studio adopts

> Research note for Ekza Animator. Date: 2026-10-18. Status: proposal for review.
> Versions checked: a popular open-source DCC, 5.2 LTS (2026-07-14) [B-52], called **the open-source DCC** below; a
> leading commercial desktop DCC, 2027 release (March 2026; 2027.1 May 2026) [M-2027], called **the desktop DCC**
> below; Blockbench 5.2.2 (2026-10-08) [BB-REL]. Reference products are named generically; Ekza is not affiliated with
> either DCC vendor.
> Scope: polygonal **low-poly box modeling** of game characters and props, and the hand-off to skinning
> and animation. Out of scope here: NURBS surfaces, sculpting, retopology, UV layout UX, booleans (mentioned only),
> the mesh data structure and kernel algorithms (owned by the modeling kernel note).
> Inputs: research [08](08-extensibility-modeling.md) (operators, tools, mesh constraints §9.8),
> [09](09-ui-ux-spec.md) (hotkeys §7, marking menus §7.3–7.4, browser-reserved chords §7.6),
> [ADR 0008](../adr/0008-operator-tool-editor-registries.md) (registries, two-phase operators, keymaps as data),
> [ADR 0013](../adr/0013-editor-history.md) (editor history). Sources are listed at the end as `[ID]`.

---

## 0. Decisions in one screen

| # | Decision | Evidence |
|---|---|---|
| D1 | **One paradigm: the desktop DCC's.** The default (and in the modeling iteration, only) preset keeps the desktop DCC's interaction model for modeling: component *selection modes* on a selected object (no separate Edit Mode wall), RMB / Shift+RMB / Ctrl+RMB marking menus, W/E/R manipulators, Channels, Alt navigation, industry-standard DCC hotkeys wherever the browser allows. | The animation side already follows the desktop DCC (09 §1, M1/M2a shipped); the project lead models in the desktop DCC; the open-source DCC's own *Industry Compatible* keymap converges on the same keys (1–3 component modes, Ctrl+E extrude, Ctrl+B bevel, B soft selection, W/E/R, double-click loop) [B-IC]; the desktop DCC already has native analogues of the open-source DCC's ideas we want (In-View Editor ≈ redo panel, `g` ≈ Shift+R) [M-IVE][M-HK14]. |
| D2 | **Adopt the open-source DCC's semantics, not its keys**: (a) Adjust Last Operation, (b) typed numbers during any modal interaction, (c) modal tools with live preview and clean cancel, (d) Mirror-modifier-style live symmetry, (e) Extrude Manifold, auto-merge, connected-only falloff, Select Similar criteria, smooth by angle, X-ray select-through. | These are where the open-source DCC is measurably faster for precise low-poly work [B-UNDO][B-NUM][B-EM][B-MIRROR][B-TS]; none needs an open-source-DCC hotkey. |
| D3 | **"Last Operation" HUD** = the desktop DCC's In-View Editor look and placement (pane corner, MMB-drag values, also shown as Channels panel INPUTS) with the open-source DCC's F9 semantics: undo the last step and re-run the operator with new args. Only the last operation is adjustable; there is no persistent construction history. | Open-source DCC: Adjust Last Operation [B-UNDO]; desktop DCC: In-View Editor [M-IVE][M-EXT]; Blockbench implements exactly "undo + re-run with the amended form" in a web stack (`Undo.amendEdit`) [BB-SRC]. |
| D4 | **Every modeling operator is a pure kernel call** `(mesh, componentSelection, args) → (mesh′, selection′)` registered as an operator with declarative `params`; tools are state machines that preview through the same kernel and commit with one `app.run(op, args)`. | ADR 0008 (operators compose through the edit kernel, never nested runs); prerequisite for D3, repeat-last, the operator log, scripting and the later AI/MCP bridge. |
| D5 | **`G` = Repeat Last** (`edit.repeatLast`). | The desktop DCC's `g` = Edit › Repeat [M-HK14]; the open-source DCC's equivalent is Shift+R [B-UNDO], which our keymap already uses for "key scale". |
| D6 | **Numeric input**: while a modeling tool's manipulator is live (right after Ctrl+E, during a drag, in the HUD), typed digits edit the primary value; Tab moves to the next field; Enter applies; Esc reverts. The 09 §6.4 expression grammar with units is always on (no simple/advanced split as in the open-source DCC). | Open-source DCC numeric input [B-NUM]; desktop-DCC numeric fields in Channels panel / In-View Editor [M-IVE]. |
| D7 | **Symmetry** = a status-line mode with the desktop DCC's semantics (Object/World axis, Topology via a seam edge) **plus** a per-mesh **live Mirror** with the open-source DCC's Mirror-modifier semantics (axis, merge distance, clipping, bisect), evaluated non-destructively and baked at export. | [M-SYM][B-MIRROR][B-TS]. |
| D8 | **No general modifier stack and no per-op construction history** in the modeling iteration. A small `MeshModifierDef` registry with two built-ins (mirror, smoothing); triangulate / weld / decimate later (needed for AI-generated meshes). | The desktop DCC has no modifier stack and its history is node-per-op [M-EXT]; the open-source DCC moved even Auto Smooth into a modifier in 4.1 [B-41]; meshes are coarse blobs for collaboration (08 §9.8). |
| D9 | **Low-poly shading defaults**: new meshes are faceted (flat); per-edge hard/soft flags plus an optional per-mesh smoothing angle (desktop-DCC Soften/Harden + Set Normal Angle ≈ open-source-DCC Mark Sharp + Smooth by Angle); the exporter splits vertices on hard edges. | [M-MM][B-SBA][B-41]. |
| D10 | **Keymap**: add a `mesh` scope (viewport with a mesh in a component mode) to the `dcc` preset; bind F8–F11 (desktop DCC) **and** `1`/`2`/`3` (industry convention, Mac-safe) for component modes; move Export off `Mod+E` so `Mod+E` can be the desktop DCC's Extrude. | [M-MT][M-HK14][B-IC]; 09 §7.5–7.6 (F-keys on Mac laptops, Ctrl+Tab reserved). |
| D11 | **An alternative keymap preset (open-source-DCC style) later (V1+)**, as a data pack over the *same* operator ids plus one modal transform operator used only by that preset (G/R/S with X/Y/Z); open-source-DCC navigation is a navigation profile, not a keymap. A preset is always complete — never a mix of two DCCs' keymaps. | Blockbench ships keymaps for both reference DCCs and Cinema 4D over one action registry [BB-KEYMAPS]; ADR 0008 §5. |
| D12 | **No code reuse** from the open-source DCC, LoopTools (GPL-2.0+), Blockbench (GPL-3.0); Plasticity, Spline, Womp, MagicaVoxel, Asset Forge, Crocotile 3D and Nomad Sculpt are proprietary. UX patterns only. | §10. |

---

## 1. Method

- "Low-poly" here means roughly 500–20k triangles per asset, quads and n-gons while editing, flat or angle-smoothed
  shading, vertex colours or a small atlas, skinned to a humanoid skeleton for Ekza profiles (OMOBA
  `humanoid-glb-v1`, Space `vrm-humanoid-v1`; research 03).
- The task list in §3 is one typical session: block out from a primitive, extrude limbs, add loops, cut details,
  bevel a few edges, mirror, weld, clean up, set hard edges, hand off to skinning.
- Facts come from vendor documentation and source code (cited). Several of the desktop DCC's help pages are from
  2016–2025 editions; behaviour that has not changed since is cited with its edition. Its current hotkey page on the
  vendor's site refused automated access, so hotkeys are taken from the vendor's versioned help.
- Where a claim could not be verified it is marked *unverified* and kept out of decisions.

---

## 2. The two paradigms in brief

### 2.1 The desktop DCC (2027 release)

- **Component selection modes**, not an edit mode: with an object selected, the upper half of the RMB marking menu
  switches vertex / edge / face / UV / vertex-face; "objects remain selected even when switching between object and
  component modes" [M-MM]. Hotkeys F8 (object ↔ component), F9 / F10 / F11 (vertex / edge / face), Alt+F9 (vertex
  face), F12 (UV), Ctrl+F9/F10/F11 (convert selection) [M-HK14]; Ctrl+Tab = multi-component mode in the modeling
  tools [M-MT].
- **Marking menus carry the modeling vocabulary**: Shift+RMB with a mesh selected lists the polygon tools (Target
  Weld, Fill Holes, Multi-Cut, Insert Edge Loop, Append to Polygon, Soften/Harden Edge, Extrude, Offset Edge Loop,
  Smooth, Mirror, Triangulate, Quadrangulate, Separate, Combine, Booleans, Reduce, Cleanup, Connect, Quad Draw…);
  Shift+RMB on empty space lists primitives; Ctrl+RMB lists selection conversions [M-MM].
- **Operations are history nodes**: Extrude creates a `polyExtrudeFace` node; the Show Manipulator tool (`T`) and
  the **In-View Editor** show its attributes (Thickness, Offset, Divisions…); "select an attribute and middle-drag",
  with Ctrl / Shift to slow down / speed up; the same attributes stay editable under INPUTS in the Channels panel until
  history is deleted [M-EXT][M-IVE]. Ctrl+E = Extrude; **Shift+drag the Move/Rotate/Scale manipulator = smart
  extrude** [M-EXT].
- **Modeling tools**: Multi-Cut (click to cut; Ctrl-click inserts an edge loop, Ctrl+MMB a centred loop,
  Ctrl+Shift-click snaps to the *Snap Step %*; MMB-drag slices; RMB completes; Esc cancels; `y` re-activates) [M-MC];
  Connect; Quad Draw; Target Weld (drag to merge, MMB-drag to merge at centre); tweak mode `` ` ``; soft select `b`;
  pivot editing `d`; snapping holds `x` (grid), `c` (curve), `v` (point) [M-MT].
- **Symmetry** is a global setting in the status line / tool settings: Object or World axis, or Topology (pick a
  seam edge); "the current Symmetry setting persists from one tool to another" [M-SYM].
- **Soft Select** `b`, falloff modes Volume / Surface / Global / Object; `b` + drag resizes [M-SOFT].
- Clean deletion: Edit Mesh › Delete Edge/Vertex, `Ctrl+Delete` / `Ctrl+Backspace`, removes winged vertices [M-DEL].
- Repeat last `g`, repeat at mouse Shift+G; grow / shrink `>` / `<`; smooth mesh preview `1` / `2` / `3` [M-HK14].
- **The 2027 release** adds Smart Bevel (2027.1 reduces artifacts on complex geometry) and integrates **ngSkinTools**
  for skinning [M-2027] — relevant because skinning is the hand-off this iteration must cover.
- The vendor's own hotkey reference warns that macOS Exposé keys (F9–F12) may conflict with the desktop DCC's hotkeys
  [M-HK14].

### 2.2 The open-source DCC (5.2 LTS)

- **Edit Mode** (Tab) is a data mode: the mesh becomes editable BMesh; 1 / 2 / 3 switch vertex / edge / face.
- **Modal operators**: G / R / S follow the pointer without a held button; X / Y / Z lock axes; **typed numbers**:
  simple mode (digits, `-` negates, `/` reciprocal, Backspace resets then cancels, Tab / Ctrl+Tab next component) and
  advanced mode (`=` or Numpad `*`: units such as cm, ", deg; Python operators and `math` functions) [B-NUM].
- Mesh tools: Extrude Region / **Extrude Manifold** ("enables Dissolve Orthogonal Edges by default… split and remove
  adjacent faces when extruding inwards") / Along Normals / Individual / To Cursor, Inset, Bevel, Loop Cut, Offset Edge
  Loop Cut, Knife, Bisect, Poly Build, Spin, Smooth, … [B-TB][B-EM]. Loop Cut (Ctrl+R) previews the loop, then
  slides; number of cuts in tool settings; the rest in Adjust Last Operation [B-LOOP]. Knife (K): click or drag cut
  points, double-click closes the loop, Space / Return applies, Esc cancels; options for occlusion, X-ray, length
  and angle measurements, angle snapping (screen or relative) [B-KNIFE].
- **Adjust Last Operation**: a HUD panel in the bottom-left after an operation, or F9 as a pop-up; changing a value
  re-executes the operator; **Repeat Last** Shift+R; Undo History list [B-UNDO].
- Edit-mode **Mirror** axes plus **Topology Mirror**; **Auto Merge** with a threshold and "Split Edges & Faces", which
  "affects interactive operations only (tweaks made in the Adjust Last Operation panel are considered interactive
  too)" [B-TS].
- **Mirror modifier**: axes, Bisect / Flip, Mirror Object, **Clipping**, Merge + Merge Distance, UV flip, vertex-group
  mirroring by `.L`/`.R` names [B-MIRROR].
- **Proportional editing** (O): falloff profiles, radius by wheel / PageUp/PageDown, **Connected Only** (Alt+O),
  Projected from View [B-PROP]. **Select Similar** (Shift+G) with per-mode criteria (normal, adjacent faces, edge
  length, direction…) [B-SIM]. **Snapping**: Ctrl to toggle temporarily, Snap Base (closest / center / median /
  active), Snap Target (increment, grid, vertex, edge, face project…), absolute increment [B-SNAP].
- **Smooth by Angle** modifier replaced the Auto Smooth option in 4.1 ("Shade Auto Smooth" adds it) [B-41][B-SBA].
- 5.0 (Nov 2025) added geometry-node-based modifiers (array with gizmos, scatter, curve to tube…) [B-50].
- **LoopTools** (Bridge, Circle, Curve, Flatten, Gstretch, Loft, Relax, Space) left the bundle after 4.1 and is a
  community extension, v4.7.7, GPL-2.0-or-later [B-LT].
- **Industry Compatible keymap** (shipped with the open-source DCC): 1–3 selection modes, 4 object mode, RMB context
  menu, Tab menu search, W / E / R, Alt+LMB/MMB/RMB navigation, F frame selected, A frame all, Ctrl+E extrude, Ctrl+B
  bevel, I inset, K knife, Alt+C loop cut, B proportional ("a.k.a. Soft Selection"), double-click loop, double
  Alt-click ring, Ctrl+L linked, Up/Down grow/shrink, S set key, Shift+W/E/R key translate/rotate/scale [B-IC].

---

## 3. Same low-poly tasks, side by side

`M` = desktop-DCC default kept · `M~` = desktop-DCC-inspired, adapted · `E` = Ekza addition. "From open-source DCC"
lists the semantics we borrow.

| # | Task | Desktop DCC (2027) | Open-source DCC (5.2) | Ekza default (`dcc` preset) | From open-source DCC |
|---|---|---|---|---|---|
| 1 | Enter a component mode | RMB menu top half; F8; F9/F10/F11 [M-MM][M-HK14] | Tab, then 1/2/3 | RMB menu (M); F8–F11 (M); `1`/`2`/`3` alias (E, §8) | — |
| 2 | Multi-component selection | modeling tools: Ctrl+Tab [M-MT] | Shift+1/2/3 combine modes | RMB menu "Multi" only (Ctrl+Tab is browser-reserved, 09 §7.6) | — |
| 3 | Loop / ring | double-click edge = loop; ring via Ctrl+RMB conversion | Alt+click / Ctrl+Alt+click | double-click loop, Shift+double-click adds (M); ring in the Ctrl+RMB menu (M) | — |
| 4 | Grow, shrink, shell, similar | `>` `<`; Ctrl+RMB › To Shell; RMB › Select Similar [M-MM] | Ctrl+Num±; L / Ctrl+L; Shift+G [B-SIM] | Shift+. / Shift+, (M); To Shell; Select Similar | per-mode Similar criteria |
| 5 | Extrude | Ctrl+E → manipulator + In-View Editor; Shift+drag manipulator = smart extrude [M-EXT] | E (region, follows normal), Extrude Manifold [B-EM] | `Mod+E` + Shift+drag (M); HUD with armed Thickness; option *Dissolve orthogonal* | Extrude Manifold; typed value |
| 6 | Inset | Extrude Offset with Thickness 0 | I (again = individual) | `mesh.inset` in the Shift+RMB menu; same kernel as extrude offset | separate, discoverable op |
| 7 | Insert edge loop | Multi-Cut Ctrl-click / Ctrl+MMB centre / Ctrl+Shift snap step % [M-MC] | Ctrl+R, slide, cuts count [B-LOOP] | Multi-Cut with Ctrl (M); count, even, flip, slide in the HUD | count + even in the redo HUD |
| 8 | Knife / cut | Multi-Cut points, RMB completes [M-MC] | K; angle snap; measurements [B-KNIFE] | Multi-Cut (M) + optional angle snap and length read-out | angle snap, measurements |
| 9 | Bevel | Edit Mesh › Bevel; In-View Editor Fraction / Segments; 2027 Smart Bevel [M-2027] | Ctrl+B modal; wheel = segments | `Mod+B` (M~, see Q3) + HUD Fraction / Segments | typed value |
| 10 | Bridge, fill, append | Bridge; Fill Hole; Append to Polygon [M-MM] | Bridge Edge Loops; F; Grid Fill | menu + Shift+RMB menu (M) | — |
| 11 | Merge / weld | Merge (threshold); Merge to Center; Target Weld [M-MT] | M menu; Auto Merge; Merge by Distance [B-TS] | Target Weld tool (M) + merge ops; **Auto-weld** toggle, off by default | Auto Merge |
| 12 | Delete cleanly | Ctrl+Delete = Delete Edge/Vertex [M-DEL] | Dissolve (Ctrl+X) | `Delete` (M); `Mod+Delete` / `Mod+Backspace` (M) | — |
| 13 | Symmetric editing | Symmetry Object / World / Topology [M-SYM] | mirror axes + Topology Mirror [B-TS] | Symmetry mode in the status line (M) | — |
| 14 | Half-model workflow | instance-mirror by hand; Mesh › Mirror bakes | Mirror modifier with clipping / merge [B-MIRROR] | per-mesh **live Mirror** (Attributes), baked at export | modifier semantics |
| 15 | Soft selection | `b`; Volume / Surface / Global / Object [M-SOFT] | O; profiles; Connected Only [B-PROP] | `B` (M); desktop-DCC mode names; *Surface* = connected only | falloff profiles |
| 16 | Snapping | hold `x` grid / `c` curve / `v` point [M-MT] | Ctrl; snap base / target [B-SNAP] | hold `X` / `V` (M); `J` increment (09) | snap-base choice (later) |
| 17 | Pivot | `d` / Insert [M-MT] | 3D cursor, pivot point | hold `D` (M); **no 3D cursor** | — |
| 18 | Hard / soft edges | Soften/Harden Edge; Set Normal Angle [M-MM] | Mark Sharp; Shade Flat / Smooth / Auto Smooth [B-SBA] | per-edge hard flag + per-mesh angle; faceted by default | smoothing as a live built-in |
| 19 | X-ray | Shading › X-Ray; camera-based selection | Alt+Z also selects through | `Alt+X` (exists) also enables select-through in component modes | select-through |
| 20 | Adjust after the fact | history node in the In-View Editor / INPUTS until Delete History [M-IVE] | Adjust Last Operation until the next operation [B-UNDO] | **Last Operation HUD**, last operation only (§6.2) | redo semantics |
| 21 | Repeat | `g` [M-HK14] | Shift+R [B-UNDO] | `G` (M) | — |
| 22 | Exact numbers | Channels, In-View Editor fields | type during the modal [B-NUM] | armed HUD field + digits during drags (§6.4) | typed input |
| 23 | Find a command | search / Find Menu | F3 | `Mod+K` palette (exists) with names used by other DCCs as aliases | aliases |
| 24 | Primitives | Shift+RMB on empty; attributes editable | Add menu + redo panel | Shift+RMB on empty (M); size / subdivisions in the HUD | — |
| 25 | Separate / combine | Separate / Combine [M-MM] | P / Ctrl+J | Separate / Combine (M), menu only | — |
| 26 | Non-destructive | history + Smooth Mesh Preview | modifier stack | live Mirror + smoothing only (D8) | — |

---

## 4. Where each paradigm wins for low-poly work

| Criterion | Winner | Why it matters here |
|---|---|---|
| Precise values fast | **Open-source DCC** | `E 0.2 ↵` and the redo panel beat clicking an In-View Editor field; low-poly is dimension-driven (thicknesses, bevel widths, loop positions). |
| Changing your mind | Desktop DCC ≈ open-source DCC | The desktop DCC keeps history until deleted (any op, any time, order-fragile); the open-source DCC keeps only the last op. For low-poly the last op covers most corrections; full history is expensive (§7). |
| Discoverability | **Desktop DCC** | Context marking menus put the whole poly vocabulary one gesture away (Shift+RMB) [M-MM]; the open-source DCC's equivalents are spread across Tab-mode menus and pies. |
| Half-model symmetry | **Open-source DCC** | A live mirror with clipping removes the "re-mirror, re-merge the seam" ritual. |
| Consistency with our animation side | **Desktop DCC** | `S` is Set Key, `R` the scale tool, RMB a marking menu, Alt the camera. Open-source-DCC keys would redefine all four inside one app. |
| Browser fit | **Open-source DCC** | Modal ops need no held button, no F-keys; the desktop DCC's F9–F12 and Ctrl+Tab fail on macOS / in browsers [M-HK14] (09 §7.6). Mitigated by RMB menus and digit aliases. |
| Breadth of potential users | **Open-source DCC** | Many indie low-poly artists learn the open-source DCC first; its 2024 user survey shows the desktop DCC and another commercial DCC from the same vendor as the most common *second* tools of its users [SURVEY]. An open-source-DCC-style preset matters for adoption — later. |

---

## 5. Recommendation

**Keep the desktop DCC's interaction model; take the open-source DCC's semantic upgrades; ship an open-source-DCC-style
keymap later as data.**

1. The editor is one product with Animate and Model workspaces. A second paradigm in the Model workspace would give
   the same keys two meanings (`S`, `R`, `G`, RMB, wheel, `1`–`3`) and double the onboarding and test matrix.
2. The things that make the open-source DCC fast are **semantics** — adjust-last, typed numbers, previewing modal
   tools, live mirror — and each has a desktop-DCC-native surface to live on: the In-View Editor, Channels panel INPUTS,
   manipulators and the Symmetry setting. Desktop-DCC users get the open-source DCC's speed without changing habits.
3. Industry evidence: the open-source DCC ships a desktop-DCC-like *Industry Compatible* keymap [B-IC]; Blockbench,
   the most relevant web low-poly editor, ships keymaps for both reference DCCs and Cinema 4D over one action set
   [BB-KEYMAPS]. The durable design is "one operator set, several keymaps", not "two interaction models".
4. Our registries already fit (ADR 0008): keymaps are data on `KeyboardEvent.code`; navigation is a separate
   profile; every surface calls operators. The open-source-DCC-style preset is an additive data pack plus one modal
   transform operator.

---

## 6. Open-source-DCC ideas mapped onto the operator registry

### 6.1 Contract additions (`editor-core`, backwards compatible)

```ts
/** Declarative parameter list: drives the Last Operation HUD, Channels panel INPUTS, palette prompts,
 *  the operator log and (V1) the JSON schema for scripting and agents. */
interface ParamDef<A> {
  readonly key: keyof A & string;
  readonly label: string;
  readonly kind: 'number' | 'int' | 'distance' | 'angle' | 'percent' | 'bool' | 'enum' | 'axis';
  readonly min?: number; readonly max?: number;          // hard limits
  readonly softMin?: number; readonly softMax?: number;  // virtual-slider range
  readonly step?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly primary?: boolean;                            // the field typed digits go to (one per operator)
}
interface OperatorDef<A, R, P> {
  // …existing fields (ADR 0008)…
  readonly params?: readonly ParamDef<A>[];
  readonly flags?: {
    // …undo, internal, structural…
    readonly adjustable?: boolean;   // may be re-run through edit.adjustLast
    readonly repeatable?: boolean;   // may be re-run through edit.repeatLast
  };
}
/** Session (U) state, per user: the last finished run of an adjustable or repeatable operator. */
interface LastRun {
  readonly id: OperatorId;
  readonly args: unknown;            // final args, including everything the pointer contributed
  readonly stepId: string;           // EditorHistory step the run created
  readonly docSeqAfter: number;      // store sequence right after the run
  readonly paneId: string | null;
}
```

Rules:

- **Args carry everything.** A tool that commits after pointer interaction folds the pointer's contribution into
  args (extrude thickness, cut points as `{ faceOrEdge, t }`, loop edge + slide fraction). Re-running with the same
  args on the same pre-state yields the same mesh hash (kernel conformance test).
- Kernel functions live in a headless mesh package and are called by tools (preview) and operators (commit) alike,
  exactly like the animation edit kernel (ADR 0008 §1).

### 6.2 Adjust Last Operation → `edit.adjustLast { args: Partial<A> }`

- **Poll**: `lastRun` exists, its `stepId` is still the top of `EditorHistory`, the store sequence still equals
  `docSeqAfter` (no local or remote write since), the operator is `adjustable`. Otherwise the HUD greys out with the
  reason ("The mesh changed since Extrude").
- **Apply as a dispatcher** (allowed in `prepare` by ADR 0008 §1): `app.run('edit.undo')`, then
  `app.run(lastRun.id, { ...lastRun.args, ...patch })`. The undo moves the old step to redo; the new step clears redo
  (ADR 0013 §2). Net effect: the step is replaced and the history length is unchanged — the open-source DCC's redo
  panel and Blockbench's `Undo.undo(); runEdit(amended)` guarded by "the edit is still on top" [BB-SRC].
- **Live scrubbing without document writes**: dragging a HUD value is a gesture. Each pointer move runs the kernel on
  the pre-op mesh (kept by hash in `LastRun`) into the viewport preview overlay; release performs one undo + re-run.
  This keeps "one gesture = one step" and, under collaboration, one CRDT write per release (08 §5.1, 06).
- **Invalidation**: any new history step, undo/redo, component-selection change, mode or workspace switch, file
  open, or a remote change to the same mesh record hides the HUD.
- **Surfaces**: the HUD sits in the pane's lower-left corner, titled with the operator label; fields from `params`;
  MMB-drag anywhere on a row = the M2a virtual slider (`prefs.virtualSlider`), Ctrl slower / Shift faster as in the
  desktop DCC's In-View Editor [M-IVE]; values accept the 09 §6.4 grammar. The same fields appear under **INPUTS** in
  the Channels panel, where desktop-DCC users look for them. `T` toggles the HUD (the desktop DCC's Show Manipulator
  hotkey). Undo label: "Extrude (adjusted)".
- **Not** construction history in the desktop DCC's sense: once another operation runs, earlier ones are baked.
  Parametric *generators* (primitives, and later sweep/loft from 08 §9.6) keep their own params on their record until
  frozen, which covers the main reason desktop-DCC users keep history.

### 6.3 Repeat Last → `edit.repeatLast` (`G`)

Re-runs the last `repeatable` operator with its args on the current selection (the desktop DCC's `g`, the
open-source DCC's Shift+R). File, view, UI and selection operators are not repeatable. The help line shows "G: Repeat
Extrude". *Refined (MODELING-PLAN v0.2 §3.4): arguments bound to pointer picks (`{edge, t}` cut points, weld pairs)
are dropped and targets come from the current selection; tool-only operators (Multi-Cut, Target Weld, Slide) are not
repeatable and `G` re-activates the tool, like `Y`.*

### 6.4 Numeric input

- *Superseded (MODELING-PLAN v0.2 §3.4, Q-MOD-UI-8): the window below was too wide — with the extrude manipulator
  kept up after the operation (desktop-DCC convention) it covered most of a session and turned `3` (leave face mode)
  into "3 m of thickness". Capture is now armed only during a drag and right after a keyboard-invoked operator until
  the first pointer move, click or non-numeric key (`Mod+E`, `0`, `.`, `2`, `↵` still extrudes 0.2 m); `T` opens the
  card with the primary field focused; preference `numericCapture: 'auto' | 'explicit'`.*
- ~~**Armed primary field**: while an adjustable operator's manipulator is live (from the run until the user switches
  tool, clicks empty space or changes selection), a digit, `-`, `.` or `=` over the viewport starts editing the
  `primary` field of the HUD — `Mod+E`, `0`, `.`, `2`, `↵` extrudes 0.2 m. Tab / Shift+Tab move between fields; Enter
  applies through `edit.adjustLast`; Esc restores; Backspace edits. While armed, digits never trigger hotkeys (`1`–`3`
  modes, `4`–`7` display); the typed buffer is visible in the HUD and the help line. Preference
  `numericCapture: 'afterOp' | 'off'` (default `afterOp`).~~
- **During a drag** (manipulator, tool handle, HUD virtual slider): digits replace the dragged amount; Enter commits
  and ends the gesture; Esc cancels the gesture.
- **Grammar**: 09 §6.4 plus units `mm cm m` and `deg rad`, scene units by default. No simple/advanced split as in the
  open-source DCC: `-` and `/` keep arithmetic meaning.
- **Axis constraints** stay desktop-DCC-style in the `dcc` preset (manipulator handles; Shift-drag dominant axis,
  09 §6.2), because `X`/`C`/`V` are the desktop DCC's snap holds. The open-source-DCC-style preset maps X/Y/Z.

### 6.5 Modal tool contract

- Tools (`ToolDef`, ADR 0008 §3) are state machines: `idle → hover-preview → placing/dragging → confirm | cancel`.
  Preview = kernel into the overlay; commit = one `app.run(op, args)`; Esc cancels with no history step.
- **RMB never cancels** (it completes Multi-Cut and opens marking menus, as in the desktop DCC [M-MC]); Esc cancels.
- The wheel stays camera dolly (desktop-DCC convention). Counts (loop cuts, bevel segments) are HUD params, and
  **PageUp / PageDown** step them inside a tool (the desktop DCC uses these keys for smooth-preview division levels
  [M-HK14]; the open-source DCC accepts PageUp/PageDown for proportional radius [B-PROP]).
- Every tool shows its keys in the help line (the open-source DCC shows modal keys in the status bar [B-KNIFE]).

### 6.6 Symmetry and live mirror

- **Symmetry mode** (status line, desktop-DCC semantics [M-SYM]): Off · Object X/Y/Z · World X/Y/Z · Topology (pick a
  seam edge). Move, soft select, extrude, cut, bevel, weld and delete act on counterparts. Counterparts come from
  positions within a tolerance, or from a breadth-first walk from the seam edge; unmatched vertices are highlighted
  with a warning (the open-source DCC documents the same failure mode for position-based mirror [B-TS]).
- **Live Mirror** (per mesh, the open-source DCC's Mirror-modifier semantics [B-MIRROR]):
  `{ axis, mergeDistance, clip, bisect }`. The authored half is the data; the evaluated mesh is half + reflection,
  welded on the plane; clipping pins plane vertices. Export bakes it. Skin weights mirror through the humanoid L/R
  bone mapping the animation side already uses for Mirror Pose — stronger than the open-source DCC's name-suffix rule.
- Default: live Mirror for new character meshes; Symmetry mode for imported or AI-generated meshes that are already
  whole.

### 6.7 Other open-source-DCC ideas, with the desktop-DCC-facing name we use

| Open-source DCC idea | Ekza surface (desktop-DCC vocabulary) | Phase |
|---|---|---|
| Extrude Manifold [B-EM] | Extrude option *Dissolve orthogonal faces* (on when extruding inward) | modeling v1 |
| Auto Merge [B-TS] | status-line **Auto-weld** toggle + threshold; "Split edges & faces" later | v1 |
| Proportional *Connected Only* [B-PROP] | Soft Select falloff **Surface** (the desktop DCC's name for the same idea [M-SOFT]) | v1 |
| Select Similar criteria [B-SIM] | RMB › Select Similar with per-mode criteria + threshold in the HUD | v1 |
| Smooth by Angle [B-SBA] | per-mesh *Smoothing angle* built-in + Harden/Soften Edge | v1 |
| X-ray select-through | `Alt+X` also selects occluded components | v1 |
| Knife angle snap + measurements [B-KNIFE] | Multi-Cut options | v1.x |
| Undo History list [B-UNDO] | History panel (already planned, ADR 0013) | V1 |
| LoopTools Circle / Space / Relax / Flatten [B-LT] | Edit Mesh › *Make Circular*, *Space Evenly*, *Relax*, *Flatten* (patterns only, GPL) | later |
| Interactive "Add" tools | primitive drag-placement on the grid | later |
| Edge Split modifier | not needed: the exporter splits hard edges | — |

### 6.8 Minimal mesh-modifier registry

```ts
interface MeshModifierDef<P> {
  readonly kind: string;                                   // 'mirror' | 'smoothing' | later 'weld' | 'triangulate' | 'decimate'
  readonly params: readonly ParamDef<P>[];
  evaluate(mesh: MeshData, params: P): MeshData;           // pure, headless
  readonly bakeOnExport: true;
}
```

Shown as a short fixed list in the Attributes panel, not a reorderable stack. Registered like the other registries
(ADR 0008 §6), so a later decimate/triangulate pass for AI-generated meshes is a registration, not a core change.

---

## 7. What to avoid: two competing paradigms

| Concept | Desktop DCC meaning | Open-source DCC meaning | Ekza `dcc` preset |
|---|---|---|---|
| `G` | repeat last | grab (modal move) | repeat last |
| `S` | set key | scale (modal) | set key |
| `R` | scale tool | rotate (modal) | scale tool |
| RMB | marking menu | context menu; cancels a modal | marking menu; **Esc** cancels |
| `Tab` | — (its modeling tools use Ctrl+Tab) | toggle Edit Mode | unbound in the viewport (keyboard focus, WCAG "no keyboard trap") |
| Alt+LMB | tumble | loop select | tumble; loop = double-click |
| `X` / `C` / `V` | snap holds | axis lock (X), select tools | snap holds |
| `1`–`3` | smooth mesh preview | selection modes | selection modes (no subdivision preview in low-poly scope) |
| `B` | soft select | box select | soft select (viewport); break tangents (Graph Editor scope) |
| Wheel inside a tool | dolly | cut count / segments | dolly; counts via HUD and PageUp/PageDown |
| Mode concept | component selection mode | Edit Mode (data mode) | component selection mode; any internal edit-structure conversion is invisible |
| 3D cursor | — | pivot and add target | none; `D` pivot editing |
| Non-destructive | history nodes | modifier stack | last-op adjust + two built-in modifiers |

Also avoid:

- **Per-workspace keymaps that redefine keys.** The `mesh` scope activates only while a mesh is in a component mode;
  the Model workspace does not change what `S`, `W/E/R`, `Q` or Space mean.
- **Binding open-source-DCC chords "too" inside the `dcc` preset** (e.g. both `G` and Shift+R for repeat): Shift+R is
  already Key Scale; duplicates become conflicts the day the open-source-DCC-style preset ships.
- **Open-source-DCC terms in labels.** Menus use the desktop DCC's names (Multi-Cut, Insert Edge Loop, Target Weld,
  Soft Select, Harden Edge). The command palette indexes names used by other DCCs as search aliases (Loop Cut, Knife,
  Proportional Editing, Mark Sharp, Adjust Last Operation, Auto Merge) so users coming from the open-source DCC still
  find them.
- **Full construction history** (node per op, Delete History ritual): heavy for the record store, awkward for
  per-user undo and coarse mesh blobs in collaboration (08 §9.8, 06).
- **A general modifier stack UI** before there are more than two modifiers.

---

## 8. Keymap additions to the `dcc` preset

New scope **`mesh`**: the viewport while its active object is a mesh in a component mode. Resolution order:
`mesh → viewport → global` (`KeymapManager.resolve` already takes most-specific-first scopes).

| Action | Operator (proposed id) | Chord | Scope | Origin | Notes |
|---|---|---|---|---|---|
| Object ↔ component | `mesh.selectMode { mode: 'toggle' }` | `F8` | viewport | M | `fn+F8` on Mac laptops |
| Vertex / edge / face mode | `mesh.selectMode { mode }` | `F9` / `F10` / `F11` | viewport | M | macOS maps F11 to Show Desktop by default; the vendor warns F9–F12 conflict on macOS [M-HK14] |
| Vertex / edge / face (alias) | same | `1` / `2` / `3`; the active mode's key again → object mode | viewport, mesh selected | E | industry convention [B-IC]; Plasticity uses 1–4 the same way [PLAS]; Q1 |
| Convert selection | `mesh.select.convert { to }` | `Mod+F9` / `Mod+F10` / `Mod+F11`; Ctrl+RMB menu | mesh | M | [M-HK14][M-MM] |
| Component / tools / convert menus | `ui.markingMenu` | RMB · Shift+RMB · Ctrl+RMB | viewport / mesh | M | 09 §7.4 geometry; Mac one-button: Ctrl+click is RMB (nav profile `oneButton`) |
| Extrude | `mesh.extrude` | `Mod+E` | mesh | M | shadows Export in this scope; move Export (Q2) |
| Smart extrude | move tool | Shift+drag manipulator | mesh | M | [M-EXT] |
| Bevel | `mesh.bevel` | `Mod+B` | mesh | M~ | open-source DCC Industry Compatible [B-IC]; desktop-DCC default *unverified*; Firefox binds Ctrl+B to bookmarks — verify `preventDefault` in the QA matrix (Q3) |
| Multi-Cut | `view.tool { tool: 'multiCut' }` | Shift+RMB slot; `Y` re-activates last tool | mesh | M | [M-MC] |
| Delete components | `mesh.delete` | `Delete`, `Backspace` | mesh | M | outranks `key.deleteAtFrame` only in this scope |
| Delete edge/vertex cleanly | `mesh.deleteEdgeVertex` | `Mod+Delete`, `Mod+Backspace` | mesh | M | [M-DEL] |
| Grow / shrink | `mesh.select.grow` / `.shrink` | `Shift+Period` / `Shift+Comma` | mesh | M | `>` / `<` on US layouts; plain `,` `.` stay prev/next key |
| Loop select | select tool | double-click; Shift+double-click adds | mesh | M | |
| Soft select | `mesh.softSelect.toggle`; `B`+drag radius | `B` | mesh | M | [M-SOFT] |
| Snap holds | — | `X` grid, `V` point | viewport | M | `J` increment snap (09) stays |
| Pivot edit hold | — | `D` | viewport | M | [M-MT] |
| Repeat last | `edit.repeatLast` | `G` | global | M | [M-HK14] |
| Last Operation HUD | `view.lastOpHud.toggle` | `T` | viewport | M~ | the desktop DCC's `T` = Show Manipulator [M-IVE] |
| Hide / show / hide unselected faces | `mesh.hide` / `.reveal` | `H` / `Shift+H` / `Alt+H` | mesh | M~ | as 09 §7.2 for objects |
| Frame components | `view.frame` | `F` | mesh | M | |
| Tweak mode | — | `` ` `` (Backquote) | mesh | M | low priority; key position varies by layout |

Never bound: Ctrl+Tab (multi-component; browser tab switch), `Mod+1…9` (tabs), Alt+digits on Linux Chrome (09 §7.6).

Contract changes: `KeymapManager.preset` widens from the literal `'dcc'` to a registered preset id; `mesh` joins the
scopes; the keymap conformance test also checks the `mesh` scope against the reserved-chord list. Export moves to
**File menu + palette + `Mod+Shift+E`** (Firefox opens the Network Monitor on Ctrl+Shift+E; Chromium is primary,
verify in the QA matrix) — Q2.

---

## 9. Keymap preset strategy

1. **`dcc`** stays the default and grows the `mesh` scope above.
2. **An alternative keymap preset (open-source-DCC style)** (V1 or later, Q7) is a data pack: a complete binding table
   over the same operator ids. The only code specific to it is `transform.modal` (G/R/S without a held button, X/Y/Z
   and Shift+axis planes, typed values through §6.4). Tab toggles component mode *in that preset only*; LMB select
   with RMB context menu. Its camera controls (MMB orbit, Shift+MMB pan, wheel zoom, numpad views) are a **navigation
   profile** (`NavProfile`), per ADR 0008 §5.
3. **No hybrid presets.** A preset is complete; user overrides are a diff on top (as today). The HUD, adjust-last,
   numeric input and symmetry behave identically under every preset.
4. **Conformance per preset**: every `core` operator has a binding or a menu path; no conflicts within a scope; no
   reserved chords; every binding names a registered operator; the cheat sheet (`?`) and palette show the active
   preset's chords.
5. **Precedent**: the open-source DCC's Industry Compatible keymap [B-IC]; Blockbench's `keymaps/*.bbkeymap` files,
   one each for both reference DCCs and Cinema 4D [BB-KEYMAPS]. Note Blockbench stores legacy `keyCode` numbers; ours
   stay on `KeyboardEvent.code` (ADR 0008).

---

## 10. Web and indie tools: what to learn, what can be reused

| Tool (version) | What it is | Licence / price (2026-10) | UX ideas worth taking | Code reuse |
|---|---|---|---|---|
| **Blockbench** 5.2.2 [BB-REL] | "A low poly 3D model editor" (web app + Electron) with meshes, splines, **armatures + Weight Brush + automatic weights** (5.0), Mirror Animating (5.1), IK with armatures, even loop cut, more primitives (5.2), glTF export | **GPL-3.0**, free [BB-REPO] | Closest product to this iteration. Amend-edit panel = adjust last [BB-SRC]; a mesh op set that is enough for low-poly: extrude (Shift+E), inset (Shift+I), loop cut (Shift+R), merge vertices (Shift+M), create face (Shift+F), solidify, knife tool, split, dissolve edges, invert face, mirror modeling, proportional editing, vertex snap; auto-weights then paint; keymap presets | **No** — GPL-3.0 cannot enter an MIT codebase; read for patterns only |
| **Plasticity** | NURBS/Parasolid "CAD for artists" (not poly) | proprietary, perpetual; Indie $149 / Studio $299 with 12 months of updates per vendor docs (third-party listings show $175) [PLAS-LIC] | 1–4 selection modes (control point / edge / face / body), command palette [PLAS]; proof that an open-source-DCC-style fast modal UX works for hard-surface | No |
| **Spline** (spline.design) | browser 3D design tool; **V2 (2026-08-20)** rebuilt around an AI agent that edits objects, booleans, paths…; MCP server for external coding agents; WebGPU renderer; AI 3D generation is a paid feature [SPL-V2][SPL-AI] | proprietary SaaS | The agent edits through the same operations as the UI — validates our operator registry → MCP bridge; generated meshes enter as ordinary assets | No |
| **Womp** | browser SDF/CSG "Goop" modeling, smooth blends | proprietary freemium [WOMP] | One "blend" slider as the whole UI of a boolean; not polygonal | No |
| **MagicaVoxel** | voxel editor + path tracer | freeware, proprietary (free for commercial use per third parties) [MV] | Palette-first colour discipline → a vertex-colour / palette workflow for low-poly | No |
| **Asset Forge** 2.5.x (Kenney) | kit-bashing from block libraries; exports OBJ/FBX/DAE/STL/glTF | commercial, from $19 [AF] | Block library + snapping as a fast prop path; later a "kit" prefab library on top of primitives | No |
| **Crocotile 3D** 2.4.x | tile-based low-poly modeling with pixel-art tilesets; glTF/GLB export | commercial, $29.99 on Steam; limited free trial [CROC] | "Paint tiles onto faces" = UV assignment by painting from an atlas; idea for later texturing | No |
| **Nomad Sculpt** | mobile/desktop sculpting | $19.99 mobile; desktop in public beta; web version for testing only [NOMAD] | Out of scope (sculpting); touch/pen gesture ideas for 09 §11.3 | No |

Takeaways: Blockbench validates the whole scope (box modeling → armature → weights → animation → glTF in one
web-delivered tool) and the adjust-last mechanism, and confirms keymap presets as data. Spline V2 shows where the
market is going for the later AI step: agents and generators drive the same operations users do.

---

## 11. UX items to carry into the modeling plan and TODO

Must-have for the modeling iteration:

1. Component modes (vertex / edge / face, object toggle), the three marking menus, the `mesh` keymap scope (§8),
   wireframe-on-shaded cage in component modes, component pick-walk with the arrows (the desktop DCC walks loops and
   rings).
2. `params` on operators, `LastRun`, `edit.adjustLast` with gesture preview, `edit.repeatLast`, the Last Operation HUD
   and Channels panel INPUTS (§6.1–6.3).
3. Numeric capture after an op and during drags (§6.4).
4. Tools on the modal contract (§6.5): extrude manipulator with smart extrude, Multi-Cut (cut, Ctrl edge loop, snap
   step), bevel, inset, Target Weld, soft select, Symmetry mode, live Mirror, Auto-weld.
5. Low-poly shading: faceted default, Harden/Soften Edge, smoothing angle; exporter splits hard edges (D9).
6. Palette aliases with names used by other DCCs (§7).

Later: the open-source-DCC-style preset (§9); Multi-Cut angle snap and measurements; LoopTools-style Make Circular /
Space Evenly / Relax / Flatten; Quad Draw (also the natural clean-up tool for AI-generated meshes); interactive
primitive placement; tweak mode; multi-component mode.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Armed numeric capture steals digits (a user presses `4` for wireframe right after an extrude) | *Revised (MODELING-PLAN v0.2 §3.4):* capture only during a drag or right after a keyboard-invoked operator until the first pointer move, click or non-numeric key; `T` as the explicit opener; typed buffer visible in the HUD; Esc; preference `numericCapture: 'explicit'`. |
| F-keys unusable on many Mac laptops | RMB marking menu first; `1`/`2`/`3` aliases. |
| Adjust-last after a remote edit to the same mesh | Poll compares the store sequence; HUD greys out with the reason. |
| Non-deterministic kernel ops break adjust/repeat | Kernel conformance: same pre-state + args → same mesh hash; args include all pointer-derived data. |
| Users of the open-source DCC expect G/R/S | Palette aliases, a "Coming from another DCC" cheat sheet, the open-source-DCC-style preset later. |
| `Mod+E` changes from Export to Extrude in the viewport | Only in the `mesh` scope; Export gets `Mod+Shift+E`; changelog note (alpha user base is small). |
| Ctrl+RMB on macOS (Ctrl-click is the secondary click) | Treat `button === 2 && ctrlKey` as Ctrl+RMB; the one-button navigation profile documents the gesture. |
| Firefox reserves some chords used here (Ctrl+B, Ctrl+Shift+E) | Chromium is the supported target; add them to the per-release QA matrix (as 09 §7.6 does for Alt+letters). |

---

## 13. Open questions for the owner

1. **Q1** `1`/`2`/`3` as component-mode aliases in the `dcc` preset (pressing the active mode's key again returns to
   object mode)? Alternative: F8–F11 and the RMB menu only.
2. **Q2** `Mod+E` → Extrude in component modes, with Export on `Mod+Shift+E` and the File menu?
3. **Q3** Bevel on `Mod+B` (open-source DCC Industry Compatible), or menu-only like the desktop DCC's documented
   defaults?
4. **Q4** Live Mirror on by default for new character meshes?
5. **Q5** Faceted shading by default for new meshes, or a 30° smoothing angle?
6. **Q6** Numeric capture after an operation on by default?
7. **Q7** When does the open-source-DCC-style preset ship (V1 or after modeling settles), and who tests it as a user
   of the open-source DCC?

---

## Sources

Accessed 2026-10-18 unless noted. Documentation and news about the two reference DCCs are listed by id and title;
their URLs are omitted.

- [B-UNDO] Open-source DCC manual, Undo & Redo (Adjust Last Operation F9, Repeat Last Shift+R, Undo History)
- [B-NUM] Open-source DCC manual, Numeric Input
- [B-TB] Open-source DCC manual, Mesh Edit Mode Toolbar
- [B-EM] Open-source DCC manual, Extrude Manifold
- [B-LOOP] Open-source DCC manual, Loop Cut
- [B-KNIFE] Open-source DCC manual, Knife Topology Tool
- [B-TS] Open-source DCC manual, Mesh Tool Settings (Mirror, Topology Mirror, Auto Merge)
- [B-MIRROR] Open-source DCC manual, Mirror Modifier
- [B-PROP] Open-source DCC manual, Proportional Editing
- [B-SIM] Open-source DCC manual, Select Similar
- [B-SNAP] Open-source DCC manual, Snapping
- [B-SBA] Open-source DCC manual, Smooth by Angle Modifier
- [B-41] Open-source DCC 4.1 release notes, Modeling (Auto Smooth replaced by a modifier node group)
- [B-IC] Open-source DCC manual, Industry Compatible Keymap
- [B-LT] LoopTools on the open-source DCC's extensions platform (v4.7.7, GPL-2.0-or-later)
- [B-50] Open-source DCC 5.0 coverage (modifiers on geometry nodes): CG Press; Digital Production (2025-11-20)
- [B-52] Open-source DCC 5.2 LTS release notes (released 2026-07-14, supported until July 2028)
- [M-HK14] Desktop DCC reference, 2014 help: PC hotkeys (F8–F12, Ctrl+F9–F11, g / Shift+G, 1/2/3, `<` `>`, macOS Exposé note)
- [M-MT] Desktop DCC reference, 2019 help: Modeling Tools hotkeys
- [M-MC] Desktop DCC reference, 2017 help: Multi-Cut Tool hotkeys
- [M-MM] Desktop DCC reference, 2025 help: Marking Menus (polygon, Ctrl+RMB conversion, Shift+RMB polygon tools)
- [M-EXT] Desktop DCC reference, 2022 help: Extrude a polygon face, edge, or vertex (Ctrl+E, smart extrude, In-View Editor)
- [M-IVE] Desktop DCC reference, 2022 help: In-View Editor
- [M-SYM] Desktop DCC reference, 2017 help: Activate or deactivate symmetry
- [M-SOFT] Desktop DCC reference: Soft Selection options (2017 and 2023 editions)
- [M-DEL] Desktop DCC reference, 2017 help: Delete edges (Delete Edge/Vertex, Ctrl+Delete)
- [M-2027] Desktop DCC 2027 release coverage (Smart Bevel, ngSkinTools, 2027.1): CG Channel; Digital Production (2026-03-26)
- [BB-REPO] Blockbench repository (GPL-3.0; "A low poly 3D model editor") — https://github.com/JannisX11/blockbench
- [BB-REL] Blockbench releases 5.0.0 (2025-10-12), 5.1.0 (2026-03-24), 5.2.0 (2026-09-18), 5.2.2 (2026-10-08) — https://github.com/JannisX11/blockbench/releases
- [BB-SRC] Blockbench source: `js/undo.js` (`amendEdit`: on form change, check the edit is on top, `Undo.undo()`, re-run) and `js/modeling/mesh_editing.js`, `js/modeling/mesh/*.ts` (mesh actions and keybinds) — https://github.com/JannisX11/blockbench/tree/master/js/modeling
- [BB-KEYMAPS] Blockbench keymap presets — https://github.com/JannisX11/blockbench/tree/master/keymaps
- [PLAS] Plasticity documentation, Essentials (selection modes, command palette) — https://doc.plasticity.xyz/all-commands/plasticity-essentials
- [PLAS-LIC] Plasticity documentation, License Types and Features — https://doc.plasticity.xyz/getting-started/license-types-and-features
- [SPL-V2] Spline V2 announcement (2026-08-20) — https://blog.spline.design/spline-v2 ; changelog — https://updates.spline.design/changelog/introducing-spline-v2
- [SPL-AI] Spline docs, AI 3D Generation — https://docs.spline.design/generate/ai-3d-generation
- [WOMP] Womp, Easy 3D workflow and Goop guide — https://womp.com/solutions/easy-3d/ ; https://womp.com/blogs/the-ultimate-guide-to-goop-liquid-3d-modeling-thats-changing-everything
- [MV] MagicaVoxel listings (freeware, proprietary) — https://www.filehorse.com/download-magicavoxel-64 ; https://alternativeto.net/browse/all/?tag=voxel
- [AF] Asset Forge on itch.io — https://kenney.itch.io/assetforge
- [CROC] Crocotile 3D on Steam — https://store.steampowered.com/app/1244040/ ; 2.4.5 coverage — https://digitalproduction.com/2024/12/02/crocotile-3d-2-4-5-tile-based-3d-modeling-tool-gets-new-features/
- [NOMAD] Nomad Sculpt web version (testing only) — https://forum.nomadsculpt.com/t/can-we-use-or-save-on-the-browser-version/3611 ; desktop beta — https://www.cgchannel.com/?p=167476
- [SURVEY] Open-source DCC user feedback survey 2024, results
