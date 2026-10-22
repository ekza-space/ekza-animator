# Auto-Rig D6 — ⑤ Export: targets, checklist, metadata and the OMOBA local test kit: build notes

Branch `autorig/export` (from `autorig/mvp` at `04e2c54`, D3's `autorig/wizard-shell` merged at `5bac937`). Scope:
[AUTORIG-SPEC §10 D6](../AUTORIG-SPEC.md#d6--export) with §5.6 (targets, checklist, metadata, OMOBA kit, Publish to
Hub, Continue in Studio), §4.5's `autorig.export` row, FR-AR-07 and FR-AR-12. Decision IDs below are `AR-D6-<n>`. The
work package prompt named these notes `autorig-export.md`; the spec's D6 Dirs name `ar-export.md`, which this file
follows (as D0, D1 and D3 did).

## What shipped

| Part | Where |
|---|---|
| The OMOBA local test kit: `packOmobaKit({vrm, thumbnail, meta})` (`<slug>.glb` = the VRM bytes unchanged, `<slug>.png` stored, `manifest-entry.json`, `README.txt`), `omobaSlug`, `omobaLicense`, `omobaManifestEntry` / `omobaManifestJson` (OMOBA's field names and order), `omobaKitReadme` (validator command, the `OMOBA_AVATAR_MANIFEST` flow, "not approval"), the deterministic `zipFiles` (DOS-epoch times, no OS attributes, fixed order) and `unzipFiles`; one `export * from './omoba'` line in io's index | `io/src/omoba/{manifest,readme,kit,index}.ts`, `io/src/index.ts` |
| `autorig.export {character, target, fileName}`: every target through Studio's own export code — `ekza-vrm` / `glb` through `runExportCharacter` with the §5.6.1 requests (`blockingLints` refuse the save as `file.exportCharacter`'s `apply` does), `vrma` through the shipped `vrma` exporter with `file.export`'s read-back lint (one `.vrma`, or `<slug>-animations.zip`), `omoba-kit` = the VRM bytes packed by `packOmobaKit`; imported avatars bake through `file.export` kind `bake-into-model` (Space profile for VRM sources, `local/generic` for glTF ones); no undo step, no document change; busy line "Exporting the character…"; helpers `exportTargetProblem`, `availableTargets`, `characterRequest`, `fileExportRequest`, `characterClips`, `planExport` | `editor-core/src/operators/builtin/rig/wizard/export.ts` |
| ⑤ view (lazy chunk): over the pane the targets (one radio group; the kit under *For developers*), *Continue in Studio ▸* (the navigation port, `/editor?ws=animate`), and for a model character's VRM C10's `VrmMetaFields` + `ThumbnailPreview` (from `@ekza-studio/editor/bodies`, every edit one operator run); in the side panel the checklist, the last download's result line and the OMOBA / Hub / kit notes; the footer's *Download* | `autorig/src/steps/export/ExportStep.tsx` |
| The checklist (pure): fixed sentences per target over rule ids, worst severity of their rows, byte-only checks "checked when you download" until a file is written and then its measures; uncovered rows by the rule-label table, unknown ids by their own message; live rows supersede a download's | `autorig/src/steps/export/labels.ts`, `measure.ts`, strings in `autorig/src/i18n/en/export.ts` |
| ⑤'s own start (lazy, best effort): the thumbnail rendered on the first entry when none exists, the remembered author filled when none is set (one undo step each, once per character per wizard) | `autorig/src/steps/export/enter.ts`, `author.ts` |
| The `export` slice and its reducers (`chooseTarget`, `recordDownload`, `shownTarget`); the step module's lazy `stepView` / `stepEnter` | `autorig/src/steps/export/{slice,index}.ts` |
| Expected file names for the hints (`cube-lad.vrm · ready`, `2 clips → cube-lad-animations.zip`) and the Hub flag (off: the button is absent) | `autorig/src/steps/export/{files,hub}.ts` |
| Keys: none of ⑤'s own (radio group arrows, Tab, `Mod+Enter` = Download — the frame's row) | `autorig/src/keymap/steps/export.ts` |
| Tests: io kit (9), editor-core `autorig.export` headless (9: SHA-256 equal to `file.exportCharacter` / `file.export` per target, the kit headless, gates, polls, an imported VRM), autorig pure parts (11), E2E-AR-07 (7 + 1 fixme) | `io/test/ar-omoba/kit.test.ts`, `editor-core/test/autorig/export.test.ts`, `autorig/test/steps/export/export.test.ts`, `apps/web/e2e/ar-07-export-{vrm,targets}.spec.ts`, helpers `apps/web/e2e/helpers/{ar-export,omoba-kit}.ts` |

