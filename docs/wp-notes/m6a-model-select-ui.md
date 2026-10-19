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
| M6A-B10-1 | **Revisions.** The service tags each mesh's state with the revision (`MeshRuntime.ref.manifest`) it indexes and records each revision's sizes when it first sees it committed. A `set`/`remap` whose sizes differ from the committed revision's is **pending** (B7 stores the op's result inside the commit, before the batch moves the runtime) and becomes the new revision's state when the runtime follows; a rolled-back commit restores the committed state. When the runtime moves to another revision (undo, redo, a peer) the state remembered for that revision (last 24 per mesh) comes back, so undoing an extrude restores the face selection the op read and redo the op's result — without per-mesh snapshots in `TxMeta` (the runner's `selectionBefore/After` carry none yet, see Hand-over B11). A revision never seen keeps the selection when the sizes match and clears it otherwise; hidden sets are resized (new elements visible). | §4.6 "remap after topology commits", §5.6 "a mesh whose revision changed since the snapshot is skipped", §5.5 rule 2. B7's `data()` follows the edit mesh during a commit, so the runtime's own counts cannot tell a pending result from a committed change (found in the scratch integration, see Verification). |
| M6A-B10-2 | **Hidden components.** Component hides convert to faces (Maya): `H` in vertex/edge mode hides the faces the selection touches; `hidden()` returns the explicit sets plus the closure (an edge whose faces are all hidden, a vertex whose edges are all hidden), mesh-view's visibility rule (M6A-B6-6), so B2's walkers stop at the same elements the display hides. **Hidden picks stay stored** but `get()` (what ops, walkers, the HUD and the test API read) leaves them out; undoing a hide therefore brings the selection back as it was, and a replacing click or marquee drops them. | §5.6 "never op targets", "stop loop and ring walkers"; the §4.6 `HideSnapshot` has no selection, so a hide that deselected could not be undone exactly. |
| M6A-B10-3 | **`select.components` pass-through keys** (runtime only; `OperatorMap` is closed): `gesture: 'click' | 'marquee'` from the select tool. A click is remembered so a double-click's loop gesture reads the selection from **before** its first click (M6A-B2-6); a marquee over several hilited meshes runs once per mesh, the later runs with `mode: 'add'` (for a replace) and `RunContext.repeat`, so `recordSelection` merges them into one "Select" step. | §5.6 "every discrete gesture is its own step: … a marquee". |
| M6A-B10-4 | **Selection steps** record only when the gesture changed something (controls, objects or any per-mesh set, order or active); a click on what is already selected records nothing. Coalescing: auto-repeated grow/shrink (`RunContext.repeat`) and marquee continuations. Animate (`undoSelection.animate` false) is unchanged. | §5.6; a no-op step would make `Mod+Z` appear to do nothing. |
| M6A-B10-5 | **Digit vs F-key.** `F9` and `Digit1` (and `F10`/`Digit2`) are the same keymap row (`select.mode {mode}`), so the operator asks the pointer probe which key the keyboard adapter is dispatching (`lastKey`, from a capture-phase `keydown` listener of the viewport runtime): the active mode's digit returns to object mode, `F9`/`F10`, menus, the status line and scripts are idempotent. A keyboard run without a probe (headless) counts as a digit. | §5.6, §7 rows; changing the rows' args would be a §7 contract change and break B0b's keymap table test. |
| M6A-B10-6 | **Entering a component mode** hilites the selected meshes (records with data); with none the mesh under the pointer: a marking-menu run takes the **press point** of the menu (the RMB mode menu opened on the mesh), every other run the hover point. A mode item of the RMB menu on a mesh that is not hilited adds it (in object mode it joins the selected meshes). No candidate → "Select a mesh first". | §5.6 "Entering a component mode …", "RMB on another mesh … adds it to the hilite set". |
| M6A-B10-7 | **Returning to object mode** makes the hilited meshes the object selection (an `objects` "Select" step only when that changes it); an empty hilite never clears the object selection. A mode switch ends an open extrude session without a zero-drop (`app.extrude.end('mode', {drop: false})`). Conversions in Select › Convert, Ctrl+RMB and Border switch the mode to the result's kind (Maya), and `convertOnModeSwitch` converts touching. | §5.6, §5.8 (E2E-MOD-17 b). |
| M6A-B10-8 | **Replace clears the kind on every hilited mesh** (a click on mesh A drops B's selection of that kind); a click on empty space clears the current mode's selection on the hilited meshes; additive and removal gestures touch only the picked mesh. Double-click needs the same modifiers on both presses, ≤ 500 ms and ≤ 4 px apart (Shift-click then a quick Ctrl-click on the same spot is two clicks). | §5.6 click rules; Maya. |
| M6A-B10-9 | **Mirrored selection**: the service expands through the kernel's `expandSelection` (a local partner union while it is a stub); removal (Mod, a Shift toggle that turns off) on either side removes the pick and its partner; partners never reveal hidden components. The HUD's Selected column shows `N (+M sym)` from the same expansion. | §5.6. |
| M6A-B10-10 | **Object picking in Model** (object mode, the RMB menu's `over: 'mesh'`, the pointer probe) is a ray against each drawn mesh's triangulation (visible faces only), and an object marquee selects a mesh with a visible vertex inside the rectangle. mesh-view's meshes opt out of three's raycasting, so `ViewportManager.isOverMesh` asks this hit test through `setMeshHitTest` (without it the RMB mode menu never opened over a mesh). | §8.4 "RMB on a mesh"; B9's `isOverMesh` raycast could not see mesh-view surfaces. |
| M6A-B10-11 | **Framing** in Model: `F` frames the component selection (expanded, of the hilited meshes), else the selected mesh objects, else every mesh; `A` every mesh; outside Model, or with no mesh, the shipped bounds. A single point is padded to 10 cm. | §9 B10 "framing (F/A) on component selections". |
| M6A-B10-12 | **Status-line mode body**: B9's default body (`status-mode-<mode>`, `select.mode` with poll reasons, F-key labels from the keymap) is what B10 needs, so no replacement is registered. | Avoids two bodies for one behaviour. |
| M6A-B10-13 | **HUD**: Scene = the meshes the pane draws (hidden objects and the pane's isolate left out), Object = the hilited meshes (component modes) or the selected meshes (object mode), Selected = the visible picks of the current kind (tris of the selected faces in face mode; the selected meshes in object mode); UVs row = distinct (vertex, uv0) points when a mesh has UVs. Budget: the first worked-on mesh with a budget (`meshBudget`, own then parents), triangles of the worked-on meshes (else the pane's). Shown while the pane's `polyCount` flag is on (Model default). Recomputed once per microtask after a change; never per frame. | §5.24, §8.7. |
| M6A-B10-14 | **Mesh Check panel** checks one mesh (the lead hilited mesh, else the lead selected one, else the first editable mesh): rows per code with count, severity (✕ error, ◇ n-gon, ○ `open-border`), **Select** (`select.mesh.matching`: hilites the mesh and enters the problem's kind) and **Fix** (`mesh.cleanup {fix, selectOnly: false}` for codes with a §5.25 fix). While its body is shown, Model's panes get `meshCheck: true` and the display gets the problems; it says "Mesh Check arrives with the diagnostics package" while `checkMesh` is B5's stub. | §5.25; one mesh keeps the §8.10 `meshcheck-*-<code>` test ids unique. |
| M6A-B10-15 | **Component tools in object mode** (Multi-Cut, Insert Edge Loop, Target Weld, Slide, Paint Colour): activating one in object mode hilites (and opens) the selected meshes without changing the mode; the previous hilite list returns when the tool ends; entering a component mode takes over. The mesh under the pointer at the first pointer-down is the tool's to add (`model.hilite {add}`). | §5.6 "Component tools in object mode". |
| M6A-B10-16 | **Drop-zone card in Model**: the shipped "Drop a .glb or .vrm file" card shows while there is no character; in Model it now shows only while the scene has no mesh either — over a Model scene it covered the meshes at the pane centre and took their clicks (E2E-MOD-01/-02/-26 click there). | Found in the scratch integration; B13's Model start card owns the empty Model scene. |
| M6A-B10-17 | **The RMB press point** the operators' probe reads for marking-menu runs is the last right-button press in the pane; a left click on a drawn menu item (click-release menus) does not move it. | Otherwise choosing Face in a sticky RMB menu would look for the mesh under the menu item. |

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

## READY gates and E2E gates

- Unit: `editor-core/test/m6a/select/ready.ts` (`b2`, `b5`, `b7`), `editor/test/m6a-select/ready.ts` (`b5`). Gated: the
  walker operators (loop table, grow/shrink coalescing, convert, border) on `b2`; Mesh Check matching and the panel's
  rows on `b5`. `b7` gates nothing today (the service's revision tests run on the stub registry and pass on B7's
  runtime too).
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

## Hand-over

- **B7**: `components.set(id, sel)` inside `commitOp` is the intended path (a pending result); `remap` exists for ops
  that return no selection. `get()` excludes hidden components; `hidden()` includes the closure.
- **B11**: the runner's `TxMeta.selectionBefore/After` are built with `selectionSnapshot(selection, model)` (no
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
- **INT**: turn on the READY flags and the three `test.fixme` gates; the drop-zone and `isOverMesh` changes touch
  B9's files (above). Merging B7 conflicts with this branch only in the B0a foundation tests (`editor-core/test/m6a/
  foundation.test.ts` LANDED tables, `editor/test/test-api.test.ts`, `headless-tests/test/ops.m6a-foundation.test.ts`,
  `apps/web/e2e/m6a-00-foundation.spec.ts`): keep both sides' landed operators. Decide the eager allowance with
  B10's +12,044 B in mind (above).

## Eager route size (§5.27)

`check:size` on this branch: **893,227 B ≤ 900,000 B** (headroom 6,773 B); the pre-B10 base (the B9 + B6 merge,
67734e8) measures 881,183 B, so **B10 adds +12,044 B** (gzip -9) to the eager route. Both boundaries hold (the kernel
and mesh-view stay lazy: the Model select runtime, the HUD, the Mesh Check body and the marking-menu drawing are lazy
chunks). The eager part is mostly editor-core: the selection service (`editor-core/src/selection`: 5.4 kB) and the
mode, selection and hide operators. If INT needs the bytes for B11–B13 under the allowance the owner decides
(M6A-B9-14), the candidates are: the service's implementation behind the kernel load (an eager facade that answers
"nothing stored" until the mesh kernel and the implementation chunk have loaded; B7's commit already tolerates a
`not-implemented` writer), and the walker operators' bodies behind an async `prepare`.

## Gates

| Gate | Result |
|---|---|
| `pnpm run format:check` | clean (1,198 files) |
| `pnpm run lint` | 0 findings |
| `pnpm run typecheck` | clean |
| `pnpm run check:deps` | 15 packages follow the rules |
| `pnpm run test` | 15/15 tasks: editor-core 894 passed / 4 skipped (B10 gates), viewport 160 / 1, editor 451 / 3, mesh-view 74, mesh-core 134, headless-tests 173, … |
| `pnpm run build` | OK; `check:size` 893,227 B (see above) |
| B10 e2e specs | E2E-MOD-02, -25, -26 list as `test.fixme` with their gates (4 tests skipped) |
| Full e2e (`EKZA_E2E_PORT=3171 pnpm run test:e2e`, project `chrome`) | **122 passed, 14 skipped** (gated), 0 failed |
