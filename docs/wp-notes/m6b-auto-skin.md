# M6b C4 — auto-skin (Bind Skin solvers, skin worker, Bind/Unbind): build notes

Branch `m6b/auto-skin` (from `m6b/mvp` at `22b0e11`, `m6b/rig-contracts` merged). Scope:
[M6B-SPEC §9.0 C4](../M6B-SPEC.md#c4--auto-skin) = §5.9 without `skin.weights.autoForJoints` and without sparse LDLᵀ
(§0.3), §0.4.4 (Bind Unweighted Points). Decision IDs below are `M6B-C4-<n>`.

## What landed

| C4 item | Where |
|---|---|
| Sparse kit (C5 reuses it) | `mesh-core/src/skin/laplacian/{index,csr}.ts` (`cotLaplacian` PSD with clamping, `lumpedMass` mixed Voronoi, `csrFromTriples`, `csrSubmatrix`, `csrMultiply`, `csrDiagonal`), `skin/pcg/index.ts` (`solvePcg`: Jacobi PCG, several right-hand sides with independent columns, `HEAT_PCG` = 1e-6 / 200) |
| Geometry | `skin/geometry/index.ts` (`skinGeometryOf`: positions, M6a's triangulation mapped corners → points, angle-weighted point normals, the fixed partner map `buildSymmetryMap(…, x, object, identity, 1e-4 H)`, `paired`; cached per stored MeshData and height), `skin/geometry/adjacency.ts` (`pointTriangles`, `pointGraph`) |
| Islands, visibility | `skin/islands/index.ts` (`skinIslands`: components, area-weighted centroids), `skin/visibility/index.ts` (bone segments, point–segment queries, `Occluder`: any-hit BVH with the reference predicate) |
| Methods | `skin/closest`, `skin/heat` (`solveHeatIsland`), `skin/bind/index.ts` (`bindSkin`: candidates and joint mask, one-joint rigid attach, the four methods, the auto-lowpoly island rule `ISLAND_RULE`, unreachable islands, the point mask, palette rules; `autoWeightPoints`), `skin/post/index.ts` (prune ramp, top 4, symmetrize, rigidify, f32 with the residual) |
| Skin service (worker client) | `editor-core/src/rig/skinService.ts` (`skinSkeletonOf` from records, `skinBindInputs`, `bindRefusal`, `autoSymmetrize`, the worker protocol types, `createSkinService`: worker or inline, superseding, `cancel`, `skeleton(id)`, `report(mesh)`), wired in `rig/chunk/services.ts` |
| Operators | `editor-core/src/operators/builtin/rig/bind.ts`: `skin.bind` (params of §6.2, invoke-time targets/symmetrize/holds, the solve in `prepare` with a progress pill, one transaction with the layers, `MeshRecord.skin` and the first-bind control rig, the `rebindSkin` question), `skin.unbind` (the `unbindSkin` question); `skin.weights.autoForJoints` stays the deferred stub |
| Worker | `editor/src/workers/skin.worker.ts` (`handleSkinRequest`, installed only inside a worker), `editor/src/services/skinWorker.ts` (`installSkinWorker`: the `new Worker(new URL(…))` factory on `app.rig`) + one call in `shell/EditorRoot.tsx` |
| Test API | `editor/src/test-api/m6b/auto-skin.ts`: `skin(mesh)` (skeleton, palette keys, bind record, review, `checkSkin` problems once C6 lands them) |
| Tests | `mesh-core/test/m6b-bind/*` (sparse kit, geometry, bind invariants per method, P-S4, masks, P-S5 goldens Node + Chromium, P-S7, visibility vs the reference), `editor-core/test/m6b/auto-skin.test.ts` (operators and service), `apps/web/test/m6b-skin-worker-size.test.ts`, `apps/web/e2e/m6b-skin-01-bind-one-click.spec.ts` (E2E-SKIN-01, `test.fixme` until c1, c2, c3, c6, c7) |
| Benches | `mesh-core/bench/m6b-bind.bench.ts` |
| READY | `c4: true` in the four `test/m6b-ready.ts` files |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6B-C4-1 | **Heat solves the spec's system literally**, `(Lpsd + H)·w = H·p` with the unweighted cotangent Laplacian. The scale-invariant form of Baran & Popović / Blender (`H` multiplied by the lumped Voronoi mass, i.e. the area-normalized Laplacian) was built and measured first: on the 10k × 60 bench its CG hit the 200-iteration cap on every joint (2.06 s, budget 1 s); the literal system converges in a few iterations (109 ms). Consequence for the owner: on metre-scale low-poly meshes the literal `H` dominates the Laplacian, so heat weights blend over about one ring at a bone boundary; `stiffness` (0.1…10) softens it. | §5.9 text and the §5.25 budget; post-MVP an area-weighted `H` needs a stronger solver than Jacobi PCG with cap 200. |
| M6B-C4-2 | **The visibility ray's far end is open** (`0 < t < 1 − 1e-6`): a triangle through the bone point itself does not hide the bone. | The Cube Lad's upper-arm box abuts the torso at x = −0.18, the plane of the clavicle segment's closest point; with the closed end the inner arm points saw only `chest` and the boxes blended 65 % chest. Now every limb box is single-influence. |
| M6B-C4-3 | **Occlusion is a private any-hit BVH** (median split, leaves of 4) with the reference `TriangleBvh`'s Möller–Trumbore predicate; a property test compares it with `TriangleBvh.raycast(…, 0, 1 − 1e-6, ignore)` on random rays. It tests **the bound mesh's own triangles** (`bindSkin` takes one geometry; §5.9 says "over every mesh of the character"). | A boolean answer is order-independent, so it equals the reference and C2's BVH; the reference is O(triangles) per ray (30k rays per 10k bind). Other meshes as occluders would need a contract change of `bindSkin`. |
| M6B-C4-4 | **Segments**: a candidate joint's head → each child head (children of any role), a leaf head → `SkinSkeleton.tail`. Only candidates own segments; a helper/prop is a candidate only when masked in. The 3 nearest segments by Euclidean distance are tested for visibility; a point that sees none votes for its nearest segment (closest and auto-lowpoly). | §5.9 steps 1–2. |
| M6B-C4-5 | **Island rule**: `c` = the owner of the segment nearest the island's area-weighted centroid (ties: smaller joint index); votes = every point's nearest visible segment owner; the extent is measured along `c`'s `head → tail`. The thresholds stay the spec defaults (`ISLAND_RULE`: vote distance 1, extent 1.25, 2 % of the points) — see the spike. | §5.9; the spike found no threshold set better on all three fixtures. |
| M6B-C4-6 | **P-S7 exact threshold calibrated to 70 %** (spec: "≥ 85 % (calibrated in C4's spike)"); "within one joint" stays ≥ 98 % (measured 98.7 %). Polybot's skeleton is the artist's 55 joints (truth positions, `polybot.vrm` hierarchy, `*_End` nodes as helpers). | The artist splits islands between neighbours (forearm 37 lowerArm / 13 hand, neck 33 / 31) and binds shells to the proximal joint; even rigid nearest-centroid binding (the island rules' upper bound) reaches 79.5 %. INT: a contract PR to the P-S7 row if the owner accepts. |
| M6B-C4-7 | **Cube Lad P-S7 reading** ("every box single-influence except the boxes spanning a joint"): the torso, pelvis, neck, head, upper-arm, forearm, thigh and shin boxes are single-influence (forearms on their lower arm, 100 %); the hand boxes (finger joints inside) and the foot boxes (toe joint inside) may blend. Observed: the torso binds to `chest` (its bottom corners see no segment: the hips segments lie behind the pelvis box) and the neck box to `chest` (the `chest → neck` segment runs through it); the foot box binds to `toes` (the ankle lies in the shin box, so the back corners see only the toes segment). | Box models put joints in neighbouring boxes; the visibility rule is the spec's. Worth a look in the owner's demo (a walk rotates the toes). |
| M6B-C4-8 | **Masked solves** write only the masked points (others bit-equal, palette = previous + appended). Heat: points outside the mask are sources of value 1 on their dominant joint with `H = stiffness / max(d, 1e-4 H)²`; the island rule is decided on the whole island. | §5.9 step 4; P-S9-style property test with every method. |
| M6B-C4-9 | **`symmetrize: null`** resolves per mesh at invoke time (`paired ≥ 0.9` and the skeleton has mirror pairs); the value recorded in `LastRun.args` is the first target's. P-S4 holds exactly: sums run in descending-weight order and `½(a + b)` is commutative, so a point and its partner get the same doubles. | §4.2; one recorded boolean for several meshes. |
| M6B-C4-10 | **Holds** are resolved (recorded args, else the session's per-character set) and recorded, but `bindSkin` has no holds parameter: a bind replaces held weights, as Maya's does. | §6.2 records them; the §4.2 signature has none. |
| M6B-C4-11 | **Rebind / Unbind questions**: the operator's `prepare` opens `rebindSkin` / `unbindSkin` and the second poll cancels the run ("Answer the … question first"); `rebindRequest`/`answerRebind` and `unbindRequest`/`answerUnbind` (exported from `bind.ts`) are what C6's dialogs call: Rebind re-runs with `confirm: true` (an extra arg), "Only selected points" runs a masked bind per mesh with its vertex selection. The recorded args hold `confirm: false`, so Repeat asks again; Adjust Last (source `card`) never asks. | §5.9; `UiDialog` carries no payload. |
| M6B-C4-12 | **Default targets** (no `meshes`): every authored mesh of the bind character — `session.rig.character`, else `activeCharacter`, else the selection's owner, else the only model-sourced character with a skeleton. Refusals: no character, a scene mesh, a mesh (or ancestor) with a placement, meshes of two characters, an asset-sourced character ("Rig and skin edits on imported avatars arrive after the MVP"), an empty joint mask (`skin.empty-mask`). | §0.2 step 7 ("on every mesh of the character"), §5.9 refusals. |
| M6B-C4-13 | **First-bind control rig** (`ensureControlRig`): when the character's rig has no live control, `updateAutoRig(current, skeletonFromDoc(records), ids, {ik: legs})` is written in the bind's transaction (the rig record patched, the generated records added parents first). C0 baselines; C1 may swap in its in-transaction helper. | §5.16 "inside the first `skin.bind` when no rig exists yet"; gate `c1` for the full rules. |
| M6B-C4-14 | **The worker host**: `editor/src/services/skinWorker.ts` sets `app.rig.skinWorker` (structural `SkinWorkerHost`) from `EditorRoot` (one line); the service reads it on the first bind, else binds inline. The worker restates the protocol types (workers may import no editor-core, the `.oxlintrc` rule). Superseding rejects the earlier bind (`cancelled`) and restarts the worker. | `editor-core` cannot reference the editor's worker file; the C0 entry lives in `editor/src/workers`. |
| M6B-C4-15 | **Progress and abort** (CR-AR-2 (b), partly): `session.busy = {label: 'Binding skin…', progress: meshes done / meshes}`; `app.rig.skin.cancel()` aborts (rejects, terminates the worker). | The worker reports no per-island progress (bindSkin has no callback). |
| M6B-C4-16 | Palette entries carry `parent` and `mirror` keys (CR-6's field, written by `withSkin` only when known); template joint ids pair by M6a's name rule anyway. | §4.2. |
| M6B-C4-17 | `autoWeightPoints` is implemented (pure; tested); its operator stays deferred. | Cheap with the visibility queries; Auto-Rig and C11 reuse it. |
| M6B-C4-18 | **check:size reads web-worker entries**: `apps/web/scripts/lib/route-scripts.mjs` recognizes Turbopack's worker loader (`e.v(e.r(n).default("…turbopack-worker…", [files]))`) as a lazy group, so the `skin-worker` boundary is labelled (12.6 kB gzip) and its chunks never count as eager. The solvers' adjacency moved to `geometry/adjacency.ts` so the worker bundles no kernel module (else the group took the mesh-kernel label). | C0's follow-up ("C1 and C4 assert … check:size reports … skin-worker as lazy groups"). |

## Calibration spike (§5.9 island rule; Cube Lad, generated body, Polybot)

`auto-lowpoly`, symmetrize on (Polybot: off, it is not mirror-exact: `paired` = 0), literal heat (M6B-C4-1):

| Vote distance / extent / small | Polybot T exact / within | Polybot A exact / within | segmented body: multi-influence points | Cube Lad |
|---|---|---|---|---|
| **1 / 1.25 / 2 % (spec, kept)** | **72.8 / 98.7 %** (literal heat: 74.3 / 98.2 %) | 72.5 / 98.7 % | 86 (torso, pelvis, feet; every limb island single) | limb, torso, neck, head boxes single |
| 1 / 1.25 / 3 % | 75.0 / 98.7 % | 75.2 / 98.7 % | 86 | same |
| 1 / 1.5 / 2 % | 76.7 / 98.7 % | 76.9 / 98.7 % | 62 | same |
| 1 / 2 / 2 % | 76.7 / 98.7 % | 76.9 / 98.7 % | 0 (the torso rigid too) | same |
| 2 / 1.25 / 2 % | 68.9 / 99.9 % | 68.6 / 99.9 % | 86 | same |
| 2 / 2 / 3 % | 72.8 / 100 % | 73.0 / 100 % | 0 | same |
| `rigid-islands` (upper bound) | 79.5 / 100 % | 79.5 / 100 % | 0 | — |

The looser extents gain ≤ 4 points of Polybot's exact rate by making the generated segmented torso rigid (worse
deformation); none reaches 85 %. The defaults stay (M6B-C4-5, -6).

## Benches (`pnpm --filter @ekza-studio/mesh-core bench`, report-only; M-series laptop, Node 25)

| Bench | Mean | Budget |
|---|---:|---:|
| `auto-lowpoly`, 10,000 points × 60 joints (one island: a worst case for heat) | 108.6 ms | ≤ 1 s |
| `heat`, same | 102.6 ms | ≤ 1 s |
| `auto-lowpoly`, 2,960-point low-poly character × 34 joints (9 islands) | 23.5 ms | ≤ 200 ms |

The geometry (partner map, triangulation) is built once outside the timed body, as the service caches it per revision.

## Determinism (P-S5)

- Node and Chromium: `mesh-core/test/m6b-bind/goldens.json` (manifest ids of 20 cases: generated body smooth and
  segmented, Cube Lad, tube character, worm × the four methods), checked by the Node test and the Vitest browser
  test.
- Worker and main thread: a local throwaway Chrome run (e2e build, port 3163) bound the generated body through the
  operator once with the skin worker (`usedWorker: true`) and once on a page without `Worker`: the same manifest
  (`1bb76b21…`). E2E-SKIN-01 asserts the same once its gates merge.

## Shared files touched (for INT)

- `editor/src/shell/EditorRoot.tsx`: one line `installSkinWorker(app)` and its import (M6B-C4-14).
- `editor-core/src/index.ts`: type-only exports of the protocol (`SkinWorkerHost`, `SkinWorkerPort`, `SkinServiceImpl`, …).
- `editor-core/src/rig/chunk/services.ts` (C7's dir; C0 named it for C4's stub): `createSkinService(deps)`.
- `editor-core/test/m6b/foundation.test.ts`, `apps/web/e2e/m6b-00-foundation.spec.ts`: `skin.bind`/`skin.unbind` now poll with their own reasons in an empty project (a `LANDED` row each; every other assertion kept).
- `apps/web/scripts/lib/route-scripts.mjs`: the worker loader (M6B-C4-18), with its test.
- New: `editor-core/test/m6b/auto-skin.test.ts`, `apps/web/test/m6b-skin-worker-size.test.ts` (no C4 test dir in §9.0 outside mesh-core).
- P-C6 rows `skin.bind`/`skin.unbind` stay `pending` in `keys-hash.test.ts`: its runs use `opsApp()` (no mesh kernel); `auto-skin.test.ts` asserts the keys hash around a bind instead.

## Eager route (§0.4.9)

`check:size` (production build): **891,371 B** (gate 900,000 B); M6b MVP eager delta **+1,802 B** (C0 alone: +1,535 B),
so C4 adds **+267 B** (the `installSkinWorker` hook and Turbopack's worker loader) out of the 513 B the C0 budget plan
left unallocated. `skin-worker` lazy, 12.6 kB gzip (warning above 120 kB).

## Gates (local, real Chrome; port 3163)

See the end of this file (filled after the full run).
