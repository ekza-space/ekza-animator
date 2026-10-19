# M6a B11 — Operators UI: registration, Toolkit, Last-op card, INPUTS, adjust/repeat, capture: build notes

Branch `m6a/model-ops-ui` (from `m6a/spec` at `ec541b4`, with `m6a/shell-workspaces` (B9) and `m6a/mesh-runtime-doc`
(B7) merged, as its dependsOn says). Scope:
[M6A-SPEC §9 B11](../M6A-SPEC.md#b11--operators-ui-registration-toolkit-last-op-card-inputs-adjustrepeat-capture).
Decision IDs below are `M6A-B11-<n>`.

## What landed (by spec responsibility)

| B11 item | Where |
|---|---|
| Registration of every §6.1 `mesh.*` op from its descriptor through `meshOperator`/`meshSetOperator` (no kernel in the eager route): Maya labels, Blender names as palette aliases, the tool `G`/`Y` re-activate, internal ops, descriptions, Extrude's help-line wording | `editor-core/src/operators/builtin/mesh/index.ts` |
| `coerceArgs` with `passThrough: def.extraArgs` in the runner; option-box defaults for UI runs; "(adjusted)" step label; `reconcile()` after a failed run (M6A-B7-26) | `editor-core/src/operators/runner.ts` |
| LastRun recording (resolved args, kind, step, store version, pane, source, flags, targets, seed, symmetry/soft context); the card-closing tracker (§5.7 table); adjust/repeat engines; card previews (`beginCardPreview`); `tool.last` (`Y`), `view.lastOpCard` (`T`, with the extrude reopen) | `editor-core/src/operators/builtin/lastop.ts` |
| `edit.adjustLast` (undo + re-run with the recorded targets and kind, history length kept, refusal → redo), `edit.repeatLast` (the source rule), the `edit.undo`/`edit.redo` extrude-session hook | `editor-core/src/operators/builtin/edit.ts` |
| The numeric capture window (§5.10) behind `app.capture` and the Last-op card's open state; the selected INPUTS field (for B12a's MMB rule) | `editor-core/src/edit/capture.ts`, `editor-core/src/app/factories/capture.ts` |
| `parseParamInput` (the shipped grammar + the fraction rule, m/cm/mm, degrees, ints, nullable "auto") and the display texts (`0.500 m`, `0.300`, `30.000°`) | `editor-core/src/edit/paramInput.ts` |
| Shift+RMB tools menus (`model.tools.object/vertex/edge/face`), `model.primitives`, `model.merge` (§8.4) | `editor/src/overlays/menus/{tools,primitives,merge}.ts` |
| Option box popover, capture bridge (pointer slop, clicks, help-line messages), menu registration | `editor/src/overlays/menus/optionBox.tsx`, `editor/src/panels/toolkit/OptionBoxView.tsx` |
| Modeling Toolkit (§8.5; lazy body) | `editor/src/panels/toolkit/{index.ts,ToolkitPanel.tsx,ToolkitView.tsx}` |
| Last-op card (§8.6): eager pane-slot facade, lazy view; shared parameter fields with label virtual sliders | `editor/src/panels/viewport/LastOpCard.tsx`, `editor/src/panels/toolkit/{LastOpCardView.tsx,ParamField.tsx,slider.ts}` |
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
| M6A-B11-4 | **The tracker** closes on: a local store batch ("Another operation ran"), undo/redo batches or history navigations ("Undone"), a load ("The project changed"), object/control selection changes, a hilite set change, a component-service version change ("Selection changed"), a workspace change, symmetry of a target mesh or soft-select settings ("Settings changed"), remote/import/migration/cleanup batches touching a target mesh ("Changed by another user"). A preview batch, or a remote batch touching no target, refreshes `docSeqAfter` (the card stays live **and adjustable**; the poll's `store.version === docSeqAfter` then means "no untracked write since"). An update that installs or replaces `lastRun` itself never closes it (the recorder, B9's workspace switch). A run that recorded a step but does not qualify closes the card; selection-only operators close it as "Selection changed". | §5.7 table; the version rule would otherwise make any peer's edit elsewhere kill adjustability. |
| M6A-B11-5 | **✕ hides the card** (`lastOpCardState.dismissed`), `lastRun` stays live: `G` repeats and `T` brings the card back. A new operation shows its card collapsed; adjusted re-runs keep the card as it is. | §8.6 "✕ closes the card but keeps lastRun for G"; Maya's `T`. |
| M6A-B11-6 | **Capture binding and rules**: `createCapture()` gets no deps (the composition root is closed), so `bindCapture(app)` binds it on first use (the runner, `registerBuiltins`). Case (b) arms only in Model, for an adjustable `lastRun` with a visible primary param, after a `source: 'keyboard'` run (incl. `G`). `Enter` with or without an entry disarms (b); `Esc` cancels an entry, then (no entry) disarms and passes on (edit.escape ends the extrude session); `Backspace` without an entry is not part of one: it disarms and reaches the keymap (Maya's Delete). After an entry started, only the grammar's characters extend it: digits, `. , + - * / = ( ) % °`, space and the unit letters `a c d e g m r` (`m`, `cm`, `mm`, `deg`, `rad`, exponent). Modifier keys never disarm. The window closes with the card. Committed values are announced on the help line (the polite live region). | §5.10. |
| M6A-B11-7 | **Where B11's editor parts register**: `registerToolkitPanel` (one line in `panels/index.ts`, the owners' hook) registers the Toolkit panel, the `lastOpCard` pane overlay and the `optionBox` shell overlay; the shell overlay loads and registers the marking menus on the first Model entry (a lazy chunk; B9 prefetches its controller when a menu of the active workspace is registered) and binds the capture bridge. **"Primitive Options…" (primitives NW) is disabled** with "Primitive options are in the Modeling Toolkit (⋯)": §6.2 has no operator that opens an option box. Contract-PR suggestion for INT: `ui.optionBox {op}`. | §4.8 slots; no shell hook with the app for owners. |
| M6A-B11-8 | **Overlays inside a pane stop `pointerdown` natively**: the pane surface (`ViewportManager.attachInput` on the element that also holds the overlay slots) takes every press and captures the pointer, so a click on the card was retargeted. The card's root stops `pointerdown`/`wheel`; the parameter label listens to its own presses natively (React never sees a stopped press). **Suggestion for B9/INT**: ignore presses whose target is inside an interactive overlay (`pointer-events: auto` element of a slot) in `ViewportManager.pointerDown`, so every owner's overlay works without this. | Found by the B11 e2e check. |
| M6A-B11-9 | **Extrude's poll wording** (B0b's M6A-B0B-5 asked B7 or B11): in object mode, without selected faces/edges or over other panels "Select faces or border edges" (§7); in vertex mode "Vertex extrude is not available yet" (§6.1). Other ops keep B7's wrapper reasons. The vertex marking menu's S slot carries the same reason statically. | §7 `Mod+KeyE`, §6.1 Extrude notes. |
| M6A-B11-10 | **INPUTS field selection** lives in editor-core (`selectedInputsField`/`selectInputsField`, `{entry: 'lastop' \| 'primitive', mesh, param}`); B12a's MMB rule reads it and drags that field (an `edit.adjustLast` for `lastop`, the primitive's adjust/`mesh.primitive.set` for `primitive`). A primitive edit right after the creation is `edit.adjustLast` of `mesh.create.<kind>`; later ones run `mesh.primitive.set {mesh, params}` (B13's operator, stubbed here). | §8.6, §5.15. |
| M6A-B11-11 | **Card pane**: `T`'s pane, else the run's `paneId`, else the maximized pane, else `pane-persp`; a pane that is not drawn (another one maximized) falls back to the maximized pane. Toolkit runs carry no pane. | §8.6 "the pane where lastRun ran". |
| M6A-B11-12 | **`edit.undo`/`edit.redo` stay synchronous without a session**: their `prepare` returns a plain value unless an extrude session is open or an adjust is in flight (then it awaits the adjust, asks `stepBack`/`stepForward` and awaits the re-run). The runner awaits only thenable `prepare` results (shipped prepares are async, so their timing is unchanged). | Shipped code and tests read the history right after `app.run('edit.undo')`. |
| M6A-B11-13 | **Marking-menu matching**: `model.primitives` is `{modes: ['object'], over: 'empty'}` and `model.tools.object` `{modes: ['object'], over: 'mesh'}`; "nothing selected → primitives" (§8.4) has no `when` field, so Shift+RMB over a mesh in object mode always opens the object tools. | `MarkingMenuDef.when` (closed contract). |
| M6A-B11-14 | **LastRun targets and kind**: kernel ops record the meshes they ran on; set-ops record their inputs (the adjusted re-run first undoes, restoring them); `mesh.create.*` the created mesh; other operators their `meshes`/`mesh` arg. The kind is recorded only for operators that pass `kind` through (`MESH_EXTRA_ARGS`), null for object-level descriptors. | §5.7, §5.13. |
| M6A-B11-15 | **Card drags of non-mesh operations update on release** (no preview session exists for them); mesh ops preview through `beginOp(…, {base: 'before-last'})` at most once per animation frame and switch to "update on release" after a re-run above 50 ms. | §5.7 "Card drags". |
| M6A-B11-16 | **Toolkit**: the mode switcher runs `select.mode` (B10; disabled with its reason until then); the Next footer has Mesh Check (opens the panel; its count needs B10's results), triangles, Export model…, Rig & Skin (disabled "arrives in v0.4"); "Highlight nearest" is disabled (not in M6a); the falloff preview draws the preset shapes for orientation only (the kernel's curves are B2's). Narrow (≤ 260 px) packs the buttons with short labels (no icon set exists for the operators). | §8.5. |

## Contract notes for INT

- **B0a baseline tests that assume stub kernels**: `editor-core/test/m6a/mesh-runtime.test.ts` ("a stub op previews as
  its refusal …", "poll: component mode, kinds, targets, readiness, then the kernel op; apply runs commitOp") fail once
  B3/B5's real ops are merged (seen in a throwaway local merge of B1–B5 onto this branch): literal updates at INT.
- With that merge, B11's READY-gated cases (`editor-core/test/ops-ui/kernel-ops.test.ts`: Extrude through the capture
  window after `3`, bit-identical to a fresh run; Bevel `30%` and Segments 2 in place; Repeat Last of a menu Insert
  Edge Loop; paramless Triangulate) all passed.
- `PANEL` still lacks `toolkit` (M6A-B9-13): `registerToolkitPanel` uses the string kind `'toolkit'`.
- B9's command palette prompt has its own `parseParam`; `parseParamInput` (exported from editor-core) is the shared
  grammar and can replace it (M6A-B9-10 says so).
- `edit.repeatLast` forwards the dispatcher's `source` (so `G` from the keyboard arms the capture window and the
  repeated run's LastRun says `keyboard`).
- E2E gates: m6a-07 `b5, b10`; m6a-09 `b3, b4, b5, b10`; m6a-19 `b3, b10, b12b`; m6a-32 `b3, b4, b5, b10` (one
  fixme per tool). Each file also holds an ungated "B11 — …" test that runs today (the capture window after `G`, the
  card, `T`, the Toolkit and option box, the Channel Box INPUTS, the primitives menu).
- **Eager route**: B11 adds about 10 kB gzip to `/editor` (per-file attribution of a source-mapped build: lastop
  3.0, capture 1.7, mesh registration 1.4, paramInput 1.1, edit dispatchers, runner, option-box overlay 0.6, card
  facade 0.3, Toolkit registration 0.3); the marking-menu data, the Toolkit body, the card view, the option box view
  and the mesh Channel Box are lazy. The total stays under the 900,000 B gate (numbers below); the M6a allowance is
  INT's/the owner's decision (M6A-B0A, M6A-B9-14).

## Gates (local, real Chrome; port 3172)

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
