# M6b C10 — character writer: build notes

Branch `m6b/character-writer` (from `m6b/mvp` at `22b0e11`, `m6b/character-runtime` merged in). Scope:
[M6B-SPEC §9.0 C10](../M6B-SPEC.md#c10--character-writer) — §5.22 as corrected by §0.4.6 and §0.4.8: the VRM 1.0
writer, the `vrm.*` lints that mirror OMOBA's runtime admission, the model-character profile routing, the Export dialog
Character section, the VRM Meta dialog, `char.setVrmMeta`, `char.renderThumbnail`, `file.exportCharacter`,
`/e2e/character-check` and the OMOBA validator runner. Decision IDs below are `M6B-C10-<n>`. READY flag `c10` is set in
io, editor-core, rig and mesh-core.

## What landed

| Item | Where |
|---|---|
| `vrm.*` lints: OMOBA's `HumanoidRig::from_glb` check for check (VRM 0.x and 1.0 by the file), every rule reported, OMOBA's messages; the VRM 1.0 meta rows | `io/src/lint/vrm.ts`; the rows in `io/src/lint/rules.ts` (`VRM_RULE_IDS`); one call in `io/src/lint/lintExport.ts` |
| Space profile: label "Ekza avatar — Space and OMOBA (VRM 1.0)", `jsonMaxBytes` 4 MiB, the `vrm.*` overrides (errors; thumbnail a warning) | `io/src/profiles/builtin.ts` |
| Model-character routing (Space = VRM 1.0 only, `local/generic` VRM or GLB, `ekza/omoba-humanoid-v1` not offered), the banner text | `io/src/profiles/character.ts` |
| `VRMC_vrm` 1.0 as a glTF Transform extension (humanoid, meta in schema order, thumbnail image) | `io/src/vrm/extension.ts` |
| Licence presets (CC0, CC BY 4.0, Personal, Custom), `patchVrmMeta`, `vrmcMetaOf`, `thirdPartyLicenses` from provenance | `io/src/vrm/meta.ts` |
| Thumbnail renderer (software, 1024² PNG, front three-quarter, palette colours) | `io/src/vrm/thumbnail.ts` |
| Full writer: VRMC_vrm class, meta, thumbnail, swatch shaders (Blinn → `KHR_materials_specular`, used only), palette texture forced for VRM, clips + `ekza_animation_v1`, weights renormalized after rounding | `io/src/character/index.ts`, `io/src/character/vertices.ts` (`primitivesOf` shader groups, `forcePalette`) |
| `exportCharacterArtifact` (write, lint, read-back on the joint subset, tris, clips; kind `character`) | `io/src/character/artifact.ts` (also behind `io/write`) |
| `char.setVrmMeta`, `char.renderThumbnail`, `file.exportCharacter` | `editor-core/src/operators/builtin/rig/export.ts` |
| The export pipeline (request defaults, checks, fresh `skeletonFromDoc`, palettes with shaders, slot clips through the kernel, gating rows, glTF-Validator, three.js read-back), the thumbnail asset | `editor-core/src/workflows/exportCharacter.ts` (+ six names exported from `editor-core/src/index.ts`) |
| Export dialog Character section; host-agnostic `VrmMetaFields`, `CharacterChecks`, `ThumbnailPreview` (CR-AR-1) | `editor/src/dialogs/export/character/**`; the Character mode in `editor/src/dialogs/ExportDialog.tsx` |
| VRM Meta dialog | `editor/src/dialogs/VrmMetaDialog.tsx` (its loader line in `DialogHost.tsx`, `'vrmMeta'` in `shell/operators.ts` `UI_DIALOGS`) |
| Rig Toolkit Character section (Attributes › Character, CR-5 fallback) | `editor/src/panels/rigToolkit/sections/character/index.tsx` |
| `lastExport()` records `file.exportCharacter` | one condition in `editor/src/shell/createShell.ts` |
| `/e2e/character-check` (three-vrm load, raw bones, a VRMA idle, the embedded clip, thumbnail size) | `apps/web/app/e2e/character-check/**` |
| OMOBA validator runner | `tooling/omoba-validate.mjs` (+ `tooling/test/omoba-validate.test.mjs`) |
| Tests | `io/test/m6b-vrm-lints/**`, `io/test/m6b/character-writer/**`, `editor-core/test/m6b/character-writer.test.ts`, `editor/test/m6b-character-writer.test.tsx`, `headless-tests/test/m6b.writer.*`, `apps/web/e2e/m6b-skin-05-vrm-export.spec.ts`, `apps/web/e2e/m6b-skin-06-plain-glb-local.spec.ts`, `apps/web/e2e/bench/m6b-export.bench.ts`; the C10 rows of `editor-core/test/m6b/{foundation,keys-hash}.test.ts` and `apps/web/e2e/m6b-00-foundation.spec.ts` |

## DoD checks (§9.0 C10)

| Gate | Test | Result |
|---|---|---|
| One failing fixture per `vrm.*` rule (16 runtime + 3 meta), each failing only its rule, OMOBA's message | `io/test/m6b-vrm-lints/rules.test.ts` | pass |
| The lints agree with OMOBA's own validator | Polybot (VRM 0.x) clean; Seed-san fails `vrm.uniform-scale` at node 6 exactly as `cargo run … validate-runtime-vrm` does (M6B-C10-2); the written body, Cube Lad and Polybot VRMs pass both | pass |
| P-W1 read-back (joint subset: names, parents, rest locals 1e-6, humanoid by name, `jointsFingerprint`, radii 1e-4 H; tris; joints) on the generated body (smooth, segmented), the Cube Lad, Polybot (unskinned T-pose) and a Seed-san records copy | `io/test/m6b/character-writer/writer.test.ts`; in the app `headless-tests/test/m6b.writer.test.ts` | pass |
| glTF-Validator and `vrm-validator` 0 errors (body, Cube Lad, Polybot; with clips, thumbnail and Blinn) | io and headless tests (the vrm-validator is checked live: a meta without authors is reported) | pass |
| P-W2 determinism: twice, and after `.ekzanim` save/reopen (VRM and GLB) | `headless-tests/test/m6b.writer.test.ts`; gated E2E-SKIN-05 | pass |
| Shipped `ops.export.test.ts` unchanged and green; the VRM 0.x `polybot.vrm` Space bake has no `vrm.*` row | headless suite; `m6b.writer.test.ts` | pass |
| Blinn used-only (`KHR_materials_specular` in `extensionsUsed`, never required) | io, headless, gated E2E-SKIN-05 | pass |
| Export bench (report-only) | `headless-tests/test/m6b.writer.bench.test.ts`: Polybot 2,130 tris, 34 joints, 5 clips × 60 frames, validator off → median **35 ms** (budget 500 ms); the browser twin `e2e/bench/m6b-export.bench.ts` is gated c2, c4 | report |
| OMOBA's `validate-runtime-vrm` on our files | `node tooling/omoba-validate.mjs …`: the io-written Cube Lad, body and Polybot VRMs and the UI-exported bound Cube Lad (integration check below): "Compatible local humanoid: VRM 1.0, 35 nodes, 33 semantic bones, 2 scene-0 roots" | pass |
| E2E-SKIN-05, E2E-SKIN-06 | ungated parts pass; the gated parts are `test.fixme('… (gates: c2, c4, c7)')` and pass on an integration build (below) | pass |

**Integration check of the gated scenarios** (local only, not committed): a throwaway branch of this one with
`m6b/skeleton-kernel`, `m6b/auto-skin` and `m6b/rig-shell` merged (C4's skin service wired into C7's
`rig/chunk/services.ts`, which `-X theirs` had replaced with C7's stub) ran the un-fixme'd E2E-SKIN-05 and E2E-SKIN-06:
both green — the bound Cube Lad (template + one-click bind, Blinn, CC0, thumbnail, idle slot clip) exports with every
`vrm.*` lint clean and glTF-Validator 0 errors, three-vrm resolves every bone and plays a VRMA idle, the thumbnail is
1024 × 1024, three exports (twice, then after save and reload) are byte-identical; `vrm-validator` 0 errors 0 warnings
and OMOBA's validator accepts that file. The two findings of that run are fixed here (the Rig Toolkit's thumbnail test
ids; the check route's thumbnail size).

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6B-C10-1 | **When the `vrm.*` rows run**: on a non-VRMA, non-static export whose file declares `VRM`/`VRMC_vrm` **and has a profile**, and on every file of a profile that lists them (the Space profile: a plain GLB fails `vrm.spec-version`). An export **without** a profile keeps M1's "generic lints only" (no `vrm.*`). Severities: runtime rows `local: 'warning'`, `ekza: null` (absent for `ekza/omoba-humanoid-v1`, `vrma-humanoid-v1`, handheld); meta rows `local: null`; the Space profile overrides all to errors (thumbnail a warning). | §0.4.6 "errors for the Ekza profile, warnings for `local/generic` VRM, absent for plain GLB"; the shipped M1 bakes without a profile keep their lint sets. |
| M6B-C10-2 | **Seed-san is not OMOBA-admissible**: nodes 6, 9, 46, 55, 58, 59, 69 carry non-uniform scales (e.g. `[0.99975, 1, 0.99968]`); OMOBA's current source rejects it ("VRM node 6 requires positive uniform scale…") — the prebuilt `target/debug/validate-runtime-vrm` in the checkout predated that rule and accepted it, `cargo run` rebuilt and rejected it. The lint test asserts that verdict. `omoba-validate.mjs` always goes through `cargo run` for this reason. | Mirror check for check; never trust a stale binary. |
| M6B-C10-3 | **The thumbnail is rendered in software** (`io/src/vrm/thumbnail.ts`), not from the persp pane: flat-shaded palette colours, front three-quarter view, 2 × 2 supersampling, io's deterministic PNG writer. Same pixels on every machine, in Node tests and in the browser, with no WebGL context and no port from the viewport into editor-core (no contract for one exists; editor-core may not import viewport). `viewport/src/thumbnail/**` stays empty. The PNG is stored as a `role: 'thumbnail'` asset by hash; a re-render of the same records is the same asset id. | §5.22 "exports read the stored bytes, so re-exports are byte-identical on any GPU" holds either way; this way the render itself is deterministic too. |
| M6B-C10-4 | **The VRM meta rows are computed twice on purpose**: from the record by `characterExportRows` (`vrm.meta-required`, `vrm.licence-unset` — a preset choice the bytes cannot show — and `vrm.thumbnail-square`), and from the written bytes by `lint/vrm.ts` (VRM 1.0 meta only: asset bakes keep the asset's VRM 0.x meta value-equal, so it is not judged). The export lists one row per code (the record row wins); C7's Validation rows join after, deduplicated by code. M6a's three skin lints never appear in a character export (C7's `skin.*` rows are the one source). | §5.21 "one row, one severity". |
| M6B-C10-5 | **`file.exportCharacter` takes a partial request**: defaults are the Rig & Skin / active / first model character, `ekza/space-avatar-v1`, the profile's first format (VRM), clips `'slots'`, the stored thumbnail for VRM, `validate: true`, the character name as the file name (sanitized by `exportFileName`). Test clips are never exported (refused when listed). Root motion `in-place` without a node exports as `hips` (as `file.export`). M2a's reduction follows the export preference. The export bakes the clips with the character runtime's program and refuses if its skeleton fingerprint differs from the fresh `skeletonFromDoc` (a stale runtime). | §6.4 + the test API's `run('file.exportCharacter', {format, profile, clips})` rows of §10.1. |
| M6B-C10-6 | **`writeCharacter(input, opts)` gains optional `opts.animationMeta` (`ekza_animation_v1`) and `opts.derivedFrom`** (for `thirdPartyLicenses`); `CharacterWriteInput.palettes` entries may carry `StaticSwatch.shader` (structurally compatible). No contract type changed. With `format: 'vrm'` and `vrm: null` the writer keeps C1's behaviour (humanoid, no meta) — the lints then report the meta rows. | §4.4 types are closed; additive options. |
| M6B-C10-7 | **Read-back on a plain GLB** compares names, parents, rest locals, `jointsFingerprint`, tris and joints, but not the humanoid map (`humanoidEqual: null`) nor the radii: without a humanoid map the reader cannot know the chain children that end the arm/spine/hand segments. | §5.22's equalities are defined against `skeletonFromGltf`, which measures a plain GLB differently. |
| M6B-C10-8 | **Weights renormalized after the float32 rounding** in the writer (residual into the largest weight; all-zero vertices stay zero); the argmax never changes, so the radii equalities hold. | §5.22 "WEIGHTS_0 float32 renormalized after rounding with the residual in the largest weight". |
| M6B-C10-9 | **The Export dialog's Character mode** is a third "What to export" choice shown when a model-sourced character exists, and the default in Rig & Skin or while such a character is active (`export-mode-character`). The section's root is `export-character` (§8.15). Profiles listed: only the two of §0.4.6; Format is disabled for the Space profile (VRM 1.0 only). Include props shows checked and disabled ("none in this character", no Attach Prop in the MVP). | §8.13, §0.3 (props deferred). |
| M6B-C10-10 | **The `vrm.*` rows in `rules.ts` are a compact list** (ids built from one string, description "See lint/vrm.ts"); the full descriptions are `VRM_LINT_RULES` in `lint/vrm.ts`, which stays off the editor route. The first build imported `vrm.ts` from `rules.ts`/`builtin.ts` and pulled the whole check module into the eager route (+5.4 kB). | §0.4.9: C10's eager allowance is 0 B. |
| M6B-C10-11 | **`/e2e/character-check`** checks bytes passed by the spec: three-vrm (`VRMLoaderPlugin`) load, `getRawBoneNode` for every mapped bone, a VRMA idle (the bytes the caller passes, else a built-in two-key idle on the arms and spine built as a `VRMAnimation`) on the normalized humanoid, the first embedded clip on the raw bones, the skinned meshes' triangles and joints, and the thumbnail size read from the file (three-vrm loads the image only on request). The spec refers to `/e2e/vrma-check` for the VRMA idle; that route plays on the bundled samples, not on a given file, so C10's route does both. | §5.22 read-back list; E2E-SKIN-05. |
| M6B-C10-12 | **`vrm-validator` runs in io and headless tests only** (its dev dependency lives there, §2.1); the e2e validates with glTF-Validator in Node and three-vrm in the page. | apps/web has no `vrm-validator` dependency (manifests are the integration agent's). |

## Shared-file touches (INT to approve)

- `io/src/lint/lintExport.ts` (one call), `io/src/lint/rules.ts` (the `vrm.*` rows: C10's per §9.0), `io/src/index.ts`
  and `io/src/write.ts` (export lines).
- `io/test/lint.test.ts`: the shipped "clean file" assertion under the Space profile — a three-bone VRM with no meta,
  which OMOBA does not admit — now asserts that every non-`vrm.*` rule stays clean and that `vrm.required-bones` fires
  (§0.4.6 makes the Space profile OMOBA's admission). `io/test/m6b/contracts.test.ts`: the C0 "VRM_LINT_RULES is empty
  until C10" row now asserts the landed rows.
- `editor-core/src/index.ts` (six names), `editor-core/test/m6b/{foundation,keys-hash}.test.ts` (C10 rows),
  `*/test/m6b-ready.ts` (`c10: true`).
- `editor/src/dialogs/ExportDialog.tsx` (the Character mode), `editor/src/dialogs/DialogHost.tsx` (the `vrmMeta` line
  C0 reserved), `editor/src/shell/operators.ts` (`'vrmMeta'` in `UI_DIALOGS`; C0 added no M6b dialog there — C4/C6/C7
  will need the same for theirs), `editor/src/shell/createShell.ts` (`lastExport()` records `file.exportCharacter`).
- `apps/web/e2e/m6b-00-foundation.spec.ts`: the `LANDED` map (as C2/C4 did) with the C10 reasons.
- `tooling/test/omoba-validate.test.mjs` (new; tooling is the integration agent's).

Expected merge conflicts at INT: the `m6b-ready.ts` flags, the `LANDED` maps of the foundation tests, the P-C6 rows,
`editor-core/src/index.ts` export blocks, `UI_DIALOGS`.

## Eager size (§0.4.9)

`check:size` on this branch: **891,741 B** (gate 900,000 B); C1 measured 891,480 B on the same base, so C10 adds
**+261 B** (the `vrm.*` row list and the profile label/overrides in `rules.ts`/`builtin.ts`, which the eager profile
registry needs). C10's allowance is 0 B: INT to approve the 261 B from the MVP headroom (the MVP delta is now +2,172 B
of +6,144 B). Lazy: the export path chunk grows 76.6 → 82.5 kB (writer, lints, thumbnail); the dialog chunk carries the
Character section; the character-runtime chunk 14.4 kB.

## Handoffs

- **C7**: E2E-RIG-08's gated row expects Export enabled right after the `skel.required-bones` Fix on an **unbound**
  body without VRM meta. With §5.21's rows the Ekza profile still has errors there (`skin.unbound`,
  `vrm.meta-required`, `vrm.licence-unset`), so the Character section keeps Export disabled — the row needs a bind and
  `char.setVrmMeta {patch: {authors, licensePreset: 'cc0'}}` first (found on the integration build). The File menu's
  VRM Meta… and Render Thumbnail items run `char.setVrmMeta` without a patch (opens the dialog) and
  `char.renderThumbnail` without args (the Rig & Skin character).
- **C4/C6/C7**: their dialogs (`unbindSkin`, `rebindSkin`, `applyPoseAsRest`) must be added to `UI_DIALOGS` like
  `vrmMeta`, or `ui.open` refuses them ("Unknown dialog").
- **INT**: E2E-MVP-01 step 11/12 can reuse `helpers/m6b-character-writer.ts` (`exportCharacterFile`, `checkCharacter`)
  and `node tooling/omoba-validate.mjs test-results/m6b-mvp/cube-lad.vrm`; un-fixme E2E-SKIN-05/06 and the bench once
  c2, c4, c7 have merged.

## Gates (local, real Chrome GPU; port 3166)

`EKZA_E2E_PORT=3166 pnpm run ci` on `b19fcf4`+notes (the source of `81cdc0b`):

- format:check, lint, typecheck, check:deps, check:fixtures, check:licenses: pass.
- test (turbo, 15 packages): anim-core 671, doc 263, ui 94, doc-yjs 85, web 22, mesh-view 78, curve-editor 209
  (+3 skipped), io 312, viewport 244 (+1 skipped), editor-core 1360, mesh-core 905, editor 526 (+1 skipped), rig 242,
  headless 201, tooling (incl. omoba-validate): all pass. No skip added.
- build: pass. check:size: **891,738 B** (gate 900,000 B); MVP eager delta +2,169 B (C10 +258 B over C1's measure).
- test:e2e (project `chrome`): 222 passed, 25 skipped (the existing skips plus the C10 gated rows and the gated bench),
  **1 failed: `m2a-02-pole-twist-soft.spec.ts` "limbs() failed: Character 'Polybot' has no runtime yet"** — an M2a
  scenario C10 does not touch; it passed 3 of 3 alone right after (`--repeat-each 3`). A load-timing flake under the
  full parallel run (the C1 gate saw a similar one), not a C10 regression.
- My e2e alone: E2E-SKIN-05 and E2E-SKIN-06 ungated parts 4/4 pass; the gated parts pass on the integration build
  (above).
- The 3166 server was Playwright's own and stopped with each run; the port is free.