## Decisions

| ID | Decision | Why |
|---|---|---|
| AR-D6-1 | **`manifest-entry.json` writes `source_url: ""`, not `null`** (§5.6.4 says `null`) | OMOBA's `AvatarDefinition` (`omoba-bevy` `passport/src/avatars.rs`) declares `source_url: String` with no serde default: a `null` makes OMOBA's whole roster fail to deserialize. `author` and `thumbnail` are `Option<String>` and stay nullable. The builder takes an optional `sourceUrl` (the Hub path can pass its URL later) |
| AR-D6-2 | The kit's `license` is OMOBA's text for the VRM preset: `cc0` → `CC0` (the committed roster's spelling), `cc-by-4.0` → `CC-BY-4.0`, `personal` / `custom` / unset → descriptive text; an imported VRM's comes from `readVrmLicense` | the roster lists `CC0`; OMOBA reads the field as display text |
| AR-D6-3 | **File names**: `fileName: ''` means the slug of the avatar's name (`omobaSlug(vrm.name || character.name)`), so the wizard saves `cube-lad.vrm`, `cube-lad.glb`, `cube-lad-animations.zip`, `cube-lad-<clip>.vrma`, `cube-lad-omoba-kit.zip` (§5.6 mock, AS-AR-1 step 9's `polybot.vrm`); a given name keeps its base (extension stripped) | the FR-AR-12 comparison runs `file.exportCharacter` with the same request, `fileName: 'cube-lad'` included |
| AR-D6-4 | **Exportable clips** = live, non-test clips that hold motion: brought in (Use Clip, an import) or a new clip with curves — the rule D3's progress uses (AR-D3-2). An import's or a character's empty default clip (`clip1`, no curves) is not exported | without it an imported VRM always "had" a clip and its bake exported an empty animation; a VRMA of an empty clip is useless |
| AR-D6-5 | VRMA request = the Export dialog's defaults: every exportable clip in document order, pattern `<base>-{clip}`, `closeLoop` when every clip loops, constant tracks kept, no profile, the reduction preference (`prefs.exportReduce`) | "the shipped export pipeline, kind vrma" with what Studio would send; the e2e compares against `file.export` with the default preference |
| AR-D6-6 | **VRMA verified on a model-sourced character** (§5.6.1): the shipped exporter accepts C1's characters (humanoid runtime) and the bytes equal `file.export`'s, so the target is offered whenever the character has a clip; without one it is absent (§5.6.1 "a target that is not available is not shown") | Node test + E2E-AR-07 |
| AR-D6-7 | **Imported avatars** (AS-AR-4): `ekza-vrm` = `file.export` `bake-into-model` through `ekza/space-avatar-v1` (VRM sources), `glb` = the same through `local/generic` (glTF sources only; a VRM source has no plain-GLB target), `vrma` as above, `omoba-kit` from the baked VRM; every target needs a clip (the bake refuses none). No metadata section (the avatar keeps its own meta); the checklist waits for the written file | §5.6.1 "the targets are what Studio's Export dialog offers for them" |
| AR-D6-8 | Blocked saves: a target whose artifacts carry an error lint saves nothing (the VRMA zip and the kit as a whole) and toasts the first error, like `file.exportCharacter`; the result (artifacts, lints errors first) is returned either way | §5.6.2 "a blocking byte lint means no file and an error toast" |
| AR-D6-9 | The checklist is Auto-Rig's own sentences over `characterExportRows` (through `useCharacterRows`), not C10's `CharacterChecks` component | §5.6.2 asks for plain sentences keyed by rule id with an unknown-rule fallback; `CharacterChecks` prints codes |
| AR-D6-10 | Fixes: a Validation row's own `fix` (e.g. A0's *Straighten to T-Pose* on `skel.tpose`), *Render thumbnail* for `vrm.thumbnail-square`, and for `vrm.meta-required` / `vrm.licence-unset` a button that focuses the field beside the checklist ("Add author", "Choose licence") — not the row's `char.setVrmMeta` dialog Fix, whose Studio dialog duplicates the fields and whose message names Studio's menu | §5.6.3 puts the fields on the step |
| AR-D6-11 | **The remembered author** lives in `localStorage['ekza-studio:autorig:author:v1']` (written after a saved VRM/kit download; try/catch), not in `Prefs` | §5.6.3 says "(preference)", but `Prefs` is D0's closed contract (`editor-core/src/types.ts`); a per-viewer convenience fits browser storage |
| AR-D6-12 | The measured rows (file and JSON size against 50 MiB, nodes against 4,096, humanoid bones against 64) are computed by the step from the returned artifact (GLB header + JSON chunk, the read-back's humanoid count); they are dropped when the document changes after the download | `AutoRigExportResult` is D0's closed type; the bytes are in the artifact |
| AR-D6-13 | The expected file name shown before *Download* mirrors io's `omobaSlug` / `exportFileName` in `steps/export/files.ts` (Auto-Rig may not value-import io, §4.1); E2E-AR-07 asserts the hint equals the saved file's name | the operator stays the single source of the real name |
| AR-D6-14 | *Continue in Studio ▸* calls the host's navigation port directly (`{to: 'studio', workspace: 'animate', from: 'autorig'}`; a modified or middle click takes the new-tab flow), not `autorig.navigate` | §3.4: UI controls never route a navigation through the rig chunk |
| AR-D6-15 | ⑤'s entry conveniences (thumbnail, author) run once per character per wizard, best effort (a failure toasts and never fails the entry); an undo of either is respected | §5.6.3 "on first entry when none exists" |

## Findings for D7 / other owners

- **C10 writes palette textures only** (`io/src/character/index.ts`: `Materials.palette`), so an imported textured
  model's image texture (Polybot's) does **not** reach the VRM. AUTORIG-SPEC §6.1 calls that a C10 bug, not an
  Auto-Rig workaround. `ar-07-export-targets.spec.ts` keeps the texture assertions as `test.fixme('AS-AR-6 (⑤ part):
  the body's image texture reaches the VRM')`; the rest of AS-AR-6's ⑤ part (the body rigged without the sword exports a
  clean VRM, the sword stays a scene mesh) passes.
