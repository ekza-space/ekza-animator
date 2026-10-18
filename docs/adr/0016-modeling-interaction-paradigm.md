# ADR 0016 — Modeling interaction paradigm: Maya base, Blender semantics, one keymap per preset

- Status: Proposed (2026-10-18, revised 2026-10-19 after the design review, MODELING-PLAN §12); becomes Accepted
  when the M6a spec freezes (package B0a)
- Inputs: research [10](../research/10-maya-poly-modeling.md) §0, §2, §5–§6, [11](../research/11-blender-vs-maya-modeling-ux.md)
  (D1–D12), [12](../research/12-lowpoly-workflow.md) §12, [16](../research/16-model-workspace-ui.md) (U1–U12, §19),
  [09](../research/09-ui-ux-spec.md) §6–§7; [MODELING-PLAN](../MODELING-PLAN.md) §1, §3.4, §3.7; ADRs 0008, 0013.

## Context

The owner asked whether modeling should follow Maya (his own tool) or Blender. The Animate side already ships
Maya's model: Q/W/E, Channel Box, Alt navigation, RMB marking menus, `S` = set key, `R` = scale tool, the `maya`
keymap preset on `KeyboardEvent.code` with panel scopes (ADR 0008 §5). Blender is faster for precise low-poly work
(Adjust Last Operation, typed numbers during modal tools) and Blender's own *Industry Compatible* keymap (5.2 LTS) is
Maya-flavoured for modeling (`1`–`3` modes, `Ctrl+E` extrude, `Ctrl+B` bevel, `B` soft select, double-click loop).
Browsers take F11 (fullscreen), F12 (DevTools), `Ctrl+Tab`, `Mod+R`, `Ctrl+N` and `Mod+Shift+I`; macOS takes
F-keys as media keys and F11 for Show Desktop. Maya's mesh parameters live in construction history, which ADR 0014
rejects.

## Decision

1. **One paradigm, Maya's.** Component *selection modes* on a selected object (no separate Edit Mode), hilite of the
   selected meshes (other meshes stay opaque and unpickable; "Dim unhilited" is a per-pane option), per-mode
   selection memory; RMB marking menu = modes, Shift+RMB = tools with the same slots in every mode — positions
   **provisional until the owner's calibration on a real Maya (Q-MOD-UI-1)**, starting from S Extrude, W Multi-Cut,
   SW Delete (Maya's plain Delete; Delete Edge/Vertex in the slot's list), N the mode's main topology tool — Ctrl+RMB
   = convert selection, Ctrl+Shift+RMB and `Q`+LMB = selection options (symmetry, soft select, constraints); W/E/R
   manipulators with a Normal space for components; **MMB-drag anywhere transforms the selection** with W/E/R active
   (along the last-picked handle axis, or in the view plane; the Channel Box virtual slider when channels or an
   INPUTS field are selected); Tweak selection style; Shift+drag smart extrude; Maya's loop table (double-click loop;
   Shift+double-click adjacent = full loop, non-adjacent = partial loop, parallel edge = ring; Ctrl+double-click
   deselects); hide/show/isolate; Modeling Toolkit panel; Poly Count HUD; Maya names in every menu (Multi-Cut,
   Insert Edge Loop, Target Weld, Slide Edge, Average Vertices, Soft Select, Harden Edge, Merge to Center).
2. **Blender semantics, not Blender keys**: Adjust Last Operation; typed numbers during any modal interaction; modal
   tools with live preview and a clean cancel; symmetry as a persistent mode remembered per mesh; Smooth by Angle as a
   one-shot Set Normal Angle; face-orientation and statistics overlays; later Extrude Manifold, Auto-weld, Select
   Similar and a live Mirror. Blender's names are command-palette aliases only.
3. **Workspaces are pipeline steps**: tabs `Model › Rig & Skin › Animate › Review` with status glyphs (text tooltips,
   never colour alone). Each owns its dock layout, menu set (`MenuItemDef.workspaces`), status-line groups, default
   tool and pick mask, key-scope prefix and timeline visibility. Switching keeps the document, object selection and
   time; leaving Model drops to object mode and cancels a running modal tool. No default switch hotkey.
4. **Hierarchical key scopes**: `model.viewport.<mode>` → `model.viewport.component` → `model.viewport` → `viewport`
   → `model` → `global` (and `model.<panel>` → `<panel>` for other panels). A deeper scope shadows a shallower one;
   the help line shows the resolved meaning; the hotkey editor lists shadowing as intended. `KeymapManager.preset`
   widens from the literal `'maya'` to a registered preset id.
