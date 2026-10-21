# M6b C6 — skin UI with the C5 MVP subset: weights kernel, Paint Skin Weights, weight display, panels: build notes

Branch `m6b/skin-ui` (from `m6b/mvp` at `22b0e11`, spec v1.3) with `m6b/character-runtime` (C1), `m6b/auto-skin` (C4)
and `m6b/rig-shell` (C7) merged in that order (conflicts resolved in the merge commits `f89cac2` and `7b930df`: the
`LANDED` poll tables of `editor-core/test/m6b/foundation.test.ts`, the C1/C7 halves of `m6b/keys-hash.test.ts`, and
`rig/chunk/services.ts` — C7's services with C4's real skin service). Scope: [M6B-SPEC §9.0 C6](../M6B-SPEC.md#c6--skin-ui-with-the-c5-mvp-subset)
— the §0.3 C6 row. Decision IDs below are `M6B-C6-<n>`. READY flag `c6` set (the C5 subset ships with it; the READY
tables have no `c5` key).

## What landed

| C6 item | Where |
|---|---|
| §5.10 normalization with holds | `mesh-core/src/skin/normalize/index.ts`: float64 rows, `setActive` (avail, remainder to the nearest free deforming ancestor, unweighted points), `normalizeRow`, `fitFree`, `pruneToFour`, the f32 write with the residual in the largest free weight, `WeightBuffer` (private copies, the palette append rule), the stroke partner map (fixed partner map, else the closest point within 0.01 H) |
| `editWeights` kinds `set`, `stroke`, `flood`, `smooth` (expand/contract), `prune`, `normalize`, `compact`; `skinDirty` | `mesh-core/src/skin/edit/index.ts`; `hammer`, `paste`, `move`, `rigidIslands` throw `not-implemented` ("arrives after the MVP") |
| `beginStroke` (P-S2) | `mesh-core/src/skin/stroke/index.ts`: s_max for Replace/Add/Scale recomputed from the stroke start per touched point, Smooth per stamp; the batch `editWeights({kind: 'stroke' \| 'flood'})` runs the same session, so preview = commit by construction |
| `mirrorWeights` (P-S3) | `mesh-core/src/skin/mirror/index.ts`: partners → exact hash → closest point on the source half (barycentric), holds, seam symmetrize, bit-exact copies |
| `checkSkin` | `mesh-core/src/skin/check/index.ts`: unweighted, influences, weight-sum, unreachable, review, cross-side (with positions, M6B-C6-8), dangling, joint-without-weights, non-deforming-weighted |
| Operators (plain `writeData`, the CR-1 fallback) | `editor-core/src/operators/builtin/rig/weights.ts`: `skin.weights.{paint,flood,set,mirror,smooth,prune,normalize}`, `skin.palette.compact`; the shared target/holds/input helpers |
| U-state operators | `editor-core/src/operators/builtin/rig/influence.ts`: `skin.influence.{setActive,hold,holdAll,releaseAll,walk,pickDominant}`, `skin.paint.{mode,set,mirrorToggle,sample}`, `skin.testRotate.toggle` and its state |
| Weight display | `mesh-view/src/skin/display/index.ts` (`WeightDisplay`: greyscale / ramp / influence colours, danger for unweighted points, uniform-only switches) |
| Skin runtime of a viewport | `viewport/src/tools/rig/paint/index.ts` (eager: loads the runtime on the first Rig & Skin entry; `rigSkinOf(app)`), `runtime.ts` (mounts C1's skinned display, one `WeightDisplay` per shown surface, contributes the tool, hover ring, test-rotate ring, `weightLabels`), `pick.ts` (posed picking, radius px → m, Surface/Volume reach, front faces, falloffs, projection), `tool.ts` (the Paint Skin Weights tool) |
| Brush ring | `viewport/src/rig/brush/index.ts` (`BrushRing`: ring, Volume ring, partner ring, readout chip; DOM, never pickable) |
| Paint Weights panel | `editor/src/panels/paintWeights/{index.tsx,data.ts}` (§8.7 without Paint Select, Copy/Paste/Hammer/Move and the numbers overlay) |
| Toolkit Skin section | `editor/src/panels/rigToolkit/sections/skin/index.tsx`: Bind Skin one click + `⋯` option box (params → fields, `prefs.rigging.optionDefaults`), progress line, Unbind, Paint Skin Weights, Mirror ⋯, Smooth ⋯, Prune ⋯, Normalize, Attributes › Skin |
| Bind confirms | `editor/src/dialogs/SkinBindDialogs.tsx` (`rebindSkin`: Rebind / Only selected points / Cancel; `unbindSkin`) over C4's `answerRebind`/`answerUnbind` |
| Test API | `editor/src/test-api/m6b/skin-ui.ts` (`paint()`, `weightLabels(paneId)`, `componentEditor()` = null), `m6b/weights-kernel.ts` (`weights(mesh, points?)`) |
| Tests | `mesh-core/test/m6b-weights/*` (§5.10 cases, P-S1 fast-check over every MVP kind + mirror with random holds, P-S2, P-S3, P-S6, utilities, `checkSkin`, `skinDirty`), `mesh-view/test/skin-display.test.ts` (the 0-byte / no-recompile switch on real WebGL), `viewport/test/m6b-paint.test.ts` (brush maths), `editor-core/test/m6b/skin-ui.test.ts` (operators: one step, commit = kernel, holds on two meshes, no recompile, keys unchanged, U state) |
| e2e | `apps/web/e2e/m6b-skin-02-paint-fix-undo.spec.ts` (+ the 0-byte influence switch counted on `WebGL2RenderingContext` in the page), `m6b-skin-03-mirror-weights.spec.ts` (+ `test.fixme('c6-ce')`), `m6b-skin-10-test-pose-paint.spec.ts`, `m6b-rig-04-paint-keys.spec.ts`; helpers `helpers/m6b-skin-ui.ts` |
| Benches | `mesh-core/bench/m6b-weights.bench.ts` (kernel, 10k points), `apps/web/e2e/bench/m6b-paint.bench.ts` (browser pointer frames, 10k-point sphere character and the generated body) |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6B-C6-1 | **The cut to 4 never drops the edited joint**: §5.10's "drop the smallest not-held weight" skips the active joint `a`, and the rescale applies to the free joints other than `a` (their target is `avail − w_a'`), so a painted value stays what the brush set. | Dropping `a` would make a small value vanish on a full point; rescaling `a` would change the value typed. |
| M6B-C6-2 | **Sums in descending order; ties of the f32 residual by the smaller palette index.** Every sum runs over the values sorted descending, so a point and its partner (the same values on mirrored joints) get the same doubles: P-S3 holds exactly on the symmetric body for one-sided and centre-joint strokes. P-S1's "within 1e-9" is checked on the float64 rows; the stored f32 rows are checked within 1e-6 (§4.2's storage contract). | f32 storage cannot hold a sum within 1e-9. |
| M6B-C6-3 | **Normalize leaves rows within 1e-6 untouched**, so `normalize` is idempotent bit for bit (and a utility run that has nothing to repair records no undo step). An unweighted point asked for 0 stays unweighted. | P-S1 idempotence; no spurious ancestor weight. |
| M6B-C6-4 | **Mirror strokes per point**: direct op on `a` with `s_max(v)`, then the mirrored op on `M(a)` with the partner's `s_max`, then the seam symmetrize `½(w + M(w))` (free joints only). A centre joint (`M(a) = a`) applies the op once with the larger strength of the point and its partner (§5.11's "apply the op once"), which keeps both sides equal. Smooth runs per stamp as three passes (direct, mirrored, seam), each Jacobi (every point of a pass reads the values before the pass). | §5.11 order; determinism of the batch and the session. |
| M6B-C6-5 | **`editWeights({kind: 'stroke' \| 'flood'})` is the stroke session run over the stamps**, so `finish()` = batch bit for bit by construction (the tests still compare them for every op, with and without mirror, and the preview after each stamp against the batch over the prefix). | P-S2. |
| M6B-C6-6 | **Operator targets**: the hilited bound meshes of the active character, else all of them. Utilities (smooth, prune, normalize; mirror with `selection`) act on the Skin-mode point selection when there is one, else every point. Flood takes its `points` arg, else every point (Paint Select is after the MVP). Every operator resolves the held keys at invoke time and records them (`holds`); flood also records its resolved op, value, opacity, mirror and joint. | §5.13, §6.2, §0.3. |
| M6B-C6-7 | **Holds are remembered per `<projectName>/<character>`** in `prefs.rigging.holds`: the session has no project id. | §5.10 says per project and character. |
| M6B-C6-8 | **`checkSkin` takes an optional `geometry` (positions)** for `skin.cross-side`; without it the row is not produced. C7's Validation call passes none, so the row appears once INT passes the mesh's skin geometry there (`rig/validation/rows.ts`, one argument). SkinSkeleton has no roles: a non-deforming joint with a deforming ancestor reads as a prop (sockets included), one without (the root) as a helper. | §4.2's context has no positions; the contract stays as written. |
| M6B-C6-9 | **The weight display is a second draw of the `SkinnedSurface` geometry** (its posed positions and C1's per-corner `skinIndex`/`skinWeight`) with its own `ShaderMaterial`, added next to the surface's colour draw: C1's class is not edited. The vertex shader computes `gl_Position` exactly as mesh-view's surface does (same expression order), plus a small negative polygon offset, so it wins the depth test everywhere. The active influence is a bone index (`skinIndex` holds SkeletonDesc nodes) and the mode a uniform: 0 bytes and no program per switch (mesh-view test and E2E-SKIN-02). | §5.12 gate; C1 owns `SkinnedSurface`. |
| M6B-C6-10 | **The skinned display is mounted by C6's skin runtime** (C1 left it to C6/C7) whenever Rig & Skin is the workspace; the weight display shows in Skin mode only, its mode = the panes' `weights` flag. Entering Skin mode turns panes whose flag is `off` to greyscale (Maya's colour feedback on), sets the brush mirror to the skeleton's symmetry, and makes the first weighted influence active when none is (written after the mode switch: an operator never runs inside another's apply). `Alt+C` is the tool's key (`ToolDef.keys`): B9's `view.display.toggle` flips booleans only. | §5.12, §5.11, §7. |
| M6B-C6-11 | **Skin mode's bottom tab is Validation** while the Component Editor is deferred (`session/rig.ts` TAB_MEMORY; C7's file): showing the absent editor's tab put it over the viewport in the R-Side layout, which has no slot for it. | §0.3 deferral; found by E2E-SKIN-02. |
| M6B-C6-12 | **Test rotate (`E` in Skin mode)**: a ring (48 px, `test-rotate-ring`) on the active influence's joint; a press on the ring's band drags a test pose of the control that drives the joint (`toolHost.controlForJoint`) through the channel-edit gesture (C7's test-pose redirect: never a key), about the control channel whose axis is nearest the view direction; a press elsewhere paints. IK → FK for the test (§5.17) is C3's/C7's path and not done here. | §5.11; C3's joint manipulator is not merged. |
| M6B-C6-13 | **`weightLabels(paneId)`** returns every visible posed point (its triangle faces the camera and the pane ray hits it first), text with 2 decimals including `0.00`, regardless of the numbers overlay (after the MVP): it is the posed `screenOfVertex` the paint scenarios need. | §0.3 defers the overlay; §10's posed strokes need the positions. |
| M6B-C6-14 | **Brush details**: radius in CSS px converted at the hit depth; stamps every 0.25 r of pointer travel on the mesh the stroke started on; Surface reach = Dijkstra over the point graph with posed edge lengths from the hit triangle's corners; picking is brute force over the posed triangles (0.7 ms mean per pointer frame at 10k points, so no BVH yet). `B`/`M`/`N` + drag: 1 px per px radius, 1/200 per px opacity and value. The brush paints in Skin mode only. | §5.11, §5.25. |
| M6B-C6-15 | **E2E-RIG-04 without the `U` flick**: the `rig.paint.ops` marking menu is deferred (§0.3), so the row's first step is not in this cut; its Flood runs with the mirror off (a mirrored flood of a left joint also puts the right joint's half on every point). The fresh joint is the first of spine/neck/leftShoulder without weight on the Cube Lad. | §0.3, §0.7 RIG-04 cut. |
| M6B-C6-16 | **E2E scenarios use the bound Cube Lad** (`helpers/m6b-skin-ui.ts`: built in Model, Create Skeleton with its truth markers, Bind Skin; the adopted mesh id comes from Bind Skin's result); strokes use constant falloff and a 150 px radius from the panel so a whole box is reached; the Getting started card is closed first (it sits over the perspective pane). | §0.7 "on the bound Cube Lad". |

## Deferred or not done (MVP)

Component Editor (panel stub kept, `componentEditor()` null, `test.fixme('c6-ce')`), numbers overlay, Lock-Relative,
Paint Select mode, the `rig.tools.skin` / `skin.joint` / `paint.ops` marking menus, `↑↓←→` beyond what the keymap rows
bind (the walk operator is there), joint-glyph clicks (C3's overlay), Outliner mesh rows (CR-5), influence colour
overrides by joint name (`prefs.rigging.influenceColours` is not read), Skin-mode help-line texts (the help line's
hint table is in B9's eager file; C6 has no eager allowance left, see below), `hammer`/`paste`/`move`/`rigidIslands`
kernels and their operators, review-layer clearing on paint.

## Edits outside C6's Dirs — INT approval requested (§9.0, §9.1)

| File | Change | Why | Status |
|---|---|---|---|
| `viewport/src/manager/contributions.ts` | one line: `attachRigSkin(app, vm)` | the skin runtime needs the viewport manager (cameras, pane rects, mesh layers) | pending |
| `viewport/src/index.ts`, `mesh-view/src/index.ts`, `editor-core/src/index.ts` (barrels) | export lines for C6's modules (`rigSkinOf`, `WeightDisplay`, the weight helpers, C4's `answerRebind`/`answerUnbind`/`rebindRequest`/`unbindRequest`/`BIND_PARAMS`) | the panels, dialogs and test API read them | pending |
| `viewport/src/rig/index.ts` (C0 stub barrel) | the `BrushRing` stub line re-exports `./brush` | stub line of C6's class | stub line |
| `editor/src/dialogs/DialogHost.tsx` | the `unbindSkin` / `rebindSkin` loader lines | C0's placeholder comment: owners replace their line | owner line |
| `editor/src/dialogs/SkinBindDialogs.tsx` (new) | the two confirms | §9.0 C6 "the `rebindSkin` confirm" | pending (path) |
| `editor-core/src/session/rig.ts` (C7) | Skin mode's bottom tab = Validation | M6B-C6-11 | pending |
| `editor/test/m6b-rig-shell.test.tsx` (C7) | the literal of that tab | §3 rule 9 literal update | pending |
| `editor-core/test/m6b/foundation.test.ts`, `m6b/keys-hash.test.ts` | C6 poll reasons; `skin.paint.mode` and `skin.paint.set` rows `checked`; the merged keys-hash runner expects `rig.animateOnly` to stay `cancelled` (C1 added the `finished` check, C7's row always poll-fails) | §3 rule 9; merge of C1 + C7 | pending |
| `editor-core/test/m6b/skin-ui.test.ts`, `mesh-view/test/skin-display.test.ts`, `viewport/test/m6b-paint.test.ts` (new) | C6's unit and browser tests | tests next to the code they test | pending (paths) |
| the four `test/m6b-ready.ts` | `c6: true` | READY flag | flag |

**Eager bytes**: C6's eager addition is **+162 B gzip** (the `attachRigSkin` subscription and its line), measured as the
`/editor` route of this branch (+5,060 B over the M6b baseline) minus the merge base `7b930df` with C1, C4 and C7
(+4,898 B). C6's allowance is 0 B (§0.4.9); **INT approval requested** for 162 B of the unused headroom (the gate:
+5,060 ≤ +6,144 B, route 894,629 ≤ 900,000 B).

## Gate results

Run in this worktree on the last code commit (local Chrome GPU, port 3168), one sequence:

| Gate | Result |
|---|---|
| `pnpm run format:check`, `lint`, `typecheck`, `check:deps`, `check:fixtures`, `check:licenses` | green |
| `pnpm run test` (turbo, 15 tasks) | green (15/15). An earlier run hit M6a's unseeded property test `mesh-core/test/normals/cases.test.ts › incremental › updating a cache for a non-topology DirtySet equals a full computation` once (seed 1199846347, a 3e-8 position edit; flaky, untouched by C6) |
| `pnpm run build` + `check:size` | green: 894,629 B ≤ 900,000 B; M6b eager +5,060 B ≤ +6,144 B |
| C6 e2e (SKIN-02, -03, -10, RIG-04) | `test.fixme` on `c2` in this branch (part (b) of SKIN-10 also on `c3`); **all five pass, twice in a row** (incl. SKIN-10 (b)'s Skin-mode `E`; `c6-ce` stays fixme) against a scratch merge of `m6b/skeleton-kernel` with the fixmes lifted (`tmp/c6-verify`, local only, removed after) |
| full e2e (`EKZA_E2E_PORT=3168 pnpm run test:e2e`) | green: 226 passed, 35 skipped (the gated `test.fixme` scenarios, C6's four among them), 0 failed |

**Benches** (report-only):

- kernel (`pnpm --filter @ekza-studio/mesh-core bench`, worm 10k points × 60 joints): a whole 20-stamp stroke
  (≈ 300 points per stamp) Replace 1.13 ms (≈ 0.06 ms per stamp), with X-mirror 2.35 ms; Smooth 7.7 ms (0.39 ms per
  stamp), with mirror 15 ms; commit (finish + `skinDirty`) 0.80 ms; on every point: smooth 20 ms, normalize 1.9 ms,
  compact 2.3 ms, mirror 1.7 ms.
- browser (`e2e/bench/m6b-paint.bench.ts` with C2 merged, real Chrome): 10,002-point sphere character, 40 pointer
  frames: mean 0.72 ms, p95 1.2 ms, max 1.4 ms per frame (budget ≤ 4 ms) — pick, stamp, kernel and the queued partial
  upload; commit dispatch 0.7 ms, undo round trip 24 ms; the generated body (249 points): mean 0.10 ms.
- the weight-display switch: 0 bytes, no new program (mesh-view browser test; E2E-SKIN-02 counts `bufferData` /
  `bufferSubData` in the page across two influence clicks and a redraw).