- OMOBA's validator admits the E2E-AR-07 exports (local run of `node tooling/omoba-validate.mjs`, prebuilt validator,
  no rebuild): `ar-07-cube-lad.vrm` and `ar-07-polybot-textured.vrm` → "Compatible local humanoid: VRM 1.0, 35 nodes,
  33 semantic bones, 2 scene-0 roots" (exit 0). Admission only (§11).
- The ⑤ header still shows the file name (`cube-lad.glb`) after a character exists when the session's subject has no
  character id yet (D3's `SubjectName` reads `session.subject.character`); D4's `autorig.rig` sets it. Not D6's.

## Outside the Dirs (shared files)

| File | Change | Why |
|---|---|---|
| `packages/editor-core/test/autorig/composition.test.ts` (D0/D3) | one `landed` row: `autorig.export` refuses with its own argument poll | D0's stub test lists the landed ids (as D1 and D3 did) |
| `apps/web/e2e/ar-00-foundation.spec.ts` (D0/D3) | the same row | same |
| `packages/autorig/src/shell/steps.ts` (D3) | `export: exportStep` without `as StepModule` | the module now has `stepView` / `stepEnter`, so the cast became an `oxlint` error (no-unnecessary-type-assertion) |

## Sizes

Production build, `check:size` (gzip -9), against D3's last measure on `autorig/wizard-shell` (= this branch's merge
base, `5bac937`):

