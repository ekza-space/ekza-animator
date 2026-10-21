# M6b C0 — contracts, schema v4, stubs, hooks, panel registrations, lazy chunks, fixtures: build notes

Branch `m6b/rig-contracts` (from `m6b/mvp` at `906520c`, spec v1.3). Scope:
[M6B-SPEC §9.0 C0](../M6B-SPEC.md#c0--rig-contracts-integration-agent-first) with §4 and the §0.5 additions; the
shared-file roles of §9.1 as §9.0 restates them for the MVP. Decision IDs below are `M6B-C0-<n>`.

## What landed

| C0 item | Where |
|---|---|
| First commit: the MVP eager baseline (Q-MVP-14) | `apps/web/scripts/size-baseline.json`: the `dev` route before C0, **889,569 B** (production build, gzip -9), allowance +6,144 B, `enforce: false` (C7 turns the gate on), per-package allowances recorded; the M6a record kept under `previous` |
| Schema v4 (§4.1, §0.4.8) | `doc/src/records.ts` (`CharacterRecord.vrm`, `CharacterVrmMeta`, `VrmLicensePreset`, `JointRole`, `JointRecord.role`/`key`, `ShapeField`, `ControlShape.edited`, `ClipSource 'test'`, `AssetRecord.role 'thumbnail'`), `store.ts` (`skeletonOfCharacter`, `constraintsOfRig`, `meshesBoundTo`), `records/validate.ts`, `records/repair.ts` (per-record rules, `jointKeyStem`, the cross-record `repairJointKeys`; loaded with the migrations only), `records/swatch.ts` (the swatch shader repair the table registry needs eagerly), `records/vrm.ts` (the meta's defaults, validation and repair in one table, `makeVrmMeta`), `migrations/migrate.ts` (`CORE_MIGRATIONS[2]`, 3 → 4, the v4 repairs on load), `snapshot/version.ts` (`SCHEMA_VERSION = 4`, `requiredWriterVersion` 4), `store/references.ts` (the VRM thumbnail), `queries/engine.ts` (memory store; doc-yjs inherits it), the naive test store's queries in `editor-core/src/testing/store/queries.ts`; `doc/testing`: `makeTestVrmMeta`, `makeTestThumbnailAsset`, `withSchemaV4`, v4 defaults in `makeTestJoint`/`makeTestCharacter`, the schema-v4 conformance cases (memory and doc-yjs, replication included) |
| mesh-core §4.2 | `skin/types.ts` (contract file, verbatim; formatting excluded in `biome.json`), `skin/layers.ts` (`readSkin`, `readSkinReview`, `withSkin`, `SKIN_REVIEW_LAYER`: working baselines), stubs `skin/{geometry,laplacian,bind,edit,stroke,mirror,check,transfer,inpaint,fold}/index.ts`, `query/reference.ts` (the brute-force `TriangleBvh`), barrel lines in `mesh-core/src/index.ts` |
| rig §4.3 + §0.5 | `rig/src/types.ts` (every §4.3 type with the Quick Rig v2 replacements), stubs `rig/src/{templates,quickrig,joints,validate,shapes,makeEditable}/index.ts`, `constraints/{params,index}.ts` (`parseConstraintParams` and `withoutConstraints` baselines, `CONSTRAINT_OPS`, bake and mirror stubs), `autorig/update.ts` (`updateAutoRig` baseline), the marker lists `QUICK_RIG_CENTRE_MARKERS`/`QUICK_RIG_SIDE_MARKERS` |
| io §4.4 + §0.5 | `io/src/types.ts` (character writer, export request, starter-pack manifest), `skeleton/fromDoc.ts` (`skeletonFromDoc` and `jointsFingerprint` baselines, `measureSkinned` stub), `character/index.ts`, `library/index.ts` (`UAL_BONE_MAP` as §0.4.7 lists it, function stubs), `lint/vrm.ts` (`VRM_LINT_RULES = []`) |
| mesh-view, viewport §4.7 | `mesh-view/src/skin/index.ts` (`SkinnedSurface`, constructor fails `not-implemented`), `viewport/src/rig/index.ts` (overlay class stubs) behind `loadViewportRig()` |
| editor-core §4.6 + §0.5 | `types.ts` and `operators/args.ts` (every §6/§0.6 row); `workspaces/rig.ts` (enabled `RIG_WORKSPACE`, the lazy-id rule), `app/factories/rig.ts` (`app.rig`: the rig-workspace loader; the services are created by the chunk: `rig/chunk/services.ts` with the test-pose baseline in `rig/testPose/index.ts` and the skin and validation stubs), `app/factories/library.ts` (`app.library` shell), `session/rig.ts`, `evaluation/rigSource.ts` (`registerChannelSourceProvider`, the channel sources), `library/index.ts` (clip-library chunk entry), `characters/runtimeChunk.ts` + `runtimeEntry.ts` (character-runtime wrapper and entry), `history/history.ts` (`recordTestPose`, `dropTestPoses`), `operators/builtin/rig/*.ts` (one stub file per owner) + `rig/stub.ts` + `rig/index.ts` (the chunk entry), `operators/builtin/library.ts` |
| Hooks (one-line where possible) | `evaluation/service.ts` (the channel-source fill and the preview stamp in `tick`), `operators/runner.ts` (`onBeforeDocumentRun` dispatch, the lazy-chunk resolve), `operators/registry.ts` (the listener set), `app/kernel.ts` (`rig`, `library`, `restoreTestPose`), `operators/builtin/workspace.ts` (`workspace.set` awaits the rig chunk) |
| editor | `panels/viewport/hud/badges.ts` (+ the mount line in `PaneView.tsx`'s HUD), the `ANIMATE_SLOTS` entry in `shell/layout.ts`, `libraryPath` in `Editor.tsx`/`shell/EditorRoot.tsx`/`services/browser.ts` and `apps/web/app/editor/EditorIsland.tsx`, the six panel stubs `panels/{clipLibrary,quickRig,rigToolkit,validation,paintWeights,componentEditor}/index.tsx` with their registration lines in `panels/index.ts` (`panels/lazyPanel.tsx`; the five Rig & Skin bodies load as one group, `panels/rigPanels.ts`), the Rig Toolkit section stubs `panels/rigToolkit/sections/{skeleton,skin,character,library}/index.tsx` with the section list and contract, `test-api/types.ts`, `createTestApi.ts` (spreads, `characters()`), `test-api/m6b/*.ts` (one stub per owner; `rig-contracts.ts` implements `keysHash()`), `test-api/placeholder.ts` (the degraded API throws through a Proxy), placeholder Rig & Skin dialogs (`dialogs/PendingRigDialog.tsx`), the skin worker entry `workers/skin.worker.ts` |
| ui | §8.14 tokens and `--marker-quickrig-ghost` in `tokens.json` (generated `css/tokens.css`), 3:1 contrast rows against `--comp-halo` for the glyph colours |
| size | `apps/web/scripts/check-size.mjs`: BOUNDARIES `rig-workspace`, `skin-worker`, `character-runtime`, `clip-library` and the §0.4.9 chunk warnings; `apps/web/test/m6b-size.test.ts` |
| Fixtures | `tooling/make-mvp-fixtures.mjs` → `fixtures/models/cube-lad.glb`, `cube-lad-truth.json`; `tooling/make-polybot-unskinned.mjs` → `polybot-unskinned.glb`, `polybot-unskinned-tpose.glb`, `polybot-truth.json`; `tooling/test/*`; `fixtures/LICENSES.md` rows and an empty "Starter pack" section |
| Dependencies (§2.1) | `@pixiv/types-vrmc-vrm-1.0` 3.5.5 (io dev, types only), `vrm-validator` 2.0.0-dev.3.10 (io and headless-tests dev, CI only); the `rig → mesh-core` types-only edge; `check-deps` and `.oxlintrc.json` allowances (also `@ekza-studio/mesh-core` for the editor workers) |
| e2e | `apps/web/e2e/helpers/m6b-rig.ts`, `helpers/m6b-cube-lad.ts`, `m6b-00-foundation.spec.ts` (E2E-M6B-00) |

## Working baselines (never throwing)

Schema v4 migration, validation, repairs, queries, `referencesOf`, `requiredWriterVersion`; `readSkin`/`withSkin`/
`readSkinReview`; the brute-force `TriangleBvh`; `parseConstraintParams`, `withoutConstraints`; `updateAutoRig`;
`skeletonFromDoc` (rest data only) and `jointsFingerprint`; `EditorHistory.recordTestPose`/`dropTestPoses`; the
in-memory `TestPoseService` (in the rig-workspace chunk, M6B-C0-24); the channel sources `animate`, `bind`, `test`, `clip` with the `preview` priority; the
enabled Rig & Skin `WorkspaceDef` and the three lazy loaders; `keysHash()`.

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6B-C0-1 | **Cube Lad = 16 boxes, no extrudes** (torso, pelvis, neck, head and per side upper arm, forearm, hand, thigh, shin, foot), 192 triangles, built by `mesh.create.cube` per box + `scene.object.transform` + `mesh.combine {pivot: 'origin'}`. §0.7 says "13 boxes, a few extrudes" for the same 16 parts. | Extrudes would tie the Node generator to the kernel's extrude geometry; boxes give the helper and the GLB the same points exactly (checked within 1e-6 m by E2E-M6B-00). The truth file's `boxes` is the single design both sides build from. |
| M6B-C0-2 | **Cube Lad truth joints** follow the §0.4.2 fit formulas from the truth markers (spine/chest evenly between hips and neck, clavicle halfway to the spine, `neck = chin − 0.01 H`, `head = chin + 0.02 H`, fingers by the §5.2 table along `wrist − elbow`, toes tail at the foot's front extent) with the 2° **minimum bend** on elbows (back) and knees (forward). | The C2 fitter gate (0.03 H on synthesized markers) has an exact target; a design that disagreed with the formulas would make the gate measure the design, not the fitter. |
| M6B-C0-3 | **Polybot fixtures are in canonical space** (VRM 0.x faces −Z: positions and normals turned 180° about Y), one static mesh node at identity with Polybot's material and texture; the T-pose turns each arm's upper and then lower segment to the horizontal ±X (left = +X) about its joint, then LBS with Polybot's own weights. `polybot-truth.json`: per pose the VRM 1.0 humanoid joint positions (VRM 0 thumbs aliased), every joint node, height, ground and the nine markers (`headTop` = (0, max y, head z), `chin` = neck + 0.01 H, the rest the joints of their meaning); `vertexPoint` (glTF vertex → welded point, exact float32 weld) and `dominantJoint` (per point, an index into `joints`, the human bone or `node:<name>`). Polybot is 1.064 m tall; its `leftToes` is not in the VRM map (the node is in `nodes`). | Quick Rig requires +Z-facing models (§0.4.2 start checks); compact, exact data for P-S7 and the E2E-SKIN-01 joint check. |
| M6B-C0-4 | `skeletonOfCharacter` on a conflict returns the **greatest** SkeletonId ("the newest by id"). | §4.1 wording; ids carry no time, so "newest" reads as the id order's last. |
| M6B-C0-5 | **VRM meta validation** is "the meta repairs to itself" (one table in `records/vrm.ts`); a write with a malformed meta gets one problem, `vrm: expected null or a VRM meta`. A missing `vrm` (undefined) is a write error; load repairs it to `null`. | One definition for validation, repair and defaults keeps the eager bytes down (§0.4.9). |
| M6B-C0-6 | **Joint keys**: missing → the sanitized name (`jointKeyStem`, rig's `sanitizeNodeName` rule duplicated in doc, which cannot import rig); duplicates per skeleton among live joints get `#n` in id order, `n` skipping keys already in use. Deleted joints keep their key. `makeTestJoint`'s default key is the sanitized **id** (unique), not the name. | §4.1 rules table; tests put several joints named "Joint" in one skeleton. |
| M6B-C0-7 | **The runner resolves chunk ids**: an unregistered id that the rig-workspace chunk registers (`skel.*`, `skin.*`, `char.*`, Rig & Skin `rig.*`, `select.joints`, `mesh.importStatic`, `file.exportCharacter`) or a `library.*` id loads its chunk, then runs (a second hook in `runner.ts` next to `onBeforeDocumentRun`). | §2.1: "anything (a menu, the palette, the test API) runs an operator id with one of these prefixes". |
| M6B-C0-8 | **`onBeforeDocumentRun`** fires after the first poll (a poll-failing run does not stop a preview) and the extrude-session hook, immediately before `prepare`, for `flags.undo` operators and `edit.undo`/`edit.redo`; a throwing listener is reported (`console.error`) and never stops the run. | §0.5 "before `prepare`"; a key attempt that cannot run must not end the preview. |
| M6B-C0-9 | **Channel sources** (C0 baseline, C7 refines): `animate` (shipped), `bind` (channel defaults; C7 evaluates the constraint-free program), `test` (defaults ⊕ `app.rig.testPose`), `clip` (curves without overrides). A registered `preview` provider wins in every workspace when its `values(character)` is non-null (the newest registration first); the evaluation re-evaluates when any provider's `version` or the registrations change. The provider is a module-level registry (the §0.5 signature has no app). `channelValues`/`channelValue` keep reading the document (the Channel Box never shows preview values). | §0.5; C12's provider bumps its version per frame and on stop. |
| M6B-C0-10 | **Operator stubs**: every §6 id and the §0.6 additions from one file per owner (`operators/builtin/rig/{character,autorig,skeleton,quickRig,quickRigSession,prop,bind,weights,influence,mode,pose,rom,shadows,constraints,shapes,export,makeEditable,recovery}.ts`, `operators/builtin/library.ts`). MVP ids poll-fail "not available yet", deferred ids "Arrives after the MVP" and are `internal` (no menu, palette or keymap). Key scope `rig`, workspaces `['rig']` (`rig.constraint.create`: rig and animate; `library.*`: animate and rig; `file.exportCharacter`: scope `global`). `select.joints`, `skel.symmetry.set` and `skel.pose.tStance` sit in `skeleton.ts` (C2's file; C3 owns their UI, and §9.0 gives C3 only `quickRigSession.ts`). `rig.animateOnly` carries its final reason. Ops whose §6 label is "internal: …" and the U-state ops that need pointer or record args are `internal`. | §3 rule 1, §0.6, Q-MVP-15. |
| M6B-C0-11 | **Keymap rows and menus are not landed**: §9.0 gives `editor-core/src/keymap/maya.rig.ts`, `editor/src/shell/menus/rig.ts` and the marking menus to C7 (its §7 MVP rows, the §0.4.5 menus). C7 registers them from `app.rig.load()` (its file after C0), so they stay in the lazy chunk. | §9.0 wins over §9.1's "C0 lands empty registries". |
| M6B-C0-12 | **Panel bodies are the lazy `panels/<id>/index.tsx`**, registered by one line each in `panels/index.ts` through `lazyPanelDef` (`panels/lazyPanel.tsx`), so a panel adds only its registration to the route. The five Rig & Skin bodies are one lazy group, `panels/rigPanels.ts` (C0, closed; one re-export per owner, keyed by panel kind), so the route carries one chunk reference for them; Clip Library keeps its own (`clip-library` lives apart from `rig-workspace`). Stub test ids: `clip-library-panel`, `quickrig-panel`, `rtk-panel`, `val-panel`, `pw-panel`, `ce-panel`. The Rig Toolkit body renders `RIG_TOOLKIT_SECTIONS` (`sections/index.ts`, contract `sections/types.ts`) with `rtk-section-<id>`. | §0.4.9 eager budget; §8.15. |
| M6B-C0-13 | **Badge slot**: `registerViewportBadge(provider)` (module registry, registration order); `ViewportBadges` draws each non-null label as `hud-badge-<provider id>-<paneId>` at the bottom right of every pane's HUD, before "Feet pinned" and the frame readout. | §0.5; §8.3 places the pose badge bottom right. |
| M6B-C0-14 | **Contract additions beyond the spec text**: `TriangleQueries` (the instance shape of `TriangleBvh`, in the skin contract file), `RigToolkitSection(Props)`, `ViewportRigModule`, `CharacterRuntimeChunk`, `RigApi`/`LibraryApi` (factory shapes), `M6B_CHUNK_WARN_BYTES`, `ARRIVES_AFTER_MVP`, `makeVrmMeta`/`repairVrmMeta`, `jointKeyStem`/`repairJointKeys`, `previewValues`. | Implementation helpers the owners reuse; no §4 shape changed. |
| M6B-C0-15 | `ControlLayer.setShape` (§4.7) is **not** landed: the shipped class belongs to C9 (deferred, §0.3). `VRM_LINT_RULES` is an empty list in `io/src/lint/vrm.ts` (C10's file). `UAL_BONE_MAP` is landed as §0.4.7 lists it (52 deformers, verified against the fixture's node names). | §0.3 deferrals; data the spec fixes. |
| M6B-C0-16 | **`updateAutoRig` baseline** = `autoRig(skeleton, ids, {ik})` regenerated; current controls whose id the new rig lacks are soft-deleted (warnings); `staleOffsets` empty. **`skeletonFromDoc` baseline**: live joints of the skeleton, topological (parents first, siblings by `order` then id; cycle members appended as roots), `restRotation` read as character-space orientation, rest locals derived against the parent, format `vrm1` for `vrm-humanoid` else `gltf`, radii null, joint-based height (`JOINT_HEIGHT_FACTOR`), `props`/`helpers`/`jointKeys` filled. | §9.0 names them working baselines that keep C1/C2 green while the other runs. |
| M6B-C0-17 | **character-runtime chunk**: `characters/runtimeChunk.ts` is the `import()` wrapper (`loadCharacterRuntime()`), `characters/runtimeEntry.ts` the entry with the marker (one module cannot be both lazy entry and its own eager wrapper). Nothing imports it yet (C1's registry hook will), so `check:size` reports its boundary "not in this build". The skin worker entry likewise waits for C4 (`new Worker(new URL('./skin.worker.ts', import.meta.url))`). | §9.1 row; the BOUNDARY tests run on fixture builds. |
| M6B-C0-18 | **Display flags**: Animate keeps today's look (`joints` false, `jointAxes`/`jointLabels` 'none', `weights` 'off', `constraintLines` false); Rig & Skin starts from the same `DEFAULT_DISPLAY` (fix round 1 removed C0's `RIG_DISPLAY`: C7 lands the Rig & Skin display with its modes, joints overlay, x-ray, axes on selection, labels on hover). | §4.6 comments; §0.4.9: C7's display is C7's eager bytes. |
| M6B-C0-19 | **READY flags**: `test/m6b-ready.ts` in mesh-core, rig, io and editor-core (`c1`…`c12` of the MVP, all false); each package sets its own on merge. **P-C6** (`editor-core/test/m6b/keys-hash.test.ts`): one row per registered rig/library operator (equal to the chunk's ids), status `pending`, `checked` (runs with the owner's `setup`) or `keys` (the §3 rule 7 exceptions: `skel.joint.orient`, `rig.autoRig.update`, `rig.constraint.{removeTarget,delete,bake}`, and `library.useClip`, which writes a clip with keys). | §3 rule 4, §5.26. |
| M6B-C0-20 | **Placeholder dialogs**: every new `UiDialog` opens `PendingRigDialog` (title = the dialog id) until its owner replaces its loader line in `DialogHost.tsx`. | `DialogHost` maps every dialog name to a chunk. |
| M6B-C0-21 | **§8.15 test ids are reserved** by this list and the spec table: `ws-tab-rig` exists; the panel stubs carry `rtk-panel`, `pw-panel`, `ce-panel`, `val-panel`; owners use the remaining ids as §8.15 assigns them (`hud-pose-<paneId>` stays C7's; C0's badges use `hud-badge-<id>-<paneId>`). | No runtime registry of test ids exists (none was built for M6a either). |
| M6B-C0-22 | **No CR filing** (§0.4.1): CR-2, CR-4, CR-7 are direct edits of their owners; the others are deferred with their fallbacks. | §9.0 C0 scope. |
| M6B-C0-23 | **Joint-key uniqueness is the writers' duty on local writes**: the per-record write validation sees one joint, so two live joints of a skeleton with the same `key` written in one local transaction are accepted (load repairs them). Every joint writer (C2's skeleton operators, Quick Rig's Create Skeleton, `char.fromModel`) allocates keys unique among the skeleton's live joints, e.g. by running `repairJointKeys` over the skeleton's joints plus the new ones before writing (JSDoc of `repairJointKeys`). | A store-level cross-record check would put an index walk on every eager `transact`; reviewer finding (fix round 1). |
| M6B-C0-24 | **The Rig & Skin services live in the rig-workspace chunk**: `app.rig.load()` creates `testPose`, `skin` and `validation` (`rig/chunk/services.ts`, re-exported by the chunk entry); before, reading one throws `EkzaError('unavailable', 'app.rig.<name>: await app.rig.load() first')`. They are prototype getters of a small class, so enumerating `app.rig` never reads them (React's dev-mode prop logging walks `props.app`; the first try with own getters failed 85 editor tests). `app.rig.services` is null until then; the evaluation's `test` source reads the loaded test pose or nothing. C7 (validation, tab glyph) and C4 (skin) replace their stubs in that file and load the chunk where they need a service before the tab was entered. | §0.4.9: C7's allowance covers the `WorkspaceDef`, menus, keymap and the loader, not the services; §9 C7 dirs `rig/{testPose,validation,chunk}/**`. |
| M6B-C0-25 | **Load-time repairs are lazy**: the table registry needs only the swatch shader repair (`records/swatch.ts`; one import line in `tables/registry.ts` changed); `records/repair.ts` (the M6a rules, the v4 rules, `repairJointKeys`, `repairHierarchy`) is imported by `migrateSnapshot` alone and loads with it. The three v4 queries scan their tables (live rows only, sorted as before) into one cache cleared by any `skeletons`, `constraints` or `meshes` write and by `invalidateAll`; results stay frozen and shared until then. | §0.4.9; the reviewer's "load the schema-v4 repairs only when a snapshot holds v4 fields": they now load with the migrations, which only a load runs. |
| M6B-C0-26 | **The degraded test API** (kernel unavailable) keeps `ready`, `webgl` and `renderedFrames` and throws `not-implemented` for every other string key through a Proxy (`then` stays undefined, so the object is never a thenable); M6b groups need no list there. | §0.4.9; the list went stale with every group. |
| M6B-C0-27 | **Polybot truth markers** (fix round 1): centre markers have x = 0 (`pelvis` was the hips joint at x = 0.0005), and a marker lies on or above the ground: the artist's toes joint is 6 mm below the sole, so the `toe` marker is clamped to the ground while `humanoid.rightToes` keeps the artist's joint. | §0.4.2 axis rule (centre markers clamp x to 0); the guess places `toe` at 0.02 H, never below the sole. |

## Eager route (§0.4.9)

Production builds, `check:size` (gzip -9, first visit). Recorded baseline (first commit): **889,569 B** (dev before
C0). Fix round 1: **891,104 B, +1,535 B** (C0 allowance 2,048 B; gate 900,000 B, headroom 8,896 B). The four lazy
chunks stay outside the route (`rig-workspace` 3.0 kB, `clip-library` 0.7 kB; `skin-worker` and `character-runtime`
have no importer yet, M6B-C0-17).

How the first round's +4,871 B came down (source-mapped builds, each step measured by a rebuild; base 889,686 B):

| Step | Route delta |
|---|---:|
| first round (`20e4c77`) | +4,881 |
| load-time repairs lazy (M6B-C0-25: `repair.ts` out of the route) | +2,758 |
| v4 queries as one cached scan; test pose, skin and validation in the rig chunk (M6B-C0-24); `app.library` and the before-run hook shorter; `RIG_DISPLAY` removed (M6B-C0-18) | +2,387 |
| the Rig & Skin panel bodies as one lazy group; the degraded test API as a Proxy (M6B-C0-12, -26) | +1,491 |
| prototype getters for the rig services (M6B-C0-24) | +1,547 |

**Gross and offsets, stated plainly.** Two steps also took **shipped** code out of the route: the M6a load-time
repairs (≈ 1,530 B) and the degraded test API's per-function list (≈ 635 B), measured by applying the same two changes
to the baseline build (889,686 → 887,523 B, source-mapped). Over that offset baseline, C0's own additions are
≈ **3,710 B**. The route measure §0.4.9 defines ("the MVP's eager additions … over the `dev` measure before C0 … so
C0's own delta counts", each package "measured … against `m6b/mvp`") is the net **+1,535 B**. Both offsets are real
savings for every visit, on code C0 owns (`doc/src/records/**`) or touched for M6b (the test-API groups), and nothing
was deferred to reach them. If INT reads the allowance as gross additions, the next candidates are listed below with
their measured costs; the VRM meta table must stay eager (local writes run the per-record rules, §4.1).

**MVP budget plan** (+6,144 B over the baseline): C0's +1,535 B leaves **4,609 B** for C7 (2,560 B), C12 (1,024 B)
and C1 (512 B), together 4,096 B: every remaining allowance fits, with 513 B to spare. C7's category items already in
the route (the `WorkspaceDef`, the lazy-id rule and loader, the rig session and rigging prefs defaults, ≈ 700 B) and
C12's (the `app.library` shell, ≈ 190 B) count in C0's number, so those packages start with their full allowance.

What remains (marginal costs, source-mapped, each measured by removing the item and rebuilding):

| Item | ≈ B |
|---|---:|
| VRM meta defaults, validation and repair table (`doc/src/records/vrm.ts`; eager because `validate.ts` checks writes) | 458 |
| Rig session defaults (`editor-core/src/session/rig.ts`) | 230 |
| `Prefs.rigging` sanitizer (`prefs/persist.ts`) | 191 |
| `app.library` shell (`app/factories/library.ts`) | 189 |
| The six panel registrations and `lazyPanelDef` (after the grouping) | ≈ 150 |
| Viewport badge slot (`hud/badges.ts` and its mount) | 113 |
| Placeholder Rig & Skin dialogs (`DialogHost.tsx`) | 96 |
| The rest: the other schema v4 checks and `requiredWriterVersion`, `PANEL` ids, the hooks (`rigSource`, `runner`, `registry`, `history`), the rig loader, the lazy-id rule and the `WorkspaceDef` | ≈ 200 |

Owners' follow-ups from this section: C1 and C4 assert in their DoD that `check:size` reports `character-runtime` and
`skin-worker` as lazy groups once they import the entries (today only `apps/web/test/m6b-size.test.ts` proves the gate
on fixture builds); C7 adds the Rig-workspace variant of the preview-priority test (`foundation.test.ts` sets the
`bind` source directly until C7 maps the workspace to it) and its Skeleton and Skin menus to E2E-M6B-00's menubar
check.

## Literal updates (§3 rule 9)

Each in the commit that changes the contract; every assertion kept:

- Schema v4 (`51b80a5`): `SCHEMA_VERSION` 3 → 4 and saved `schemaVersion` literals (doc `schema-v2`, `schema-v3`,
  `snapshot`; io `project`, `project-m6a`; editor-core `test/testing/fixtures.ts`; headless `ops.m2a-foundation`,
  `ops.m6a-foundation`; e2e `m2a-00-foundation`), `withSchemaV3` → `withSchemaV4` where the migrated form is compared,
  skeletons and model characters requiring writer version 4 (doc `schema-v3`), character records gaining `vrm: null`
  (editor-core `create-editor-app`, `mesh-io`; viewport `fingers`).
- editor-core contracts (`81e7d83`): Rig & Skin enabled — editor-core `m6a/workspaces` (tab list, `workspace.set`
  refusals), editor `m6a-shell`, `m6a-command-palette`, `test-api` (Review is the disabled tab/entry); `Selection`
  gains `joints`/`constraints` (editor-core `clip`, `session`, `m6a/foundation` and the selection literals of
  editor-core, viewport and editor tests); `Prefs.rigging` and `undoSelection.rig` (editor-core `prefs`).
- editor (`2884bd0`): `characters()` gains its M6b fields (editor `test-api`).
- e2e (`67fa361`): `m6a-shell.spec` uses Review as the disabled tab and palette entry.
- Fix round 1: `apps/web/test/m6a-size.test.ts`'s two expected messages read 'M6b MVP eager delta' (check:size's
  renamed line); `editor-core/test/m6b/foundation.test.ts` awaits `app.rig.load()` before using the test pose
  (M6B-C0-24) and asserts the unavailable error first. Assertions added, none removed.

## Gates (local, real Chrome; port 3160)

`EKZA_E2E_PORT=3160 pnpm run ci` on `b9d3d5b` (plus this note): **exit 0**.

- format:check, lint, typecheck, check:deps, check:fixtures (the two generators' `--check`), check:licenses: pass.
- test (turbo 15/15): mesh-core 905, editor-core 1340, editor 521 (+1 skipped), anim-core 671, io 262, doc 263,
  viewport 243 (+1 skipped), rig 232, curve-editor 209 (+3 skipped), headless 193, ui 94, doc-yjs 85, mesh-view 75,
  web 22, tooling (node:test) 22. Skips are the existing M6a ones; none added.
- build: pass. `next.config.ts` needed no skin-worker entry (Turbopack bundles `new Worker(new URL(...))`).
- check:size: 894,440 B (gate 900,000 B, headroom 5,560 B); eager delta **+4,871 B** over the 889,569 B baseline
  (C0 allowance 2,048 B: see the INT request above; the MVP total allowance 6,144 B is not enforced yet). No boundary
  violation: `rig-workspace` 2.5 kB and `clip-library` 0.7 kB are lazy groups; `skin-worker` and `character-runtime`
  are reported absent (their entries have no importer until C3/C1 wire them). `apps/web/test/m6b-size.test.ts` puts
  each of the four markers into the eager scripts and expects the gate to fail.
- test:e2e (local Chrome GPU, project `chrome`): 219 passed, 23 skipped (the existing skips), 2.5 min; includes
  E2E-M6B-00 (`m6b-00-foundation.spec.ts`).
- Flake seen once, not caused by C0: in the previous full run, editor-core `m6a/mesh-io.test.ts` "displays the rebuilt
  container once a mesh is edited" timed out at 30 s under parallel turbo load; it passes alone (≈ 2.5 s, 3/3) and in
  this run. Shipped M6a test, left unchanged.
