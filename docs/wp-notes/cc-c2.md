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
| OMOBA's conformance fixtures (C0 draft `f025981`), copied and pinned; every package and contract case through the TypeScript rules | `fixtures/contracts/omoba-fixtures/v1/`, `tooling/sync-contract.mjs --fixtures`, `packages/io/test/contract/package.test.ts` |
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

## Findings

- **VRM 1.0 thumbs.** The contract's `drivenBones` use VRM 0.x thumb names; Studio's VRM 1.0 writer maps
  `*ThumbMetacarpal`. Read as OMOBA's retargeter reads them (CC-C2-5); C3's passport must do the same.
- **C0 draft fixtures**: two expectations disagree with §5.1 (CC-C2-4): `clip-too-short` (manifest contact 0.1 s vs
  metadata 0.05 s) and `ok-shared-animation` (0.5 s rocket basic > `minIntervalSecs` 0.4375 s). Report to C0.
- The fixture contract and every contract case of C0 read with C1's reader as expected.

## What the next packages need

- **C3 (OMOBA engine + passport)**: the same measurements (CC-C2-3), the thumb renaming (CC-C2-5), the check order and
  stop points (CC-C2-2), `package.<rule>`-free: the passport reports rule ids; read `ekza_package_v1` and the slot-named
  animations; run `validate-motion-pack` on `fixtures/contracts/omoba-package/polybot-wildspark.vrm` (copy it into
  OMOBA's gate) and `tooling/omoba-validate.mjs` on Studio's output; custom clips play at rate 1 from 0 with the
  manifest's contact.
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

`check:size` (production build, gzip -9): `/editor` 892,666 B (+366 over 892,300, the +256 target missed by 110 B,
CC-C2-17; gate 900,000), `/autorig` 653,054 B (+46; gate 660,000).

Screenshots (E2E-CC-03 with `EKZA_CC_SCREENSHOTS`): the time slider with the contact ◆, limit line and window
bracket; Auto-Rig ⑤ blocked by the contract row with *Set contact*; the Export dialog blocked and ready; the Target
panel with the fix.
