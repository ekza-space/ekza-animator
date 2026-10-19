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
| M6A-B12B-5 | **The session frame is the frame the kernel applies to the picked group** (fix round 2): mesh-core's `extrudeGroupFrame(m, kind, picks, {keepFacesTogether, symmetry, placement})` groups the picks as `mesh.extrude` groups the symmetry-expanded selection (face regions, or border-edge chains) and returns the group holding the lowest-index pick: its §5.8 frame (faces: B3's `regionFrame` of the region; border edges: the §5.8 step 7 chain frame, `borderChainFrame` — the length-weighted pivot, X the summed edge directions projected, Z the averaged face normals, Y away from the faces), its §5.14 role, and for a mirrored **partner** group (picked on the negative side) its *source* group's frame plus the mirror S, because the kernel moves a partner with S∘T∘S. A picked face whose partner joins its region gets the joint region's frame. The engine stores `Frame.mirror` and converts a partner's drags in the source frame with the reflected delta (M6A-B12B-6); the manipulator and `extrudeSession.frame` sit on the picked group in the reflected frame S·F (left-handed: X and Y as the source's, Z the picked cap's own normal for faces). The frame is taken right before the run (after a drop, whose cap kept the face indices). `T` reopens with a memo of that frame (it follows the extrude's adjusted steps); without one, the frame comes from the cap moved back by `localTranslate*` (exact when only translation moved the cap). | §5.8 step 4 "Under symmetry the partner region uses the reflected frame", §5.14, §5.7 `T`. |
| M6A-B12B-6 | **Absorption math** (`absorbArgs`, pure and exported): local args `t += Fᵀ·M⁻¹·Δt` (M = the placement's linear part), world args `t += Δt`; rotation about the cap's current pivot `R' = Aᵀ·ΔR·A·R` (A = the frame's world rotation; world args `R' = ΔR·R`), Euler xyz through `eulerNear` against the current angles; scale multiplies `localScale*` by the frame-aligned factors. A mirrored partner group's world delta is reflected first (W = M·S·M⁻¹: `Δt ↦ W·Δt`, `ΔR ↦ W·ΔR·W`), so the picked cap moves by exactly the delta and its source by the delta's mirror (identical args on both sides, §5.14). The drag's start args are the stack's current entry; each update previews through B11's `beginCardPreview` (`base: 'before-last'`); `commit` runs one `edit.adjustLast` with the changed values (it commits the preview session). | §5.8 "Conversion uses the args frame A"; unit tests: a 30°-tilted face moved on world Y (data-tilted and through a rotated, scaled placement), two composed world rotations, scale; under Object X the −X face, the +X face and a −X border edge dragged on X/Y/Z and rotated (1e-6 on both caps), smart extrude on the −X face. |
| M6A-B12B-7 | **Smart extrude** (`beginSmartExtrude(app, ctx)`, the same `AbsorbGesture` shape): ends the open session with its zero-drop, takes the frame of the selection, previews a new `mesh.extrude` through a `MeshOpSession` from the current mesh (the option box's defaults under the drag's args) and runs **one** `mesh.extrude` on commit (`source: 'tool'`): the step and the card are titled "Extrude" (an adjust would label the step "Extrude (adjusted)"), and that run opens the next session. A commit without movement runs nothing. On the extrude manipulator the manipulator tool stays active through the drag. B12a's W/E/R tools call it when `Shift` is held at a handle drag's start (null: move normally — object mode, nothing to extrude). | §5.8 "Smart extrude"; E2E-MOD-18 "three 'Extrude' steps". |
| M6A-B12B-8 | **The extrude manipulator is a viewport tool** (`VIEWPORT_TOOL.extrude`): a session switches the select tool to it (no other tool: W/E/R stay and absorb through B12a), its end hands the viewport back; the tool never lingers with nothing to show (a workspace's remembered tool falls back to select). Its handles reuse the W/E/R handle ids (`tx…tz`, `rx…rz`, `sx…sz`, `suniform`; the toggle is `space`), drawn at the manipulator size in px, placed per pane in `onBeforeRender`; picking is analytic (centre, toggle, cubes, arrows, rings). `screenOfManipulator` (B9's `manager/testApi.ts`) asks the topology kit first; a grab point always picks back as its own handle (a ring's widest point can lie on an arrow). | §4.6 `VIEWPORT_TOOL.extrude`, §4.7. |
| M6A-B12B-9 | **Typed values during a manipulator drag** (capture case (a)): the typed field commits one `edit.adjustLast {[field]: value}` on `Enter` (pushed on the stack); the drag's pointer preview is dropped. `Esc` during the first drag after `Mod+E` cancels it and ends the session with the zero-drop. | §5.10 (a), §5.8 table row 1. |
| M6A-B12B-10 | **Previews of Multi-Cut and Insert Edge Loop are scratch kernel runs** on a copy of the stored revision (`TopologyRuntime.tryOp`: `begin` → run → read → `abort`), drawn as overlay lines: exactly the edges the run would make, the mirrored path/loop included, with no document write and no preview session. A `MeshOpSession` would renumber the mesh the next click picks on (Multi-Cut points refer to the original indices). Slide previews through a `MeshOpSession` (its adjust fast path), Target Weld through a rubber band. | §5.10 "Preview goes through MeshOpSession" (the intent: no document writes, `Esc` leaves no step). |
| M6A-B12B-11 | **Component tools in object mode draw and pick components** (B6's `viewport/src/mesh/display.ts`: the display's component kind is the tool's — Multi-Cut, Insert Edge Loop, Slide: edges; Target Weld: vertices; Paint: faces — while B10 hilites the selected meshes for the tool). | §5.6 "Component tools in object mode"; E2E-MOD-05 starts in object mode. |
| M6A-B12B-12 | **Multi-Cut details**: points on edges and vertices only (a click inside a face says "Click on an edge or a vertex: points inside faces arrive later"); consecutive points must share a face ("Click on each face the cut crosses") and the chord is validated by a scratch `mesh.cut` ("That cut would leave the face"); one mesh per cut; a single point cuts nothing. `Ctrl`-click loops pass `mode: 'relative'` (one loop, whatever the Insert Edge Loop option box says) and drop a cut in progress first (the loop renumbers it). | §5.11. |
| M6A-B12B-13 | **The Model tools' help line**: `sayModelHelp`/`onModelHelp` (eager, `extrudeSession.ts`); B11's capture bridge (`editor/src/overlays/menus/optionBox.tsx`, one subscription) shows them. Tools say the first warning of a finished run and the reason of a refused one. | §5.14 "the help line says …", §5.8 "the help line mirrors it". |
| M6A-B12B-14 | **The Inset/Bevel value handle**: after an Inset or Bevel from the select tool (any source but the card) the manipulator tool shows a diamond and a pane-right arrow at the result's centroid; dragging it is a virtual slider on Inset's `offset`, Bevel's `fraction` — or Bevel's absolute `offset` when the run has Offset as Fraction off (`valueParamOf`, fix round 2) — (the shipped rates, `Shift` ×0.1, `Mod` ×10 per move; B11's card preview; one `edit.adjustLast` on release); the select tool comes back when that operation stops being the live last one. Bevel's handle works once B5's bevel lands (READY.b5; the stub refuses). | §6.1 "B12b (handle)", research 16 §9. |
| M6A-B12B-15 | **`PageUp`/`PageDown`** step the Insert Edge Loop count of a placement in progress (Multiple mode). Multi-Cut, Target Weld and Slide have no counts. **Every reserved modal key** (`RESERVED_MODAL_KEYS`) is consumed by each topology tool while it is placing or dragging — acted on, or swallowed as a no-op (`Backspace` on Slide, Target Weld, Insert Edge Loop and the extrude manipulator/value handle; `PageUp`/`PageDown` without a count; `Enter` on the extrude manipulator and Target Weld) — so the keyboard adapter never falls through to the keymap's `mesh.delete`/`scene.delete` mid-gesture (fix round 1). | §5.10 "can never run `mesh.delete` on the selection". |
| M6A-B12B-16 | **E2E-MOD-24's Average step** lifts one interior vertex first (`mesh.transformComponents`): a regular grid's interior vertices already sit at their neighbours' average, so Average would move none. | §10.1 assertion "interior vertices moved". |
| M6A-B12B-17 | **Gated scenarios keep ungated B12b checks** in the same file (the B11 pattern): E2E-MOD-17 part (b) and the manipulator flow, -18 with the manipulator's `Shift` drags, -08 (a), (b) and the MMB weld, -24 without symmetry, -28 without the snap. The gated parts are `test.fixme('<§10.1 ids>')`: 04 `b12a, b13`; 08, 17, 18, 24, 28 `b12a`; 20, 21 (arm/waist), 22 `b12a, b13`; 21 (b), (c) `b12a`. Every spec picks screen points at least 24 px inside the pane (a point on a dock sash is not a click on the mesh). | §10.1 Gates. |
| M6A-B12B-18 | **The status line's "Extrude · W World"** is not drawn: the status-line tool/space body is B12a's (B9 slots); it can read `app.extrude.state` and the tool's space. | §5.8 (B12a's status body). |
| M6A-B12B-19 | **Drag speed on the extrude manipulator** (`dragSpeed`): `Shift` pressed after a drag has started is ×0.1, `Mod` ×10 (Shift wins), applied per move to that move's step of the drag value (translate/scale: the axis parameter; rotate: the angle; uniform: the factor's offset from 1), so a modifier change mid-drag never jumps. `Shift` held since the press is smart extrude and becomes fine only after it is released and pressed again. The value handle accumulates the same way. | §5.8 "Shift pressed after a drag has started is the fine adjustment", §7, S29. |
| M6A-B12B-20 | **The zero-drop toast's Undo** is `edit.redo {step: <the dropped extrude's step id>}`: with a `step`, B11's `edit.redo` polls "Nothing to restore" unless that step is the history's top redo entry and never steps a session; without args it is unchanged. | §5.8 "runs `edit.redo` while that redo entry still exists". |

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
  (exports); fix round 1: B11's `operators/builtin/edit.ts` (`edit.redo {step}`, M6A-B12B-20) and B3's
  `mesh-core/src/ops/extrude/edges.ts` + `mesh-core/src/index.ts` (`borderChainFrame` exported next to `regionFrame`,
  M6A-B12B-5); fix round 2: B3's `edges.ts` exports its chain helpers (`chainsOf`, `borderRecords`, `chainFrame`,
  `BorderEdge`), and the new `mesh-core/src/ops/extrude/sessionFrame.ts` (B12b's, in B3's directory) with its test
  `mesh-core/test/ops-core/extrude-session-frame.test.ts`. **§4.3 API additions**: `borderChainFrame(m: EditMesh,
  edges: ArrayLike<number>): OpFrame | null` (the frame of the chain holding the lowest-index border edge; null without
  a border edge) and `extrudeGroupFrame(m: EditMesh, kind: 'face' | 'edge', picks: ArrayLike<number>, opts?:
  {keepFacesTogether?, symmetry?: SymmetryContext | null, placement?: ReadonlyXf}): ExtrudeGroupFrame | null` with
  `ExtrudeGroupFrame = {frame: OpFrame, role: 'own' | 'self' | 'source' | 'partner', mirror: ExtrudeMirror | null}`
  (M6A-B12B-5) — please add both to the §4.3 listing.
- **Spec amendment request: E2E-MOD-01 (owner INT) and E2E-MOD-02 (owner B10, spec file
  `apps/web/e2e/m6a-02-mac-without-f-keys.spec.ts`).** Both rows end with "one undo → 8/12/6 and the cube's
  manifest", which contradicts §5.8's args undo stack (and E2E-MOD-17, where the third `Mod+Z` removes the extrude):
  the `Mod+E` opens a session, the typed `0.5` and the card's Divisions 2 each push an args entry, so the first undo
  steps Divisions back. Evidence (fix round 2 verifier, an un-gated throwaway copy of m6a-02 on this branch, all its
  gates b3, b7, b11 merged): after one undo the run had `{v: 12, e: 20, f: 10}` where `{v: 8, e: 12, f: 6}` was
  expected (its other failure, the soft card `⌘E` check, is B11's and recorded by B10). Proposed wording, either: "three
  undos (Divisions, then the typed value, then the extrude) → 8/12/6 and the cube's manifest", or "after one undo:
  12/20/10 with `localTranslateZ` 0.5 kept and `state().extrudeSession` true". Until the rows change, both scenarios are
  red at INT by design of §5.8, not by a B12b defect.
- **For INT/B0b (keyboard adapter, not a B12b defect; read from the code, not run in the browser)**: `#toolKey` in
  `editor/src/input/keyboard.ts` offers the reserved modal keys to the viewport tool only while the scope chain's panel
  is the viewport with a pane (§5.17 step 2). During a Multi-Cut in progress (`placing`) with the pointer over another
  panel, `Backspace` therefore reaches the keymap (`mesh.delete`), against §5.10's "a Multi-Cut `Backspace` … can never
  run `mesh.delete` on the selection". Either route the reserved keys to the active viewport tool while it is placing or
  dragging wherever the pointer is, or amend §5.10's wording.
- **For INT/B5/B10/B11 (Bevel adjusts through the card preview)**: on a local, uncommitted merge of
  `m6a/mesh-bevel-check-uv` (B5) into this branch (aborted afterwards), in the viewport test scene the first Bevel adjust
  after `beginCardPreview` → `update` → `edit.adjustLast` is cancelled with "No operation to adjust": B11's Last-op
  tracker closes the LastRun with "Selection changed" (`lastopEngine.ts` `attachTracker`, the components listener) before
  the adjust's `prepare`. It reproduces with the topology runtime detached and the Move tool active (so with no B12b
  code in the path) and hits the card's own Fraction/Offset sliders the same way; a second Bevel in the same browser
  session adjusts fine, and in editor-core without a viewport both adjust fine. The gated
  `viewport/test/m6a-topology/tools.test.ts` "the Bevel value handle (READY.b5)" drag of the absolute offset therefore
  fails at INT until that is fixed; its fraction case only checks that the handle is on `fraction`.
- **Literal test updates at this merge of B3, B4, B10 and B11** (the refusal path and the read selection kept under
  test): B0a's `test/m6a/mesh-runtime.test.ts` ×2 (real refusals: Extrude without a selection — exactly
  `extrude.no-selection` since fix round 1 —, Inset of a closed shell),
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
  Fix round 1 adds +78 B (the `edit.redo {step}` guard): **908,621 B**. Even without all of B12b's eager additions the
  route stays above the gate (the base alone is 906,925 B), so trimming the shim or the tool definitions would not pass
  it; the decision stays INT's/the owner's.
  The gate needs INT's/the owner's decision (M6A-B9-14 allowance) and the candidates B10 named (M6A-B10 "Eager route
  size").

## Fix round 1

| Problem (verifier, 388c3dd) | Resolution | Test |
|---|---|---|
| major: reserved modal keys fell through to the keymap mid-gesture (`Backspace` ran `mesh.delete`) in the extrude manipulator/value handle, Slide, Target Weld, Insert Edge Loop, Multi-Cut | every tool's `key()` consumes every `RESERVED_MODAL_KEYS` code while placing or dragging (M6A-B12B-15) | per tool, `viewport/test/m6a-topology/tools.test.ts`: each reserved code returns true during the gesture, no step, no mesh change; idle, false |
| major: border-edge session frame from the lowest-index edge only (L-chain drag moved diagonally; pivot off the kernel's) | `borderChainFrame`, the kernel's chain frame (M6A-B12B-5) | `editor-core/test/topology/extrude-session.test.ts`: L-shaped and straight chains — pivot = kernel pivot, world drags move the outer edges exactly (1e-6) |
| major: `Shift`/`Mod` ignored during manipulator drags | per-move drag speed (M6A-B12B-19) | Shift from the second move gives ×0.1 of each later step; `dragSpeed` |
| minor: unguarded toast `edit.redo` | `edit.redo {step}` (M6A-B12B-20) | undo of an earlier Select, then the toast's Undo: "Nothing to restore"; after redoing the Select it restores |
| minor: weakened B0a literal | exact `extrude.no-selection` | — |
| minor: test gaps | Slide state machine (RMB ignored, `Esc` no step, MMB drag, typed percent), Target Weld RMB ignored, Multi-Cut `Ctrl`+MMB / `Ctrl+Shift` / `Shift` snap / 8 px vertex snap, reserved keys per tool, edge-chain sessions | as listed |
| minor: `check:size` | not fixable inside B12b (see "Eager route"); needs the INT/owner decision | — |

## Fix round 2

| Problem (verifier, a3534d0) | Resolution | Test |
|---|---|---|
| major: under symmetry a picked mirrored partner (−X face, −X border edge) took its own right-handed frame while the kernel moves it with the reflected source frame: absorbed drags moved both caps the wrong way along Y (faces) or X (chains), rotations too, and smart extrude inherited it | mesh-core `extrudeGroupFrame` (the kernel's grouping, role, source frame and S); the engine converts in the source frame with the reflected delta and draws the manipulator in S·F (M6A-B12B-5, -6) | `editor-core/test/topology/extrude-session.test.ts`: Object X, the −X face at the origin and through a rotated, moved, scaled placement, the +X face, a −X border edge — world drags on X, Y, Z and a world rotation move the picked group by exactly the delta and the partner by its mirror (1e-6), the reflected session frame and the args; smart extrude on the −X face; `absorbArgs`/`manipulatorFrame` with a mirror; `mesh-core/test/ops-core/extrude-session-frame.test.ts`: roles, frames, S, the joint region, chains, against the kernel's run. The four −X cases fail on a3534d0's engine |
| major: E2E-MOD-01/-02 "one undo → 8/12/6" contradicts §5.8 (unrecorded) | contract note and amendment request (owners INT, B10) | — |
| minor: no preview test | the scene helper attaches the mesh registry (as the editor does at boot) so the previews read the run's symmetry map; `ToolOverlay.drawn` | `viewport/test/m6a-topology/tools.test.ts`: hover and slide preview the loop the run inserts (same points); Object X: 8 segments at ±x for 0.3, 4 on the plane at a typed 0.5, the runs 16/28/14 and 12/20/10; Multi-Cut's chord preview equals the cut, under Object X its mirror too (9/12/4) |
| minor: manipulator drags | — | a ring drag (the cap turns about the pivot by `localRotateX`, the grabbed ring point moves along the drag), an axis scale cube (`localScaleX` only, along the cap axis), a translate after the local/world toggle (world X → `localTranslateY`, the cap moves along world X) |
| minor: the pivot-edit row bypassed the runner | the test runs the registered `model.pivot.editToggle` first: the B0a stub poll-fails, and the runner's hook runs only after a passing poll, so the session stays (it would end once B12a's operator lands); then the hook by the operator's id as before | `a pivot edit ends it without the zero-drop` |
| minor: the Bevel handle dragged `fraction` with Offset as Fraction off | `valueParamOf`: `offset` then (M6A-B12B-14) | `valueParamOf` unit test; the READY.b5-gated drag (see the B5/B10/B11 contract note) |
| minor: reserved keys with the pointer over another panel | contract note for INT/B0b | — |

## Gates (local, real Chrome; port 3252)

Fix round 1, run on this branch's head in this worktree (the tree clean before and after apart from these notes; one
e2e server on port 3252 for both e2e runs, stopped afterwards, port free; the preview server untouched):

| Gate | Result |
|---|---|
| `pnpm run format:check` | clean (1,403 files) |
| `pnpm run lint` | rc 0, no findings |
| `pnpm run typecheck` | rc 0 |
| `pnpm run check:deps` | 15 packages follow the rules |
| `pnpm run test` | 15 tasks green (6 replayed from the cache: ui, doc, doc-yjs, anim-core, rig, tooling — inputs unchanged): anim-core 671, doc 235, doc-yjs 81, rig 202, io 176, mesh-core 711 + 3 skipped, mesh-view 74, editor-core **1086 + 12 skipped** (B12b: 29 in `test/topology`), curve-editor 207 + 3 skipped, viewport **186 + 1 skipped** (B12b: 22 in `test/m6a-topology`), editor 480 + 6 skipped, headless-tests 173, ui 87, web 16, tooling 14 |
| `pnpm run build` | green |
| `check:size` (not in B12b's gate list; reported) | **908,621 B > 900,000 B** (the base before B12b 906,925 B; B12b +1,696 B with fix round 1's +78 B); M6a eager delta +63,354 B (warning, not enforced); the Model workspace chunk 119,239 B |
| B12b e2e specs (04, 05, 06, 08, 17, 18, 20, 21, 22, 24, 28; project `chrome`) | **10 passed, 13 skipped** (the gated `test.fixme` parts with their §10.1 ids), 0 failed |
| Full e2e suite once (`EKZA_E2E_PORT=3252 pnpm run test:e2e`) | **137 passed, 44 skipped, 0 failed** (1.1 min) |

Before fix round 1 (388c3dd), also recorded:

| Gate | Result |
|---|---|
| Symmetric scenarios on a throwaway B13 merge with a temporary symmetry probe (not committed) | E2E-MOD-04, -20, -21 (a, b, c), -22 (a, b): **green**; -08 (c), -17, -18, -28's snap fail only where B12a's tools are needed (`scene.object.transform`, the component R/W manipulators, `V` snap) |
| B11's E2E-MOD-19 (gated `b3, b10, b12b`) with the fixme removed locally | **green** (the extrude manipulator's `tz` drag) |
