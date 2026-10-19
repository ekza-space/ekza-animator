# M6a B10 — Modes, component selection UI, selection undo, hide/isolate, HUD, Mesh Check UI: build notes

Branch `m6a/model-select-ui` (from `m6a/spec`, with `m6a/shell-workspaces` (B9, which carries B0a and B0b) and
`m6a/mesh-view` (B6) merged; `m6a/keymap-menus` was already in B9). Scope:
[M6A-SPEC §9 B10](../M6A-SPEC.md#b10--modes-component-selection-ui-selection-undo-hideisolate-hud-mesh-check-ui).
Decision IDs below are `M6A-B10-<n>`. B10's gated dependencies (§9): B2 (walkers, partner maps), B5 (Mesh Check),
B7 (runtime commits); its E2E-MOD scenarios -02, -25 and -26 are landed behind their §10.1 Gates.

## What landed (by spec responsibility)

| B10 item | Where |
|---|---|
| `ComponentSelectionService` (§4.6): per-kind bitsets, pick order and active component (per-mode memory), `apply` with Maya's modes, hidden components (faces primary, closure), `snapshot`/`restore`/`restoreHidden` (skip changed revisions, never mode or hilite), `remap`, `set` inside commits, the mirrored selection, session counts | `editor-core/src/selection/component/{service,state,topology}.ts` (`selection/index.ts` re-exports; the factory `app/factories/components.ts` is unchanged) |
| The runtimes' edit links follow the hilite: open in a component mode in Model (and for a component tool in object mode), closed otherwise (§5.5 rule 8, M6A-B9-3) | `service.ts` (`followHilite`, `followTool`) |
| `select.mode`, `model.hilite` (§5.6 modes, hilite, the digit/F-key rule, returning to object mode) | `editor-core/src/operators/builtin/mode.ts` |
| `select.components`, `select.mesh.{loop,ring,grow,shrink,border,shell,all,invert,none,convert,matching}`, `select.objects` (§6.2) with selection undo | `editor-core/src/operators/builtin/selectMesh.ts`, `selection/component/steps.ts` |
| `view.hide`, `view.showAll`, `view.isolate`, `objectsDrawnIn` | `editor-core/src/operators/builtin/hide.ts` |
| Pointer probe of the headless operators (mesh under the pointer / at the RMB press, the dispatched key) | `editor-core/src/selection/component/probes.ts`, provided by the viewport runtime |
| Session repair: hilite, hidden objects and isolate sets point at live records; a document load ends component editing and clears hiding and isolation; restore warnings in §5.6 wording | `editor-core/src/session/{repair,selection}.ts` |
| Model select runtime (lazy): hosts B6's `MeshDisplay`, component picking (hover with partner, click, Maya modifiers, marquee, double-click → loop table, camera-based and back-face options per pane), mesh-object picking and marquee in object mode, framing (`F`/`A`), face isolate sets, the pointer probe | `viewport/src/tools/model/select/{index,runtime}.ts`; `tools/selectTool.ts` (`SelectBehaviour` delegates in Model, so W/E/R presses that miss their manipulator select too) |
| `model.modes` (RMB on a mesh) and `model.convert` (Ctrl+RMB) marking-menu data | `editor/src/overlays/menus/{modes,convert}.ts` |
| Poly Count HUD with the budget bar (§5.24), `BIND POSE` badge | `editor/src/panels/viewport/hud/{index.tsx,Hud.tsx,data.ts}` |
| Mesh Check panel (lazy body) and overlay (problems pushed to the display, `meshCheck` flag on while shown) | `editor/src/panels/meshcheck/**` |
| Test API B10 group: `model`, `screenOfVertex/Edge/Face`, `hud`, `meshCheck`, `paneObjects` | `editor/src/test-api/m6a/model-select-ui.ts` |
| E2E-MOD-02, -25, -26 (gated) and their helper | `apps/web/e2e/m6a-{02,25,26}-*.spec.ts`, `apps/web/e2e/helpers/m6a-model-select-ui.ts` |
| Status-line mode switcher body | B9's default body (`shell/statusGroups.tsx`) already runs `select.mode` with its poll reasons; B10 keeps it (M6A-B10-12) |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B10-1 | **Revisions.** The service tags each mesh's state with the revision (`MeshRuntime.ref.manifest`) it indexes and records each revision's sizes when it first sees it committed. A `set`/`remap` is **pending** when an op is in flight (fix round 1): a result already pending, sizes other than the committed revision's, or a stored form (`data()`, by identity) the runtime replaced since the service last saw the committed content (B7 caches the new revision's form before it stores the result, `commitOp`). Before a pending result replaces the state, that state is remembered as the revision the op read; the result becomes the new revision's state when the runtime follows, settles as a change of the current revision at the end of the task when no revision moved, and rolls back to the remembered state when the content changed under the same revision (an aborted commit). A same-size result keeps the kinds it does not supply (empty bitsets of other kinds: per-mode memory). A store with the same stored form and the committed sizes (a select outside a commit, a run that wrote no revision) changes the current revision at once. When the runtime moves to another revision (undo, redo, a peer) the state remembered for that revision (last 24 per mesh) comes back, so undoing an op restores the selection it read and redo its result, whatever the sizes — without per-mesh snapshots in `TxMeta` (the runner's `selectionBefore/After` carry none yet, see Hand-over B11). A revision never seen keeps the selection when the sizes match and clears it otherwise; hidden sets are resized (new elements visible). | §4.6 "remap after topology commits", §5.6 "a mesh whose revision changed since the snapshot is skipped", §5.5 rule 2, §5.7 (Adjust Last re-runs on the restored selection). The service has no document handle (the factory gets `session` and `meshes`; `kernel.ts` is closed), so it reads "an op is in flight" from the runtime itself. |
| M6A-B10-2 | **Hidden components.** Component hides convert to faces (Maya): `H` in vertex/edge mode hides the faces the selection touches; `hidden()` returns the explicit sets plus the closure (an edge whose faces are all hidden, a vertex whose edges are all hidden), mesh-view's visibility rule (M6A-B6-6), so B2's walkers stop at the same elements the display hides. **Hidden picks stay stored** but `get()` (what ops, walkers, the HUD and the test API read) leaves them out; undoing a hide therefore brings the selection back as it was, and a replacing click or marquee drops them. | §5.6 "never op targets", "stop loop and ring walkers"; the §4.6 `HideSnapshot` has no selection, so a hide that deselected could not be undone exactly. |
| M6A-B10-3 | **`select.components` pass-through keys** (runtime only; `OperatorMap` is closed): `gesture: 'click' | 'marquee'` from the select tool. A click is remembered so a double-click's loop gesture reads the selection from **before** its first click (M6A-B2-6); and `also: {mesh, indices}[]`: a marquee over several hilited meshes is **one run** (fix round 2) — the first mesh in `mesh`/`indices`, the others in `also`, applied in one batch with `mode: 'add'` after a replace (`mode` itself for add/remove/toggle) — so it records one "Select" step even when the first mesh's part changes nothing. | §5.6 "every discrete gesture is its own step: … a marquee". |
| M6A-B10-4 | **Selection steps** record only when the gesture changed something (controls, objects or any per-mesh set, order or active); a click on what is already selected records nothing. Coalescing: auto-repeated grow/shrink (`RunContext.repeat`), and a `repeat` run merges only into the step the selection run right before it recorded (`selectionGesture` keeps that step's id per app): a continuation whose own first run changed nothing never merges into an earlier gesture's step (fix round 2). Animate (`undoSelection.animate` false) is unchanged. | §5.6; a no-op step would make `Mod+Z` appear to do nothing. |
| M6A-B10-5 | **Digit vs F-key.** `F9` and `Digit1` (and `F10`/`Digit2`) are the same keymap row (`select.mode {mode}`), so the operator asks the pointer probe which key the keyboard adapter is dispatching (`lastKey`, from a capture-phase `keydown` listener of the viewport runtime): the active mode's digit returns to object mode, `F9`/`F10`, menus, the status line and scripts are idempotent. A keyboard run without a probe (headless) counts as a digit. | §5.6, §7 rows; changing the rows' args would be a §7 contract change and break B0b's keymap table test. |
| M6A-B10-6 | **Entering a component mode** hilites the selected meshes (records with data); with none the mesh under the pointer: a marking-menu run takes the **press point** of the menu (the RMB mode menu opened on the mesh), every other run the hover point. A mode item of the RMB menu on a mesh that is not hilited adds it (in object mode it joins the selected meshes). No candidate → "Select a mesh first". | §5.6 "Entering a component mode …", "RMB on another mesh … adds it to the hilite set". |
| M6A-B10-7 | **Returning to object mode** makes the hilited meshes the object selection (an `objects` "Select" step only when that changes it); an empty hilite never clears the object selection. A mode switch ends an open extrude session without a zero-drop (`app.extrude.end('mode', {drop: false})`). Conversions in Select › Convert, Ctrl+RMB and Border switch the mode to the result's kind (Maya), and `convertOnModeSwitch` converts touching. | §5.6, §5.8 (E2E-MOD-17 b). |
| M6A-B10-8 | **Replace clears the kind on every hilited mesh** (a click on mesh A drops B's selection of that kind); a click on empty space clears the current mode's selection on the hilited meshes; additive and removal gestures touch only the picked mesh. Double-click needs the same modifiers on both presses, ≤ 500 ms and ≤ 4 px apart (Shift-click then a quick Ctrl-click on the same spot is two clicks). | §5.6 click rules; Maya. |
| M6A-B10-9 | **Mirrored selection**: the service expands through the kernel's `expandSelection` (a local partner union while it is a stub); removal (Mod, a Shift toggle that turns off) on either side removes the pick and its partner; partners never reveal hidden components. The HUD's Selected column shows `N (+M sym)` from the same expansion. | §5.6. |
| M6A-B10-10 | **Object picking in Model** (object mode, the RMB menu's `over: 'mesh'`, the pointer probe) is a ray against each drawn mesh's triangulation (visible faces only), and an object marquee selects a mesh with a visible vertex inside the rectangle. mesh-view's meshes opt out of three's raycasting, so `ViewportManager.isOverMesh` asks this hit test through `setMeshHitTest` (without it the RMB mode menu never opened over a mesh). | §8.4 "RMB on a mesh"; B9's `isOverMesh` raycast could not see mesh-view surfaces. |
| M6A-B10-11 | **Framing** in Model: `F` frames the component selection (expanded, of the hilited meshes), else the selected mesh objects, else every mesh; `A` every mesh; outside Model, or with no mesh, the shipped bounds. A single point is padded to 10 cm. | §9 B10 "framing (F/A) on component selections". |
| M6A-B10-12 | **Status-line mode body**: B9's default body (`status-mode-<mode>`, `select.mode` with poll reasons, F-key labels from the keymap) is what B10 needs, so no replacement is registered. | Avoids two bodies for one behaviour. |
| M6A-B10-13 | **HUD**: Scene = the meshes the pane draws (hidden objects and the pane's isolate left out), Object = the hilited meshes (component modes) or the selected meshes (object mode), Selected = the visible picks of the current kind (tris of the selected faces in face mode; the selected meshes in object mode); UVs row = distinct (vertex, uv0) points when a mesh has UVs. Budget: the first worked-on mesh with a budget (`meshBudget`, own then parents), triangles of the worked-on meshes (else the pane's). Shown while the pane's `polyCount` flag is on (Model default). Recomputed once per microtask after a change; never per frame. | §5.24, §8.7. |
| M6A-B10-14 | **Mesh Check panel** checks one mesh (the lead hilited mesh, else the lead selected one, else the first editable mesh) with `meshCheckOptions` (M6A-B10-18): rows per code with count, severity (✕ error, ◇ n-gon, ○ `open-border`), **Select** (`select.mesh.matching`: hilites the mesh, enters the problem's kind and selects its elements; `loose-geometry`'s wire edges become their endpoints in vertex mode) and **Fix** (`mesh.cleanup {fix, selectOnly: false}` for codes with a §5.25 fix). "Clean" = no row (`open-border` appears only on meshes their template flags closed, where it is a problem). While its body is shown, every pane gets `meshCheck: true` — panes made later (a layout switch) and a manager that comes after the panel too (fix round 2) — and it is turned off again only where the panel turned it on; the markers follow the flag (M6A-B10-20). Rows keep elements per domain (M6A-B10-23); `duplicate-slot` also offers **Swatch** (M6A-B10-24). It says "Mesh Check arrives with the diagnostics package" while `checkMesh` is B5's stub. | §5.25; one mesh keeps the §8.10 `meshcheck-*-<code>` test ids unique. |
| M6A-B10-15 | **Component tools in object mode** (Multi-Cut, Insert Edge Loop, Target Weld, Slide, Paint Colour): activating one in object mode hilites (and opens) the selected meshes without changing the mode; the previous hilite list returns when the tool ends; entering a component mode takes over. The mesh under the pointer at the first pointer-down is the tool's to add (`model.hilite {add}`). | §5.6 "Component tools in object mode". |
| M6A-B10-16 | **Drop-zone card in Model**: the shipped "Drop a .glb or .vrm file" card shows while there is no character; in Model it now shows only while the scene has no mesh either — over a Model scene it covered the meshes at the pane centre and took their clicks (E2E-MOD-01/-02/-26 click there). | Found in the scratch integration; B13's Model start card owns the empty Model scene. |
| M6A-B10-17 | **The RMB press point** the operators' probe reads for marking-menu runs is the last right-button press in the pane; a left click on a drawn menu item (click-release menus) does not move it. | Otherwise choosing Face in a sticky RMB menu would look for the mesh under the menu item. |
| M6A-B10-18 | **Mesh Check options** (`meshCheckOptions`, `editor-core/src/selection/component/meshCheck.ts`): the visible elements (the mesh's hidden set); **`closedExpected`** when a template group is above the mesh (`GroupRecord.template`: prop, handheld, humanoid — AS-LP's sword, grip and body parts are closed solids, §5.16) or the mesh is the humanoid body generator's; **`duplicateSlots`** = the slots two live swatches of the mesh's palette share. The panel, the overlay, `select.mesh.matching` and the test API's `meshCheck()` use it. | §5.25 "`open-border`: border edges on a mesh flagged closed by its template/AS-LP check", "`duplicate-slot`: two live swatches share a slot in the mesh's palette". No record field flags a mesh closed; the template group is the template's flag (agreed source to confirm with B8/B13, Hand-over). |
| M6A-B10-19 | **Snapshots keep every kind's pick order**: the §4.6 `MeshSelectionSnapshot` carries order/active for its own kind only (closed type), so the service keeps the other kinds' order and active component per snapshot entry it made (a `WeakMap`); a copied snapshot (no entry) keeps the current order of the picks still selected. A selection undo never resets Bridge/Target Weld pick order or the loop table's reference of another mode. | §5.6 per-mode memory. |
| M6A-B10-20 | **The Mesh Check overlay follows `DisplayFlags.meshCheck`**, not the panel: while any pane in Model has the flag, the Model select runtime pushes every drawn mesh's problems to the display (recomputed only when the mesh's content, the component selection service or a `meshes`/`groups`/`palettes`/`swatches` batch changed); without the flag the markers go. B6 draws them in edit views (hilited meshes in component modes). | §5.25 "the overlay (`DisplayFlags.meshCheck`)". |
| M6A-B10-21 | **"Make editable first" in `select.mode`**: the pointer probe answers `assetMeshAt(pane, press | hover)` — a mesh the viewport draws without a record (a character's glTF mesh; `isOverMesh` true where no record's mesh is picked). The RMB mode menu opened over one refuses (in object and component modes); a key or menu run with no other candidate over one refuses; the reason is `MAKE_EDITABLE_HINT` ("Make editable first: use Make editable on its Outliner row"). `model.hilite` keeps `MAKE_EDITABLE_FIRST` for record rows without data. | §5.6 "cannot be hilited: 'Make editable first' with the Outliner action". |
| M6A-B10-22 | **`Mod+Shift` double-click** extends the loop like `Shift` (`shift-double`, additive); only `Mod` alone gives `mod-double` (`loopGestureOf`). | §5.6 click rules: `Mod+Shift` adds. |
| M6A-B10-23 | **Mesh Check rows per domain** (fix round 2): `checkRows` keys a code's elements by domain (`loose-geometry` reports loose points and wire edges, so point 5 and edge 5 are two elements). A row's `count` is the distinct elements over all its domains (the problem count when it has none); its `domain` is the first problem's (the kind "Select" picks in, as `select.mesh.matching`); `elements` (and the test API's `meshCheck().elements`) are the row's elements in that domain; `byDomain` lists all. | §4.8 `meshCheck(mesh): {code, count, elements}[]` has one element list; mixing domains made it meaningless. |
| M6A-B10-24 | **`duplicate-slot` "select swatch"** (fix round 2): the row has **Swatch** (`meshcheck-swatch-duplicate-slot`), which runs `palette.setActive {swatch}` (B13's operator, a B0a stub until B13) with the swatch the reader shadows on the lowest shared slot (the reader takes the smallest SwatchId, `swatchBySlot`): B13's Palette panel shows the active swatch, the duplicate to re-slot or remove. No Fix (§5.25 offers none). | §5.25 table: `duplicate-slot` → "select swatch"; §6.2 `palette.setActive {swatch}`. |

## Shared files and other packages' paths (minimal, additive)

| File | Change | Why |
|---|---|---|
| `viewport/src/manager/ViewportManager.ts` (B9) | `paneView(paneId)` (the pane's three camera, size and display for mesh-view picking), `setFrameBounds(provider)` (consulted first by `boundsFor`), `setMeshHitTest(test)` (consulted by `isOverMesh`) | No public camera accessor existed; `F`/`A` and `isOverMesh` knew controls and character meshes only (M6A-B10-10, -11). |
| `viewport/src/manager/contributions.ts` (B9) | one line: `attachModelSelect(app, vm)` where the viewport registers its tools | The runtime needs the manager; it loads lazily (first mesh or Model). |
| `editor/src/shell/createShell.ts` (B9) | one line: `registerModelSelectUi(app)` (HUD and BIND POSE overlays, the two marking menus) | The shell is the only per-app bootstrap with the app. |
| `editor/src/panels/index.ts` | `registerMeshCheckPanel(registry)` | §4.8 "registered by their owners through `registerBuiltinPanels`". |
| `editor/src/panels/viewport/ViewportPanel.tsx` (B9) | the drop-zone condition in Model (M6A-B10-16) | Clicks on Model meshes. |
| `editor-core/src/selection/index.ts` (B0a stub "owned by B10") | re-exports `./component` | The stub's replacement. |
| `editor-core/src/index.ts`, `viewport/src/index.ts` | additive exports (B10 block) | Cross-package use (viewport, editor, tests). |
| `editor-core/test/m6a/foundation.test.ts` (B0a) | literal update: the landed B10 operators' poll reasons in the `LANDED` table; `components.set` on a mesh without a runtime throws `invalid-record` (was the stub's `not-implemented`) | §3 rule 9-style literal updates; nothing weakened. |
| `editor/test/test-api.test.ts` (B0a) | literal update: `model()` and `paneObjects()` answer (the B10 group landed) | Same. |
| `editor/test/m6a-shell.test.tsx` (B9) | the overlay-slot test registers its overlay after the shell (the shell now registers B10's HUD; the latest registration draws) and checks its own element goes away | Same property checked. |

### Contract request to B9 and INT (§9.1) — pending acceptance

§9.1 makes `viewport/src/manager/**`, `editor/src/shell/**` and `editor/src/panels/viewport/ViewportPanel.tsx` B9's
files; "another package that needs a change sends a contract PR or asks the owner". B10 needed the five changes above
before B9 could add them, so they are on this branch, additive and covered by B10's tests. **B10 asks B9 (or INT at the
merge) to accept them as B9's API** — no B9 owner session was reachable in this round, so the acceptance is not
recorded yet:

| Hook (B9 file) | Contract | Consumers | Tests |
|---|---|---|---|
| `ViewportManager.paneView(paneId)` | `{camera, width, height, display} | null` for a registered pane; no side effects | B10 picking, framing, HUD; B12a (pane camera) | `viewport/test/m6a-select/runtime.test.ts` |
| `ViewportManager.setFrameBounds(provider | null)` | `boundsFor('selection' | 'all')` asks the provider first; null = the shipped bounds | B10 `F`/`A` in Model | same (framing) |
| `ViewportManager.setMeshHitTest(test | null)` | `isOverMesh` also answers true where `test(pane, x, y)` does (mesh-view meshes take no raycasts) | marking menus' `when.over: 'mesh'` (`model.modes`) | same (`isOverMesh`) |
| `contributions.ts`: `attachModelSelect(app, vm)` | one line next to the tool registrations; lazy chunk | — | the runtime tests |
| `createShell.ts`: `registerModelSelectUi(app)` | one line (HUD, BIND POSE, `model.modes`, `model.convert`) | — | `editor/test/m6a-select-ui.test.tsx`, `m6a-shell.test.tsx` |
| `ViewportPanel.tsx` drop-zone condition | in Model the "Drop a .glb" card shows only while the scene has no mesh either (M6A-B10-16) | B13's Model start card owns the empty Model scene | E2E-MOD-26 clicks at the pane centre |

Status after fix round 2: **still pending** — no B9 or INT session was reachable from this builder session (no peer
agent for B9 is listed), so nothing is recorded as accepted; the hooks are unchanged since fix round 1. INT: record the
acceptance here (or in B9's notes) at the merge. The B13 merge (scratch, fix round 2) conflicts on three of these lines:
`editor/src/panels/index.ts` and `viewport/src/manager/contributions.ts` keep both sides (B10's and B13's
registrations); in **`ViewportPanel.tsx` take B13's condition** (no drop zone in Model at all: its Model start card
owns the empty scene), which supersedes M6A-B10-16 (`hasNothingToModel` then goes unused and can be deleted).

If B9 prefers other names, B10 adapts its three call sites (`tools/model/select/{index,runtime}.ts`, `hud/index.tsx`).

## READY gates and E2E gates

- Unit: `editor-core/test/m6a/select/ready.ts` (`b2`, `b3`, `b5`, `b7`), `editor/test/m6a-select/ready.ts` (`b5`).
  Gated: on `b2` the walker operators (the exact edge loop and a `Shift`+double-click full loop, grow/shrink coalescing,
  convert, border) and the hide semantics of walkers (a loop stops at a hidden column; grow and convert skip hidden
  faces); on `b3` a `mesh.delete` through `meshOperator`/B7 that never targets a hidden pick; on `b5` Mesh Check
  matching (a template mesh's open border, loose vertices), the panel (Clean, Select, Fix) and `meshCheck()`; on `b7` a
  same-size op through the real `commitOp` (undo/redo/per-mode memory, an aborted transaction). The service's revision
  tests also simulate B7's commit on the stub registry (ungated).
- E2E (`test.fixme` with the §10.1 Gates column): E2E-MOD-02 `b3, b7, b11`; E2E-MOD-25 `b3, b11, b13`; E2E-MOD-26
  `b2, b7` (both its Model part and its Animate part).

## Verification against the real B1, B2, B3 and B7 (scratch integration, not committed)

A throwaway worktree merged `m6a/mesh-select` (B1 + B2), `m6a/mesh-runtime-doc` (B7) and `m6a/mesh-ops-core` (B3) onto
this branch (conflicts only in the B0a foundation tests). There, with the READY flags on:

- editor-core B10 tests: 38 passed (1 skipped: `b5`), including the loop table, grow/shrink coalescing, convert and
  border through B2's walkers, and the service's revision tests on B7's runtime;
- viewport/editor B10 tests and B6's display tests: all green on B1's kernel;
- **E2E-MOD-26 un-gated: both parts pass** in real Chrome (double-click loop, empty click + undo, three Shift-clicks =
  three steps, adjacent/partial/ring/Mod+double-click in edge mode, vertex and face rows, Animate records no Select);
- scratch-only variants (B3/B11/B13 parts left out): E2E-MOD-02's RMB mode menu (Face), digits `1 2 3 3`, the ⌘E help
  line, RMB → Vertex hiliting the mesh under the press, Ctrl+RMB → To Faces; E2E-MOD-25's hide → marquee without hidden
  faces → Show All → one/two-endpoint edge marquees → per-pane isolate; a picked top face → `Ctrl+E` (B3's extrude
  through B7's `meshOperator`, registered in the scratch only) → the cap selected → undo restores the top face, redo the
  cap.

These runs found and fixed M6A-B10-1 (B7's live `data()`), -10 (`isOverMesh`) and -16 (the drop-zone card). The
final re-run (this branch's head merged into the scratch) passed E2E-MOD-26, the variants, the extrude check and
B9's `m6a-shell.spec.ts`; the only failure there was B7's copy of `m6a-00-foundation.spec.ts` expecting
`ui.commandPalette` to poll-fail (B9 landed it) — a B7 × B9 merge item, not B10's (the spec passes on this branch).

### Fix round 1 re-verification (scratch integration, deleted afterwards)

A throwaway `--shared` clone merged `m6a/mesh-select` (B1 + B2), `m6a/mesh-runtime-doc` (B7), `m6a/mesh-bevel-check-uv`
(B5) and `m6a/mesh-ops-core` (B3) onto this branch, every READY flag on, and B7's three fallback reads
(`t.meshes.localSelection(...)` in `test/mesh/runtime.test.ts` (the `'before-last'` block's `faces` helper) and
`test/mesh/setops.test.ts` (two places)) pointed at `app.components.get(id, 'face')`:

- editor-core: B10's 55 tests and B7's `runtime`/`setops` suites all pass (B7's `'before-last' reads what the last op
  read` block 4/4, including the re-run on the restored selection); the whole package 969 passed, 2 failed — both
  failures exist before this round's commits too (the B0a `foundation.test.ts` gets two `LANDED` tables from the B7
  auto-merge, and `m6a/mesh-runtime.test.ts` expects stub ops that B3/B5 replaced): INT literal updates, not B10;
- editor (`m6a-select-ui`, `m6a-shell`, `test-api`): 36 passed — the b5-gated panel tests run against real B5;
- viewport (`m6a-select`): 13 passed;
- **E2E-MOD-26 un-gated, both parts pass** in real Chrome with the tightened assertions (the exact vertex arc
  v0 v1 v2; the Animate part undoes a real `clip.new` step).

## Hand-over

- **B7**: `components.set(id, sel)` inside `commitOp` is the intended path (a pending result); `remap` exists for ops
  that return no selection. `get()` excludes hidden components; `hidden()` includes the closure. The service reads "an
  op is in flight" from your runtime: keep caching the new revision's stored form (`cacheStored`) **before**
  `storeSelection` and bumping `version` when a commit is reverted (M6A-B10-1). **With READY.b10 your fallback-reading
  tests must read `app.components`**: once B10's service stores, `localSelection` stays empty, so
  `test/mesh/runtime.test.ts` (`faces` in the `'before-last'` block) and `test/mesh/setops.test.ts` (the created
  output's face 0, the reshaped plane's face 1) read `app.components.get(id, 'face')`; all of them pass on the scratch
  integration (above).
- **B8, B13**: Mesh Check's `closedExpected` comes from the template group above a mesh (and the humanoid body
  generator), `duplicateSlots` from its palette (`meshCheckOptions`, M6A-B10-18). B8's export lints call
  `checkMesh(data)` without options; for the AS-LP closed check they can pass `closedExpectedOf(store, record)`. If B13
  wants another flag (a template field on the mesh), `closedExpectedOf` is the one place to change.
- **B9**: the Model tab glyph (`workspaces/index.ts`) counts `checkMesh(data)` problems without options; with
  `meshCheckOptions(app, id)` it would match the panel ("Clean" = no row). The five hooks above wait for your
  acceptance (contract request).
- **B11** (contract request, fix round 2): E2E-MOD-02 expects the Last-op card to show the op's shortcut in platform
  labels (§10.1 "the card and help line show `⌘E`"), as text or as the `title` of the card or one of its parts — for
  example the pill's `Adjust Extrude (T)` tooltip becoming `Adjust Extrude (T) · ⌘E`, from the keymap's label of the
  op's binding (`Mod+E` → `⌘E` on `platform=mac`, `Ctrl+E` elsewhere). `LastOpCardView` on `m6a/model-ops-ui`
  (ab3caaa) renders `⟲Extrude · 0.500 m▸ Adjust Extrude (T)`. The assertion stays (soft: the scenario still reports
  the rest) and fails until the card shows it; everything else in E2E-MOD-02 passes un-gated on B11 (fix round 2). The runner's `TxMeta.selectionBefore/After` are built with `selectionSnapshot(selection, model)` (no
  per-mesh part); passing `app.components.snapshot().meshes` as its third argument would make doc-step undo carry
  component selections too (the service already restores them by revision, M6A-B10-1). The LastRun card closing on an
  `objects` selection step after returning to object mode is yours (§5.7). `select.mode` ends the extrude session
  (`drop: false`) but does not touch the capture window.
- **B12a**: the transform tools already select through `SelectBehaviour` in Model when a press misses the
  manipulator; `componentInternals(app.components).expanded(mesh, kind)` is the expanded set, `partnerOf` the
  partner; `vm.paneView(paneId)` gives the pane camera.
- **B12b**: activating a component tool in object mode already hilites and opens the selected meshes
  (`COMPONENT_TOOLS`, M6A-B10-15); add the mesh under the first pointer-down with `model.hilite {add}`. B6's display
  shows edit views (and pickers) only in component modes: object-mode component tools need it to treat a tool hilite
  like a component mode (B6/INT).
- **B13**: the Outliner adds a mesh to the hilite in component mode with `model.hilite {meshes:[id], mode:'add'}`; it
  refuses records without data ("Make editable first"). `select.mesh.bySwatch` can store its result with
  `componentInternals(app.components).store(mesh, sel, 'face')` (a selection step around it: `selectionGesture`). The
  Model start card replaces the drop-zone card, which no longer shows over a Model scene with meshes (M6A-B10-16).
- **INT**: turn on the READY flags (`b3` is new this round) and the three `test.fixme` gates; the drop-zone and
  `isOverMesh` changes touch B9's files (the contract request above). E2E-MOD-25 moves its cube beside the body with
  `select.mesh.all` + `mesh.transformComponents {translateX: 1.6}` (registered by B11, its gate). Merging B7 conflicts with this branch only in the B0a foundation tests (`editor-core/test/m6a/
  foundation.test.ts` LANDED tables, `editor/test/test-api.test.ts`, `headless-tests/test/ops.m6a-foundation.test.ts`,
  `apps/web/e2e/m6a-00-foundation.spec.ts`): keep both sides' landed operators. Decide the eager allowance with
  B10's +13,126 B in mind (above).

## Fix round 1 (review of 77b4c8d)

| Finding | Resolution |
|---|---|
| Major: Mesh Check never passed `closedExpected`/`duplicateSlots`; the b5 panel test failed on real B5; matching only checked the hilite | `meshCheckOptions` (M6A-B10-18) for the panel, overlay, matching and `meshCheck()`; matching selects per domain; b5 tests rewritten on real problems with exact elements and kinds (template plane's open border, a loose vertex, a non-planar cap for Fix), green on real B5 |
| Major: a same-size `set` inside a commit was taken as the pre-op revision's state; result kinds wiped per-mode memory | pending whenever an op is in flight, the pre-op state remembered first, same-size results keep unsupplied kinds, end-of-task settle and rollback (M6A-B10-1); simulated and READY.b7 real-`commitOp` regression tests; B7's own fallback tests pass on `app.components` |
| Major: invert under symmetry re-added the inverted picks | invert complements the expanded set; mirrored-invert test |
| Major: no tests of hide semantics in walkers/ops, of the Fix button; the loop test was loose | b2: exact loop, `Shift`+double-click full loop, loop stops at a hidden column, grow/convert skip hidden; b3: a delete never targets a hidden pick; b5: panel Fix runs `mesh.cleanup {fix, selectOnly: false}` |
| Minor: selection undo lost other kinds' pick order | per-kind orders per snapshot entry (M6A-B10-19); service and operator tests |
| Minor: hand-over omitted B7's fallback tests | Hand-over B7 lists them; verified on the scratch integration |
| Minor: overlay only with the panel, one mesh | the overlay follows `DisplayFlags.meshCheck` for every drawn mesh (M6A-B10-20); viewport test |
| Minor: `select.mode` ignored character meshes without a record | probe `assetMeshAt`, `MAKE_EDITABLE_HINT` (M6A-B10-21); operator and viewport tests |
| Minor: `Mod+Shift` double-click removed | `loopGestureOf` (M6A-B10-22); runtime test |
| Minor: E2E gaps | E2E-26 exact vertex arc and a real doc step in Animate (passes un-gated on the scratch); E2E-02 the card's `⌘E`; E2E-25 the cube beside the body |
| Minor: B9-owned files without a recorded ack | contract request above; acceptance pending (no B9 session reachable) |

## Fix round 2 (review of d38a755)

| Finding | Resolution |
|---|---|
| Major: a marquee over several meshes whose first mesh's part changed nothing merged into the previous marquee's step (one undo reverted two gestures) | the select tool sends a marquee as **one** `select.components` run with `also` (M6A-B10-3); `selectionGesture` lets `repeat` merge only into the step the previous selection run recorded (M6A-B10-4). Regression tests: operators (marquee 1 on A, marquee 2 on A unchanged + B → two steps, one undo → `{A: picks, B: []}`; a `repeat` continuation after a no-op run is its own step) and the viewport runtime with real pointer events on two cubes; both fail on d38a755 |
| Major: E2E-MOD-02 could not pass once its gates open (collapsed card, focus kept in the field, `⌘E` on the card) | `setLastOpField` expands the pill, fills, Enter, then Escape so the field gives the keyboard back (asserted `not.toBeFocused`); the card's `⌘E` check stays (soft) and is a B11 contract request (Hand-over). Un-gated on the scratch with B11: every other step passes |
| Minor: E2E-MOD-02 lacked E2E-MOD-01's geometry | the top face (same index): four vertices at y = 1, centroid moved by (0, 0.5, 0), area 1 (Newell), 1e-6 |
| Minor: flaky "loads with the first mesh" poll | the runtime-load poll waits up to 15 s (a cold lazy chunk under load); the test timeout is 30 s |
| Minor: Mesh Check rows mixed domains | M6A-B10-23; unit test (point 5 + edge 5 = 2 elements) |
| Minor: the overlay missed panes made while the panel is open | the panel follows `subscribePanes` and the manager (`subscribeViewportManager`); editor test: single → quad turns the three new panes on, unmount turns all four off (fails on d38a755) |
| Minor: B9-owned files without a recorded ack | still pending (contract request above; no B9/INT session reachable); the B13 merge conflicts and which side to take are listed there |
| Minor: `duplicate-slot` "select swatch" missing | M6A-B10-24; unit test of the shadowed swatch, b5-gated panel test (green on real B5) |

Also: E2E-MOD-25 took the first front torso edge of at least 24 px on screen, which the B13 humanoid body in a quad
pane does not have (its torso edges are 15–25 px); it now takes the longest visible one and asserts it is longer than
twice the marquee pad. The b5 panel fixture shares slot 0 (B5 reports `duplicate-slot` on faces painted with the shared
slot; unpainted faces read 0).

### Fix round 2 verification (scratch integration, deleted afterwards)

A throwaway `--shared` clone merged `m6a/mesh-select` (dbdce07), `m6a/mesh-runtime-doc` (778cd1f),
`m6a/mesh-bevel-check-uv` (1562e1f), `m6a/mesh-ops-core` (b82b8c6), `m6a/model-ops-ui` (ab3caaa) and then
`m6a/model-content` (B13, d4925a4) onto this branch (foundation-test conflicts from this side; the `index.ts`
registration conflicts kept both sides; `ViewportPanel.tsx` from B13), every READY flag on, the three e2e gates off:

- editor-core B10 tests 57/57; editor `m6a-select-ui` + `m6a-select` 15 passed / 2 skipped (the stub-only tests);
  viewport `m6a-select` 14/14;
- real Chrome, port 3241: **E2E-MOD-26 both parts pass; E2E-MOD-25 passes on B13's humanoid body** (hide, a marquee
  without hidden faces, extrude leaving hidden faces bit-equal and hidden, Shift+H, the one- and two-endpoint edge
  marquees, per-pane isolate); **E2E-MOD-02 fails only at the soft card `⌘E` check** (B11's label) — RMB → Face,
  `1 2 3 3`, ⌘E extrude 12/20/10 with the E2E-MOD-01 geometry, the help line `⌘E`, Divisions 2 → 16/28/14 without a
  new step, undo → 8/12/6 with the same manifest all pass.

## Eager route size (§5.27)

`check:size` on this branch (fix round 2): **894,309 B ≤ 900,000 B** (headroom 5,691 B); the pre-B10 base (the B9 +
B6 merge, 67734e8) measures 881,183 B, so **B10 adds +13,126 B** (gzip -9) to the eager route (+898 B in fix round 1:
the Mesh Check options, the pending detection, the Make editable hint; +184 B in fix round 2). Both boundaries hold (the kernel
and mesh-view stay lazy: the Model select runtime, the HUD, the Mesh Check body and the marking-menu drawing are lazy
chunks). The eager part is mostly editor-core: the selection service (`editor-core/src/selection`: 5.4 kB) and the
mode, selection and hide operators. If INT needs the bytes for B11–B13 under the allowance the owner decides
(M6A-B9-14), the candidates are: the service's implementation behind the kernel load (an eager facade that answers
"nothing stored" until the mesh kernel and the implementation chunk have loaded; B7's commit already tolerates a
`not-implemented` writer), and the walker operators' bodies behind an async `prepare`.

## Gates

Fix round 2, run on this head in this worktree (the tree clean before and after; servers stopped, port 3241 free):

| Gate | Result |
|---|---|
| `pnpm run format:check` | clean (1,199 files) |
| `pnpm run lint` | rc 0, no findings |
| `pnpm run typecheck` | clean |
| `pnpm run check:deps` | 15 packages follow the rules |
| `pnpm run test` (and `turbo run test --force --continue`) | 15/15 tasks: editor-core 906 passed / 10 skipped (B10 gates `b2`, `b3`, `b5`, `b7`), viewport 164 / 1, editor 454 / 6, mesh-view 74, mesh-core 134, headless-tests 173, anim-core 671, doc 233, io 170, rig 202, curve-editor 207 / 3, doc-yjs 78, ui 87, web 16 |
| `pnpm run build` | OK; `check:size` **894,309 B ≤ 900,000 B** (headroom 5,691 B; +184 B over fix round 1: the `also` key and the continuation guard); the M6a eager-delta warning is the owner's pending allowance decision, not enforced |
| B10 e2e specs | E2E-MOD-02, -25, -26 list as `test.fixme` with their gates (skipped here); un-gated on the fix round 2 scratch integration: -25 and -26 pass, -02 fails only at B11's card `⌘E` (above) |
| Full e2e (`EKZA_E2E_PORT=3241 pnpm run test:e2e`, project `chrome`, local GPU Chrome) | **122 passed, 14 skipped** (gated), 0 failed (1.0 min) |