5. **Bindings in the `maya` preset** (complete table in research 16 §19.3): `F8` object ↔ component; `F9`/`1` vertex,
   `F10`/`2` edge, `3` face (pressing the active digit again returns to object mode); **F11 and F12 are never bound in
   web builds**; `Mod+F9/F10/F11` convert; `Mod+E` **Extrude** in `model.viewport.component` while Export keeps
   `Mod+E` elsewhere and gains `Mod+Shift+E` everywhere; `Mod+B` Bevel; `K` Multi-Cut; `M` merge menu; `Delete`
   = Maya Delete (edges merge their faces, end vertices stay) and `Mod+Delete`/`Mod+Backspace` = Delete Edge/Vertex;
   `G` Repeat Last; `T` Last Operation card with the primary field focused; `Y` last tool; `B` soft select (`B`+LMB drag radius, `B`+MMB from zero);
   `D` pivot (`Insert` on Windows/Linux, `Home` on macOS as a toggle); `X`/`V` snap holds, `J` increment;
   `Shift+.`/`Shift+,` grow/shrink; the loop table of decision 1; `H` / `Shift+H` / `Alt+H` hide selected / show all /
   hide unselected (components and objects); `Shift+L` isolate per pane; `Ctrl+Alt+←/→` spin edge with a menu
   fallback; `4`–`7` shading. **Never bound**: `Mod+R`, `Ctrl+N`, `Ctrl+Tab`, `Mod+Shift+I`, `Mod+1…9`, `Ctrl+H`,
   `Tab` outside modal tools, `Alt+E`/`Alt+F` on Windows. Chords some browsers also use (`F10`, `Ctrl+B` and
   `Ctrl+Shift+E` in Firefox, `Ctrl+Alt+arrows` on some Windows graphics drivers) call `preventDefault` and enter the
   per-release QA matrix; Chromium is the supported target.
6. **Operator contract additions** (extends ADR 0008 §1–§2): `params: ParamDef[]` (label, kind `number | int |
   distance | angle | percent | bool | enum | axis`, hard and soft limits, step, options, one `primary` field, and
   `bound: 'selection' | 'pointer' | 'value'`) and flags `adjustable` / `repeatable`; session `LastRun { id, args,
   stepId, docSeqAfter, paneId }`. `ParamDef` lives in anim-core: kernel ops declare it and `meshOperator()` derives
   the `OperatorDef` params, JSON schema and defaults from it (one source). Arguments carry everything the pointer
   contributed (cut points as `{edge, t}`, extrude `local*` offsets, loop slide), so a re-run on the same pre-state
   yields the same mesh hash. `edit.adjustLast { args }` = undo + re-run (ADR 0015 §6). `edit.repeatLast` (`G`)
   re-runs the last repeatable operator **without its `pointer`-bound arguments, taking its targets from the current
   selection** (Insert Edge Loop seeds the ring from the selected edge with the same divisions and weight); operators
   whose targets are only pointer picks (Multi-Cut, Target Weld, Slide) are not repeatable and `G` re-activates their
   tool, like `Y`. File, view, UI and selection operators are not repeatable. Operators that create or delete mesh
   records are `MeshSetOp`s (ADR 0014 D7); adjust-last over them requires an unchanged record set.
7. **Last-operation surfaces**: a pane card at the bottom-left (collapsed pill, expands on click or `T`; MMB virtual
   slider on rows, Ctrl slower / Shift faster) and the same fields under **INPUTS** in the Channel Box, where Maya users
   look. Only the last operation is adjustable; any other document edit, selection or mode change, undo/redo,
   workspace switch or remote change to the target closes it with the reason — except the **extrude session**:
   after `Ctrl+E` (or a smart extrude) the extrude manipulator stays up and every drag on it, and every `W`/`E`/`R`
   drag on the cap, is absorbed into the extrude's `localTranslate`/`localRotate`/`localScale` arguments through
   `edit.adjustLast` (one undo step; Divisions stays editable) until the selection changes or a non-transform
   operator runs; the extrude's primary field is `localTranslateZ` (along the normal), `offset` and `thickness` are
   secondary; a session that ends with every argument at zero leaves no step. Primitives keep their parameters
   editable until the **first component edit of any kind**, a vertex nudge included (Outliner badge `prim` → `✎`).
8. **Modal tool contract** (`ToolDef` state machines, ADR 0008 §3): `idle → hover-preview → placing/dragging → confirm |
   cancel`; preview through the kernel into overlays; commit with one `app.run(op, args)`; `Esc` cancels with no history
   step; **RMB never cancels** (ignored during a drag; it completes Multi-Cut and opens marking menus otherwise; the
   keymap conformance test asserts it); the wheel stays dolly; `PageUp` / `PageDown` step counts. **Numeric capture
   is armed only (a) during an active drag and (b) right after an operator invoked from the keyboard, until the first
   pointer move beyond the 3 px drag threshold, a click or a non-numeric key** — never merely because a manipulator
   stays on screen, so `1`–`7` keep their mode and shading meanings and `-`/`=` keep manipulator size. While armed,
   digits, `.` and `-` start entry for the primary field, `Tab` next field, `Enter` confirms through
   `edit.adjustLast`, `Esc` restores, with the research 09 §6.4 expression grammar and units (`mm cm m`, `deg rad`).
   **`T`** is the explicit opener at any time: it opens the Last-op card with the primary field focused. Preference
   `numericCapture: 'auto' | 'explicit'` (default `auto`). The help line shows the tool's keys; a polite live region
   announces committed values.
