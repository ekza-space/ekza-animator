# M6a B11 — Operators UI: registration, Toolkit, Last-op card, INPUTS, adjust/repeat, capture: build notes

Branch `m6a/model-ops-ui` (from `m6a/spec` at `ec541b4`, with `m6a/shell-workspaces` (B9) and `m6a/mesh-runtime-doc`
(B7) merged, as its dependsOn says). Scope:
[M6A-SPEC §9 B11](../M6A-SPEC.md#b11--operators-ui-registration-toolkit-last-op-card-inputs-adjustrepeat-capture).
Decision IDs below are `M6A-B11-<n>`.

## What landed (by spec responsibility)

| B11 item | Where |
|---|---|
| Registration of every §6.1 `mesh.*` op from its descriptor through `meshOperator`/`meshSetOperator` (no kernel in the eager route): Maya labels, Blender names as palette aliases, the tool `G`/`Y` re-activate, internal ops, descriptions, Extrude's help-line wording; the twelve ops whose §6.1 Modes add `object` run on whole meshes in object mode (M6A-B11-17) | `editor-core/src/operators/builtin/mesh/{index.ts,whole.ts}` |
| `coerceArgs` with `passThrough: def.extraArgs` in the runner; option-box defaults for UI runs; "(adjusted)" step label; `reconcile()` after a failed run (M6A-B7-26) | `editor-core/src/operators/runner.ts` |
| LastRun recording (resolved args, kind, step, store version, pane, source, flags, targets, seed, symmetry/soft context), the polls, `tool.last` (`Y`), `view.lastOpCard` (`T`, with the extrude reopen), the B11 runtime chunk's loader (`loadOpsRuntime`, M6A-B11-19) | `editor-core/src/operators/builtin/lastop.ts` (eager) |
| The card-closing tracker (§5.7 table), the adjust engine, card previews (`beginCardPreview`) | `editor-core/src/operators/builtin/lastopEngine.ts` (lazy) |
| `edit.adjustLast` (undo + re-run with the recorded targets and kind, history length kept, refusal → redo), `edit.repeatLast` (the source rule), the `edit.undo`/`edit.redo` extrude-session hook | `editor-core/src/operators/builtin/edit.ts` |
| The numeric capture window (§5.10) behind `app.capture`: the eager shim (state, listeners, binding), the Last-op card's open state, the selected INPUTS field (for B12a's MMB rule), `visibleParams`/`numericParams`; the state machine is lazy | `editor-core/src/edit/capture.ts`, `editor-core/src/app/factories/capture.ts`, `editor-core/src/edit/captureEngine.ts` (lazy) |
| `parseParamInput` (the shipped grammar + the fraction rule, m/cm/mm, degrees, ints, nullable "auto") and the display texts (`0.500 m`, `0.300`, `30.000°`) | `editor-core/src/edit/paramInput.ts` |
| Shift+RMB tools menus (`model.tools.object/vertex/edge/face`), `model.primitives`, `model.merge` (§8.4) | `editor/src/overlays/menus/{tools,primitives,merge}.ts` |
| Option box popover, capture bridge (pointer slop, clicks, help-line messages), menu registration (a lazy chunk mounted on the first Model entry by the eager `ModelOpsSlot`) | `editor/src/overlays/menus/optionBox.tsx`, `editor/src/panels/toolkit/{ModelOpsSlot.tsx,OptionBoxView.tsx}` |
| Modeling Toolkit (§8.5; lazy body) | `editor/src/panels/toolkit/{index.ts,ToolkitPanel.tsx,ToolkitView.tsx}` |
| Last-op card (§8.6): eager pane-slot facade, lazy view; shared parameter fields with label virtual sliders and param-group sections (`ParamSections`) | `editor/src/panels/viewport/LastOpCard.tsx`, `editor/src/panels/toolkit/{LastOpCardView.tsx,ParamField.tsx,slider.ts}` |
| Channel Box of a mesh/group object in Model: TRS rows (`scene.object.transform`), SHAPES, INPUTS primitive and last-op entries (§8.6; lazy) | `editor/src/panels/channel-box/{MeshChannels.tsx,ChannelBoxPanel.tsx}` |
| Test API B11 group: `lastOp`, `lastOpCard`, `helpLine`, `history` | `editor/src/test-api/m6a/model-ops-ui.ts` |
| E2E-MOD-07, -09, -19, -32 (gated, §10.1 Gates) plus ungated B11 checks in the same files | `apps/web/e2e/m6a-{07,09,19,32}-*.spec.ts`, `apps/web/e2e/helpers/m6a-model-ops-ui.ts` |

