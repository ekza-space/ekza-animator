# M6a B12a — Transform tools, MMB-drag, Tweak, snapping, pivots, soft select, symmetry UI: build notes

Branch `m6a/model-transform-tools` (from `m6a/spec`, with `m6a/model-select-ui` (B10), `m6a/model-ops-ui` (B11) and
`m6a/mesh-select` (B2) merged, as its dependsOn says; B10 and B11 carry B9, B0b, B7, B6, B1 and B0a). Scope:
[M6A-SPEC §9 B12a](../M6A-SPEC.md#b12a--transform-tools-mmb-drag-tweak-snapping-pivots-soft-select-symmetry-ui-owner-feel-check),
§5.15, §5.14 (first two rows), §5.10 (the transform tools' side), §5.13 (Freeze/Reset), §6.2, §8.4 `model.options`,
§8.7. Decision IDs below are `M6A-B12A-<n>`.

## What landed (by spec responsibility)

| B12a item | Where |
|---|---|
| `model.symmetry.set` (per-mesh mode, tolerance in metres, Preserve Seam; default targets hilite / selected meshes) | `editor-core/src/operators/builtin/symmetry.ts` |
| `model.softSelect.set`/`.toggle`, `model.selectionStyle.set` (`toggle` = `` ` ``), `model.cameraBased.set`, `model.backfaces.toggle`, `model.constraint.set` (non-`off` and `drag` poll "arrive later") | `editor-core/src/operators/builtin/softSelect.ts` |
| Soft weights of a hilited mesh as a transform would use them (overlay tint, test API) | `editor-core/src/operators/builtin/softWeights.ts` (lazy) |
| `model.snap.toggle`; the Component orientation of Move/Rotate (`transformSpace`, `view.setManipSpace {space:'component'}`); the last-picked handle (`setTweakHandle`) | `editor-core/src/operators/builtin/snap.ts` |
| `model.pivot.editToggle`, `mesh.pivot.set/center/bottomCenter/reset/bake`, `mesh.resetTransforms`, `mesh.freezeTransforms` (over B4's `mesh.applyTransform`), `scene.object.transform` | `editor-core/src/operators/builtin/pivot.ts` (definitions, polls) + `pivotImpl.ts` (bounds, matrices, commits; loaded by `prepare`) |
| History label of `mesh.transformComponents` by the dominant part ("Move", "Rotate", "Scale") | `editor-core/src/operators/builtin/mesh/index.ts` (`MESH_OP_UNDO_LABELS`, B11's file, additive) |
| Move/Rotate tools: one ToolDef per id branching on workspace and mode; `keys` X V J D B; the MMB rule on controls in Animate; the Scale tool wrapped the same way (`withModelTransform`) | `viewport/src/tools/transformTool.ts`; `viewport/src/tools/scaleTool.ts` (B9's, two additive edits) |
| Model's transform runtime (lazy chunk): manipulator targets (components: pivot = world bbox centre of the picked vertices or the pinned `componentPivot`, World/Object/Component frames; objects for Move/Rotate; the pivot while edited, dashed), component drags through a `MeshOpSession` of `mesh.transformComponents` → one step, object drags → `scene.object.transform`, pivot drags → `mesh.pivot.set` / `componentPivot`, the MMB rule (INPUTS field slider, last-picked handle, view plane / view axis / uniform), Tweak, snapping (X grid, V vertex across meshes, J increments; held or sticky), `B`+LMB/MMB radius, the soft-weight overlay push, the radius ring, the capture window's `NumericTarget`, `app.extrude.beginAbsorb` first | `viewport/src/tools/model/transform/{index,runtime,frame,motion,snap,readout,types}.ts` |
| ViewportManager hooks: `setModelManipulator`, `manipulatorFrame`, `refreshManipulatorSoon`; Model targets ahead of B9's object scale target and the control target | `viewport/src/manager/ViewportManager.ts` (B9's, additive) |
| Dashed manipulator (pivot editing); edge-on plane handles yield to their axis | `viewport/src/manipulators/ManipulatorKit.ts` (B9's, additive) |
| Modal readout chip (`modal-readout`): dragged value 16 px right/below the pointer, flipped at the pane edges, capture entry with "Enter ✓ · Esc ✕ · Tab next" mirrored on the help line, snap candidate ring + "→ vertex 128 · Torso", soft radius ring | `editor/src/panels/viewport/ModalReadout.tsx` (eager facade, registration) + `ModalReadoutView.tsx` (lazy) |
| `model.options` (Ctrl+Shift+RMB; `model.options.lmb` for `Q`+LMB) and the space menus `model.space.move` (`W`+LMB) / `model.space.rotate` (`E`+LMB) with Component | `editor/src/overlays/menus/options.ts` (lazy, registered on the first Model entry) |
| Test API B12a group: `symmetry`, `softWeights` | `editor/src/test-api/m6a/model-transform-tools.ts` |
| E2E-MOD-10, E2E-MOD-23 (INPUTS part gated `b3`), bench | `apps/web/e2e/m6a-10-soft-selection-drag.spec.ts`, `m6a-23-mmb-drag-rule.spec.ts`, `e2e/bench/m6a-transform.bench.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B12A-1 | **Component drags pass the stored picks, an explicit `pivot` and an explicit `orientation`** to `mesh.transformComponents`. The pivot is the world bounding-box centre of the picked vertices of every hilited mesh (one shared pivot across meshes, Maya), or the pinned `componentPivot`; `orientation` is always the Component frame of the picks (recorded so an adjusted re-run switched to Component keeps it, M6A-B2-11). Under symmetry the picks' own frame is used (the expanded set's normals cancel across the plane) and the pivot on the picked side tells the kernel the source side (M6A-B2-12; B7 expands the input of `'expand'` ops before the run, so the picks' mean is near the plane and the pivot decides). | §5.15 "pivot = the bounding-box centre of the selected vertices"; B2's hand-over. |
| M6A-B12A-2 | **The args' frame**: World → `space: 'world'`; Object on one mesh (or meshes sharing a rotation) → `space: 'object'`; otherwise the manipulator's own frame as `space: 'component'` with `orientation` = that frame (several meshes with different rotations move along the lead's axes, as the manipulator shows). Translations are the motion expressed in that frame; a ring rotates about one frame axis (`rotate<K>`), the view ring and MMB rotations become an xyz Euler of the axis–angle; scales are factors along the frame axes. | One manipulator, one motion for every target mesh. |
| M6A-B12A-3 | **The Component orientation lives next to the preferences**: `prefs.moveSpace/rotateSpace` (closed types: object/world/gimbal) keep their values; Component is remembered per app (`transformSpace`, not persisted) and `view.setManipSpace` accepts `space: 'component'` for Move and Rotate. The Scale tool follows Move's orientation for components (B9 keeps object axes for objects). Gimbal reads as Object for components and objects in Model. | §5.15 "Move and Rotate space menus gain Component" with `Prefs` closed after B0a. Contract-PR suggestion: `ManipSpace` gains `'component'` (persisted). |
| M6A-B12A-4 | **Object Move/Rotate in Model**: the topmost selected objects (B9's `topmostSelectedObjects`); translations move every one by the same world delta (through each parent's inverse), rotations turn each about its own pivot (Maya's default for several objects), scale stays B9's (handles) except MMB scale (uniform or along the last-picked axis, each about its own pivot). Preview through a document gesture, commit `scene.object.transform {ids, placements}` with `source: 'tool'`, labelled by the dominant change (`tx.annotate`): "Move", "Rotate", "Scale". | §6.2 `scene.object.transform` "object W/E/R and MMB commits in Model ('Move' etc.)"; M6A-B9-11. |
| M6A-B12A-5 | **The MMB rule** (§5.15) — order: Channel Box channels selected → the viewport's shipped virtual slider (before any tool); an INPUTS field name selected → its virtual slider (`edit.adjustLast {[param]}` for the last-op entry and a primitive right after its creation, else `mesh.primitive.set`; the card's preview through `beginCardPreview`; rate `paramSliderRate`, Shift ×0.1 / Mod ×10; the stand-in clears Shift); else the selection moves along `session.model.tweakHandle` when it belongs to the active tool (move: tx…tview, rotate: rx…rview, scale: sx…suniform), else the view plane / the view axis / uniform scale. `tweakHandle` is set by any LMB press on a handle (Animate too) and cleared by a tool switch (`activate`). In Animate the drag is the same channel-edit gesture as a handle drag (additive: MMB without channels did nothing before). | §5.15, Q-MOD-UI-14. |
| M6A-B12A-6 | **Tweak**: with the Move tool in a component mode and `selectionStyle: 'tweak'`, a press on a component (B10's picker) becomes a drag after 3 px: an unselected component replaces the selection on every hilited mesh (stored without a "Select" step) and moves in the view plane; the run is the one "Move" step. A press without a drag is a plain click (B10's select behaviour). Undo of the Move restores the revision's selection as B10 remembers it (the tweaked component), not the selection before the tweak. | §5.15 "one step 'Move' whose selectionBefore/After carry the change": the runner's `selectionBefore/After` carry no per-mesh part (B10 hand-over to B11); restoring the pre-tweak selection on undo needs that part (INT/B11). |
| M6A-B12A-7 | **Snapping**: `X` snaps the moved pivot's coordinate along each moved axis (measured from the world origin; plane handles: their two axes; view plane / MMB: all three) to `gridStep`; `J` snaps the move along each moved axis to `increments.move`, rotations to `increments.rotate`, scales to `1 + n·increments.scale`; `V` snaps the pivot to the nearest visible vertex within `vertexSnapRadiusPx` on any mesh the pane draws (`objectsDrawnIn`; hidden components skipped; component drags exclude their moved vertices, object drags the moved objects and their descendants; ties on one line of sight go to the nearer vertex) — constrained handles take the projection on their axis or plane. Priority V > X > J; held keys (consumed only in Model, without modifiers) or the sticky toggles. Occlusion of `V` candidates is not tested (a vertex behind a surface can win). | §5.15. |
| M6A-B12A-8 | **Pivot editing**: `D` held or `model.pivot.editToggle` (`Insert`/`Home`); the manipulator shows translate handles (whatever the tool) drawn dashed; object mode commits `mesh.pivot.set {id: lead, pivot}` (the lead object only), component mode pins `componentPivot` (U state, world). A pinned component pivot follows a translation of its components and is dropped when the picked components change (Maya resets the custom pivot with the selection). | §5.15. |
| M6A-B12A-9 | **Bounds of Modify › Pivot** are in the object's own space: a mesh's points, a group's descendant meshes' points mapped into the group; Bottom Center = (centre x, min y, centre z) of those bounds. Bake Pivot moves the geometry by −pivot (`mesh.applyTransform`), the children by −pivot in its space and the placement by R·S·pivot. | §5.15 "props stand on the ground" — for rotated objects the local bottom is not the world floor; the owner may want world bounds (DECISIONS-OPEN §H candidate). |
| M6A-B12A-10 | **Freeze**: M = P′⁻¹·P per mesh (P the placement, P′ with the frozen parts reset), so the world stays exactly where it was with any subset of translate/rotate/scale; the pivot moves by M, child objects by M·C (decomposed). A group freezes its descendant meshes (the group's own placement stays). Params `translate/rotate/scale` (bool, default true) make it adjustable; skinned meshes poll-fail `freeze.skinned`'s message before the kernel is asked. | §5.13. |
| M6A-B12A-11 | **Readout and capture**: during a drag the capture window is armed with the motion's three `mesh.transformComponents` fields (Tab order X, Y, Z; the dragged axis active); a typed value wins over the pointer for its field; `Enter` confirms the drag with it, `Esc` cancels (no step). The chip shows the field and value (single-axis handles: the frame value; planes and the view plane: the distance moved, "Move"; uniform scale: the factor). | §5.10, §8.7. |
| M6A-B12A-12 | **`model.options` is two menu definitions** (`MarkingMenuDef` has one trigger): `model.options` (Ctrl+Shift+RMB) and `model.options.lmb` (`Q`+LMB, same items). Its ✓ items for Camera-based and Preserve Seam run `model.cameraBased.set {value: 'toggle'}` and `model.symmetry.set {preserveSeam: 'toggle'}` (runtime-additive values; `OperatorMap` is closed). "Tolerance…" opens the Modeling Toolkit (B11's Symmetry section has the field). | §8.4; contract-PR suggestion: the two `toggle` values in `OperatorMap`. |
| M6A-B12A-13 | **Space menus** `W`+LMB (World, Object, Component) and `E`+LMB (World, Object, Component, Gimbal) in Model; `R`+LMB is not registered (the Scale tool has no space of its own). | §7 "Pointer gestures". |
| M6A-B12A-14 | **Soft select**: `B` is observed by the tools, never consumed on the way down (the keymap's tap toggles soft select, §7); a `B`+drag release is consumed (no tap). `B`+LMB scales the radius ×2 per 100 px to the right (relative), `B`+MMB sets it from zero (pointer travel × scene units per px at the manipulator); the session radius previews, the release runs `model.softSelect.set`. The overlay tint is B6's (`setSoftWeights`), pushed for every hilited mesh on selection, settings and committed geometry changes. | §5.15. |
| M6A-B12A-15 | **Edge-on plane handles** (an orthographic side view: the plane contains the view direction within ~11°) are skipped by `ManipulatorKit.pick`, so the press goes to the axis drawn under them. Before, pressing the X arrow in the front view picked the X–Z plane, whose drag cannot move (the pointer ray runs in the plane) — in Animate's shipped tools too. | Found by the B12a viewport tests in M-Quad's ortho panes. |
| M6A-B12A-16 | **Session fields written directly** (no operator): `tweakHandle` (`setTweakHandle`), `componentPivot` (pivot drags, the pinned pivot's follow and reset), the soft radius preview. All are B12a's U state; no edits in `editor-core/src/session/**`. | §9.1 "other packages write their `session.model` fields only through their own operators (no edits in this tree)". |

## Shared files and other packages' paths (minimal, additive)

| File (owner) | Change | Why |
|---|---|---|
| `viewport/src/manager/ViewportManager.ts` (B9) | `setModelManipulator`, `refreshManipulatorSoon`, `manipulatorFrame`; the Model target ahead of the object-scale and control targets in `refreshManipulator`; `beginManipulatorDrag`/`beginObjectDrag` return null on a Model target | B9's hand-over: "add the object and component targets ahead of the control target". |
| `viewport/src/manipulators/ManipulatorKit.ts` (B9) | `setDashed` (+ line distances), the edge-on plane skip in `pick` (M6A-B12A-15) | §5.15 dashed pivot manipulator. |
| `viewport/src/tools/scaleTool.ts` (B9) | `modes`, `keys`, the instance wrapped by `withModelTransform` | §4.6 "the new `scale` branch on the component mode inside (B12a)". |
| `viewport/src/manager/contributions.ts` (B9) | one line: `attachModelTransform(app, vm)` | as B10's `attachModelSelect`. |
| `editor/src/shell/createShell.ts` (B9) | one line: `registerModelTransformUi(app)` | as B10's `registerModelSelectUi`. |
| `editor-core/src/operators/builtin/view.ts` (WP-7b/B9) | `view.setManipSpace` accepts `space: 'component'` | M6A-B12A-3. |
| `editor-core/src/operators/builtin/mesh/index.ts` (B11) | `MESH_OP_UNDO_LABELS` (`mesh.transformComponents` by the dominant part) | §6.1 "label by the dominant part". |
| `editor-core/src/index.ts`, `viewport/src/index.ts` | additive exports (B12a blocks) | cross-package use. |

New B12a paths outside the literal §9 Dirs list (INT: please add them to B12a's Dirs):
`editor-core/src/operators/builtin/{pivotImpl,softWeights}.ts` (the lazy halves of `pivot.ts`/`softSelect.ts`),
`editor/src/panels/viewport/ModalReadoutView.tsx` (the lazy view of `ModalReadout.tsx`), the tests
`editor-core/test/m6a/transform/**`, `viewport/test/m6a-transform/**`, `editor/test/m6a-transform-ui.test.tsx`.

### Literal updates (§3 rule 9)

- `editor-core/test/m6a/foundation.test.ts`: the landed B12a operators' poll reasons in `LANDED`.
- `editor/test/test-api.test.ts`: `symmetry()`/`softWeights()` answer null for an unknown mesh (the group landed).
- `editor/test/m6a-shell.test.tsx`: the status line's Soft body is enabled in Model (`model.softSelect.toggle` landed).
- `editor/test/input/menu-sets.test.ts`: Modify › Center Pivot shows its own poll reason ("Select a mesh or group
  first") instead of "not available yet".
- **Merge fallout of B2 + B7 + B10 + B11 on this branch** (not B12a behaviour, needed for a green `test`):
  `editor-core/test/mesh/{runtime,setops}.test.ts` read component selections from `app.components` (B10's hand-over to
  B7: with B10's service the runtime's local fallback stays empty); `editor-core/test/mesh/ready.ts` gains
  `primitives` (B1's sphere/cone/torus build) next to `b1` (whose probe also runs B3's extrude), and
  `test/mesh/create.test.ts` gates the reference-refusal case and the real creation case on it.

### Contract notes and requests (INT)

- `ManipSpace` (`Prefs.moveSpace/rotateSpace`) gains `'component'`, persisted (M6A-B12A-3).
- `OperatorMap`: `model.cameraBased.set {value: … | 'toggle'}`, `model.symmetry.set {preserveSeam: boolean |
  'toggle'}` (M6A-B12A-12).
- `MarkingMenuDef.trigger` as a list would let `model.options` be one menu (M6A-B12A-12).
- E2E-MOD-23's INPUTS part reads `state().extrudeSession` after `Enter`: it needs B12b's session as well as B3's
  extrude. The §10.1 Gates column says `b3`; the spec file gates the part on `b3` (the column) and says so — INT runs
  it with everything merged.
- Tweak's undo (M6A-B12A-6): the runner's `TxMeta.selectionBefore/After` with B10's per-mesh part would let one undo
  restore the selection from before the tweak.

## READY gates and E2E gates

- Unit: B4's `mesh.applyTransform` — `editor-core/test/m6a/transform/operators.test.ts` probes the kernel op (READY.b4
  by probe): with the B0a stub it substitutes a positions-only op through the module mock so Freeze and Bake Pivot run
  end to end; with B4 merged the real op runs (verified below). B12b's absorb hook is tested with a fake
  `app.extrude.beginAbsorb` (the B0a stub returns null, so every drag transforms components today).
- E2E: E2E-MOD-10 (Gates "—") and E2E-MOD-23 (a, b) run; E2E-MOD-23's INPUTS part is `test.fixme('b3: …')`.
- For the packages gated on `b12a` (B12b E2E-MOD-04/08/13/17/18/20/21/22/24/28, B13 -27): `model.symmetry.set`,
  `scene.object.transform`, the component manipulator (`screenOfManipulator` handles of component selections),
  vertex snapping of object moves (`V` + the centre handle, E2E-MOD-28's step: covered by
  `viewport/test/m6a-transform/runtime.test.ts`) and the absorb call are in place.

## Hand-over

- **B12b**: W/E/R and MMB drags call `app.extrude.beginAbsorb(tool | 'mmb', transformSpace(app, tool))` first, with
  world deltas about the drag's pivot (translate: vector; rotate: an axis–angle quaternion; scale: factors along the
  manipulator's axes); `commit()` on release, `cancel()` on Esc. While a session is open the manipulator still sits on
  the component selection (the cap): if the extrude manipulator needs another frame, extend
  `ModelTransformRuntime.target` (or register ahead of it through `vm.setModelManipulator`). The tools' `keys` (X V J D
  B) reach the runtime only in Model; the reserved modal keys reach `key()` while `phase()` is `dragging`.
- **B13**: `mesh.pivot.*`, Freeze/Reset and `scene.object.transform` are ready for the Outliner/Attributes (`attr-pivot-*`
  can run `mesh.pivot.set`); templates set Object X through `model.symmetry.set {meshes, mode: 'object-x'}`.
- **B11**: the Toolkit's Symmetry and Soft Selection sections can run `model.symmetry.set`/`model.softSelect.set`
  directly; Snap to Grid in the vertex tools list runs the sticky `model.snap.toggle {kind: 'grid'}` (landed).
- **INT**: the eager route (below); add the new paths to B12a's Dirs; the contract notes above; the owner feel check.

## Owner feel check (30 minutes, Chrome, a fresh profile; findings → B12a follow-up or INT, DECISIONS-OPEN §H)

1. Create › Cube (low-poly), Maya's habit throughout. `1`, click a top vertex, `W`: the manipulator sits on it; drag
   each arrow, a plane, the centre; `Ctrl+Z` after each. Repeat with two vertices on different faces (pivot = their
   bounding-box centre).
2. `3`, a top face; `W`+LMB → Component; drag the Z arrow (along the face normal). Rotate the cube 30° first (object
   mode, `E`), then the same in World, Object and Component — compare Component with Maya 2026's **Normal**
   orientation on a tilted face (Maya moves each component along its own normal; ours moves the selection along the
   averaged frame). Owner choice 1: is Component enough for M6a, or is Normal needed in core?
3. MMB-drag away from the manipulator (view plane); click the X arrow, MMB-drag (X only); `E`, MMB-drag (view axis);
   `R`, MMB-drag (uniform). Select a Channel Box channel of a control in Animate: MMB-drag runs the slider; without it
   the control moves.
4. Tweak: `` ` `` (Tweak on), drag an unselected vertex (it moves; one undo step), `` ` `` again.
5. Snapping: hold `X` while dragging (0.1 m grid), `J` (0.1 m, 15°, ×0.1), `V` with an object move onto a vertex of a
   second cube (ring and "→ vertex n · name" chip). Toggle the sticky status-line buttons.
6. Pivots: hold `D`, drag the dashed manipulator (object mode, then a component selection); Modify › Pivot › Bottom
   Center, Bake; Freeze Transformations on a rotated, scaled cube (the cube stays; the Channel Box zeroes).
7. Soft select: `B` (tap), `B`+LMB drag (radius ×2 per 100 px), `B`+MMB from zero; drag a vertex of a 20×20 plane;
   Surface vs Volume in the Toolkit.
8. Symmetry: Ctrl+Shift+RMB → Symmetry: Object X; move a vertex at x > 0 (its partner mirrors); a seam vertex keeps
   x = 0 with Preserve Seam.
9. Numeric capture: during a drag type `0.5` `Enter`; then **`Ctrl+E`, then `2`** on a face (the capture window takes
   the `2` as the extrude distance, not edge mode). Owner choice 2: keep, or exempt `1`–`7` from case (b) (§5.10).
10. **`Ctrl+E`, then `W` in World on a tilted face** (B12b's session absorbs the drag; with B12b merged).

## Benchmarks (report only; Apple M-series, Chrome GPU, port 3251)

`e2e/bench/m6a-transform.bench.ts` (DPR 2): dragging 1,024 vertices — per frame mean 0.37 ms, p95 2.40 ms (move
handlers 0.17 ms, frame callbacks 0.17 ms; budget ≤ 4 ms); soft drag over 10k vertices (r = 1.8 m) — per frame mean
0.57 ms, p95 6.20 ms (moves 0.47 ms, frames 0.14 ms; budget ≤ 8 ms). E2E-MOD-10 at DPR 1: move handler mean 0.55 ms
(p95 5.90 ms: the first move opens the session), frame mean 0.17 ms. The kernel's own row (B2): one transform with
soft and symmetry on 10k vertices with its undo, 0.47 ms.

## Eager route (§5.27)

`check:size` (production build, gzip -9): the merge base of this branch (B2 + B10 + B11, `6c5d11f`) measures
**906,923 B — already over the 900,000 B gate** (B10's +13 kB and B11's +7 kB together; each branch alone was under
it). This branch: **912,498 B (B12a +5,575 B)**: 20 operator definitions with their polls and argument checks
(the stubs they replace cost ≈ 0.8 kB), the tools' Model link and MMB rule, the ViewportManager hooks, the readout
facade and its store, the registration. Lazy: the transform runtime, the readout view, the menus, the bounds and
matrices of Pivot/Freeze (`pivotImpl`, loaded by `prepare`), the soft weights (`softWeights`) — guarded by
`editor-core/test/m6a/transform/eager-boundary.test.ts`. The gate failure is the merged base's; INT needs the owner's
eager-allowance decision (M6A-B9-14) or the lazy candidates B9 and B10 listed (Model-only registrations after the
first Model entry; the selection service behind the kernel load).

## Verification against B4 (scratch, not committed)

`git merge --no-commit m6a/mesh-ops-shape` on this branch (conflicts only in `mesh-core/test/{descriptors.test,ready}.ts`,
left unresolved; the merge was aborted afterwards): `editor-core/test/m6a/transform` 15/15 plus a probe asserting
that B4's real `mesh.applyTransform` runs (no stand-in): Freeze (translate/rotate/scale and partial, a group's meshes,
the pivot following, exact undo) and Bake Pivot (the child compensated) pass on B4's op.

## Gates (local, real Chrome; port 3251)

At the notes' commit, clean tree:

| Gate | Result |
|---|---|
| `pnpm run format:check` | clean (1,339 files) |
| `pnpm run lint` | rc 0, no findings |
| `pnpm run typecheck` | clean |
| `pnpm run check:deps` | 15 packages follow the rules |
| `pnpm run test --concurrency=2` | 15/15 tasks: anim-core 671, ui 87, mesh-core 450 + 1 skipped, doc 235, rig 202, doc-yjs 81, mesh-view 74, io 176, **editor-core 1064 + 20 skipped**, curve-editor 207 + 3 skipped, headless-tests 173, **viewport 185 + 1 skipped**, **editor 485 + 6 skipped**, web 16, tooling |
| `pnpm run build` | OK; `check:size` **912,498 B > 900,000 B** — the merge base already measures 906,923 B (see Eager route); B12a +5,575 B |
| B12a e2e specs | E2E-MOD-10 and E2E-MOD-23 (a), (b) pass; E2E-MOD-23's INPUTS part is `test.fixme('b3: …')` |
| Full e2e (`EKZA_E2E_PORT=3251 pnpm run test:e2e`, project `chrome`) | **130 passed, 32 skipped** (gated `test.fixme` and stretch), 0 failed (2.2 min); the server was stopped afterwards |
| Bench (`-c e2e/bench/playwright.config.ts m6a-transform`) | numbers above (report only) |
