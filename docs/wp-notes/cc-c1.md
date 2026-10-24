# C1 — Studio reads the contract (target binding, slot statuses, checklists) + C-pre (Studio items)

Branch `feat/character-contract-studio` from `dev` (worktree `_workspace/worktrees/animator/cc-c1`). Specs:
[CHARACTER-CONTRACT-SPEC](../CHARACTER-CONTRACT-SPEC.md) v0.2 (§8, §10 C1/C-pre, §11 P-4…P-6, §15),
[GAME-PROTOCOL-SPEC](../GAME-PROTOCOL-SPEC.md) v0.1 (§3, §4, §8.10, §12.3 "C1"), [ADR 0024](../adr/0024-character-contract.md),
[ADR 0025](../adr/0025-game-protocol.md). Build decisions: [DECISIONS-OPEN §Q.1](../DECISIONS-OPEN.md) `CC-C1-1…16`.
Gate `EKZA_E2E_PORT=3170 pnpm run ci`, local Chrome.

C1 started on the v0.1 shapes (`omoba.character-contract.v1`) and adopted the Ekza Game Protocol's names mid-way, as
the main session decided (`GP-21`): the code reads `ekza.game-contract.v1` with the profile `omoba.character.v1`, the
target record is keyed by `contract {schema, game, revision}` and `target`, and nothing writes the retired manifest
name (C2 writes `ekza_package_v1`).

## What landed

