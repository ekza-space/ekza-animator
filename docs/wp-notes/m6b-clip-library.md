# M6b C12 — Clip Library: CC0 starter pack as VRMA, manifest, panel, preview, Use Clip — build notes

Branch `m6b/clip-library` (from `m6b/mvp` at `22b0e11`, with `m6b/rig-contracts` merged). Scope:
[M6B-SPEC §9.0 C12](../M6B-SPEC.md#c12--clip-library-new) and [§0.4.7](../M6B-SPEC.md#047-c12--clip-library-new-package)
with the §0.5 contract. Decision IDs below are `M6B-C12-<n>`.

## What landed

| C12 item | Where |
|---|---|
| `UAL_BONE_MAP` (C0's data, own module), `parseStarterPackManifest`, `retargetUalClip`, `writeHumanoidVrma` | `packages/io/src/library/{boneMap,manifest,retarget,vrma,index}.ts` (one module each; the clip-library chunk loads only the manifest parser) |
| Retarget tests: bone map coverage (52 `DEF-*`), reference = identity (1e-6), determinism, hemisphere continuity, the three semantic tests, VRMA read-back (`inspectVrma`, no warnings, lint-clean), the three-vrm-animation playback golden on Seed-san (1e-4 rad) | `packages/io/test/m6b-library/retarget.test.ts`, golden `walk-frame-golden.json` (Walk_Loop frame 12, 24 bones + hips) |
| Manifest tests (the committed manifest parses to itself; 17 refusals naming their field) | `packages/io/test/m6b-library/manifest.test.ts` |
| Generator and check (one vitest file; `EKZA_WRITE_STARTER_PACK=1` writes), determinism, 4 MiB budget | `packages/io/test/m6b-library/starter-pack.gen.test.ts`, wrapper `tooling/make-starter-pack.mjs [--check]` |
| Committed outputs (16 files, 624 kB) | `apps/web/public/library/animations/{14 × <id>.vrma, starter-pack.json, LICENSE.md}` |
| Licence rows (repository-rooted, kept by the generator) and the `check-fixtures.mjs` extension with its cases | `fixtures/LICENSES.md` "Starter pack" rows; `tooling/check-fixtures.mjs` (`ROOTED_PREFIX`), `tooling/test/check-fixtures.test.mjs` |
| Credit on the third-party notices page | `apps/web/scripts/third-party-notices.mjs` (preamble line) |
| `ClipLibraryService` (manifest, verified bytes, session cache, checksum, preview, stop rules, frame driver) | `packages/editor-core/src/library/{service,convert,index}.ts` |
| The `preview` channel source | `packages/editor-core/src/evaluation/previewSource.ts` (registered through C0's `registerChannelSourceProvider`) |
| `library.open` / `.preview` / `.stop` / `.useClip` | `packages/editor-core/src/operators/builtin/library.ts` |
| Kernel tests on the production kernel and Seed-san; service tests on the naive kit; C0 literal updates | `packages/editor-core/test/m6b/{library,library-service}.test.ts`; `foundation.test.ts`, `keys-hash.test.ts` (P-C6 rows `checked`) |
| Panel body (host-agnostic, CR-AR-1 `ClipCardList`), panel, Rig Toolkit section, `PREVIEW <clip>` badge, view state | `packages/editor/src/panels/clipLibrary/{ClipCardList.tsx,index.tsx,badge.ts,state.ts}`, `panels/rigToolkit/sections/library/index.tsx` |
| Test API `library()` | `packages/editor/src/test-api/m6b/clip-library.ts` |
| Panel tests (browser) | `packages/editor/test/m6b-clip-library.test.tsx` |
| E2E-LIB-01, E2E-LIB-02, E2E-LIB-03 (gated `c1, c2, c3, c4, c7`) and helpers | `apps/web/e2e/m6b-lib-{01,02,03}-*.spec.ts`, `apps/web/e2e/helpers/m6b-clip-library.ts`; E2E-M6B-00 refuses `library.stop` instead of the stub's `library.open` |
| READY `c12` | `packages/{mesh-core,rig,io,editor-core}/test/m6b-ready.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6B-C12-1 | **The starter pack is resampled to 30 fps.** UAL's keys sit at **24 fps** (Walk_Loop: 33 keys over 4/3 s), not the 30 fps §0.4.7 assumes. Each clip is sampled at N + 1 uniform times, N = round(30 · d) for the source's last key time d: key k at k/30 s reads the source at k·d/N s. A clip whose length is not a whole number of 30 fps frames (Death01: 2.375 s → 71 frames) is time-scaled by less than half a frame, so its first and last keys stay the source's and a loop stays seamless. | The §0.5 contract fixes `StarterPackClip.fps: 30`; the shipped importer detects the clip's fps from the VRMA's key times, so a 24 fps file would import as a 24 fps clip and contradict its manifest. |
| M6B-C12-2 | **Constant tracks keep one key** (all keys within 1e-7 of the first) rather than being dropped. | "removing constant tracks" read literally would leave a bone without a track, which three-vrm-animation plays at its rest (identity) — wrong for a held non-identity pose. One key is the same reduction without that loss. |
| M6B-C12-3 | **The retarget reads the whole node hierarchy** (Rig → root (−90° about X) → DEF-hips …), with per-axis scale composed (the UAL clips animate scale ≈ 1); the yaw alignment comes out as the identity (the reference's left hand is at x > 0). Hips translation = A · the hips' world position (absolute, source metres), `restHipsPosition` = A · the reference's. | §0.4.7; the OMOBA script ignores scale, which is harmless here but the composition is exact. |
| M6B-C12-4 | **`writeHumanoidVrma(data, meta, restWorld?)`**: an optional third argument places the bone nodes (the generator passes the UAL reference turned by A, `ualRestWorld`); without it a bone sits 5 cm above its parent. `meta.sourceSha256` (optional) records the fixture's hash in `derivedFrom`. The animation is named `data.name` (the UAL source name); `ekza_animation_v1` carries `loop` by `/loop/i`, `fps`, `rootMotion: 'hips'`, `redistributable: 'yes'` for CC0, `slot: null` (Use Clip sets the slot from the manifest); `asset.generator` = `meta.generator`. | `HumanoidClipData` has no rest positions besides the hips; VRMA players read only rotations and the hips, but a file with a real rest skeleton is nicer to every other tool. Additive to the §0.5 signature. |
| M6B-C12-5 | **The generator also keeps the "Starter pack" rows of `fixtures/LICENSES.md`** (in write mode it rewrites that table; the check compares it). The rows include `starter-pack.json` and `LICENSE.md` (16 rows): the two-way rule says every file under the folder needs one. `check-fixtures.mjs` treats every file under `apps/web/public/library/` as licensed (the spec names `…/animations/`; the prefix rule and the file rule are now the same tree). | One source for the hashes; a stale row fails `pnpm run test` and `check:fixtures` alike. |
| M6B-C12-6 | **Preview = the Use Clip plan, never written.** `library.preview` runs `prepareVrmaImport` (the shipped import chunk, loaded by `loadImportPath()`), compiles the plan's curves with the app's curve engine and samples them per frame at clip frame `start + seconds · fps`; controls without a curve keep their defaults (C0's resolution resets the channels first). The plan's clip partition (opened by the import path, empty) is closed again. Side effects that are not document writes: the VRMA bytes go into the content-addressed asset store (the asset Use Clip writes anyway) and the plan consumes record ids from the id source. | §0.4.7 asks for `inspectVrma` + `importHumanoidClip` "with the same options as Use Clip"; the import chunk exports only the prepare/apply pipeline, and editing `workflows/importPath.ts` (no M6b owner) needs INT's approval. Running the very same pipeline makes preview = Use Clip by construction and keeps io's readers out of the clip-library chunk. |
| M6B-C12-7 | **The preview always loops** (the manifest's `loop` is shown, not obeyed), at its own clock (`performance.now()`), driven by a requestAnimationFrame loop while it plays; each frame bumps the provider's version and requests a frame. Node has no rAF: tests step it with their own clock (`ClipLibrary.stepPreview`, injectable `now`). | §0.2 step 10 "plays it in a loop". |
| M6B-C12-8 | **Stop rules as built**: C0's `onBeforeDocumentRun`; any store batch except a partition load that left the character in place; `session.workspace`, `session.activeCharacter` or `session.overrides` changing (the start of a transform drag or a Channel Box edit writes overrides); `app.rig.testPose.subscribe` when the rig chunk is loaded at preview start (a test pose needs it; entering Rig & Skin is a workspace switch anyway); Esc through a global `Escape → library.stop` binding contributed only while a preview plays (it shadows `edit.escape` for that time); Stop; the second click on the playing card (the panel's toggle; `library.preview` itself never toggles, so scripts stay predictable). A preview whose clip was still being read when a document run happened does not start (`documentRuns` guard). | §0.4.7 "Preview" (2)–(4). |
| M6B-C12-9 | **Use Clip**: `applyClipImport` (the clip activated) then one `tx.patch` of `{name: uniqueName(label), loop, slot (manifest's when no other clip holds it, else null), provenance}`. The provenance is the VRMA's `ekza_animation_v1` entry; a field it lacks (title, author, licence, source hash) is filled from the manifest and the asset id, `redistributable: 'yes'`. Undo label `Use Clip <label>`. | §0.4.7 "Use Clip"; one transaction, one asset (content-addressed). |
| M6B-C12-10 | **Checksum failures**: `bytes(clip)` checks size and SHA-256, marks the clip failed (sticky for the session), notifies, and rejects with `EkzaError('checksum', 'The file failed its checksum')`; the operators toast it once. A network failure is not sticky (the next call retries); a failed manifest load is retried by the next open. The panel keeps its own per-app view (`panels/clipLibrary/state.ts`: manifest status, failed clips recorded from the operators' results) because editor-core exports nothing of the lazy chunk; the test API's `library()` reads that view (null until the chunk and the manifest are in; the first call starts the load). | §0.4.7 "Serving"; `editor-core`'s root barrel is not C12's. |
| M6B-C12-11 | **The Rig Toolkit section is collapsed until opened** ("Show clips", `rtk-library-open`); the body is its own lazy chunk shared with the Animate panel. | Entering Rig & Skin must not load the clip-library chunk (E2E-M6B-00), and the manifest is fetched "on the first panel open". |
| M6B-C12-12 | **`library.open`**: shows `clipLibrary` in Animate, `rigToolkit` in Rig & Skin, through the shell's `workspace.showPanel` (skipped in a headless app), and starts the manifest load. | §0.4.7 "Placement". |
| M6B-C12-13 | **Empty states**: no active character → "Select a humanoid character (a VRM, or one you rigged here) to preview clips"; a generic character → "Clips need a humanoid character" (the operators' poll maps `animationTargetProblem`'s humanoid reason to it). | §0.4.7. |

## Deferred or not built

- **CR-AR-2** (SHOULD, §0.10): `params: ClipParams` / `replace` on preview and Use Clip and an in-memory `HumanoidClipData`
  preview source are not built; the fallback owner is D5 (it edits `library.ts`, `editor-core/src/library/**` and
  `evaluation/previewSource.ts`). `ClipPreviewSource.start` takes any `PreviewClip`, so (c) is a small step.
- E2E-LIB-03 is `test.fixme` until c1, c2, c3, c4 and c7 merge (§9.0); its body is written against the §0.6 ids.

## Budgets (§0.4.9)

Production build, `check:size` (gzip -9, first visit): **891,371 B** (gate 900,000 B). Against C0's recorded measure on
`m6b/mvp` (891,104 B) the **C12 eager delta is +267 B** (allowance 1,024 B): no eager module changed; the growth is the
turbopack runtime's chunk table (the new lazy chunks: the panel body and the section's split). Lazy groups: **clip
library 4.6 kB** (the `ekza-clip-library` boundary: service, operators, preview source, manifest parser; warning
threshold 60 kB), the panel UI a few kB more in its own group; io readers and glTF Transform stay in the import and
export chunks.

## Gates (local, real Chrome; port 3165)

Filled in at the end of the run (below).
