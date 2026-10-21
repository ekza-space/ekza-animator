# WP-4 notes — `@ekza-studio/io`

Builder notes for the integration agent: what landed, interpretations of MVP-SPEC v0.2, deviations, contract
additions, dependencies on other work packages and hand-offs. Branch `wp/wp-4` (base `4bdbe5c`).

## What landed

| Responsibility (§7 WP-4) | Where | Tests |
|---|---|---|
| GLB container (`parseGlb`, layout, JSON chunk, zero-copy BIN), GLB assembly | `src/glb/` | `test/glb.test.ts` |
| SHA-256 (WebCrypto + synchronous pure JS for fingerprints) | `src/hash/sha256.ts` | `test/hash.test.ts` (FIPS vectors, `node:crypto` at every padding boundary) |
| Input budgets and structural checks (§4.11.14) incl. index and joint value ranges | `src/budget/check.ts` | `test/budget.test.ts` (fixtures, 300k-vertex/60-morph stress file, hostile files) |
| Format detection (copy-adapted `detectVrmKind`, `vrm-both`), VRM licence meta, `heightScale`, import provenance | `src/gltf/format.ts`, `ekzaMeta.ts`, `provenance.ts` | `test/format.test.ts` |
| Accessor reader (float, normalized ints, byteStride, matrix padding, sparse, data URIs; meshopt → `CompressedDataError`) | `src/gltf/accessor.ts`, `schema.ts` | `test/animation.test.ts`, `test/skeleton.test.ts` |
| `skeletonFromGltf` (order B-16, TRS/matrix, joints, humanoid incl. VRM 0.x array form and thumb aliases, facing, spring joints, node constraints, bone radii, height, fingerprint, `ekzaHeightScale`) | `src/skeleton/` | `test/skeleton.test.ts` (rest worlds vs three.js on all fixtures, radii for every humanoid bone of both VRMs, null on the meshopt fixture) |
| `readAnimations` (+ `compressed-animation`) | `src/animation/read.ts` | `test/animation.test.ts` (every UAL clip vs three's `GLTFLoader`, 1e-6) |
| `readVrma` / `inspectVrma` (§4.11.7) | `src/vrma/read.ts` | `test/vrma-read.test.ts` (three-vrm-animation parity on a synthetic third-party VRMA, hand-derived golden) |
| `bakeClip`, `ekzaAnimationMeta`, `clipFramesToSeconds` (§4.11.10) | `src/bake/bake.ts` | `test/bake.test.ts` |
| Surgeon `bakeIntoModel`, `preexistingTracks` (§4.11.11) | `src/surgeon/bakeIntoModel.ts` | `test/surgeon.test.ts` (all three fixtures, UAL replace-then-rebake, rollback on Polybot and Seed-san, byte-identical re-bake) |
| Animation-only GLB and VRMA writers, `VRMCVrmAnimation` glTF Transform extension | `src/writers/`, `src/vrma/extension.ts` | `test/writers.test.ts`, `test/vrma-playback.test.ts` |
| Lints, rule table, `BUILTIN_EXPORT_PROFILES` (ADR 0010) | `src/lint/`, `src/profiles/builtin.ts` | `test/lint.test.ts` |
| Read-back check, glTF-Validator wrapper, `compareValidation` | `src/validate/` | writer and surgeon tests |
| `.ekzanim` zip + JSON debug variant | `src/project/archive.ts` | `test/project.test.ts` |
| `io/three` display loader (Draco/KTX2/meshopt, VRM plugin, node constraints, spring bones) | `src/three/index.ts` | `test/three-loader.test.ts` (incl. US-26 node-constraint preview) |
| `io/testing` (Node loader harness, synthetic GLB builders, FK pose source) | `src/testing/` | `test/testing/load-gltf.test.ts` and every test above |
| Compressed fixture and its generator | `tooling/make-compressed-fixture.mjs`, `fixtures/animations/quaternius-idle-meshopt.glb` + `LICENSES.md` row | `tooling/test/make-compressed-fixture.test.mjs` (byte-identical regeneration) |
| Cross-package export pipeline on the real rig | `packages/headless-tests/test/io.export-pipeline.test.ts` | skipped until WP-3 lands (see below) |

DoD: writers use glTF Transform documents only (never three's `GLTFExporter`); the surgeon copies the original BIN
prefix verbatim and never re-serializes it; every writer is deterministic (byte-identical outputs, tested).

## Public API beyond the §7 block (additive)

| Export | Why |
|---|---|
| `importProvenance(license, { sourceSha256, names, known? })` | §4.11.6 step 7 as a pure function for `file.importModel` (WP-7b): VRM meta → `DerivedFrom`, `/mixamo/i` → `'no'`, unknown → `'unknown'`, bundled samples pass their licence. |
| `inspectVrma(c)` → `{ data, warnings }` | `readVrma` plus the import-summary warnings (ignored eye/scale/non-hips tracks, draft spec version, intermediate rest rotations). `readVrma` returns `inspectVrma(c).data`. |
| `setGltfValidator(module)`, `GltfValidatorModule` | `io` never imports `gltf-validator` (dev dependency only; the app worker is stretch). Tests install it in their setup; `validateGltf` throws `unsupported` until one is installed. |
| `LINT_RULES`, `LintRuleDef`, `ruleSeverity(id, profile)` | The ADR 0010 table as data (codes, local/Ekza severities, descriptions) for the export dialog and for profiles. |
| `ANY_EXPORT_KIND` (`'*'`), `profilesForKind(kind)` | `local/generic` applies to every exporter; the dialog lists the profiles of a kind. |
| `io/testing`: `GltfBuilder`, `makeGlb`, `makeBudgetStressGlb`, `makeHostileGlb`, `HostileKind`, `createFkPoseSource`, `FkPoseSourceOptions`, `withNodeImageStub` | Shared test kit (convention 12): synthetic GLBs and a naive FK `PoseSource` so bake/writer/surgeon tests run without the rig kernel. |
| `io/three`: `ThreeModelLoader` (the return type of `createThreeModelLoader`) | Named type for the registry. |
| `io/worker`: `VALIDATOR_PROTOCOL`, `ValidatorRequest`, `ValidatorResponse`, `MessageEndpoint`, `serveGltfValidator`, `createValidatorClient`, `ValidatorClient` | M1-stretch validator worker (below). |
| `HostileKind` gains `'index-out-of-range'` and `'joint-out-of-range'` | W4-5 tests; the template itself is validator-clean, so each kind plants exactly one defect. |

## Contract addition inside `io` (requested spec change)

- **`EkzaBakeMarkerV1.generatorAdded?: true`** (§4.4). §4.11.11 rule 8 says `asset.generator` is set only if
  absent; the rollback test says "bake then rollback only → JSON value equal to the source except `asset.extras`".
  Seed-san has no generator, so both cannot hold unless the marker remembers that the generator was ours. The
  surgeon writes `generatorAdded: true` on the first bake of a generator-less file, writes its generator
  (`Ekza Animator <toolVersion>`, placed right after `version`) whenever it bakes clips, and removes it on rollback.
  The key is absent for files that had a generator, so their marker matches the spec shape exactly. Spec change:
  add the optional field to §4.4 and "the generator the surgeon added" to the preservation exceptions of §4.11.13.

## Interpretations and deviations (proposed DECISIONS-OPEN entries)

| # | What | Why |
|---|---|---|
| W4-1 | **`ekza.unique-names` is a warning locally, an error under Ekza profiles** (MVP-SPEC §4.11.13), not error/error as the ADR 0010 table says. | The spec text is explicit and newer; the writers already throw `unsupported` on duplicate names among the exported clips, so a local hit can only come from the model's own animations, which the user cannot fix in the Animator — an error would block the download. ADR 0010's table should be updated. |
| W4-2 | Size lint code is `source_too_large` for every kind (the ADR row lists `source_too_large` / `rendition_too_large`). | Exports are what a user would upload as a source; one code keeps profiles simple. Change the code in `src/lint/lintExport.ts` if the registry maps animator outputs to renditions. |
| W4-3 | Without a profile, `ekza.json-chunk-size` uses 4 MiB (the OMOBA limit, warning); > 8 MiB is always an error. `ekza.provenance-unknown` also fires (once) when a file carries no `ekza_animation_v1` at all. `rendition_external_data` reports at most 20 `uri` keys. | ADR 0010 table; bounded output on hostile inputs. |
| W4-4 | Lint scope: slot-name and unit-quaternion rules apply to the animations listed in `ekza_animation_v1` (ours); unique-names, hips-only translation, required clips and the `vrma.*` rules look at every animation. | A surgeon output keeps the model's own animations (e.g. UAL's `Idle_Loop`), which must not fail slot-name lints. |
| W4-5 | `checkInputBudget` structural extras: index values of mesh primitives must be below the POSITION count and `JOINTS_n` values below the joint count of every skin the mesh is bound with (glTF-Validator `ACCESSOR_INDEX_OOB` / `ACCESSOR_JOINTS_INDEX_OOB`). Values are read in place from the BIN chunk, only when no budget is exceeded, and only for plain (not sparse, not meshopt) accessors. Other deviations: chunk misalignment, extra BIN chunks and a BIN chunk more than 3 bytes longer than `buffers[0]` are warnings; buffers with `data:` URIs and meshopt fallback buffers are accepted; at most 200 issues are listed. | §4.11.14 "mesh indices and skin joint indices in range"; ARCHITECTURE §16 "sparse and index ranges". |
| W4-6 | `parseGlb` refuses JSON chunks above 64 MiB with `budget-exceeded` before `JSON.parse` (the 8 MiB JSON budget itself is `checkInputBudget`'s). It tolerates NUL padding and a BOM in the JSON chunk, skips unknown chunks and uses the first BIN chunk. | Bounds the parse of hostile files; real exporters' quirks. |
| W4-7 | `detectModelFormat` classifies by the root extension **objects** (`VRM`, `VRMC_vrm`), not `extensionsUsed`. | A file listing `VRMC_vrm` without the object has no humanoid to read. |
| W4-8 | `readVrmLicense`: VRM 0.x `licenseName` maps to SPDX-like ids (`CC_BY` → `CC-BY-4.0`, …, `Redistribution_Prohibited` → `proprietary`, `Other` → `unknown`); CC licences allow redistribution, `*_ND` forbid modification. VRM 1.0 `licenseName` is `LicenseRef-VRM-PL-1.0` for a `vrm.dev/licenses/1.0` URL, else null. | `VrmLicenseInfo.licenseName` is "SPDX-like"; VRM 1.0 carries only the licence URL. |
| W4-9 | Bone radii fallbacks (so every skinned joint of a readable mesh has a value): dominant-weight (≥ 0.5) vertices first; joints that dominate none use vertices they influence with weight ≥ 0.1; joints with neither inherit the nearest measured ancestor. Vertices are placed with their dominant joint's skinning matrix. Segment end = the humanoid primary child (e.g. hand → middle proximal), else the first joint child. `height` = skinned bind-pose Y extent; joint fallback = (highest − lowest joint) × 1.15. Any meshopt/Draco skinned primitive makes all radii null. | §4.3 says "1.25 × P90 … null when unknown"; fingers and end joints often dominate no vertex. |
| W4-10 | `readAnimations` repairs instead of rejecting: keys whose time does not increase (or is not finite) are dropped with their values; outputs shorter than `input × components` are truncated; morph-weight component counts are inferred from the output length. Skipped channels are reported in `RawClip.skipped`. Unnamed animations are called `animation_<index>`. | Convention 6 (repair, never reject, where safe). |
| W4-11 | `readVrma` accepts `specVersion` `"1.0-draft"` (warning) and a missing `specVersion` (warning, read as 1.0); other versions throw `unsupported`. Only the first animation is read (warning if more). Bone rest rotations are the decomposed rotation of the world matrix (three-vrm-animation uses `setFromRotationMatrix`, identical for unscaled rests). CUBICSPLINE tangents are mapped with the same linear maps (hips tangents without translation). Eye, scale, non-hips translation, expression and lookAt channels are ignored with warnings. | §4.11.7; three-vrm-animation 3.5.5 behaviour. |
| W4-12 | `bakeClip` details: translation/scale of a raw track is written only when it leaves the rest local by > 1e-6 (hips translation always, required tracks always); humanoid bones never get scale; constant = every component within 1e-7 of the first sample; `bake.large-rotation-step` is reported once per track (first offending pair). Sub-frame STEP schedule times are evaluated on demand. Invalid options throw `unsupported`. | §4.11.10 leaves thresholds open. |
| W4-13 | Surgeon details: `surgeon.no-rollback` names the reason (BIN bytes changed, arrays shorter than the baseline, a foreign marker with a later baseline, a stale `replaced` index); `replaced` entries are kept after a rollback even if the next bake does not replace that animation again (restoring an equal value is harmless, and "written once" holds); `ekza_animation_v1` in a surgeon output describes only the animator's clips (kept entries of an earlier non-rolled-back bake stay). Re-baking with **zero clips** is the rollback-only operation (`stats.bytesAppended: 0`). | §4.11.11 rules 5–7. |
| W4-14 | "Output is a `Blob`-style concatenation (no copy of large originals)": `ExportArtifact.bytes` is a `Uint8Array`, so the original BIN prefix is copied **exactly once**, into the output buffer; nothing else copies it. | Contract type. A `Blob` output would need an `ExportArtifact` change (V1 if memory matters for 100 MB avatars). |
| W4-15 | VRMA writer: the identity root above hips is a node named `root`; bones whose rest position is missing from `humanoidRestWorld` are left out (hips is required, else `unsupported`); tracks VRMA cannot hold (scale, non-hips translation, absent bones) are dropped with `vrma.skipped-track` (warning). | §4.11.12. |
| W4-16 | `ExportArtifact.validation` is `null` from every writer (the validator runs in tests and, as stretch, in the app worker). | §4.4 comment. |
| W4-17 | `.ekzanim`: entries are written in a fixed order (`manifest.json`, `project.json`, assets by id) with DOS time 1980-01-01 00:00 and `os/attrs` 0; JSON is deflated (level 6), models are stored; the manifest is pretty-printed. Opening: entries above the limits (manifest 1 MiB, project 64 MiB, asset 256 MiB, total 1 GiB) are refused before inflating (`budget-exceeded`), unknown entries are ignored without inflating, a corrupt archive or a non-project file is `unsupported`, a listed asset that is missing or does not match its size/hash is `asset-missing`/`asset-corrupt`, an asset the snapshot does not describe gets a record derived from the manifest. The JSON variant is recognised by its first non-blank byte `{`. | ADR 0011. |
| W4-18 | `CompressedDataError` (internal) uses code `unsupported` with `details.compressed: true`; `readAnimations` maps compressed animation data to `compressed-animation` before reading anything; `skeletonFromGltf` turns it into null radii. | Mesh compression is legal for display; only animation data must be editable. |
| W4-19 | `io/three` imports three's `meshopt_decoder.module.js` statically (it is plain JS, no WASM file to host); Draco and KTX2 use `decoderPath` + `draco/gltf/` and `basis/` (the layout of `apps/web/scripts/copy-assets.mjs`). Loading a file that uses `KHR_texture_basisu` before `setRenderer()` throws `unsupported`. The public copy of `meshopt_decoder.module.js` is therefore unused by io. | ARCHITECTURE §16 (self-hosted decoders). |

## Dependencies on other work packages

| WP | What waits | Status |
|---|---|---|
| WP-2 | `test/project.test.ts` "snapshot round trip" block (4 tests) runs when `serializeSnapshot`/`parseSnapshot`/`migrateSnapshot` exist (`describe.skipIf`). | Verified locally by overlaying `wp/wp-2` @ `073c92a` `packages/doc/src` (not committed): **10/10 project tests pass**. |
| WP-3 | `packages/headless-tests/test/io.export-pipeline.test.ts` (6 tests: surgeon/animation-only/VRMA on the real kernel, zero pose = rest, hips rest cross-check `readVrma` vs `bakeClip`) runs when `autoRig`/`compileRig` exist. | Verified locally by overlaying `wp/wp-3` @ `434cde2` `packages/rig/src` (not committed): **6/6 pass**. |
| WP-3 | §4.11.7 "a Polybot-sourced VRMA imported on Seed-san compared on world bone directions (< 1e-3 rad)" needs `importHumanoidClip` + curve evaluation; it belongs with WP-3's `rig.*` headless tests. io covers the reader side (goldens, three-vrm-animation parity) and VRMAs written from both Polybot and Seed-san playing on both targets (`test/vrma-playback.test.ts`). | Hand-off. |

## Hand-offs

- **WP-7b (`file.importModel`)**: `parseGlb` → `checkInputBudget` (abort on any `error`) → `detectModelFormat` →
  `skeletonFromGltf` (check `skeleton.nodes.some(n => n.isJoint)` for `no-skin`) → `readAnimations` (catch
  `compressed-animation`) → `importProvenance(readVrmLicense(c), { sourceSha256: c.sha256, names: [clip and node names] })`.
  VRMA: `inspectVrma(c)` for data + warnings.
- **WP-7b (`file.export`)**: `requiredTracks` for a surgeon bake = the clips' own tracks ∪
  `preexistingTracks(original, skeleton, clipNames)`; `writeVrma`'s `humanoidRestWorld` =
  `rig.humanoidRestWorldPositions(skeleton)` (cross-checked against io's rest worlds in the headless test);
  `exportFileName(pattern, tokens, ext)` with `.vrm`/`.glb`/`.vrma`; `clipExportName(clip)` for `BakeOptions.name`;
  errors in `artifact.lints` block the download. Duplicate export names throw `unsupported` (poll should prevent it).
- **WP-8**: `createThreeModelLoader({ decoderPath: '/decoders/' })`, `setRenderer(gl)` before the first load.
- **Integration (DECISIONS-OPEN)**: W4-1 (ADR 0010 table), the `generatorAdded` marker field, W4-2.

## M1-stretch (done)

| Item | Where | Notes |
|---|---|---|
| In-app glTF-Validator worker | `src/worker/index.ts` (`@ekza-studio/io/worker`), `test/worker.test.ts` | Protocol only, as ARCHITECTURE §3 keeps `gltf-validator` out of io: `serveGltfValidator(endpoint, module)` (worker side) and `createValidatorClient(endpoint)` → `{ validate(bytes, opts?), dispose() }` (main thread). Endpoints are structural (`postMessage(message, transfer)`, `add/removeEventListener('message')`): a DOM `Worker`/`MessagePort` and a `DedicatedWorkerGlobalScope` type-check against it. The client transfers a copy (the download keeps its bytes); requests match by id; validator failures reject with `EkzaError(code)` (`internal` for non-Ekza errors); `dispose()` rejects pending calls with `unsupported`. **WP-8 hand-off**: `packages/editor/src/workers/index.ts` → `serveGltfValidator(self, await import('gltf-validator'))`; `createBrowserServices({ createValidatorWorker })` → `createValidatorClient(worker)`; the export dialog can then show `compareValidation(await client.validate(source), await client.validate(artifact.bytes))` for surgeon outputs and `report.errors` for fresh writers. |
| Bevy lints (`bevy.*`) | `src/lint/lintExport.ts` (`checkBevyPaths`), `src/lint/rules.ts` | `bevy.unnamed-path-node` (a node that is animated or above an animated node has no name) and `bevy.duplicate-sibling-name` (a node on an animated path shares its name with a sibling; scene roots are siblings), warning/warning, at most 20 each; not run for VRMA. The fixtures produce none. |
| Animation-only GLB import onto a character (FR-IO-10) | — | io's part already works (`skeletonFromGltf` + `readAnimations` on an animation-only GLB); the name remapping is WP-3's `remapRawClipByName`. |

## Gates (worktree, 2026-10-17)

`pnpm run format:check`, `lint`, `typecheck`, `check:deps`, `check:fixtures`, `check:licenses`, `test` (all
packages; io 138 tests, 4 skipped on WP-2; headless io file skipped on WP-3) and
`node tooling/make-compressed-fixture.mjs --check` pass. io has no e2e spec of its own and touches no UI package.
