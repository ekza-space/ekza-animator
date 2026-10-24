# C2 — the hero package, the contract's lints and the timeline markers

Branch `feat/character-contract-package` from `dev` @ `e52ffd87` (worktree `_workspace/worktrees/animator/cc-c2`).
Specs: [CHARACTER-CONTRACT-SPEC](../CHARACTER-CONTRACT-SPEC.md) v0.2 (§4, §5, §8.4–§8.10, §8.14–§8.16, Appendix C/D),
[GAME-PROTOCOL-SPEC](../GAME-PROTOCOL-SPEC.md) (§5.2, §7.2, §7.5, Appendices B, C, E), [ADR 0024](../adr/0024-character-contract.md),
[ADR 0025](../adr/0025-game-protocol.md), [ADR 0010](../adr/0010-ekza-integration-tiers.md) rev. 3. Build decisions:
[DECISIONS-OPEN §Q.2](../DECISIONS-OPEN.md) `CC-C2-1…18`. Gate `EKZA_E2E_PORT=3171 pnpm run ci`, local Chrome.

## What landed

| Item | Where |
|---|---|
| `ekza.package.v1`: strict reader (every Appendix B check; a newer 1.x minor reads leniently), deterministic writer of a character package's manifest (every customizable slot of the offer once, offer order, sorted markers), the JSON key order of Appendix B | `packages/io/src/contract/packageManifest.ts` |
| The byte rules on a package (`pack.manifest` … `pack.bytes`, `pack.slot-known`, `pack.ref`, `pack.unreferenced`, `rig.humanoid`, every `clip.*`), measured values per slot, the gate verdict shape, `ekza.validation-report.v1` | `packages/io/src/contract/packageCheck.ts` |
| OMOBA's C0 contract bundled; its conformance fixtures (`c0fe23f`), copied and pinned; every package and reader case through the TypeScript rules and reader | `apps/web/public/contracts/omoba/`, `fixtures/contracts/omoba/v1/`, `tooling/sync-contract.mjs --fixtures`, `packages/io/test/contract/package.test.ts` |
| Profile `ekza/omoba-humanoid-v2` "OMOBA character (VRM 1.0 with your animations)" among the model-character profiles; `writeCharacter` embeds `asset.extras.ekza_package_v1` after `ekza_animation_v1` | `packages/io/src/profiles/{builtin,character}.ts`, `io/src/character/{index,artifact}.ts` |
| The developer zip (`<slug>-omoba-dev.zip`) | `packages/io/src/omoba/devZip.ts` |
| `EkzaClipMetaV1.label` and `.markers`, written only when set (M1 goldens unchanged); the import restores slot, contact, root motion, tags, label and named markers of Studio-written clips | `io/src/types.ts`, `io/src/bake/meta.ts`, `editor-core/src/workflows/{ekzaClipRestore,importAnimation}.ts` |
| Named markers in `ekza.clipMarkers`; the status checks every declared marker; issues carry their one-tap fix | `editor-core/src/workflows/target/{markers,status,service}.ts` |
| `target.slot.create`, `target.fix`, `target.marker.set`, `target.exportPackage` (one undo step each but the export) | `editor-core/src/operators/builtin/targetSetup.ts`, `operators/args.ts` rows |
| The package plan (clips, indices, markers, manifest, labels) and the byte lints `package.<rule>` | `editor-core/src/workflows/target/package.ts`; `workflows/exportCharacter.ts` (`clips: 'target'`) |
| Validation rows strict for the v2 profile, with fixes | `workflows/target/service.ts`, `rig/validation/index.ts` |
| Time slider: a lazy layer API on the controller and the contract layer (markers, limits, window bracket, lead-in band, ◆ drag) | `curve-editor/src/timeline/TimeSliderController.ts`, `editor/src/panels/timeline/{TimeSliderView.tsx,contractLayer.ts}` |
| Clip Settings: loop, root motion and slot *from contract · Unlock* | `editor/src/panels/clips/ClipSettingsForm.tsx` |
| Target panel: *New*, *Start from default*, *From library ▾*, *From file…* (all `target.slot.create`), each issue's fix (+ *Fit timing* next to a contact issue), *Export package*, *Developer zip* | `editor/src/panels/target/index.tsx` |
| Export dialog: the OMOBA profile (`clips: 'target'`, its banner, *Developer zip*) | `editor/src/dialogs/export/character/ExportCharacterSection.tsx` |
| Auto-Rig ⑤: target `omoba-hero` "OMOBA hero package · VRM 1.0" (the contract rows with their fixes gate *Download*); `omoba-kit` writes the developer zip for a bound model character | `editor-core/src/operators/builtin/rig/wizard/export.ts`, `autorig/src/steps/export/{ExportStep.tsx,files.ts}`, `autorig/src/i18n/en/export.ts` |
| The Studio-written package fixture for OMOBA | `fixtures/contracts/omoba-package/polybot-wildspark.vrm` |
| Tests | io `test/contract/{package,devZip}.test.ts` (fixtures, manifest, reports, zip, metadata keys), editor-core `test/target/{setup,restore}.test.ts`, headless `test/cc-c2.package.test.ts` (rig → bind → two slots → package → read back → validators → determinism → zip → re-import), tooling `sync-contract` fixtures test, e2e `cc-03-package-export.spec.ts` (and `cc-01` for the panel's new *From library*) |

## Shared files touched (small, additive)

- `packages/editor-core/src/types.ts` (Halo T2's): `AutoRigExportTarget` += `'omoba-hero'` (one union member).
- `packages/editor-core/src/operators/args.ts`: four `target.*` rows; `LintIssue` import.
- `packages/editor-core/src/workflows/targetSlots.ts`: the hook's `rows(…, profile?)` (type only).
- `packages/editor-core/src/rig/validation/index.ts`: passes the chosen profile to the target hook.
- `packages/editor-core/src/workflows/{exportCharacter,importAnimation}.ts`, `operators/builtin/rig/wizard/export.ts`.
- `packages/curve-editor/src/{index.ts,timeline/TimeSliderController.ts}` (the layer hook), `packages/editor/src/panels/timeline/TimeSliderView.tsx`, `panels/clips/ClipSettingsForm.tsx`, `dialogs/export/character/ExportCharacterSection.tsx`.
- `packages/io/src/{types.ts,index.ts,bake/meta.ts,character/*,profiles/*,omoba/index.ts,contract/index.ts}`.
- `packages/autorig/src/steps/export/{ExportStep.tsx,files.ts}`, `i18n/en/export.ts`.
- Tests updated for the new behaviour: io `lint.test.ts` (profile list), editor `m6b-character-writer.test.tsx` (profile options), editor-core `autorig/composition.test.ts` (target list), e2e `cc-01-target-panel.spec.ts`, `helpers/ar-export.ts` (`chooseTarget` type).
- Docs: ADR 0010 rev. 3 (T2 row → `ekza_package_v1`; clip `label`/`markers`), DECISIONS-OPEN §Q.2, `fixtures/LICENSES.md` (game contracts paragraph).
- C0 conformance: `.gitattributes` (new: `-text` for the pinned contract bytes), `tooling/check-deps.mjs` (`ajv` for
  headless-tests), `packages/headless-tests/package.json` + `pnpm-lock.yaml` (`ajv` 8.20.0, already pinned in the
  repo), C1's `io/src/contract/{gameContract,read}.ts` (reason codes), C1's tests on the C0 data
  (`io/test/contract/contract.test.ts`, `editor-core/test/target/target.test.ts`, e2e `cc-01`).

## Conformance with OMOBA's C0 contract (added scope)

C0 (`omoba-bevy` PR #109, `feat/character-contract-export` @ `c0fe23f`, open) published OMOBA's contract, its schemas
and conformance fixtures; the C2 code now conforms to them.

1. **Snapshot.** `node tooling/sync-contract.mjs --from <cc-c0>/shared/assets/catalog/game-contract.json --schema …`
   (the three schemas): revision `sha256-bae71784fff170720fcaf18da3992c05a4800257f89954157b687406b1257402` **verifies as
   is** (no `--restamp`; Studio's canonical JSON reproduces it); the three schema files are byte-identical to C1's
   copies. The prototype revision left the bundle (kept as `fixtures/contracts/omoba.game-contract.gp5-draft.json` for
   the asset-slot tests). Wildspark now has nine rows and one offer (C0 emits animation slots only).
2. **Conformance test** (`packages/io/test/contract/package.test.ts`): all 45 package cases, the 12 reader cases and
   `manifest.json` in `fixtures/contracts/omoba/v1/`, every file checked against the manifest's SHA-256
   (`.gitattributes -text`). **43 of 45** package cases give exactly the expected gate verdict (pack rule ids,
   warnings, per-slot verdicts and slot warnings); **12 of 12** reader cases give the expected verdict and reason code.
   Studio changes for C0: `clip.in-place` from the rest pose with `maxHorizontal`/`maxHorizontalHold`/`maxUp`/`maxDown`
   read from the params (N1); the VRM 1.0 bone names through `clip.channels.params.vrm1BoneMap` (N4); the per-clip
   metadata key from `clip.markers.params.metaKey`; reader reason codes (`contractRefusalReason`). Order N7 was already
   Studio's.
3. **OMOBA expectations Studio believes wrong** (not changed; the test records Studio's verdict):
   - `clip-too-short`: expected `basic.wildspark.0: ["clip.duration"]`; Studio also reports `clip.markers`. The case is
     two changes from the baseline, not one: the clip was shortened to 0.1 s with its metadata contact moved to 0.05 s,
     but the manifest kept the baseline's 0.1 s contact (`THREE`). GAME-PROTOCOL-SPEC §7.2 `clip.markers`: "equal to
     the per-clip metadata when both exist" (the rule even names the key, `metaKey`), so 0.1 ≠ 0.05 fails. Fix in the
     generator: give the case's manifest the clip's contact (0.05 s).
   - `ok-shared-animation`: expected no warnings; Studio warns `clip.min-interval` on `basic.wildspark.rockets.0`. The
     shared clip is 0.5 s and the rocket-mode basic attack's `minIntervalSecs` is 0.4375 s; the rule (CC §5.1, C0's
     own table "warning when a basic clip outlasts `minIntervalSecs`") warns. Fix: a 0.4 s shared clip, or expect the
     warning.
4. **A full Wildspark fill** (headless, nine custom slots, one shared by Last Spark): the written manifest validates
   against the pinned `ekza.package.v1.schema.json` (Ajv 2020-12) and against OMOBA's own validator
   (`export_game_contract.load_schema`, run once read-only), and the gate verdict is `ok` with every slot `pass`. The
   rule set also caught real drift in three starter-pack clips used in place (Cast 0.172, Sword Attack 0.197, Jump
   Start 0.250 leg lengths > 0.15), so the test uses others (CC-C2-21). OMOBA's Rust `validate-runtime-vrm` was not
   run (a cargo build; C3's gate).

## Findings

- **VRM 1.0 thumbs.** The contract's `drivenBones` use VRM 0.x thumb names; Studio's VRM 1.0 writer maps
  `*ThumbMetacarpal`. Read as OMOBA's retargeter reads them (CC-C2-5); C3's passport must do the same.
- **C0 fixtures**: two expectations disagree with §5.1 (above, CC-C2-4). Report to C0.
- The fixture contract and every contract case of C0 read with C1's reader as expected (with reason codes).

## What the next packages need

- **C3 (OMOBA engine + passport)**: the same measurements (CC-C2-3), the thumb renaming (CC-C2-5), the check order and
  stop points (CC-C2-2) with plain rule ids (Studio's `package.` prefix is only its lint code); read `ekza_package_v1`
  and the slot-named animations; run `validate-motion-pack` on `fixtures/contracts/omoba-package/polybot-wildspark.vrm`
  (copy it into OMOBA's gate) and `tooling/omoba-validate.mjs` on Studio's output; custom clips play at rate 1 from 0
  with the manifest's contact.
- **C4 (builder + registry)**: `check_package` = the `pack.*` subset of `packageCheck.ts` (same order); the package is
  one VRM 1.0 with `asset.extras.ekza_package_v1` and `ekza_animation_v1` (labels); the dev zip is local only.
- **C5 (submit)**: `target.exportPackage` already bakes the bytes and `validationReport()` gives the `tool` stage
  report for `ekza-studio-submit/v1`; `target.recordSubmission` and *Submit* are C5's. Rights are the VRM meta
  (CC-C2-12).
- **C6 (Auto-Rig/Halo/agents)**: agent kinds `omoba_hero` / `omoba_dev_zip` and `target_*` tools; *Restore the OMOBA
  target* on import (CC-C2-7); Auto-Rig ④'s *Pick from library* to `target.slot.create`; ⑤'s footer name for a bound
  character's developer zip; Halo's Thread markers (the layer's drawing can be reused); FEATURES and the spec documents
  of §8.17.
- **C0**: regenerate the two fixture expectations; when it merges, `node tooling/sync-contract.mjs --from … --schema …`
  and `--fixtures <omoba-bevy>/shared/assets/catalog/game-contract-fixtures/v1`.

## Budgets and gates

`check:size` (production build, gzip -9; before the dev merge): `/editor` 892,661 B (+361 over 892,300; the +256 B
target missed by ≈ 105 B, CC-C2-17), `/autorig` 653,051 B (+43). Since SIZE-1 (§S, merged from `dev` at `054b8789`)
one 5,000,000 B gate applies to every route and targets are report-only; nothing was trimmed for size.

Gate before the merge (`EKZA_E2E_PORT=3171 pnpm run ci` on `358c7281`): green — test 22/22 tasks, build, check:size,
e2e 368 passed, 24 skipped (the existing skips). Earlier runs failed only on known flakes in untouched code (mesh-core
property seeds 107113566 and 1028527676, the `agent/keys` timing bound under load; each green alone) and on two e2e
expectations C2 changed (fixed).

After merging `dev` (`054b8789`: Halo T0–T5c and SIZE-1; merge `9478a547`; one conflict, Auto-Rig's `files.ts`, which
dev moved to editor-core's `autorigFlow` — the hero target's `.vrm` and the bound character's `-omoba-dev.zip` now live
in `exportFileNameOf`), `EKZA_E2E_PORT=3190 pnpm run ci`: format, lint, typecheck, deps, fixtures, licences pass; test
23/23 tasks (the first run's 7 failures in editor `shell.test.tsx` were load: 14/14 alone); build; check:size
`/editor` 896,090 B, `/autorig` 657,175 B, `/app` 639,822 B (gate 5,000,000 B); e2e 414 passed, 34 skipped, **1
failed**: `m6a-19-numeric-capture` B11 (the capture window still armed after a 10 px pointer move). It fails the same
way on a clean `origin/dev` (`054b8789`, run in a temporary worktree), so it is dev's, not C2's.

Screenshots (E2E-CC-03 with `EKZA_CC_SCREENSHOTS`): the time slider with the contact ◆, limit line and window
bracket; Auto-Rig ⑤ blocked by the contract row with *Set contact*; the Export dialog blocked and ready; the Target
panel with the fix.
