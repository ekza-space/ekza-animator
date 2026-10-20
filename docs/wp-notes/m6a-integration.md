# M6a integration — merge, gates, INT scenarios, budgets, docs: build notes

Branch `m6a/integration` (from `m6a/spec`). Scope: [M6A-SPEC §9 INT](../M6A-SPEC.md#int--integration-after-every-package)
and [§11](../M6A-SPEC.md#11-integration-plan-and-m6a-definition-of-done). Decision IDs below are `M6A-INT-<n>` for
DECISIONS-OPEN §H.

## Merge (M6A-INT-1)

In the §11.1 order, `--no-ff -s ort`, signed off: B0a `m6a/contracts-foundation` (`b85b7ac`), B0b `m6a/keymap-menus`
(`8a6ff94`), B9 `m6a/shell-workspaces` (`fc4cb60`), B1 `m6a/mesh-kernel` (`a495049`), B6 `m6a/mesh-view` (`983a142`),
B7 `m6a/mesh-runtime-doc` (`960feb0`), B8 `m6a/mesh-io` (`b4954cb`), B2 `m6a/mesh-select` (`3710d3e`), B3
`m6a/mesh-ops-core` (`5e2792b`), B4 `m6a/mesh-ops-shape` (`7c47b33`), B5 `m6a/mesh-bevel-check-uv` (`01a211d`), B10
`m6a/model-select-ui` (`e57acfc`), B11 `m6a/model-ops-ui` (`308dea4`), B13 `m6a/model-content` (`7c000a5`), B12a
`m6a/model-transform-tools` (`bf2c3e3`), B12b `m6a/model-topology-tools` (`e04d85a`). Every branch is an ancestor of
the head; no package branch was changed by the integration. Conflicts were the ones the packages' merge notes name
(the descriptors test's `LANDED` sets as their union, the shared `mesh-core/test/ready.ts`, the barrel and contribution
import blocks, the ROADMAP rows), resolved as those notes say.

## Gates turned into failures (§3 rule 4; M6A-INT-2)

`a13c0f5`: every `READY` flag of mesh-core, io, editor-core, editor and viewport is a static `true` (the inline
probes are gone; B3's and B5's gate files fold into `mesh-core/test/ready.ts`, M6A-B3-13, M6A-B5-13), the stub-era
cases that only ran before B1/B5 landed are removed, and every §10.1 `test.fixme` of an E2E-MOD scenario and the
mesh-view bench is a test. The only `test.fixme` tests left are stretch items: the M1/M2a ones of `stretch.spec.ts`
and the fourteen M6a-stretch items of `m6a-stretch.spec.ts` (M6A-INT-30).

## Known problems from the package rounds (all fixed with regression tests)

| # | Problem | Fix | Tests |
|---|---|---|---|
| 1 | B11: Last-op card, INPUTS and option-box fields kept the keyboard after Enter | fields blur on commit like Esc (`86279e6`, B11 fix round) | `editor/test/m6a-model-ops-ui.test.tsx` |
| 2 | B11: the Last-op tracker closed a fresh LastRun as "Selection changed" when the selection service published the op's own result in a microtask | `aeb2fa7`, `def87b1` (the run's own result, card previews and store publishes keep the card) | `editor-core/test/ops-ui/lastrun.test.ts`, `card-preview.test.ts` |
| 3 | B10: a component marquee over several meshes merged into the previous undo step when its first run was a no-op | one run per marquee (`also` pass-through), a continuation merges only into its own gesture (`ea97125`) | `editor-core/test/m6a/select/operators.test.ts`, `viewport/test/m6a-select/runtime.test.ts` |
| 4 | B12a: under symmetry a committed component drag replaced the picks with pick + partner | the pre-expansion picks are restored inside the run's batch (`353ff04`, `8ed4437`) | two-drag cases in `viewport/test/m6a-transform/runtime.test.ts`, `editor/test/m6a-transform-ui.test.tsx` |
| 5 | B12b: the extrude session frame was wrong when the first region/chain was the mirrored partner | `extrudeGroupFrame` gives the frame the kernel applies (improper `S·F` for a partner) and the session converts drags in its source frame (`03b4a0c`, `17c2573`) | `mesh-core/test/ops-core/extrude-session-frame.test.ts`; `editor-core/test/topology/extrude-session.test.ts` (−X face, −X border chain, smart extrude) |
| 6 | E2E-MOD-01/-02 vs §5.8's args undo stack | spec rows amended (M6A-INT-3), both scenarios end the session with Esc before the one undo; -02 expands the card first; the card names `⌘E` (M6A-INT-4) | `m6a-01-*.spec.ts`, `m6a-02-*.spec.ts` |
| 7 | `check:size` 912,769 B > 900,000 B | the component selection service loads with the kernel (M6A-INT-14) and the Model-only operators with their chunk on the first Model entry (M6A-INT-13); see "Size" | `check:size`, manifest drift test, boundaries |
| 8 | Residual verifier findings of B0a, B3, B4, B5, B6, B9, B13 | "Residual hand-overs" below | as listed |

## Interpretations and decisions

| # | What | Why / where |
|---|---|---|
| M6A-INT-3 | **E2E-MOD-01/-02 amended to §5.8**: `Esc` ends the extrude session (the cap moved: no zero-drop) before the one undo that removes the extrude; inside the session one undo steps Divisions back, as E2E-MOD-17 asserts. | B12b's amendment request; §10.1 rows changed with the tests (`44cfacb`, `4eada31`). |
| M6A-INT-4 | The Last-op card names its shortcut in the platform's labels (`⌘E`/`Ctrl+E`) as the pill's tooltip and the expanded card's header; `cb-inputs` wraps the INPUTS entries | §10.1 E2E-MOD-02, §8.10, E2E-MOD-27 (`3ee9b8d`). |
| M6A-INT-5, -9 | W/E/R Shift-start calls B12b's `beginSmartExtrude`; the extrude manipulator hands an MMB drag with an INPUTS field selected to B12a's slider | §5.15 MMB rule's INPUTS step after `Mod+E` (`9c3eb21`). |
| M6A-INT-6 | E2E scenarios meet the merged packages (literal updates, assertions kept): -02/-18 end the session before the undo, -12 names its loop's edge kind, -17 drags the Scale uniform handle, -23/-28 show the Channel Box tab first, -27/-29 read the merged geometry | `4eada31`. |
| M6A-INT-7 | `cb-inputs` is the INPUTS section with its primitive and last-op entries (not the header line) | §8.10. |
| M6A-INT-8 | The known problems 1–5 were fixed on the package branches in their fix rounds before the merge (each with its test) | table above. |
| M6A-INT-10 | Model object picking mapped triangle corners as points (most faces missed; a second mesh got a mutated ray) | `651911e`, viewport test of clicks across two cubes in three views. |
| M6A-INT-11 | E2E-MOD-01 and -16, INT's own scenarios | `44cfacb`, `1d2c484`. |
| M6A-INT-12 | A busy viewport tool owns the reserved modal keys wherever the pointer is (a Multi-Cut Backspace over another panel never runs `mesh.delete`, §5.10) | B12b's note for INT/B0b (`7031a69`). |
| M6A-INT-13 | **Model operators load with their chunk on the first Model entry** (B0a's option C): a generated manifest gives each Model-only operator a proxy (id, label, category, scope, flags, workspaces, aliases) so menus, keymap and palette see them from the start; a proxy polls "Model tools are loading" and starts the load | `1ae333a`; manifest drift test (`EKZA_WRITE_MODEL_MANIFEST=1` regenerates). |
| M6A-INT-14 | `app.components` is an eager facade; B10's service loads with the mesh kernel | `281d456`. |
| M6A-INT-15 | `useRegistryList` catches up with registrations made before it subscribes | `6c73d64`. |
| M6A-INT-16 | **Merge to Center groups by the mirror plane**: with the runtime's expanded input each pick and its partner were taken for one group, so both arms' end caps merged into one point (found by E2E-MOD-15) | `36a1720`; P10 coverage 600 cases. |
| M6A-INT-17 | **Test API (additive, §4.8)**: INT's `setExpression` is implemented; `pixels(paneId, x, y, w, h)`, `displayNodeWorld(character, node)` and `displayModel(character)` are added for E2E-MOD-30 | `b5ca954`; `ViewportManager.readPixels/setExpression/displayNodeWorld/displayModelInfo`. |
| M6A-INT-18 | **Separate names new records "<name> 2", "3"…** (an empty proposed name is the source's) and **Combine's palette refusal offers Assign palette** (failed `OperatorResult` may carry an `OperatorAction`; the shell toast shows it) | B4's hand-over M6A-B4-20 (`9af64aa`). |
| M6A-INT-19 | The mirror attribute helpers write `0 − x` (+0 stays +0); Mirror and Symmetrize drop their −0 pass | M6A-B4-18 (`7f1fada`). |
| M6A-INT-20 | `PANEL` names `toolkit`, `palette`, `meshCheck`; the Animate keymap snapshot keeps probing its M2a panels | M6A-B9-13 (`e24a0cf`). |
| M6A-INT-21 | One `MeshLayerHost` declaration (the manager's; `mesh/display.ts` re-exports it) | B6/B9 hand-over (`b40cc67`). |
| M6A-INT-22 | `insertKeyPreservingShape` writes +0 on the new key and every frozen neighbour; the two failing seeds are pinned; the 3,000-run weighted property gets a 120 s timeout | the anim-core flake handed over by B0a and B9 (`0d30912`). |
| M6A-INT-23 | B9's pixel probe waits for the drawn character before reading the shaded look | B13's hand-over (`22628cb`). |
| M6A-INT-24 | **Assign Colour without a slot paints with the active swatch** (and refuses a swatch outside the target's palette) | M6A-B13-18 (`746952f`). |
| M6A-INT-25 | `PickOptions.wire` joins the §4.4 contract | M6A-B6-1 (`06a8553`). |
| M6A-INT-26 | **Meshes painting with one palette share one export material** (named after the palette; one per used swatch with material-per-colour) | §5.19 "one material, one PNG"; AS-LP-A's "1 material" (`0019dfa`). |
| M6A-INT-27 | E2E-MOD-13 read the grip block's rotation as `rotationDegrees`; the block carries the registry's `rotation_degrees`, so the bound was never checked | `3704f8c`. |
| M6A-INT-28 | **E2E-MOD-15's legs taper** (0.85 per segment): untapered, both legs' inner walls lay in the plane x = 0 and the −X one survived the delete-half step (coincident faces after Mirror) | research 10 §7's sequence kept; `a339eae`. |
| M6A-INT-29 | **E2E-MOD-31 reads "the untouched JSON values of the original file" as the original Polybot's**: B rolls back to A's baseline and bakes again, so A's own appended accessors are replaced; the edited geometry is A's | §5.22 marker v2 rollback (`2b84706`). |
| M6A-INT-30 | **AS-LP-S twin readings** (§10.3): operators throughout (the reference images through their dialog); "snapped with V" is a placement of the arm; the head box stays its own mesh in the group; "shoulder ring" is a loop on the arm's first segment and the "armpit loop" a loop round the bridge (with the arms hidden); the topology helper counts vertex rings strictly inside the elbow, knee and shoulder segments and the vertices inside the bridge (its middle ring plus the armpit loop); "flip one diagonal" triangulates one back quad and flips its diagonal; M6a-stretch items are `test.fixme` in `m6a-stretch.spec.ts` with the fallbacks the test API reaches | `6c203d2`, `3704f8c`, `5e48114`. |
| M6A-INT-31 | B12b's §4.3 helpers (`borderChainFrame`, `extrudeGroupFrame`) and Dirs added to the spec | its contract notes. |

## Residual hand-overs (verifier findings and package notes)

| From | Item | Status |
|---|---|---|
| B0a | Eager allowance (Decision requested) | see "Size" (owner item) |
| B0a, B9 | anim-core `insert.test.ts` −0 flake | fixed (M6A-INT-22) |
| B3 | `LANDED` union, `ready.ts` fold (M6A-B3-12/13) | done at the merge and `a13c0f5` |
| B4 | Separate names, Combine's palette action (M6A-B4-20) | fixed (M6A-INT-18) |
| B4 | −0 writes of the mirror helpers (M6A-B4-18) | fixed (M6A-INT-19) |
| B4 | E2E-MOD-24's irregular plane (M6A-B4-14) | in B12b's scenario |
| B4, B5 | switch the local symmetry helpers to B2's (M6A-B4-2, M6A-B5-7) | not done: same semantics, both verified on B2's maps by their owners; a refactor for M6b |
| B5 | known limits (UV seam stretch, partial chamfers on folds, Roundness > 0.5, apex tents) | owner look (DECISIONS-OPEN §H) |
| B6 | the bench's gate, `READY.b6` | lifted (`a13c0f5`) |
| B6 | `PickOptions.wire` contract PR | done (M6A-INT-25) |
| B6 | re-measure entering component mode with B1 | 34.2 ms ≤ 40 (see "Budgets") |
| B6 | a `PickOccluder` over ModelLoader characters in Model; a per-pane isolate cache; character hides outside Model (M6A-B6-22/23/26) | not built: owner items for M6b (characters in Model are drawn by mesh-view once made editable) |
| B9 | `PANEL` kinds (M6A-B9-13) | done (M6A-INT-20) |
| B9 | `MeshLayerHost` twice | done (M6A-INT-21) |
| B9 | eager-delta gate `enforce` | see "Size" |
| B13 | Assign Colour slot, swatch palette refusal (M6A-B13-18) | done (M6A-INT-24) |
| B13 | pixel probe | done (M6A-INT-23) |
| B13 | decisions M6A-B13-16…21 to DECISIONS-OPEN §H | copied |
| B13 | Create › New model menu item | not built (the start card shows on any empty Model scene) |

## Size (§5.27; M6A-INT-32)

`check:size` (production build, gzip -9, first visit): **896,274 B** ≤ 900,000 B (6 scripts; eager 889,421 B, first-visit-only 6,853 B); the `mesh-kernel`, `mesh-view`,
`model-operators` and `component-selection` boundaries keep their chunks lazy. The eager delta over the recorded M2a
baseline (845,267 B) is **+51,007 B**: above every option of B0a's decision request (A +40,960 B; B +20,480 B
from the B0a merge; C +20,480 B over M2a, which INT implemented as far as it goes: Model-only operators, menus and the
selection service are lazy). `size-baseline.json` keeps `enforce: false`; the allowance stays the owner's number
(MODELING-PLAN R38). Proposal for the owner: record the allowance as **+51,200 B** (limit 896,467 B, under the 900,000 B gate) with
`enforce: true`, so any later eager addition needs a decision, and plan M2b's cuts (M2A-INT-4: IK operator bodies,
the Dope Sheet controller, `camera-controls`) to restore headroom under the gate (3,726 B left).

## Budgets (§5.27, report only; M6A-INT-33; real Chrome, DPR 2, Apple M4 Pro, machine shared with other agents)

| Row | Budget | Measured |
|---|---|---|
| Idle in Model, 20k tris face mode | 0 frames / 2 s (gate) | 0 (E2E-MOD-16 and the bench) |
| Enter component mode, 50k tris | ≤ 40 ms | 34.2 ms (B6's row, met after B1) |
| Hover pick at 50k tris | ≤ 0.5 ms | median 0.000, p95 0.100 ms |
| Marquee with occlusion | ≤ 16 ms for 10k vertices | **65 ms for 4,452 vertices incl. a frame (miss)** |
| Drag 1,000 vertices | ≤ 4 ms/frame | mean 0.37, p95 2.50 ms |
| Soft drag over 10k vertices | ≤ 8 ms/frame | mean 0.57, p95 6.70 ms |
| Typical topology op end to end | ≤ 16 ms | extrude 100 faces 14.9 ms, loop on a 200-quad ring 16.2 ms (medians of 5, incl. the next frame) |
| Undo of that extrude through the editor | ≤ 5 (journal) / ≤ 40 ms (rebuild) | 15.0 ms incl. the next frame |
| Make editable / export one edited mesh | ≤ 150 / ≤ 50 ms | 64 ms / 15 ms (incl. validation and the read-back) |
| Leaving Model with an edited Seed-san | ≤ 300 ms | 189 ms (bench); E2E-MOD-30 315 ms incl. its polling |
| Editor route | 900,000 B gate | see "Size" |

The kernel, runtime and io rows are the packages' Node benches (their wp-notes). Results of the browser benches:
`.acceptance/budgets/m6a-*.json` (`apps/web/e2e/bench/m6a-{budgets,mesh-view,transform}.bench.ts`).

## Gates (this branch, local, real Chrome; port 3253; CI unset)

`EKZA_E2E_PORT=3253 pnpm run ci` at `6260475` (plus these docs), clean tree, CI unset: `format:check`, `lint`,
`typecheck`, `check:deps`, `check:fixtures`, `check:licenses` green; `test` (turbo) 15/15 tasks green (editor-core
1,205, editor 511 + 1 skipped, rig 202, headless 193, mesh-core 890 node tests among them); `build` green;
`check:size` 896,274 B ≤ 900,000 B (eager-delta warning +51,007 B, not enforced); the full e2e suite, project
`chrome`, **200 passed, 23 skipped** (the stretch `test.fixme` items: M1/M2a and the fourteen M6a ones), 0 failed.
The first run of the gate failed only in rig's IK allocation test, a fixed 180,000-evaluation run that exceeded the
30 s default at load average 32 (5 s alone): its timeout is 120 s now (`6260475`).

## Open for the owner

The owner feel check (B12a: capture case (b), Component vs per-component Normal), the owner demo script (§11.3), the
eager allowance, the marquee budget miss, B5's known limits and B6's character occluder (DECISIONS-OPEN §H).