9. **Keymap presets**: `maya` is the default and the only preset through M6; a complete **`blender` preset** comes
   later as a data pack over the same operator ids plus one Blender-only modal transform operator (G/R/S with X/Y/Z);
   Blender camera habits are a navigation profile, not a keymap. **No hybrid presets**: a preset is complete, user
   overrides are a diff, and adjust-last, numeric input and symmetry behave identically under every preset.
   Conformance per preset: every core operator has a binding or a menu path, no conflicts within a scope, no reserved
   chords, every binding names a registered operator.
10. **Accessibility**: every marking-menu item is also in a menu-bar menu and the command palette; the mode switcher is
    a radio group with key hints; overlays meet 3:1 through a 1 px halo; colour is never the only cue.
11. **Clean-room UX**: patterns may be taken from GPL tools (Blender, Blockbench, LoopTools); code may not (ADR 0009).
12. **Selection is undoable in Model** (Maya records selection in its undo queue by default; Blender records edit-mode
    selection): `EditorHistory` (ADR 0013) gains a session-only **selection part**; consecutive selection gestures
    coalesce into one "Select" step and hide/show into "Hide"; nothing enters the document or the CRDT. Preference
    `undoSelection` per workspace, default on in Model and off in Animate (the shipped behaviour).
13. **Symmetry covers every base tool** (MODELING-PLAN §3.14): vertex, edge and face partner maps; pointer arguments
    mirrored (`{edge, t}` → `{partner, t | 1 − t}` by edge orientation); one symmetric result at the seam (a seam-
    crossing ring inserts one loop, a seam-crossing cut becomes one symmetric cut, a weld onto a seam vertex collapses
    both partners); tolerance in metres (default 0.001 m). Live Mirror stays stretch unless this table overruns.

## Alternatives

| Alternative | Why not |
|---|---|
| Blender paradigm (Edit Mode, G/R/S modal transforms, LMB select with RMB context menu, `Tab`) | Redefines `S`, `R`, `G` and RMB inside one product that already ships Maya's Animate side; `Tab` collides with focus traversal; several Blender chords are browser-reserved; the owner models in Maya |
| Hybrid preset binding both Maya and Blender chords | Conflicts on the day the Blender preset ships (`Shift+R` is already Key Scale); two meanings per key |
| Maya with construction history and an INPUTS history list | Rejected in ADR 0014 §8; last-op covers the most-used part |
| Bind `F11` to face mode | Where a browser delivers the keydown it still goes fullscreen: one press, two actions |
| A separate `mesh` scope only (research 11 D10) | `K`, `M`, `T` and `Home` need Model meanings in object mode too; the hierarchical chain covers both (`model.viewport.component` is the `mesh` scope) |
| Per-workspace keymaps that redefine global keys | Users lose `S`, `W/E/R`, `Q`, Space meanings by switching tabs |
| Delete dissolves edges by default (research 16 Q-MOD-UI-6) | Breaks the owner's Maya habit; Delete Edge/Vertex can change a shape (a cube edge turns the cube into a prism); a stray-vertex lint with a one-click fix covers hygiene |
| Numeric capture armed for the whole life of a manipulator (research 11 §6.4) | With Maya's habit of keeping the extrude manipulator up, `3` to leave face mode became "3 m of thickness"; Blender only gets away with it because its typed numbers live inside short modal operations |
| Extrude commits on `Ctrl+E`; later `W`/`R` drags are separate operations | Breaks Maya's most common flow (`Ctrl+E`, scale the cap, change Divisions); the session keeps it one adjustable step |
| Selection changes never undoable (research 09 §6.3) | One stray click loses a hand-built loop selection; both reference tools record selection |
| Live Mirror as the only symmetric path | Maya users model characters with Symmetry mode; kept as the fallback if per-tool symmetry overruns |

## Consequences

- Marking menus (FR-SHELL-09), the command palette (FR-SHELL-08), workspaces (FR-SHELL-11) and the viewport Scale
  tool move from M2c into M6a's first UI package; DECISIONS-OPEN Q-UI-1 (Model tab hidden) closes when they land.
- `KeymapManager.resolve` is unchanged; the DOM adapter's scope-chain builder changes; the keymap conformance test
  covers the new scopes and the reserved-chord list.
- Export moves to `Mod+Shift+E` as its universal chord; the changelog says so.
- The compass positions of Maya's RMB component menu are not documented by Autodesk; they are calibrated once on a
  real Maya install by the owner before the M6a spec freezes, then never change between modes.
- `EditorHistory` gains a third step part (selection), an extension of ADR 0013 that leaves the doc `UndoManager`
  untouched; E2E-MOD-26 covers it.
- The viewport's plain MMB-drag gains a meaning without selected channels (additive: it did nothing before).
- Blender users get palette aliases and a "Coming from Blender" cheat sheet in M6a and a full preset later.