| Item | Where |
|---|---|
| Protocol model (targets, sections, offers; slot kinds `animation`, `asset`, `socket`; markers; `leadInSecs`; asset specs; families; packaging; rules with `checkedBy`) | `packages/io/src/contract/model.ts` |
| Canonical JSON and the revision (`ekza-canonical-json/1`; reproduces OMOBA's Python `canonical` byte for byte) | `packages/io/src/contract/canonical.ts` |
| One strict reader of `ekza.game-contract.v1`: §3.3 minors (`minReaderVersion` refuses, a newer `schemaVersion` reads leniently and records skipped keys), every Appendix A check in code, §3.5 cross-references, unknown core rule ids fail closed, unknown namespaced ids are `deferred`, a namespaced rule checked only by tools is invalid, required unknown profiles refuse, the recomputed revision | `packages/io/src/contract/gameContract.ts`, `strict.ts`, `read.ts` |
| Profile module `omoba.character.v1` (strict `ext` at document, target, animation slot, asset slot; none elsewhere) | `packages/io/src/contract/profiles/omobaCharacterV1.ts` |
| Bundled index `ekza.contract-index.v1` (`profiles`, `targets`) | `packages/io/src/contract/snapshotIndex.ts` |
| Snapshot sync and check: `--from`, `--schema` (repeatable), `--restamp` (draft data only), `--check` | `tooling/sync-contract.mjs`, `tooling/test/sync-contract.test.mjs` |
| Committed data: OMOBA's contract (protocol converter output, 113 slots, 18 targets, `sha256-68441bd3…`), the protocol, package and profile schemas | `apps/web/public/contracts/omoba/{index.json, sha256-….json}`, `fixtures/contracts/*`, `fixtures/LICENSES.md` "Game contracts" |
| The target chunk (lazy): `ekza.targets` extension table (`tgt:<characterId>`, partition `char:<id>`, the contract pinned), the contract service (pinned → session cache → bundled with size/SHA-256 checks), the pure `computeSlotStatuses` / `slotStatuses` (per-offer counts, deferred rules, extras), the open-vocabulary check, Validation rows of area `animation`; marker `ekza-character-target` (check-size boundary `character-target`) | `packages/editor-core/src/workflows/target/{index,table,contracts,service,status}.ts`, `apps/web/scripts/check-size.mjs` |
| `target.bind`, `target.unbind`, `target.update`, `target.slot.assign`, `target.slot.clear`, `target.slot.alias` (one undo step each; `agent: denied` until C6); the runner loads the chunk for any `target.*` id | `packages/editor-core/src/operators/builtin/target.ts`, `workspaces/rig.ts` (`lazyOperatorChunk`), `operators/args.ts` rows |
| Open slot vocabulary (eager, ≈1 kB source): dotted ids are contract slots; `clip.setSettings` loads the chunk in `prepare` and refuses a slot outside the target, a closed slot, a non-animation slot or a second holder; `library.useClip {slot}` and `autorig.clip.add {slot}` fill a slot in one Use Clip step (the slot moves off other clips); the `ekza.slot-name` lint accepts contract slot ids; ADR 0010 §5 amended | `workflows/targetSlots.ts`, `operators/builtin/{clip,library}.ts`, `rig/wizard/clip.ts`, `io/src/lint/lintExport.ts` |
| Pro **Target** panel (lazy; Windows › Target, *Target* in the Clips toolbar, docked beside Clips): *For: OMOBA · <target>*, the whole kit (clips and objects) by section, ● ○ ⚠ ⊘ ◌, timing to aim for, per-offer summaries, deferred rules, *Game default ▶*, *From library…*, *Use clip…*, *Same as…*, *Use default*/*Unlink*, extras *Map to a slot…*; Clip Settings keeps a target slot | `packages/editor/src/panels/target/{index.tsx,state.ts}`, `panels/index.ts`, `shell/layout.ts`, `panels/clips/*` |
| Auto-Rig ④ contract mode: *For a game…* → target (2 taps); the `character` offer's checklist replaces the free clip list; *Game default ▶*, *Pick from library…*, *Use clip…*, *Use default*, extras | `packages/autorig/src/steps/animations/TargetChecklist.tsx`, `AnimationsStep.tsx`, `i18n/en/animations.ts` |
| C-pre P-4: the OMOBA local test kit stages a VRM 1.0 as OMOBA's `convert_vrm_to_glb.py` does (roots turned 180° about Y, `asset.extras.omoba_rest_yaw180`; VRM 0.x byte for byte) | `packages/io/src/omoba/{facing,kit,readme}.ts`, `apps/web/e2e/ar-07-export-targets.spec.ts` |
| C-pre P-5: `ekza/omoba-humanoid-v1` labelled "legacy passport clips"; P-6 copy unchanged (hidden only in ④'s contract mode) | `packages/io/src/profiles/builtin.ts`, `docs/FEATURES.md` |
| Tests | io `test/contract/contract.test.ts` (reader, refusals, minors, profiles, rules, canonical JSON, Appendix A key-set cross-check, index), io `test/ar-omoba/facing.test.ts`; editor-core `test/target/target.test.ts` (statuses, operators and undo, open vocabulary and the lazy load, Validation rows, snapshot round-trip offline, checksum); e2e `cc-01-target-panel.spec.ts`, `cc-02-autorig-target.spec.ts` |

## P-4, verified

`omoba-bevy@dev` (`6d34f98`, read-only): `scripts/convert_vrm_to_glb.py` turns a VRM 1.0 to rest facing −Z through
`retarget_animations.normalize_vrm1_rest_facing` (detects +Z from `(leftHand − rightHand) × (head − hips)`, turns every
scene root by `Y·q`, translation `(−x, y, −z)`, sets `asset.extras.omoba_rest_yaw180`); `docs/humanoid-motion.md`
("Local model validation and import") tells users to run it; the client has no runtime turn (no use of the marker or
the facing check under `client/src`). Studio's kit copied the VRM unchanged, so a VRM 1.0 from Studio faced backwards
in a local OMOBA build. `stageVrmForOmoba` is the same algorithm in TypeScript (idempotent; matrix roots are
pre-multiplied), unit-tested on Seed-san (VRM 1.0, turned) and Polybot (VRM 0.x, untouched); the in-game look is C7's
check.

## Shared files touched (small, additive)

- `packages/editor-core/src/types.ts` (Halo T2's): `EditorServices.contractsPath?`; `RigValidationRow.area` += `'animation'`.
- `packages/editor-core/src/operators/args.ts`: six `target.*` rows; `slot?` on `library.useClip` and `autorig.clip.add`.
- `packages/editor-core/src/index.ts`: exports `isTargetSlotId`, `loadTargetKit`, `TargetKit`.
- `packages/editor-core/src/workspaces/rig.ts` (`lazyOperatorChunk`), `rig/validation/{index,rows}.ts` (append rows).
- `packages/editor/src/panels/index.ts`, `shell/layout.ts` (`EXTRA_PANEL_SLOTS.target`), `panels/clips/*`.
- `packages/autorig/src/steps/animations/AnimationsStep.tsx` (the target section around the clip list).
- `apps/web/scripts/check-size.mjs` (one boundary).

## What C2 needs from C1

- The chunk's API: `loadTargetKit(app)` → `bindingOf`, `slotStatuses` (rows with `offers`, per-offer counts),
  `contractsOf`, `computeSlotStatuses`, `targetOf`; `ContractModel.packaging.character` (containers, `manifestKey`
  `ekza_package_v1`, caps) and the rules with their parameters (`clip.markers.toleranceSecs`, `clip.keys`, …).
- The C1 document checks are in `status.ts` (`animationIssues`); C2 adds the byte checks, makes errors block the package
  export, and turns the advisory Validation rows into the gate (`CC-C1-9`).
- `target.slot.create` (blank / default / file with the contract's settings), the timeline markers (other named markers
  than `contact`), contract-locked Clip Settings fields, the `ekza_package_v1` writer and the dev zip (reusing
  `stageVrmForOmoba` for the −Z turn).
- When C0 lands: `node tooling/sync-contract.mjs --from <omoba-bevy>/shared/assets/catalog/game-contract.json
  --schema …` (C0 emits animation slots only; counts in the tests that include Wildspark's six asset slots change).

## Budgets and gates

See the gate section appended at the end of the run (sizes from `check:size`).