**READY flags for B11's dependents**: B12a/B12b/B13 can probe B11 by `app.operators.get('edit.adjustLast')` not
answering "not available yet", or by `registeredMeshOperator` being exported from `@ekza-animator/editor-core`.

## Decisions and deviations

| ID | Decision | Why |
|---|---|---|
| M6A-B11-1 | **Resolved args of kernel ops**: the registration's `apply` makes the same calls as B7's `meshOperator.apply` (`kindOf`, `targetsOf`, `runSeed`, `runSettings`, `commitOp`) and remembers `MeshCommitResult.resolvedArgs` for the outcome it returns (`rememberResolvedArgs`); `MeshOpOutcome` is a closed contract without the field, and `mesh/operator.ts` is B7's. For `mesh.create.*` the record's `generator.params` are the resolved args (the preferred default set applied). | §5.7 "`OpResult.resolvedArgs` for kernel ops". |
| M6A-B11-2 | **Runner coercion passes on only the keys the run was given** (validated: clamped, rounded, enum-checked, `data` schemas, unknown keys dropped, `extraArgs` untouched); the defaults of absent params stay the operator's to resolve. Filling `ParamDef.default`s in the runner overrode `prefs.modeling.primitiveDefaults: 'maya'` (the low-poly defaults are the descriptors') and the kernel's nullable "auto" and selection-bound resolution. The LastRun still records every param (resolved, else default). **Option-box defaults** (`prefs.modeling.optionDefaults[id]`) start runs from the keyboard, menus, marking menus, the Toolkit, the palette and tools; never scripts (`source` absent/`api`) or card re-runs. | §4.6 "`coerceArgs` … so a script, a palette prompt and the card all pass the same checks"; §8.5 "defaults for the next run". |
| M6A-B11-3 | **An adjusted re-run keeps the recorded source, pane, tool, seed, context, kind and targets**: it is the same operation with new values. So `G` after a card edit of a tool run still re-activates the tool (rule 1). The re-run is recognised as `source: 'card'` of the operator `edit.adjustLast` is re-running (as B7's `adjustedRun`). | §5.7 rules; M6A-B7-20. |
| M6A-B11-4 | **The tracker** closes on: a local store batch ("Another operation ran"), undo/redo batches or history navigations ("Undone"), a load ("The project changed"), object/control selection changes, a hilite set change, a component-service version change ("Selection changed"), a workspace change, symmetry of a target mesh or soft-select settings ("Settings changed"), remote/import/migration/cleanup batches touching a target mesh ("Changed by another user"). A preview batch, or a remote batch touching no target, refreshes `docSeqAfter` (the card stays live **and adjustable**; the poll's `store.version === docSeqAfter` then means "no untracked write since"). An update that installs or replaces `lastRun` itself never closes it (the recorder, B9's workspace switch). A run that recorded a step but does not qualify closes the card; selection-only operators close it as "Selection changed". Fix round 2 (B10's service, found on a merge): the run's **own result selection** is part of the run — the recorder reads the run's meshes and the hilited ones (`settleSelection`) before it installs the LastRun and takes the baseline, because B10 publishes a pending result on its next read, else in a microtask after the baseline; a **card preview** holds the selection check from `beginOp` until its adjust or cancel (B10 follows the runtime that re-shows the pre-op mesh; a cancel re-takes the baseline); a selection publish while the store version differs from the LastRun's leaves the reason to that batch (B10 follows the runtimes before the tracker's store listener: an undo is "Undone", not "Selection changed"; a peer's batch that keeps the card re-takes the baseline). | §5.7 table; the version rule would otherwise make any peer's edit elsewhere kill adjustability. |
| M6A-B11-5 | **✕ hides the card** (`lastOpCardState.dismissed`), `lastRun` stays live: `G` repeats and `T` brings the card back. A new operation shows its card collapsed; adjusted re-runs keep the card as it is. A hidden card stays hidden when its LastRun closes (fix round 2: no "closed" pill for it). | §8.6 "✕ closes the card but keeps lastRun for G"; Maya's `T`. |
| M6A-B11-6 | **Capture binding and rules**: `createCapture()` gets no deps (the composition root is closed), so `bindCapture(app)` binds it on first use (the runner, `registerBuiltins`). Case (b) arms only in Model, for an adjustable `lastRun` with a visible primary param, after a `source: 'keyboard'` run (incl. `G`). `Enter` with or without an entry disarms (b); `Esc` cancels an entry, then (no entry) disarms and passes on (edit.escape ends the extrude session); `Backspace` without an entry is not part of one: it disarms and reaches the keymap (Maya's Delete); an entry erased to nothing is no entry (fix round 2): `Enter` disarms (b) quietly, nothing is "discarded", a nullable field's empty entry still means "auto", and further `Backspace`s stay in the window. After an entry started, only the grammar's characters extend it: digits, `. , + - * / = ( ) % °`, space and the unit letters `a c d e g m r` (`m`, `cm`, `mm`, `deg`, `rad`, exponent). Modifier keys never disarm. The window closes with the card. Committed values are announced on the help line (the polite live region). | §5.10. |
| M6A-B11-7 | **Where B11's editor parts register**: `registerToolkitPanel` (one line in `panels/index.ts`, the owners' hook) registers the Toolkit panel, the `lastOpCard` pane overlay and the `optionBox` shell overlay; the shell overlay loads and registers the marking menus on the first Model entry (a lazy chunk; B9 prefetches its controller when a menu of the active workspace is registered) and binds the capture bridge. **"Primitive Options…" (primitives NW) is disabled** with "Primitive options are in the Modeling Toolkit (⋯)": §6.2 has no operator that opens an option box. Contract-PR suggestion for INT: `ui.optionBox {op}`. | §4.8 slots; no shell hook with the app for owners. |
| M6A-B11-8 | **Overlays inside a pane stop `pointerdown` natively**: the pane surface (`ViewportManager.attachInput` on the element that also holds the overlay slots) takes every press and captures the pointer, so a click on the card was retargeted. The card's root stops `pointerdown`/`wheel`; the parameter label listens to its own presses natively (React never sees a stopped press). **Suggestion for B9/INT**: ignore presses whose target is inside an interactive overlay (`pointer-events: auto` element of a slot) in `ViewportManager.pointerDown`, so every owner's overlay works without this. | Found by the B11 e2e check. |
| M6A-B11-9 | **Extrude's poll wording** (B0b's M6A-B0B-5 asked B7 or B11): in object mode, without selected faces/edges or over other panels "Select faces or border edges" (§7); in vertex mode "Vertex extrude is not available yet" (§6.1). Other ops keep B7's wrapper reasons. The vertex marking menu's S slot is the shared `mesh.extrude` item, so it shows that poll reason (fix round 1; it was a static item with other words). | §7 `Mod+KeyE`, §6.1 Extrude notes, §8.4. |
| M6A-B11-10 | **INPUTS field selection** lives in editor-core (`selectedInputsField`/`selectInputsField`, `{entry: 'lastop' \| 'primitive', mesh, param}`); B12a's MMB rule reads it and drags that field (an `edit.adjustLast` for `lastop`, the primitive's adjust/`mesh.primitive.set` for `primitive`). A primitive edit right after the creation is `edit.adjustLast` of `mesh.create.<kind>`; later ones run `mesh.primitive.set {mesh, params}` (B13's operator, stubbed here). | §8.6, §5.15. |
| M6A-B11-11 | **Card pane**: `T`'s pane, else the run's `paneId`, else the maximized pane, else `pane-persp`; a pane that is not drawn (another one maximized) falls back to the maximized pane. Toolkit runs carry no pane. | §8.6 "the pane where lastRun ran". |
| M6A-B11-12 | **`edit.undo`/`edit.redo` stay synchronous without a session**: their `prepare` returns a plain value unless an extrude session is open or an adjust is in flight (then it awaits the adjust, asks `stepBack`/`stepForward` and awaits the re-run). The runner awaits only thenable `prepare` results (shipped prepares are async, so their timing is unchanged). | Shipped code and tests read the history right after `app.run('edit.undo')`. |
| M6A-B11-13 | **Marking-menu matching**: `model.primitives` is `{modes: ['object'], over: 'empty'}` and `model.tools.object` `{modes: ['object'], over: 'mesh'}`; "nothing selected → primitives" (§8.4) has no `when` field, so Shift+RMB over a mesh in object mode always opens the object tools. | `MarkingMenuDef.when` (closed contract). |
| M6A-B11-14 | **LastRun targets and kind**: kernel ops record the meshes they ran on; set-ops record their inputs (the adjusted re-run first undoes, restoring them); `mesh.create.*` the created mesh; other operators their `meshes`/`mesh` arg. The kind is recorded only for operators that pass `kind` through (`MESH_EXTRA_ARGS`), null for object-level descriptors. | §5.7, §5.13. |
| M6A-B11-15 | **Card drags of non-mesh operations update on release** (no preview session exists for them); mesh ops preview through `beginOp(…, {base: 'before-last'})` at most once per animation frame and switch to "update on release" after a re-run above 50 ms. | §5.7 "Card drags". |
| M6A-B11-16 | **Toolkit**: the mode switcher runs `select.mode` (B10; disabled with its reason until then); the Next footer (fix round 1) has Mesh Check ✓ or its problem count (the kernel's `checkMesh`, B5, with the Model tab glyph's "clean" rule, cached per mesh version; the plain button until B5 lands; it opens the panel), triangles / budget of the target meshes (§5.24 through B9's `meshBudget`: each mesh's own, else its parent's; the sum when every target has one) with the budget bar's ok/warn/danger states (`data-state`), Export model…, Rig & Skin (disabled "arrives in v0.4"); "Highlight nearest" is disabled (not in M6a); the falloff preview draws the preset shapes for orientation only (the kernel's curves are B2's). Narrow (≤ 260 px) is two columns of short labels (no icon set exists for the operators); wide is two columns of full labels. The export profile's default budget (§5.24 "else the export profile's default") is not applied: `meshBudget` (B9) stops at the parents; INT/B13 when the export root lands. | §8.5. |
| M6A-B11-17 | **Whole-mesh runs** (fix round 1, blocker): the twelve §6.1 rows whose Modes add `object` to component kinds (Triangulate, Quadrangulate, Harden, Soften, Set Normal Angle, Reverse, Conform, Average Vertices, Symmetrize, the three UV projections; `WHOLE_MESH_OPS` in `mesh/whole.ts`) poll and apply in object mode (no `kind`), or with an explicit `kind: null`, through B7's object-level wrapper built from the same descriptor (`meshOperator({...desc, kinds: 'object'})`): the selected mesh objects or `meshes`, kind null, a null selection (the kernels read it as every visible face/edge/vertex, `scopeFaces` & co.). An explicit component `kind` keeps the component selection. The LastRun records kind null; Adjust Last passes `kind: null`, so an adjusted whole-mesh run stays whole after a switch to a component mode; Repeat Last follows the current mode (Maya's `G` on the current selection). The descriptors stay as B0a froze them (no contract change). | §6.1 Modes column; E2E-MOD-09, -32. |
| M6A-B11-18 | **A typed entry after a keyboard-run op is committed only when its re-run finishes** (fix round 1): the capture window awaits `edit.adjustLast`; it announces "<Label> <Field> <value>" on the help line (the polite live region) and then disarms (Enter) or moves on (Tab); a cancelled or failed re-run says its reason as a warning ("Advance: Thirteen is unlucky") and keeps the entry armed for editing. Drag targets (a) are unchanged (synchronous). Fix round 2: an accepted `Enter`/`Tab` clears the entry at once (keys typed while the re-run runs start a new entry instead of extending the committed one — "0.5", Enter, "7" no longer reads "0.57"; a pointer move meanwhile discards nothing); a refusal brings the entry back unless the window moved on. | §5.7 "A refusal of the re-run … reports the reason", §5.10 "announces committed values". |
| M6A-B11-19 | **The B11 runtime chunk** (fix round 1, §5.27 "the eager side holds only descriptors, registrations, keymap rows and shell code"): the tracker, the adjust engine, the card preview (`lastopEngine.ts`), the capture state machine (`captureEngine.ts`) and the typed-value grammar (`paramInput.ts`) load lazily (`loadOpsRuntime()`): on the first Model entry (the capture binding watches the workspace), when a LastRun is recorded, when the window arms and when Adjust Last runs. Eager: the recorder (LastRun must exist synchronously after a run), the polls, the registrations, the card state and a capture shim (`key()` false while nothing is armed; an `arm` before the chunk applies once it loads unless something armed/disarmed meanwhile or the LastRun changed). The tracker bound late closes a LastRun that a write, an undo or a selection change made stale meanwhile. While the chunk loads, `pendingAdjust` answers for an adjust (undo/redo wait). The editor's shell overlay (option box, capture bridge, menu registration) mounts through a small eager `ModelOpsSlot` on the first Model entry. A source-scan test keeps the chunk's modules out of eager imports (`test/ops-ui/eager-boundary.test.ts`: Turbopack keeps a whole module once anything eager imports a value from it, and drops unused barrel re-exports — probed). Eager route: 896,084 → 893,685 B. | §5.27; verifier round 1. |
| M6A-B11-20 | **Param groups as sections** (fix round 1): `ParamSections` (`ParamField.tsx`) renders a list with its `ParamDef.group` sections (`<fieldset>`/`<legend>`, `<prefix>-section-<group>` test ids): sections by first appearance, fields in list order inside each, ungrouped fields without a header. Card, option box and INPUTS use it. No descriptor sets `group` yet. | §8.6 "param groups as sections". |
| M6A-B11-21 | **Snap to Grid** in the vertex tools list runs §6.2's sticky grid snap `model.snap.toggle {kind: 'grid'}` (B12a; its stub says why until it lands). | §8.4, §6.2. |
| M6A-B11-22 | **E2E-MOD-09's Conform step** (fix round 1; superseded by M6A-B11-27): §10.1 expects "unchanged positions; `meshCheck` empty" after Conform. The spec file also waited for `lastOp` to become `mesh.conform`, which a Conform that changes nothing never records (§5.7: only runs that record a history step; probed on a B3/B4/B5 merge: Conform finishes, `lastOp` stays Mirror). The step now asserts the Mesh Display item is enabled in object mode, clicks it, runs `mesh.conform` through `runOk` (status finished), then the spec's checks. | §10.1, §5.7. |
| M6A-B11-23 | **Fields give the keyboard back** (fix round 2, blocker): an accepted `Enter` in a card, option-box or INPUTS field (`ParamField`), a Channel Box TRS row or a Toolkit number input blurs the input, as the Channel Box kit's fields do, so `T`, `G`, `Y` and digits over the pane reach the keymap again (the keyboard adapter skips keys whose target is a text field; E2E-MOD-07's `T` after the Segments edit was typed into the field). A refused value keeps the focus for correcting. `Esc` blurs too; the blur it causes no longer commits the draft (its handler still saw the typed text), and `setText(null)` is no longer followed by a `setInvalid` that brought the draft back (Esc showed the typed text again). | §5.10 "Outside the window … `T` is the explicit opener at any time"; §4.10 keyboard focus. |
| M6A-B11-24 | **`T` reopens the extrude session only while the selection is its result** (fix round 2): `resultIsSelection` — the current component mode is the recorded kind, the targets are hilited and the component selection has not changed since the recorder's baseline (which holds the run's own result). A mode switch that keeps the card live (same hilite) shows another kind's selection: `T` then opens only the card. B12b's `reopen()` may check more. | §5.7 `view.lastOpCard`. |
| M6A-B11-25 | **B11's marking-menu chunk is fetched with its overlay chunk** (fix round 2): the eager `ModelOpsSlot` starts both imports on the first Model entry (before, the overlay's mount effect started the second one: a waterfall). A key or Shift+RMB press before the chunk arrives still finds no menu ("Unknown marking menu …" on the help line, nothing else); B11's e2e helpers tap again (`openKeyMenu`, as `openShiftRmbMenu` already did). | §5.27; E2E-MOD-32 Merge to Center failed once that way on a loaded machine. |
| M6A-B11-26 | **The B10 interplay is tested without B10** (fix round 2): `test/ops-ui/lastrun.test.ts` wraps each app's component service so a test can publish (`componentBumps`) and store a pending result that the next read or a microtask publishes (`componentPending`, as B10's `markPending`); the wrapper forwards the real service's own publishes, so the READY.b10 case sees B10's. `card-preview.test.ts` checks that the preview's publishes keep the card and a later change closes it. | §5.7 table. |
| M6A-B11-27 | **E2E-MOD-09's Conform step observes the menu click's own run** (fix round 2): the whole mesh is reversed first (`mesh.reverse {meshes}` in object mode), so Mesh Display › Conform has work to do; its LastRun (`source: 'menu'`, targets the cube) and the restored winding (`meshFaces` equal to before the reverse) show the click's run finished. The API re-run then checks that a consistent mesh records no step and keeps its positions; Mesh Check stays empty. | §10.1; verifier round 2. |

