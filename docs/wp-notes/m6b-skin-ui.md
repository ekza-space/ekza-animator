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
| Weight display | `mesh-view/src/skin/display/index.ts` (`WeightDisplay`: greyscale / ramp / influence colours, danger for unweighted points, a `--lint-error` dot on problem points `\|Σ − 1\| > 1e-6` — the faces within a fifth of the way from the point; > 4 influences cannot reach the GPU's four slots and are `checkSkin`'s — uniform-only switches) |
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
| M6B-C6-2 | **Sums in descending order; ties of the f32 residual by a mirror-invariant canon.** Every sum runs over the values sorted descending, so a point and its partner (the same values on mirrored joints) get the same doubles. The f32 residual `1 − Σ` goes to the largest free entry; a tie is broken by `min(key, mirror key)` (not the palette index, which is not mirror-symmetric), and a tied mirror pair — `leftLowerArm` = `rightLowerArm` on a seam point after symmetrize — shares it half and half; `pruneToFour` breaks ties the same way and drops a tied pair together on symmetrize (fix round 1). P-S3 then holds exactly on seam points too. P-S1's "within 1e-9" is checked on the float64 rows; the stored f32 rows are checked within 1e-6 (§4.2's storage contract). | f32 storage cannot hold a sum within 1e-9. |
| M6B-C6-3 | **Normalize leaves rows within 1e-6 untouched**, so `normalize` is idempotent bit for bit (and a utility run that has nothing to repair records no undo step). An unweighted point asked for 0 stays unweighted. | P-S1 idempotence; no spurious ancestor weight. |
| M6B-C6-4 | **Mirror strokes per point**: direct op on `a` with `s_max(v)`, then the mirrored op on `M(a)` with the partner's `s_max`, then the seam symmetrize `½(w + M(w))` (free joints only). A centre joint (`M(a) = a`) applies the op once with the larger strength of the point and its partner (§5.11's "apply the op once"), which keeps both sides equal. When both `v` and `p(v)` are stamped, see M6B-C6-18; Smooth, see M6B-C6-18. | §5.11 order; determinism of the batch and the session. |
| M6B-C6-5 | **`editWeights({kind: 'stroke' \| 'flood'})` is the stroke session run over the stamps**, so `finish()` = batch bit for bit by construction (the tests still compare them for every op, with and without mirror, and the preview after each stamp against the batch over the prefix). | P-S2. |
| M6B-C6-6 | **Operator targets**: the hilited bound meshes of the active character, else all of them. Utilities (smooth, prune, normalize; mirror with `selection`) act on the Skin-mode point selection when there is one, else every point. Flood takes its `points` arg, else every point (Paint Select is after the MVP). Every operator resolves the held keys at invoke time and records them (`holds`); flood also records its resolved op, value, opacity, mirror and joint. | §5.13, §6.2, §0.3. |
| M6B-C6-7 | **Holds are remembered per `<projectName>/<character>`** in `prefs.rigging.holds`: the session has no project id. | §5.10 says per project and character. |
| M6B-C6-8 | **`checkSkin` takes an optional `geometry` (positions)** for `skin.cross-side`; without it the row is not produced. C7's Validation call passes none, so the row appears once INT passes the mesh's skin geometry there (`rig/validation/rows.ts`, one argument). SkinSkeleton has no roles: a non-deforming joint with a deforming ancestor reads as a prop (sockets included), one without (the root) as a helper. | §4.2's context has no positions; the contract stays as written. |
| M6B-C6-9 | **The weight display is a second draw of the `SkinnedSurface` geometry** (its posed positions and C1's per-corner `skinIndex`/`skinWeight`) with its own `ShaderMaterial`, added next to the surface's colour draw: C1's class is not edited. The vertex shader computes `gl_Position` exactly as mesh-view's surface does (same expression order), plus a small negative polygon offset, so it wins the depth test everywhere. The active influence is a bone index (`skinIndex` holds SkeletonDesc nodes) and the mode a uniform: 0 bytes and no program per switch (mesh-view test and E2E-SKIN-02). | §5.12 gate; C1 owns `SkinnedSurface`. |
| M6B-C6-10 | **The skinned display is mounted by C6's skin runtime** (C1 left it to C6/C7) whenever Rig & Skin is the workspace; the weight display shows in Skin mode only, its mode = the panes' `weights` flag. Entering Skin mode turns panes whose flag is `off` to greyscale (colour feedback on, a desktop-DCC convention), sets the brush mirror to the skeleton's symmetry, and makes the first weighted influence active when none is (written after the mode switch: an operator never runs inside another's apply). `Alt+C` is the tool's key (`ToolDef.keys`): B9's `view.display.toggle` flips booleans only. | §5.12, §5.11, §7. |
| M6B-C6-11 | **Skin mode's bottom tab is Validation** while the Component Editor is deferred (`session/rig.ts` TAB_MEMORY; C7's file): showing the absent editor's tab put it over the viewport in the R-Side layout, which has no slot for it. | §0.3 deferral; found by E2E-SKIN-02. |
| M6B-C6-12 | **Test rotate (`E` in Skin mode)**: a ring (48 px, `test-rotate-ring`) on the active influence's joint; a press on the ring's band drags a test pose of the control that drives the joint (`toolHost.controlForJoint`) through the channel-edit gesture (C7's test-pose redirect: never a key), about the control channel whose axis is nearest the view direction; a press elsewhere paints. IK → FK for the test: see M6B-C6-19. | §5.11; C3's joint manipulator is not merged. |
| M6B-C6-13 | **`weightLabels(paneId)`** returns every visible posed point (its triangle faces the camera and the pane ray hits it first), text with 2 decimals including `0.00`, regardless of the numbers overlay (after the MVP): it is the posed `screenOfVertex` the paint scenarios need. | §0.3 defers the overlay; §10's posed strokes need the positions. |
| M6B-C6-14 | **Brush details**: radius in CSS px converted at the hit depth; stamps every 0.25 r of pointer travel on the mesh the stroke started on; Surface reach = Dijkstra over the point graph with posed edge lengths from the hit triangle's corners; picking is brute force over the posed triangles (0.7 ms mean per pointer frame at 10k points, so no BVH yet). `B`/`M`/`N` + drag: 1 px per px radius, 1/200 per px opacity and value. The brush paints in Skin mode only. | §5.11, §5.25. |
| M6B-C6-15 | **E2E-RIG-04 without the `U` flick**: the `rig.paint.ops` marking menu is deferred (§0.3), so the row's first step is not in this cut. Its Flood is the panel's default path with the brush's X-mirror as Skin mode left it (on), and asserts that a one-sided fresh joint's mirror joint takes nothing (M6B-C6-17). The fresh joint is the first of leftShoulder/spine/neck without weight on the Cube Lad. | §0.3, §0.7 RIG-04 cut. |
| M6B-C6-16 | **E2E scenarios use the bound Cube Lad** (`helpers/m6b-skin-ui.ts`: built in Model, Create Skeleton with its truth markers, Bind Skin; the adopted mesh id comes from Bind Skin's result); strokes use constant falloff and a 150 px radius from the panel so a whole box is reached; the Getting started card is closed first (it sits over the perspective pane). | §0.7 "on the bound Cube Lad". |
| M6B-C6-17 | **Flood is one-sided by default** (fix round 1): `skin.weights.flood`'s `mirror` defaults to `false` instead of inheriting the brush's X-mirror stroke (as Flood does in a leading commercial desktop DCC; §5.11's Flood row says nothing about mirroring), so the panel's Flood button no longer hands a left joint's points to the right one (before: Replace 1 on leftUpperArm moved 228 of 249 body points to rightUpperArm). With `mirror: true`, Flood paints its mask directly and the mirrored op reaches **only partners outside the mask** (no seam symmetrize): over every point it equals the one-sided Flood; over the left half it reaches the right partners exactly. | A mask flood with both ops on every point is meaningless for a one-sided joint. |
| M6B-C6-18 | **Spec conflict for INT — §5.11's per-point order vs P-S3** (fix round 1). Read literally, "direct op, then mirrored op" at both `v` and `p(v)` makes a stroke that stamps both sides of a one-sided joint asymmetric (`op_M(a)(op_a(w))` at `v`, `op_M(a)(op_a(w'))` at `p(v)`; a chest stamp of leftShoulder Replace 0.6 left 2 of 4 changed points asymmetric). The kernel reads the order **per pair**: when both `v` and `p(v)` are stamped, the op that comes from the smaller point index of the pair runs first on both points (so at the larger index the mirrored op runs first); a one-sided stamp is unchanged (the order is moot). Mirrored **Smooth** (joint-agnostic, so `M(a)` has no meaning) is one Jacobi pass per stamp over the stamp's points and their partners at the larger strength of the pair — the centre-joint rule — then the stamped seam points symmetrize. Fast-check: `w(v) = M(w(p(v)))` exactly after random multi-stamp strokes over both sides, every op, symmetric holds (smooth only where the body's 1-rings are mirror images: 20 of its 249 points have mirror-asymmetric quad diagonals). INT: amend §5.11's order sentence to "per pair". | P-S3 is the gate; §5.11's order exists so implementations agree, which a per-pair rule keeps. |
| M6B-C6-19 | **Skin-mode `E` on an IK limb** (fix round 1): the paint tool's test rotate holds `@ikFk 0` on the limb's IK control in the same channel-edit gesture when the joint's driving control is one of the limb's FK controls and the limb's evaluated `ikFk > 0` — the rule C3's `E` on a joint uses (§5.17), via `limbOfControlIn`. The `FK FOR TEST` HUD badge is C3's shell part. E2E-SKIN-10 (b) is split: the Skeleton-mode knee test (gates c2, c3: `1`, `E` on the left knee, shin moved > 0.02 H, `@ikFk` 0 on leg.L in the test pose, the badge, keys and the document's ikFk unchanged) and the Skin-mode `E` (gate c2: the knee of the IK leg, then the elbow; tool stays `paintSkinWeights`). **INT/C3 hand-off**: when C3 merges, the Skin-mode test rotate may route through C3's `beginTestPose` (rotation about the view axis) instead of the nearest-channel drag; the badge assertion of the Skin-mode test can then be added. | §0.7 gives C6 the knee / Skin-mode `E` items of part (b). |
| M6B-C6-20 | **Mirror Skin Weights writes an exact copy whenever the held joints already equal the image** (fix round 1): with symmetric holds the target's held values equal the mirrored source's, so the copy keeps them bit-equal and avoids a float64 rescale of the free entries that broke exactness. A target that already holds the image is skipped, holds or not. Seam residuals: M6B-C6-2. | P-S3 with holds. |
| M6B-C6-21 | **Rig Toolkit Skin buttons expose their last run** (`data-runs`, `data-status` on the button): a utility with nothing to change records no step (M6B-C6-3), so E2E-SKIN-03's second Mirror run asserts `finished` and exactly zero new steps. | §10.1 "one step per run" asserted exactly. |

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

**Eager bytes**: C6's eager addition is **+168 B gzip** (the `attachRigSkin` subscription and its line, 162 B; fix round
1 adds 6 B: Flood's `mirror` default in the eager operator table), measured as the `/editor` route of this branch
(+5,066 B over the M6b baseline) minus the merge base `7b930df` with C1, C4 and C7 (+4,898 B). C6's allowance is 0 B
(§0.4.9); **INT approval requested** for 168 B of the unused headroom (the gate: +5,066 ≤ +6,144 B, route 894,635 ≤
900,000 B). No zero-byte route exists in this cut: nothing else loads the viewport's lazy rig chunk on a Rig & Skin
entry (C7's eager shell hook has no viewport manager), so moving the subscription needs an INT decision on which eager
hook owns it.

## Gate results

Fix round 1, run in this worktree on the last code commit (local Chrome GPU, port 3168):

| Gate | Result |
|---|---|
| `pnpm run format:check`, `lint`, `typecheck`, `check:deps`, `check:fixtures`, `check:licenses` | green |
| `pnpm run test` (turbo, 15 tasks, `--concurrency=1`) | green (15/15) |
| `pnpm run build` + `pnpm --filter web check:size` | green: 894,635 B ≤ 900,000 B; M6b eager +5,066 B ≤ +6,144 B |
| C6 e2e (SKIN-02, -03, -10, RIG-04) | `test.fixme` on `c2` in this branch (the Skeleton-mode part of SKIN-10 (b) also on `c3`). Against a scratch merge of `m6b/skeleton-kernel` (`e7527cb`) with the `c2` fixmes lifted (local only, removed after): **5 passed, `--repeat-each=2`: 10 passed** (the `c3` knee test and `c6-ce` skipped). Without the Skin-mode IK → FK fix (M6B-C6-19 reverted) the new Skin-mode knee test fails (the shin does not move), so it guards the fix |
| full e2e (`EKZA_E2E_PORT=3168 pnpm run test:e2e`) | green: 226 passed, 36 skipped (the gated scenarios, C6's among them), 0 failed. A first run had one failure in M6a's `m6a-26-selection-undo-loop-table.spec.ts` ("a control selection records no Select step", untouched by C6); it passed 3/3 alone and the full rerun was green |

**Benches** (report-only):

- kernel (`vitest bench bench/m6b-weights.bench.ts`, worm 10k points × 60 joints): a whole 20-stamp stroke (≈ 300
  points per stamp) Replace 1.16 ms (≈ 0.06 ms per stamp), with X-mirror 2.33 ms; Smooth 7.4 ms (0.37 ms per stamp),
  with mirror 15 ms; commit (finish + `skinDirty`) 0.79 ms; on every point: smooth 20 ms, normalize 1.9 ms, compact
  2.2 ms, mirror 1.4 ms.
- browser (`bench:budgets -g m6b-paint` on the scratch merge with C2, real Chrome): 10,002-point sphere character, 40
  pointer frames: mean 0.62 ms, p95 1.1 ms, max 1.3 ms per frame (budget ≤ 4 ms) — pick, stamp, kernel and the queued
  partial upload; commit dispatch 0.6 ms, undo round trip 21 ms; the generated body (249 points): mean 0.09 ms.
- the weight-display switch: 0 bytes, no new program (mesh-view browser test; E2E-SKIN-02 counts `bufferData` /
  `bufferSubData` in the page across two influence clicks and a redraw).
