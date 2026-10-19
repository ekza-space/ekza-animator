# M6a B9 — Shell: workspaces, marking menus, command palette, Scale tool, shading, overlay slots, size gate: build notes

Branch `m6a/shell-workspaces` (from `m6a/spec` at `ec541b4`, with `m6a/contracts-foundation` merged at `4d70522` and
`m6a/keymap-menus` (B0b) merged at `3289791`). Scope:
[M6A-SPEC §9 B9](../M6A-SPEC.md#b9--shell-workspaces-marking-menus-command-palette-scale-tool-shading-overlay-slots-size-gate)
with the shared-file roles of §9.1. Decision IDs below are `M6A-B9-<n>`.

## What landed (by spec responsibility)

| B9 item | Where |
|---|---|
| Workspace tabs `Model › Rig & Skin › Animate › Review` with glyphs (§5.17, §8.1) | `editor-core/src/workspaces/index.ts` (Model, Rig & Skin and Review definitions, Model's status glyph, `workspaceTabs`); `editor/src/shell/WorkspaceTabs.tsx` (`ws-tabs`, `ws-tab-<id>`, `ws-glyph-<id>`, role `tablist`, text tooltips, short labels below 1280 px) in `MenuBar.tsx` |
| Switching rules (§5.17) | `editor-core/src/workspaces/switch.ts` (`switchWorkspace`, `workspaceProblem`); `workspace.set` in `operators/builtin/workspace.ts`; the boot path (`ws=`, else `prefs.lastWorkspace`) in `editor/src/shell/EditorRoot.tsx` |
| Per-workspace dock layouts (§4.8, §8.2) | `editor/src/shell/layout.ts` (`MODEL_SLOTS`, `buildModelLayout`, versions per workspace: Animate v2, Model v1), `editor/src/shell/workspace.ts` (one dockview, the layout JSON swapped when `session.workspace` changes) |
| Per-workspace `viewportLayout`/`maximizedPane` and pane display memory | `session.workspaceViews` in `switchWorkspace`; `viewport/src/manager/workspaceViews.ts` (`MODEL_DISPLAY`, Model's M-Side cameras) and the `<workspace>:<paneId>` memory of `ViewportManager` (`setWorkspace`, `paneSetup`) |
| Menus, status-line groups, timeline visibility | B0b's `MODEL_MENUS`; `StatusLine.tsx` renders the workspace's `statusGroups`; Model's groups in `shell/statusGroups.tsx` (lazy) with `shell/statusGroupRegistry.ts`; `TimelineRegion.tsx` hides the time slider in Model, `workspace.toggleTimeline` (Windows › Timeline) shows it |
| Generic `MarkingMenu` (§5.18) | `editor/src/overlays/MarkingMenu/` (`controller.ts` lazy: trigger matching, flick, press-drag-release, click-release, key tap/hold, disabled reasons, Esc; `MarkingMenuView.tsx` lazy: `mm-<menuId>`, `mm-slot-<N…NW>`, `mm-item-<n>`; `index.tsx` eager facade) |
| Command palette `Mod+K` (§5.18) | `editor/src/overlays/CommandPalette/` (`controller.ts` lazy: fuzzy search, aliases, workspace entries, menu variants, the params prompt; `CommandPaletteView.tsx` lazy: `cmdk`, `cmdk-input`, `cmdk-item-<operatorId>`; `index.tsx` eager facade); `ui.commandPalette` / `ui.markingMenu` through `editor-core/src/workspaces/ports.ts` |
| Viewport Scale tool (`R`) | `viewport/src/tools/scaleTool.ts` (eager definition), `viewport/src/manipulators/scale/{math,tool,kit,load}.ts` (lazy chunk), the scale handles in `ManipulatorKit.ts`, `DragControl.s0`/`keyable.s` in `drag.ts`, object targets in `viewport/src/manager/objects.ts` |
| Shading `4`–`7` and the new `DisplayFlags` | `view.shading`, `view.display.set` (editor-core, through the pane display port); `view.display.toggle` takes every boolean flag; `viewport/src/manager/shading.ts` (character models per pane); Model pane header: `pane-shading-<paneId>`, `pane-show-<paneId>-<flag>`, Wire/Flat/X-ray/Cull (`PaneView.tsx`) |
| Pointer platform rules (§5.17) | `ViewportManager.pointerDown` (`contextmenu` never RMB; marking-menu presses through `setPointerMenus`; a placing/dragging tool keeps its presses), `navigation/profiles.ts` `isMmbStandIn` (Alt+Shift+LMB = MMB in Model on trackpad/one-button; the virtual slider gets `standIn`, M6A-B9-22) |
| Camera layers 6–9, `addMeshLayer` | `viewport/src/layers.ts`, `viewport/src/manager/meshLayers.ts`, `ViewportManager.addMeshLayer` (applyPane before each pane render) |
| Overlay slots | `editor/src/overlays/slots/index.tsx` (`registerPaneOverlay`, `registerShellOverlay`, `PaneOverlays`, `ShellOverlays`) in `PaneView.tsx` and `EditorShell.tsx` |
| `pixel` probe | `ViewportManager.readPixel`, `viewportTestApi().pixel`, `editor/src/test-api/m6a/shell-workspaces.ts` (`pixel`, `markingMenu`, `commandPalette`) |
| Image planes on layer 9 for B13 | `viewport/src/manager/imagePlanes.ts` (lazy), `ViewportManager.setImagePlanes(specs)` / `imagePlanesIn(paneId)` |
| `check:size` | `apps/web/scripts/check-size.mjs` (eager-delta gate, Model chunk warning, attribution report, the `marking-menu` and `command-palette` boundaries), `apps/web/scripts/size-baseline.json`, `attribute-chunks.mjs` (`attributeFiles`) |

## Decisions and deviations

| ID | Decision | Why |
|---|---|---|
| M6A-B9-1 | **B0b merged into this branch** before building (B9 takes over B0b's keymap, keyboard and menu files, §9.1; B0b merges first, §11.1). | Building on B0b's scope chain, `MODEL_MENUS` and `helpHints` instead of re-creating them avoids conflicts at INT. |
| M6A-B9-2 | **Ports instead of moving operators**: `view.shading`, `view.display.set`, `ui.commandPalette` and `ui.markingMenu` stay registered with the editor-core built-ins (headless scripts, menus and the palette see them) and reach the ViewportManager and the shell through `providePaneDisplay` / `provideShellOverlays` (`editor-core/src/workspaces/ports.ts`); without a port they poll-fail ("No viewport pane", "The command palette needs the editor window"). | A registry id can be registered once; B0a's stubs live in editor-core (M6A-B0A-15) and the pane display lives in the viewport. |
| M6A-B9-3 | **Leaving Model drops to object mode by writing `session.model.componentMode`** (and `lastComponentMode`) inside `workspace.set`; it ends the extrude session (`app.extrude.end('workspace', {drop: false})`), disarms the capture, and closes a live Last-op card with `LastRun.closed = LEFT_MODEL_REASON` ("Left the Model workspace"). The ViewportManager cancels a running tool gesture on the switch; B8's display rebuild follows `session.workspace` itself. | `app.run` inside `apply` throws `nested-run`, so B10's `select.mode` cannot be called; **B10**: close the edit links of hilited runtimes by following `session.model.componentMode` (not only inside `select.mode`). |
| M6A-B9-4 | **Tool and pick mask per workspace** are remembered per app (not a session field): the first entry takes `WorkspaceDef.defaultTool`/`pickMask`, later entries what the user left. | §5.17 makes them workspace properties; `SessionState` has no field for them and is closed after B0a. |
| M6A-B9-5 | **Pane memory per workspace includes the camera binding**; the view cameras (where a pane id looks from) stay shared, so the persp camera survives a switch. Model's split layout is **M-Side** (`front \| persp`): `pane-left` looks through `front` in Model. `ViewportLayout` is unchanged (`single \| split \| quad`). | §8.2 presets M-Single/M-Quad/M-Side without a new layout id. |
| M6A-B9-6 | **Model's pane display** (`MODEL_DISPLAY`): §4.6 Model defaults plus `controls: false` (rig controls are not drawn in Model, whose pick mask has no controls). | §5.17 "control selection carried over from Animate is never keyed unseen". |
| M6A-B9-7 | **Character shading per pane** by swapping materials around the pane's main pass (`CharacterShading`): `wire` = wireframe in `--wire-wiremode`, `shaded` = Lambert `--clay`, `colours` = Lambert with each material's base colour and texture, `lit` = the model's own materials (no swap). `flat`/`cull` apply to the shading materials only; `wireOnShaded` adds a wireframe pass (`--wire`) over the characters; MToon outline materials are hidden outside `lit`. Mesh-view surfaces shade themselves through `applyPane`. | §4.7 defines the four modes for "the mesh"; the characters' own (MToon) materials are not cloned. |
| M6A-B9-8 | **The new pane header controls show in Model only**: Shading ▾, Show ▾ and Wire/Flat/X-ray/Cull. Animate's header is the shipped one; `4`–`7` and `view.shading` work in both. | §3 rule 10: Animate changes only where the spec names them. |
| M6A-B9-9 | **Marking menus**: specificity picks between matching menus (a `when.modes` match scores 2, `when.over` 1; ties by registration order); the dead zone and flick distance are 20 px, slots are 45° sectors of filled slots only; releasing inside the dead zone (a click-release, or a press held still) leaves the menu open; a press outside an open menu closes it and is swallowed; submenus open in place and stay open for a click; `ui.markingMenu` from the keyboard (the key still held) follows the key, from menus or the palette it opens for a click at the last pointer position. The drawing appears after the 250 ms flick window (at once for a click-release or a tap). A tool in phase `placing`/`dragging` gets RMB first (Multi-Cut completes). The press hook is `ViewportManager.setPointerMenus(handler)` with `PanePointerPress.overMesh()` (a raycast of the character meshes and the mesh-layer roots). | §5.18 leaves selection between menus and these details open; §5.17 rule (a). |
| M6A-B9-10 | **Command palette entries**: one per workspace (`Workspace: <label>`, `cmdk-item-workspace.set:<id>`), the menu items with arguments as variants of their operator (`cmdk-item-<op>:<menuItemId>`; menu labels, workspace and mode filters), then every other non-internal operator visible in the workspace (`cmdk-item-<op>`). Disabled entries stay listed with their poll reason. The prompt asks for the operator's value-bound, shown, non-data params (primary first), starting from `prefs.modeling.optionDefaults[op]`; typed angles are degrees, fractions take `0.3` or `30%`. `ui.commandPalette` carries the aliases Search, F3 Search, Menu Search, Find Command. | §5.18 lists operators; menu arguments ("Four View", "Export…") and workspaces are what a user searches for. |
| M6A-B9-11 | **Scale tool on scene objects commits one document gesture** (`beginKeyEditGesture`, label "Scale") that patches `meshes`/`groups` placements about each object's pivot, instead of running B12a's `scene.object.transform`. Scale handles use object axes; an axis scales by the ratio of the positions along it (crossing the pivot mirrors, Maya), the centre cube by `1 + (dx − dy)/size` (≥ 0.01). Object targets show only for the Scale tool in Model's object mode; move/rotate on objects stay B12a's. | B12a owns object W/E/R commits; the Scale tool must work at B9's merge (§9 B9 tests "Scale tool on a mesh object … (undo)"). B12a may route the commit through `scene.object.transform`. |
| M6A-B9-12 | **Overlay slots**: `registerPaneOverlay(slot, Component)` for `hud` (top-left, B10), `bindPose` (bottom-right, B10), `emptyState` (centre, B13), `gettingStarted` (top-right, B13), `lastOpCard` (bottom-left, B11), `modalReadout` (whole pane, B12a); `registerShellOverlay('optionBox', Component)` (B11). The latest registration of a slot draws; slot wrappers are `pointer-events: none` (interactive overlays set `pointer-events: auto`). Model status bodies: `registerStatusGroup(id, Component)` replaces B9's default bodies (`mode`, `symmetry`, `soft`, `snap`, `pivot`), which read the session and run the owners' operators, disabled with their poll reasons until those land. | §4.8 names `registerPaneOverlay(id, component)`. |
| M6A-B9-13 | **New panel kinds as strings**: `MODEL_PANEL = { toolkit, palette, meshCheck }` in `shell/layout.ts`; `editor-core/src/types.ts` `PANEL` (closed after B0a) does not have them yet. **Contract PR for INT**: add them to `PANEL` (§4.8). | §9.1: the types file is closed. |
| M6A-B9-14 | **Eager allowance not enforced yet**: `size-baseline.json` records the M2a route (845,267 B) and the §5.27 allowance (+20,480 B) with `enforce: false` and the pending owner decision; `check:size` prints the delta and a `WARN` until INT sets `enforce: true` with the decided allowance (an enforced, exceeded delta fails the gate; e2e builds are never compared). The 900,000 B gate and every lazy boundary stay hard gates. | M6A-B0A "Decision requested: the M6a eager allowance": B0a alone used +19,160 B, B0b +4,806 B; the gate as written cannot be green before the owner decides (options A/B/C there). |
| M6A-B9-15 | **Model workspace chunk** = the lazy groups of the `mesh-kernel`, `mesh-view` and `marking-menu` boundaries (configurable in `size-baseline.json`), warned above 250,000 B. The chunk attribution report prints when the build carries source maps (`ANIMATOR_SOURCE_MAPS=1`). | §5.27 names the chunk, not its contents. |
| M6A-B9-16 | **Lazy by default**: the marking-menu and command-palette controllers and drawings, Model's status bodies, the Scale tool's behaviour and maths, and the image-plane layer load on demand (Model entry, first use, first planes). Until the scale chunk has loaded no scale manipulator shows and a press does nothing; `setImagePlanes` returns a promise. A viewport press starts the marking-menu load only where menus exist (`marksMenus`: Model, or a workspace a registered menu lists — the prefetch's rule), so a click in Animate loads nothing (fix round 1). | §5.27 eager budget; see "Eager route" below. |
| M6A-B9-17 | **`view.tool` in Model records the last non-transform viewport tool** in `session.model.lastTool` (Maya's `Y` skips Q/W/E/R); the built-in M6a tools that are not registered yet poll-fail "not available yet" instead of "Unknown viewport tool". | §6.2 `view.tool` (changed). |
| M6A-B9-18 | **Model's status glyph** reads Mesh Check through the loaded kernel's `checkMesh` (B5; a stub reads as clean) per runtime version and the triangle budgets of §5.24 (`BUDGET_TRIS` in editor-core, the mesh's or the nearest parent's budget). INT may point it at B8's `io/profiles/budgets.ts`. Disabled tabs carry no glyph. | §5.17 glyph rules; B8's table is not in this branch. |
| M6A-B9-19 | **`panes()` rows also report `shading`** (additive runtime field; the §4.8 type lists the M1 fields), so specs can read a pane's shading (E2E-MOD-19 `4` → wire). | The test-API types file is closed after B0a. |
| M6A-B9-20 | **Windows menu**: Model lists its own panels (Toolkit, Palette, Mesh Check) and Timeline; the layout submenu has Model's presets (Single, Four View, Front \| Persp) there and Animate's in Animate. Reset Workspace resets the current workspace's layout. | §8.2 presets, "Windows › Timeline shows it". |
| M6A-B9-21 | **No control edits from a Model pane** (fix round 1): in Model the ViewportManager builds no manipulator from `selection.controls` — move and rotate show none (B12a adds object and component targets), Scale sits on objects in object mode and shows none in component modes — and the pane's MMB virtual slider leaves control channels alone unless that pane draws controls (Show ▸ Controls). Animate is unchanged. | §5.17: Model neither draws nor picks controls, and a control selection carried over from Animate is never edited or keyed unseen (the same reason as the `model.animateOnly` rows). |
| M6A-B9-22 | **The MMB stand-in reaches the virtual slider as MMB**: `startVirtualSliderDrag` takes an optional `standIn` (default false) that reads Shift as released for the whole gesture and keeps `Mod` ×10; the ViewportManager passes it for stand-in presses. **Contract note for B12a** (`virtualSliderDrag.ts` is B12a's file): the option is additive; B12a's INPUTS-field slider from the viewport MMB rule must pass it through as well. | §5.17 (b): delivered as MMB with Alt and Shift cleared, the INPUTS virtual slider among its targets. |
| M6A-B9-23 | **E2E fixture marking menu**: the test API registers `e2e.fixture` (plain RMB in Model: N Wireframe, S Shaded, E disabled, list Lit) on e2e pages opened with `mmFixture=1`, read from `location.search` in `test-api/m6a/shell-workspaces.ts` (the test-API types and `params.ts` are closed). | The pointer-rule (a) e2e must show a real right-button press opening a registered menu while `contextmenu` alone opens nothing, before B10/B11 register the real menus. |

## Literal updates (§3 rule 9)

- `editor-core/test/m6a/foundation.test.ts`: the built-ins register Model, Rig & Skin, Animate and Review; the
  poll-fail loop accepts the landed B9 operators' own reasons.
- `headless-tests/test/ops.m6a-foundation.test.ts`: the four workspaces.
- `editor/test/test-api.test.ts`: `workspaces()` lists the four tabs; `pixel` has landed (no viewport → `[0, 0, 0, 0]`).
- `viewport/test/operators.test.ts`: the viewport tools include `scale` (§3 rule 10 "R selects the new Scale tool").
- `viewport/test/testApi.test.ts`: `panes()` rows carry `shading`.
- `apps/web/e2e/m6a-00-foundation.spec.ts`: the poll-fail loop skips `ui.commandPalette`, which opens the palette
  without arguments (asserted and closed); the Model-tab test's `b9` gate is lifted. `m6a-03-mod-e-scopes.spec.ts`:
  part (a)'s `b9` gate is lifted.

## Minimal edits in files other packages own

- `viewport/src/tools/virtualSliderDrag.ts` (B12a): the optional `standIn` option (M6A-B9-22), three lines in the
  move handler and the initial motion; nothing else changes.

## Eager route (§5.27)

Production build, `check:size` (gzip -9, first visit): B0b merged **869,233 B** → this branch **880,433 B** (B9
**+11,200 B**, fix round 1 included; gate 900,000 B green, headroom 19,567 B; no boundary violation). Lazy-loading the
marking menu, the command palette, Model's status bodies, the Scale tool and the image planes took B9 from +16.1 kB to
+11.1 kB. The eager B9 code is the workspace definitions, status and switching rules, the workspace operators
(≈ 3.4 kB), the workspace tabs, slots and facades (≈ 2.1 kB), the per-workspace pane memory, character shading,
mesh-layer hosting, pointer rules and scale handles in the viewport, and the shell changes (status line, help line,
pane header, layout swap). M6a total: **+35,166 B over the M2a baseline** (allowance +20,480 B: not enforced,
M6A-B9-14). Model workspace chunk: 22.5 kB (kernel and marking menu; mesh-view has no consumer in this build).

## DoD status

| DoD item | Status |
|---|---|
| CI green | Local gates green (below). |
| `check:size` passes with both gates | **Not met; waived by an open owner decision.** The 900,000 B gate passes (880,433 B). The +20,480 B eager-delta gate is not enforced (`size-baseline.json` `eagerDelta.enforce: false`, M6A-B9-14) because the allowance is the owner's number (MODELING-PLAN R38, M6A-SPEC §12.4, "Decision requested" in the B0a notes). Against the options there: **A** (+40,960 B over M2a, limit 886,227 B) passes with 5,794 B to spare; **B** (+20,480 B from the B0a merge, limit 884,907 B) passes with 4,474 B; **C** (+20,480 B over M2a, limit 865,747 B) fails by 14,686 B. When the owner decides, INT sets `enforce: true` with that allowance and re-runs `check:size`. |
| READY flag `b9` | Set by INT at merge (the `b9` gates of the foundation e2e and E2E-MOD-03 (a) are lifted on this branch). |

## Hand-over

- **B10**: register `model.modes`/`model.convert` marking menus (`app.contribute({kind: 'markingMenu'})`; the press
  routing, gestures and drawing are here); replace status bodies with `registerStatusGroup('mode', …)` if needed;
  register the HUD with `registerPaneOverlay('hud', …)` (and `bindPose`); load the mesh display with
  `loadMeshDisplay({ app, target: vm })` — `ViewportManager.addMeshLayer` and `invalidate` are B6's `MeshLayerTarget`;
  follow `session.model.componentMode` to close runtimes when `workspace.set` drops to object mode (M6A-B9-3).
- **B11**: `model.tools.*`, `model.primitives`, `model.merge` menu data; the Last-op card in
  `registerPaneOverlay('lastOpCard', …)`; the option box in `registerShellOverlay('optionBox', …)`; the palette prompts
  operators with `params` from `prefs.modeling.optionDefaults`.
- **B12a**: `model.options` menu data; `registerPaneOverlay('modalReadout', …)`; symmetry/soft/snap/pivot status
  bodies are defaults over your operators; the Scale tool's object commit (M6A-B9-11) and the MMB stand-in
  (`button 1`, Alt/Shift cleared) are in place for the MMB rule. `refreshManipulator` builds no control target in
  Model (M6A-B9-21): add the object and component targets there, never a fallback to `selection.controls`. Pass
  `standIn` to `startVirtualSliderDrag` for the INPUTS-field slider too (M6A-B9-22).
- **B13**: `ViewportManager.setImagePlanes(specs)` draws decoded planes per ortho pane (behind/front, opacity, size,
  offset; never picked); `registerPaneOverlay('emptyState' | 'gettingStarted', …)`; the Model layout has the
  Palette tab placeholder (`palette` kind).
- **B6/INT**: one `MeshLayerHost` declaration (B6's `viewport/src/mesh/display.ts` and B9's
  `viewport/src/manager/meshLayers.ts` have the same shape; this branch does not export B9's from the package index,
  so B6's exports win); `LAYER.meshComponents … helpers` = 6…9 as B6's `MESH_LAYERS`.
- **INT**: decide the eager allowance (M6A-B9-14) and set `enforce`; add `toolkit`, `palette`, `meshCheck` to `PANEL`
  (M6A-B9-13); the B6 bench's `b9` gate can be lifted.

## Gates (local, real Chrome; port 3170)

Fix round 1 (HEAD after the fix commits, clean tree): `format:check`, `lint`, `typecheck`, `check:deps`,
`check:fixtures`, `check:licenses` green; `test` (turbo `test test:tooling --force --concurrency=3`, CI unset) 15/15
tasks green: anim-core 671, doc 233, doc-yjs 78, mesh-core 134, mesh-view 2, io 170, rig 202, editor-core 859,
curve-editor 207 + 3 skipped, viewport 126 + 1 skipped, editor 425 + 1 skipped, headless-tests 173, ui 87, web 16,
tooling 14; `build` green; `check:size` 880,433 B ≤ 900,000 B (eager-delta warning, M6A-B9-14 and "DoD status"); B9
e2e (`m6a-shell.spec.ts` 8, the lifted `m6a-00-foundation` and E2E-MOD-03 (a)) green; the full e2e suite
(`EKZA_E2E_PORT=3170 pnpm run test:e2e -- --workers=4`, project `chrome`) **120 passed, 10 skipped, 0 failed** (B0b:
110 passed, 12 skipped; +8 shell checks, +2 lifted gates).

Fix round 1 added: viewport tests for a control selection carried over to Model (no W/E/R manipulator in any mode,
no edit from a drag where its handle was, no MMB slide while the pane hides controls) and for the stand-in's virtual
slider (40 px with Alt+Shift held = 40 px MMB = +20°, `Mod` ×10, `standIn` on `startVirtualSliderDrag`); a component
test that a press in Animate loads no marking-menu controller; the shell e2e with the `e2e.fixture` menu (a real
right-button press opens `mm-e2e.fixture`, press-drag-release and a flick run its slots, `contextmenu` alone opens
nothing) and a Polybot cog carried from Animate into Model (no manipulator, no unseen slide; with Show ▸ Controls the
stand-in slides at the MMB rate).