## Contract notes for INT

- **New B11 paths (fix round 1)** outside the literal §9.1 Dirs list, all B11's: `editor-core/src/edit/captureEngine.ts`
  and `editor-core/src/operators/builtin/lastopEngine.ts` (the lazy halves of `capture.ts` and `lastop.ts`),
  `editor-core/src/operators/builtin/mesh/whole.ts` (inside `mesh/**`), `editor/src/panels/toolkit/ModelOpsSlot.tsx`
  (inside `toolkit/**`), and `apps/web/e2e/helpers/m6a-model-ops-ui.ts` (B11's e2e helpers: `counts`, `topEdge`,
  `faceCentroid`, `runMenuItem`, `expectAllHard`, … shared by the four B11 specs; precedent: M2a's per-package
  `helpers/m2a-a2.ts`). INT: please add them to B11's Dirs.
- **`MeshOpArgs.kind`** is typed `ComponentKind` (closed `types.ts`); B11 also accepts `kind: null` at run time for the
  whole-mesh ops (M6A-B11-17; Adjust Last passes it). Contract-PR suggestion: `kind?: ComponentKind | null`. The other
  option the verifier named — an optional "also whole meshes" flag on `MeshOpDescriptor` honoured by B7's wrapper —
  would replace `WHOLE_MESH_OPS`; B11's table follows §6.1's Modes column until then.
