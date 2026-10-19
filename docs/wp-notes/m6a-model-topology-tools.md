# M6a B12b — Topology tools: extrude session, smart extrude, Multi-Cut, Insert Edge Loop, Target Weld, Slide, Bridge: build notes

Branch `m6a/model-topology-tools` (from `m6a/spec` at `ec541b4`, with its dependsOn merged: `m6a/model-select-ui`
(B10), `m6a/model-ops-ui` (B11), `m6a/mesh-select` (B2), `m6a/mesh-ops-core` (B3), `m6a/mesh-ops-shape` (B4)).
Scope: [M6A-SPEC §9 B12b](../M6A-SPEC.md#b12b--topology-tools-extrude-session-smart-extrude-multi-cut-insert-edge-loop-target-weld-slide-bridge).
Decision IDs below are `M6A-B12B-<n>`.

## What landed (by spec responsibility)

| B12b item | Where |
|---|---|
| `app.extrude` (`ExtrudeSessionApi`): an eager shim (state mirrored to `session.model.extrudeSession`, the runner's hooks, the Model tools' help-line channel) over a lazy engine | `editor-core/src/operators/builtin/extrudeSession.ts`, `editor-core/src/app/factories/extrude.ts` |
| The session engine (§5.8): open after a finished `mesh.extrude` (not the card) and on `T`; the end-trigger table with the zero-drop and its toast; the args undo stack (`stepBack`/`stepForward`, undo at index 0 removes the extrude); absorption (`beginAbsorb`: exact translate/rotate from any manipulator space, scale in the session frame, one `edit.adjustLast` per drag); `reopen`; `setManipSpace`; smart extrude (`beginSmartExtrude`) | `editor-core/src/operators/builtin/extrudeEngine.ts` (lazy chunk) |
| The extrude manipulator (translate arrows, rotate rings, scale cubes, the uniform centre cube, the local/world toggle) as the viewport tool `VIEWPORT_TOOL.extrude`; the Inset/Bevel value handle (§5.9) | `viewport/src/manipulators/extrude/{geometry,view}.ts`, `viewport/src/tools/model/extrude/tool.ts` |
| Multi-Cut (§5.11 gestures, reserved keys, `Ctrl`-click/`Ctrl`+MMB/`Ctrl+Shift`-click loops, validation and preview) | `viewport/src/tools/model/multicut/tool.ts` |
| Insert Edge Loop tool (hover preview of the whole loop and its mirror, slide before release, typed weight, `PageUp`/`PageDown` count) | `viewport/src/tools/model/loop/tool.ts` |
| Target Weld tool (drag a vertex/edge onto another; MMB or the stand-in = centre) | `viewport/src/tools/model/weld/tool.ts` |
| Slide Edge tool (LMB/MMB drag; the first direction picks the rail side; a `MeshOpSession` preview; the percent capture target) | `viewport/src/tools/model/slide/tool.ts` |
| Eager tool definitions, the lazy topology kit and its per-viewport runtime (preview overlay, hover, picks, scratch kernel runs, handles) | `viewport/src/tools/model/topology/{index,kit,runtime,overlay}.ts` |
| Bridge from pick order | B3's kernel resolves the two chains in pick order (`selectionOf…order`); E2E-MOD-28's B12b check runs it through the menu and the card |
| Symmetric pointer arguments in every tool (§5.14) | B3/B4's kernels map pointer args (cut, loop, weld, slide, bridge); the tools pass the user's pointer args and say the run's first warning on the help line ("No mirror partner: applied to one side") |
| Unit tests | `editor-core/test/topology/{extrude-session,eager-boundary}.test.ts`, `viewport/test/m6a-topology/tools.test.ts` |
| E2E-MOD-04, -05, -06, -08, -17, -18, -20, -21, -22, -24, -28 | `apps/web/e2e/m6a-{04,05,06,08,17,18,20,21,22,24,28}-*.spec.ts`, helpers `apps/web/e2e/helpers/m6a-model-topology-tools.ts` |

**READY flag for B12a**: `app.extrude` is no longer the B0a stub when `extrudeEngineModule()` (or `loadExtrudeEngine()`)
resolves, or when `app.extrude.state` becomes non-null after a `mesh.extrude` run; `beginSmartExtrude` is exported from
`@ekza-animator/editor-core`.

## Decisions and deviations

| ID | Decision | Why |
|---|---|---|
| M6A-B12B-1 | **Eager shim, lazy engine.** `app.extrude` is created before the app (closed composition root); the runner's hooks and `registerBuiltins` bind it; the engine (`extrudeEngine.ts`) loads on the first Model entry (and with any `mesh.extrude` before that: its session opens once the chunk has loaded, its frame then from the cap). `test/topology/eager-boundary.test.ts` keeps eager modules from importing engine values. | §5.27; the B11 runtime-chunk pattern (M6A-B11-19). |
| M6A-B12B-2 | **Runner hooks** (B11's `operators/runner.ts`, two lines): `extrudeBeforeRun` after the first poll — an ending run ends the session before its `prepare`/`apply` read the mesh; `extrudeAfterRun` after the LastRun recorder — a finished `mesh.extrude` opens a session, an adjusted re-run pushes onto the args stack (or follows a stack step). | §5.8 "at the start of the ending gesture … before that gesture reads the mesh"; no other hook sees an operator's start. |
| M6A-B12B-3 | **What ends the session**, mapped onto operators: any `flags.undo` or `flags.selection` operator and `edit.escape` (zero-drop), `workspace.set` leaving Model (zero-drop), `model.pivot.editToggle`/`mesh.pivot.*` (no drop); never `view.*`, `ui.*`, `edit.undo`/`edit.redo` (they step the stack), `edit.adjustLast` and its re-run, tool switches, `T`. A remote/import batch touching a target mesh ends it and drops after the store's emit. Safety net: the LastRun closing for a reason no operator reported (a store write by a gesture, an undo elsewhere) ends it without the drop. B10's `select.mode` and B9's `switchWorkspace` call `end` themselves. | §5.8 table. |
| M6A-B12B-4 | **Workspace switch zero-drops** (B9's `workspaces/switch.ts` called `end('workspace', {drop: false})`; now `drop: true`, and B9's test literal follows). | §5.8 table: "workspace switch … yes / yes". |
| M6A-B12B-5 | **The session frame** is the §5.8 region frame (B3's `regionFrame`) of the first region of the stored picks of the first target mesh (with `keepFacesTogether` off: the lowest-index face), taken right before the run (after a drop, whose cap kept the face indices); border edges: the chain frame of the lowest-index selected edge (X along it, Z its face's normal, Y away from the face). `T` reopens with a memo of that frame (it follows the extrude's adjusted steps); without one, the frame comes from the cap moved back by `localTranslate*` (exact when only translation moved the cap). | §5.8 step 4, §5.7 `T`. |
| M6A-B12B-6 | **Absorption math** (`absorbArgs`, pure and exported): local args `t += Fᵀ·M⁻¹·Δt` (M = the placement's linear part), world args `t += Δt`; rotation about the cap's current pivot `R' = Aᵀ·ΔR·A·R` (A = the frame's world rotation; world args `R' = ΔR·R`), Euler xyz through `eulerNear` against the current angles; scale multiplies `localScale*` by the frame-aligned factors. The drag's start args are the stack's current entry; each update previews through B11's `beginCardPreview` (`base: 'before-last'`); `commit` runs one `edit.adjustLast` with the changed values (it commits the preview session). | §5.8 "Conversion uses the args frame A"; unit tests: a 30°-tilted face moved on world Y (data-tilted and through a rotated, scaled placement), two composed world rotations, scale. |
| M6A-B12B-7 | **Smart extrude** (`beginSmartExtrude(app, ctx)`, the same `AbsorbGesture` shape): ends the open session with its zero-drop, takes the frame of the selection, previews a new `mesh.extrude` through a `MeshOpSession` from the current mesh (the option box's defaults under the drag's args) and runs **one** `mesh.extrude` on commit (`source: 'tool'`): the step and the card are titled "Extrude" (an adjust would label the step "Extrude (adjusted)"), and that run opens the next session. A commit without movement runs nothing. On the extrude manipulator the manipulator tool stays active through the drag. B12a's W/E/R tools call it when `Shift` is held at a handle drag's start (null: move normally — object mode, nothing to extrude). | §5.8 "Smart extrude"; E2E-MOD-18 "three 'Extrude' steps". |
| M6A-B12B-8 | **The extrude manipulator is a viewport tool** (`VIEWPORT_TOOL.extrude`): a session switches the select tool to it (no other tool: W/E/R stay and absorb through B12a), its end hands the viewport back; the tool never lingers with nothing to show (a workspace's remembered tool falls back to select). Its handles reuse the W/E/R handle ids (`tx…tz`, `rx…rz`, `sx…sz`, `suniform`; the toggle is `space`), drawn at the manipulator size in px, placed per pane in `onBeforeRender`; picking is analytic (centre, toggle, cubes, arrows, rings). `screenOfManipulator` (B9's `manager/testApi.ts`) asks the topology kit first; a grab point always picks back as its own handle (a ring's widest point can lie on an arrow). | §4.6 `VIEWPORT_TOOL.extrude`, §4.7. |
| M6A-B12B-9 | **Typed values during a manipulator drag** (capture case (a)): the typed field commits one `edit.adjustLast {[field]: value}` on `Enter` (pushed on the stack); the drag's pointer preview is dropped. `Esc` during the first drag after `Mod+E` cancels it and ends the session with the zero-drop. | §5.10 (a), §5.8 table row 1. |
| M6A-B12B-10 | **Previews of Multi-Cut and Insert Edge Loop are scratch kernel runs** on a copy of the stored revision (`TopologyRuntime.tryOp`: `begin` → run → read → `abort`), drawn as overlay lines: exactly the edges the run would make, the mirrored path/loop included, with no document write and no preview session. A `MeshOpSession` would renumber the mesh the next click picks on (Multi-Cut points refer to the original indices). Slide previews through a `MeshOpSession` (its adjust fast path), Target Weld through a rubber band. | §5.10 "Preview goes through MeshOpSession" (the intent: no document writes, `Esc` leaves no step). |
| M6A-B12B-11 | **Component tools in object mode draw and pick components** (B6's `viewport/src/mesh/display.ts`: the display's component kind is the tool's — Multi-Cut, Insert Edge Loop, Slide: edges; Target Weld: vertices; Paint: faces — while B10 hilites the selected meshes for the tool). | §5.6 "Component tools in object mode"; E2E-MOD-05 starts in object mode. |
| M6A-B12B-12 | **Multi-Cut details**: points on edges and vertices only (a click inside a face says "Click on an edge or a vertex: points inside faces arrive later"); consecutive points must share a face ("Click on each face the cut crosses") and the chord is validated by a scratch `mesh.cut` ("That cut would leave the face"); one mesh per cut; a single point cuts nothing. `Ctrl`-click loops pass `mode: 'relative'` (one loop, whatever the Insert Edge Loop option box says) and drop a cut in progress first (the loop renumbers it). | §5.11. |
| M6A-B12B-13 | **The Model tools' help line**: `sayModelHelp`/`onModelHelp` (eager, `extrudeSession.ts`); B11's capture bridge (`editor/src/overlays/menus/optionBox.tsx`, one subscription) shows them. Tools say the first warning of a finished run and the reason of a refused one. | §5.14 "the help line says …", §5.8 "the help line mirrors it". |
| M6A-B12B-14 | **The Inset/Bevel value handle**: after an Inset or Bevel from the select tool (any source but the card) the manipulator tool shows a diamond and a pane-right arrow at the result's centroid; dragging it is a virtual slider on `offset` / `fraction` (the shipped rates, `Shift` ×0.1, `Mod` ×10; B11's card preview; one `edit.adjustLast` on release); the select tool comes back when that operation stops being the live last one. Bevel's handle works once B5's bevel lands (READY.b5; the stub refuses). | §6.1 "B12b (handle)", research 16 §9. |
| M6A-B12B-15 | **`PageUp`/`PageDown`** step the Insert Edge Loop count of a placement in progress (Multiple mode). Multi-Cut, Target Weld and Slide have no counts. | §5.10. |
| M6A-B12B-16 | **E2E-MOD-24's Average step** lifts one interior vertex first (`mesh.transformComponents`): a regular grid's interior vertices already sit at their neighbours' average, so Average would move none. | §10.1 assertion "interior vertices moved". |
| M6A-B12B-17 | **Gated scenarios keep ungated B12b checks** in the same file (the B11 pattern): E2E-MOD-17 part (b) and the manipulator flow, -18 with the manipulator's `Shift` drags, -08 (a), (b) and the MMB weld, -24 without symmetry, -28 without the snap. The gated parts are `test.fixme('<§10.1 ids>')`: 04 `b12a, b13`; 08, 17, 18, 24, 28 `b12a`; 20, 21 (arm/waist), 22 `b12a, b13`; 21 (b), (c) `b12a`. Every spec picks screen points at least 24 px inside the pane (a point on a dock sash is not a click on the mesh). | §10.1 Gates. |
| M6A-B12B-18 | **The status line's "Extrude · W World"** is not drawn: the status-line tool/space body is B12a's (B9 slots); it can read `app.extrude.state` and the tool's space. | §5.8 (B12a's status body). |

## Midpoint review (§5.14 overrun rule, Q-MOD-UI-9)

Recorded at the session-engine milestone (about day 3 of 6): **no overrun is projected**. B3 and B4 landed the symmetric
pointer arguments in the kernels (`mesh.cut` mirrors or clips the path at the seam, `mesh.insertLoop` places the mirror
loops and decides "once" by the mapped seed point, `mesh.targetWeld` follows the seam table, `mesh.slide` mirrors the
reference, `mesh.bridge` the pair), so every B12b tool passes the user's pointer args and the kernel does the rest; the
tools' share is the help line for unmatched partners. Validation: E2E-MOD-04, -20, -21 (a, b, c) and -22 (a, b) all
passed against a throwaway merge of `m6a/model-content` (B13) with a temporary `model.symmetry.set` and `symmetry()`
probe (neither committed; the probe stood in for B12a). **No Live Mirror decision is needed.**

## Contract notes for INT

- **New paths outside the literal §9.1 Dirs**, all B12b's: `editor-core/src/operators/builtin/extrudeEngine.ts` (the
  lazy half of `extrudeSession.ts`), `viewport/src/tools/model/topology/**` (the shared eager registration, the lazy kit
  and runtime of the five tools), `editor-core/test/topology/**`, `viewport/test/m6a-topology/**`,
  `apps/web/e2e/helpers/m6a-model-topology-tools.ts`. Please add them to B12b's Dirs.
- **Cross-owner edits** (each a few lines, commented): B11's `operators/runner.ts` (the two hooks), B11's
  `operators/builtin/index.ts` (`bindExtrude` next to `bindCapture`), B9's `workspaces/switch.ts` (drop on leaving
  Model), B9's `viewport/src/manager/contributions.ts` (`registerTopologyTools`), B9's `viewport/src/manager/testApi.ts`
  (`screenOfManipulator` asks the extrude manipulator first), B6's `viewport/src/mesh/display.ts` (component tools in
  object mode), B11's `editor/src/overlays/menus/optionBox.tsx` (the Model tools' help line), `editor-core/src/index.ts`
  (exports).
- **Literal test updates at this merge of B3, B4, B10 and B11** (the refusal path and the read selection kept under
  test): B0a's `test/m6a/mesh-runtime.test.ts` ×2 (real refusals: Extrude without a selection, Inset of a closed shell),
  B7's `test/mesh/runtime.test.ts` ×5 and `test/mesh/setops.test.ts` ×2 (selections read through `selectionFor`, B10's
  service once it stores them), B9's `test/m6a/workspaces.test.ts` (drop true), B11's `test/ops-ui/lastrun.test.ts` ×2
  (the shim's `state` getter, `reopen` mocked to test only B11's call conditions), viewport's `test/operators.test.ts`
  (the tool list). `mesh-core/test/descriptors.test.ts` was reformatted (a merge artefact).
- **For B12a**: W/E/R (and MMB) drags on the cap call `app.extrude.beginAbsorb(tool, space)` first (non-null while a
  session is open; the delta is world-space about the cap's pivot; translate and rotate are exact from any space, scale
  always uses the session frame); `Shift` at a handle drag's start calls `beginSmartExtrude(app, {paneId})` (null: move
  normally). E2E-MOD-17's `R` drag and -18's `W` `Shift`-drags are B12a's halves; `extrudeManipulatorFrame(app)` gives
  the cap's pivot and axes for B12a's manipulator placement during a session.
- **B11's capture bridge** sets the case (b) origin from the last pointer position it saw; on a loaded machine its lazy
  overlay can mount after the first pointer moves. E2E-MOD-17 part (b) moves the pointer until the window disarms.
- **Eager route** (production build, gzip -9): the merged base before B12b (`71996f0`: B2, B3, B4, B10, B11 merged)
  already measures **906,925 B > 900,000 B**; B12b adds about **+1.8 kB** (908,767 B before moving the zero-drop identity
  into the lazy engine): the shim and hooks (`extrudeSession.ts` ≈ 1.0 kB standalone gzip) and the eager tool
  definitions (`topology/index.ts` ≈ 0.8 kB). The engine, the kit, the manipulator drawing and the tools are lazy chunks.
  The gate needs INT's/the owner's decision (M6A-B9-14 allowance) and the candidates B10 named (M6A-B10 "Eager route
  size").

## Gates (local, real Chrome; port 3252)

Run on this branch's head in this worktree (the tree clean before and after; the server stopped, port 3252 free):

| Gate | Result |
|---|---|
| `pnpm run format:check` | clean (1,403 files) |
| `pnpm run lint` | rc 0, no findings |
| `pnpm run typecheck` | rc 0 |
| `pnpm run check:deps` | 15 packages follow the rules |
| `pnpm run test` | 15 tasks green: anim-core 671, doc 235, doc-yjs 81, rig 202, io 176, mesh-core 711 + 3 skipped, mesh-view 74, editor-core **1083 + 12 skipped** (B12b: 27 in `test/topology`), curve-editor 207 + 3 skipped, viewport **176 + 1 skipped** (B12b: 12 in `test/m6a-topology`), editor 480 + 6 skipped, headless-tests 173, ui 87, web 16, tooling 14 |
| `pnpm run build` | green |
| `check:size` (not in B12b's gate list; reported) | **908,543 B > 900,000 B**: the merged base before B12b measures 906,925 B (pre-existing, B10 + B11 together); B12b adds **+1,618 B**; every lazy boundary holds; the Model workspace chunk 119,132 B |
| B12b e2e specs (`--repeat-each=2`, project `chrome`) | **20 passed, 26 skipped** (the gated `test.fixme` parts with their §10.1 ids) |
| Full e2e suite once (`EKZA_E2E_PORT=3252 pnpm run test:e2e`) | **137 passed, 44 skipped, 0 failed** (1.1 min) |
| Symmetric scenarios on a throwaway B13 merge with a temporary symmetry probe (not committed) | E2E-MOD-04, -20, -21 (a, b, c), -22 (a, b): **green**; -08 (c), -17, -18, -28's snap fail only where B12a's tools are needed (`scene.object.transform`, the component R/W manipulators, `V` snap) |
| B11's E2E-MOD-19 (gated `b3, b10, b12b`) with the fixme removed locally | **green** (the extrude manipulator's `tz` drag) |