| Route | D3 (`5bac937`) | D6 | Delta | Gate |
|---|---|---|---|---|
| `/editor` first visit (eager + First-run) | 896,390 B | **896,388 B** | −2 B (D6 allowance 0 B) | AR-B1 limit 897,736 B, enforced: eager delta +700 B ≤ 2,048 B, pass; 900,000 B gate pass |
| `/autorig` first visit | 669,088 B | **670,678 B** | +1,590 B | 660,000 B, reported only (`routes.autorig.enforce: false`; over since D3, AR-D3-G) |

- `/editor`: nothing of D6 is eager there. `autorig.export` and the io kit live in the `rig-workspace` chunk; io's new
  `export * from './omoba'` is tree-shaken out of `/editor`'s eager scripts (fflate stays in the project-archive and
  export-path chunks); `autorig-shell` stays absent from `/editor`.
- `/autorig`: the ⑤ view, the checklist, the measures, the entry conveniences and the bodies it uses
  (`VrmMetaFields`, `ThumbnailPreview`, `useCharacterRows`) are lazy chunks (`stepView`, `stepEnter`). The +1,590 B
  is almost all **⑤'s English string table**, which D0's design merges eagerly (`i18n/en/index.ts` imports every
  step's table; the frame calls `messages()` on the first visit). Located by marker search in the eager chunk ("Ready
  for OMOBA and Ekza Space", "Get your character" present; no ⑤ code). Trimmed once (rule labels only for the rows no
  check covers, unused keys removed: −264 B); the rest are the step's sentences. **For D7**: per-step lazy message
  tables (a `messages(section)` that loads `en/<step>.ts` with the step's chunk) would move ≈ 1.5 kB (⑤) plus D4's and
  D5's tables off the first visit; it needs D0's closed `i18n/` files.

## Gates

Run in this worktree on local Chrome (GPU), `EKZA_E2E_PORT=3167`, never the SwiftShader project, never `CI=1`:

- `EKZA_E2E_PORT=3167 pnpm run ci` (final run at `35214e9`): format:check, lint, typecheck, check:deps,
  check:fixtures, check:licenses, test (16/16 turbo tasks: io 9 new, editor-core 9 new, autorig 11 new; every earlier
  suite unchanged), clean build, check:size (above: `/editor` 896,388 B, AR-B1 delta +700 B, pass; `/autorig`
  670,678 B reported), test:e2e 287 passed / 25 skipped / **1 failed: E2E-RIG-01** (`m6b-rig-01-checklist.spec.ts`,
  the joint drag of Rig & Skin under suite load — not touched by D6; the previous run's lone failure was another such
  flake, E2E-M2A-23 "no runtime yet"). Both pass alone (targeted rerun with `ar-07`, `ar-00`: 15 passed, 1 skipped).
- Full e2e suite rerun on the same build (`pnpm run test:e2e`): **288 passed, 25 skipped, 0 failed** (the skips are
  the suite's existing `fixme`/conditional ones plus D6's AS-AR-6 texture `fixme`).
- E2E-AR-07: `ar-07-export-vrm.spec.ts` 3 passed, `ar-07-export-targets.spec.ts` 4 passed + 1 fixme.
- Local OMOBA admission (not in `ci`): `node tooling/omoba-validate.mjs` on the kept exports → exit 0, "Compatible
  local humanoid: VRM 1.0, 35 nodes, 33 semantic bones, 2 scene-0 roots" for the Cube Lad and the textured Polybot.