- **Test API**: `meshNormals` lists corner normals without their faces (corners are `faceCorner`/`cornerNext` lists),
  so E2E-MOD-32's `expectAllHard` checks by counts per distinct face normal (a corner with a neighbour's or a smoothed
  normal fails; only a swap between two faces' corners would pass). Contract-PR suggestion for B7/INT: a `cornerFace`
  list in `meshNormals` (or corners in `meshFaces`), then the exact per-corner check.
- **check:size** (B9's file): a `BOUNDARIES` entry for the B11 runtime chunk would fail the gate if it crept back into the
  eager route; a marker unique to `captureEngine.ts` is its grammar class `acdegmrACDEGMR`. Until then the source-scan
  test guards it.
- **B0a baseline tests that assume stub kernels**: `editor-core/test/m6a/mesh-runtime.test.ts` ("a stub op previews as
  its refusal …", "poll: component mode, kinds, targets, readiness, then the kernel op; apply runs commitOp") fail once
  B3/B5's real ops are merged (seen in a throwaway local merge of B1–B5 onto this branch): literal updates at INT.
- With that merge, B11's READY-gated cases (`editor-core/test/ops-ui/kernel-ops.test.ts`: Extrude through the capture
  window after `3`, bit-identical to a fresh run; Bevel `30%` and Segments 2 in place; Repeat Last of a menu Insert
  Edge Loop; paramless Triangulate) all passed. Fix round 1, on a throwaway `git clone --shared` of this branch with
  `m6a/mesh-ops-core`, `m6a/mesh-ops-shape` and `m6a/mesh-bevel-check-uv` merged (only
  `mesh-core/test/descriptors.test.ts` conflicted): editor-core `test/ops-ui` **80 passed, 1 skipped** (the READY.b10
  case), including the new gated ones — the real Extrude's card preview committed in one step, bit-identical; Insert
  Edge Loop repeated from an edge of the crossing ring (18/32/16); Triangulate repeated by `G` (8/13/7 → 8/14/8);
  Triangulate (8/18/12), Conform (a reversed face restored, positions kept) and Average Vertices on whole meshes in
  object mode — and the editor B11 tests 17/17 (the Toolkit footer then shows "Mesh Check ✓"). A headless probe of the
  E2E-MOD-09 flow (loop, delete the −X half, Mirror and Conform in object mode) finished every step (M6A-B11-22).
- **Fix round 2 integration probe** (a throwaway `git clone --shared` of this branch with `m6a/mesh-ops-core`,
  `m6a/mesh-ops-shape`, `m6a/mesh-bevel-check-uv` and `m6a/model-select-ui` merged; `mesh-core/test/descriptors.test.ts`
  took one side twice, the two barrels kept both sides, `foundation.test.ts` took B10's and `test-api.test.ts` B11's):
  editor-core `test/ops-ui` and `test/builtin` **365/365** (no skips: every READY gate open; round 1's review saw 15
  B11 failures there before M6A-B11-4's settle, preview and store-order rules), the editor B11 tests 19/19, and in
  real Chrome on 3242, with the `test.fixme` gates removed: **E2E-MOD-07, -09 (with M6A-B11-27's step) and all
  E2E-MOD-32 cases pass**; E2E-MOD-19 without the B12b manipulator drag passes (it needs `tz`). The rest of the merged
  editor-core suite has 12 failures outside B11, in B0a/B7 baselines that assume stub kernels or B7's local selection
  fallback: `test/m6a/foundation.test.ts` ×3, `test/m6a/mesh-runtime.test.ts` ×2 (named above), `test/mesh/runtime.test.ts`
  'before-last' ×5 (`localSelection` reads `[]` once B10 owns the selection) and `test/mesh/setops.test.ts` ×2:
  literal updates at INT (B7/B10).
- `PANEL` still lacks `toolkit` (M6A-B9-13): `registerToolkitPanel` uses the string kind `'toolkit'`.
- B9's command palette prompt has its own `parseParam`; `parseParamInput` (exported from editor-core) is the shared
  grammar and can replace it (M6A-B9-10 says so).
- `edit.repeatLast` forwards the dispatcher's `source` (so `G` from the keyboard arms the capture window and the
  repeated run's LastRun says `keyboard`).
- E2E gates: m6a-07 `b5, b10`; m6a-09 `b3, b4, b5, b10`; m6a-19 `b3, b10, b12b`; m6a-32 `b3, b4, b5, b10` (one
  fixme per tool). Each file also holds an ungated "B11 — …" test that runs today (the capture window after `G`, the
  card, `T`, the Toolkit and option box, the Channel Box INPUTS, the primitives menu).
- **Eager route**: round 1 added about 10 kB gzip to `/editor`; fix round 1 moved the runtime engines and the shell
  overlay into lazy chunks (M6A-B11-19). Per-file attribution of a source-mapped build now (gzip, scaled): lastop 2.1
  kB (recorder, polls, two operators, loader), mesh registration 1.5 (aliases, tools, whole-mesh table 0.3), capture
  shim and card state 1.1, the B11 parts of the edit dispatchers and the runner, card facade 0.3, Model-ops slot 0.2,
  Toolkit registration 0.3 — about 7.3 kB. The capture engine with the grammar is a 2.7 kB lazy chunk; the marking-menu
  data, the Toolkit body, the card view, the option box (and its overlay) and the mesh Channel Box are lazy. The M6a
  allowance is INT's/the owner's decision (M6A-B0A, M6A-B9-14).

## Gates (local, real Chrome; port 3242) — fix round 2

At the fix-round-2 head: `format:check` (1212 files), `lint` (0 findings), `typecheck`, `check:deps` (15 packages)
green; `turbo run test test:tooling --force` (no cache): 15 tasks green — anim-core 671, doc 235, doc-yjs 81,
mesh-core 134, mesh-view 2, io 176, rig 202, editor-core **1001 + 11 skipped**, curve-editor 207 + 3 skipped,
viewport 131 + 1 skipped, editor **468 + 1 skipped**, headless-tests 173, ui 87, web 16, tooling 14.
`turbo run build --force` green; `check:size` **893,842 B ≤ 900,000 B** (headroom 6,158 B; the M6a eager delta
+48,575 B is reported, not enforced, pending the owner's allowance decision). One e2e build (`NEXT_PUBLIC_EKZA_E2E=1`)
served on 3242, default project (`chrome`): B11's specs with `--repeat-each=2` **8 passed, 34 skipped** (gated
`test.fixme`); the full suite once (`EKZA_E2E_PORT=3242 pnpm run test:e2e`): **127 passed, 27 skipped, 0 failed**
(1.0 min). The server was stopped afterwards (nothing listens on 3242); the probe clone was deleted.

## Gates (local, real Chrome; port 3242) — fix round 1

At the fix-round-1 head: `format:check` (1212 files), `lint` (0 findings), `typecheck`, `check:deps` (15 packages)
green; `turbo run test test:tooling --force` (no cache): 15 tasks green — anim-core 671, doc 235, doc-yjs 81,
mesh-core 134, mesh-view 2, io 176, rig 202, editor-core **997 + 11 skipped** (B7's two and nine READY-gated B11
cases: b3 ×3, b4 ×4, b5, b10), curve-editor 207 + 3 skipped, viewport 131 + 1 skipped, editor **466 + 1 skipped**,
headless-tests 173, ui 87, web 16, tooling 14. `turbo run build --force` green; `check:size` **893,685 B ≤ 900,000 B**
(headroom 6,315 B; round 1 was 896,084 B; the M6a eager delta +48,418 B over the M2a baseline is reported, not
enforced, pending the owner's allowance decision). One e2e build (`NEXT_PUBLIC_EKZA_E2E=1`) served on 3242, project
`chrome`, `--workers=4`: B11's specs (`m6a-07`, `-09`, `-19`, `-32`) with `--repeat-each=2`: **8 passed, 34 skipped**
(the four ungated B11 checks; the 17 gated scenarios are `test.fixme` with their §10.1 gate ids); the full suite once:
**127 passed, 27 skipped, 0 failed** (1.1 min). The server was stopped afterwards (nothing listens on 3242).

### Round 1 (port 3172)

At `be1421b` (plus the final `edit.repeatLast` token change, re-verified below): `format:check`, `lint` (0 findings),
`typecheck`, `check:deps` green; `turbo run test test:tooling --force` (no cache): 15 tasks green — anim-core 671,
doc 235, doc-yjs 81, mesh-core 134, mesh-view 2, io 176, rig 202, editor-core 982 + 6 skipped (the READY-gated B11
kernel cases and B7's), curve-editor 207 + 3 skipped, viewport 131 + 1 skipped, editor 463 + 1 skipped,
headless-tests 173, ui 87, web 16, tooling 14. `build` green; `check:size` **896,073 B ≤ 900,000 B** (headroom
3,927 B; the M6a eager delta +50,806 B over the M2a baseline is reported, not enforced, pending the owner's
allowance decision). B11's e2e specs (`m6a-07`, `-09`, `-19`, `-32`): the four ungated B11 checks pass
(`--repeat-each=4`: 16/16), the 17 gated scenarios are `test.fixme` with their §10.1 gate ids. The full e2e suite
against one e2e build served on 3172 (project `chrome`, `--workers=4`): **127 passed, 27 skipped** (gated M6a
scenarios and the stretch specs), 0 failed. After the last change: the M6a specs (`m6a-00`, `-03`, `-07`, `-09`, `-14`,
`-19`, `-32`, `m6a-shell`) 24 passed, 18 skipped; editor-core `test/ops-ui` and `test/builtin/edit.test.ts` green.
