# Halo T5c — models subpath and progress move (`halo/t5c-models`)

[STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §20.1, §20.3 items 9–10, §20.6, §21 (T5c row); [ADR 0023](../adr/0023-studio-touch-ui.md).
Decisions: [DECISIONS-OPEN §P](../DECISIONS-OPEN.md#p-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24), rows
ST-B1-T5C and ST-T5C-1…9. Branch from `halo/int` `9d7b3a09`; `halo/int` `2b280a4e` (T1, T3) merged in before the gate.

## What landed

| Part | Where |
|---|---|
| Auto-Rig's derived progress, moved and made string-free | `editor-core/src/progress/{index,checklist}.ts`, exported from the package root (one line in `editor-core/src/index.ts`, as T5b did for `autorigFlow`) |
| Auto-Rig's progress as a re-export shim (the wizard's names, its frame strings) | `autorig/src/progress/index.ts`; `autorig/src/progress/checklist.ts` removed (the lazy chunk is editor-core's) |
| Unit tests of the moved module (14, string-free: the reasons come back as codes) | `editor-core/test/progress/progress.test.ts`; Auto-Rig's `autorig/test/progress.test.ts` (14) runs unchanged against the shim |
| The four measured subpaths | `editor/src/{models,overlays,toolkit,agent}.ts`, `editor/package.json` `exports` |
| A test that pins their export lists and keeps the left-out modules out | `editor/test/halo-t5c-subpaths.test.ts` |

### The progress move (ST-T5C-7, ST-T5C-8)

`autorig/src/progress` is now `editor-core/src/progress`. The table of AUTORIG-SPEC §4.3 is the same code; what changed:

- **String-free.** `autoRigProgressOf(input, words)` takes the shell's words for the blocked reasons
  (`AutoRigProgressWords<R>`: `blockedNoModel`, `blockedNoSkeleton`, `blockedNotBound`, `blockedChecking`,
  `alreadyRigged`, `blockedRow(message)`). The keys are Auto-Rig's frame strings, so the wizard passes
  `messages().frame` as it is (no mapping code on `/autorig`); Halo passes its own words or codes (`R` is generic).
- **One subject rule.** The module imports `resolveAutoRigSubject` and `AUTORIG_FLOW_PROFILE` from
  `autorigFlow/subject` (T5b's ST-T5B-8 note): the second copy in Auto-Rig is gone.
- **Names at the editor-core root:** `autoRigProgressOf`, `autoRigProgressNow(app, subject, animationsSkipped, words)`
  (the app-reading form; Auto-Rig's `autoRigProgress(app, session)` wraps it), `autoRigSubjectRows`,
  `loadAutoRigChecklist` / `autoRigChecklistLoaded` (the checklist stays its own lazy chunk, AR-D3-21; the loader's
  state is per page, so Auto-Rig and Halo share one load), `autoRigLandingStep`, and the types `AutoRigProgressInput`,
  `AutoRigProgressWords`, `AutoRigStepProgress` (= Auto-Rig's `AutoRigProgress` for `R = string`).
- **Auto-Rig unchanged.** `autorig/src/progress/index.ts` re-exports under the old names (`progressOf`,
  `resolveSubject`, `AUTORIG_PROFILE`, `subjectRows`, `loadChecklist`, `checklistLoaded`, `landingStep`,
  `ProgressInput`, `ResolvedSubject`) and keeps `autoRigProgress: AutoRigProgressFn`; the wizard's importers
  (`shell/controller.ts`, `steps/rig/{RigStep,ProgressSheet}.tsx`, `steps/export/enter.ts`,
  `steps/animations/actions.ts`) and its test are untouched.

Checked in the build: the checklist (`"Fit joints"`) is in none of `/autorig`'s eager scripts; `/autorig` keeps its
lazy chunk groups (94 → 94 at `9d7b3a09`; 98 → 98 after the merge) and its first visit lost 13 B (the second
`resolveSubject` went).

## Measurements (ST-B1)

Production build, `check:size`, gzip -9. Groups measured one at a time in a scratch worktree of `halo/int` `9d7b3a09`
(`/editor` 895,135 B, `/autorig` 655,718 B, `/app` 638,344 B), with the Halo stub as a **lazy** importer of the
group (a `t5cProbe.ts` chunk loaded by `import()` from `HaloShell`; not committed). The cost does not depend on
eager or lazy in Halo (AR-D3-1, T1a): a module that `/editor` loads eagerly loses scope hoisting once another chunk
group imports it. A module that `/editor` loads lazily costs it nothing.

| Group (modules) | `/editor` Δ | `/autorig` Δ | Needed by | In the subpath |
|---|---|---|---|---|
| Outliner, all three modules (namespace) | +241 | 0 | | |
| · `outliner/model` (the rig tree), 3 or 5 names | +195 | 0 | no first-stage sheet (T9's Bones sheet may want it) | **no** |
| · `outliner/modelTree` + `sceneSelection` | **0** (lazy in Pro) | 0 | Scene sheet (T6b) | yes |
| Channels, all four modules (namespace) | +289 | 0 | | |
| · `channels/readout` | +207 | 0 | Echo chips and Numbers (T6a, T6b; AS-ST-19) | yes |
| · `channels/states` | +80 | 0 | Halo words key states itself (`i18n/channels.ts`) | **no** |
| · `channels/nudge` | +178 | 0 | arrow-key bursts; Halo's steppers are operator runs | **no** |
| · `channels/kit/kernel` | +33 | 0 | aliases of editor-core / doc helpers (its `readVrmLicense` is io's) | **no** |
| Graph Editor `model` | +550 | −26 | Curves (T10): its own adapter (T1a option (b)) | **no** |
| Clip settings (namespace; 8 names +376; 2 names +347) | +399 | 0 | the animation's Settings, Numbers › Animation (T6b, T7) | yes |
| Colour palette `model` | +1 (lazy in Pro) | 0 | Paint (T8) | yes (free) |
| Toolkit `slider` | 0 | 0 | Options (T6b) | yes (`./toolkit`) |
| + `paramSections`, `setOptionDefault` | +2 | 0 | Options, *Make default* | yes (`./toolkit`) |
| Marking-menu geometry | 0 (lazy in Pro) | 0 | the Halo ring (T6a) | yes (`./overlays`) |
| Command palette controller and data | 0 (lazy in Pro) | 0 | Halo's palette view (T6a, §8) | yes (`./overlays`) |
| Agent panel body | 0 (lazy in Pro) | 0 | Ask (T10, §14) | yes (`./agent`) |
| VRM meta: `splitList` from `VrmMetaFields.tsx` | −1 | +3 | About this character (T6b) | **no** (ST-T5C-5) |
| Readout + rig Outliner tree | +448 | 0 | | — |
| Readout + clip settings | +534 | 0 | | — |
| Readout + rig Outliner tree + clip settings | +727 | 0 | over the 600 B target | — |
| **The chosen set, every name of all four subpaths** | **+558** | 0 | | — |

**On the branch** (after merging `halo/int` `2b280a4e`, whose own build is `/editor` 895,122 B, `/autorig` 656,658 B,
`/app` 639,270 B):

| Build | `/editor` | `/autorig` | `/app` |
|---|---|---|---|
| T5c as committed (no Halo importer yet) | 895,122 B (**+0**) | 656,645 B (**−13**) | 639,270 B (+0) |
| + a lazy Halo importer of every name of the four subpaths (probe, not committed) | 895,660 B (**+538**) | 656,645 B (−13) | 639,330 B (+60: the probe's loader) |

So T5c's share of ST-B1 is **+538 B on `/editor` and 0 B on `/autorig`** once T6a / T6b / T7 import the subpaths
(less if they import fewer modules: the barrels are tree-shaken per re-exported module). Proposed allowance: 600 B /
0 B (ST-B1-T5C).

### Option (c): a React-free package (measured, rejected — ST-T5C-3)

`outliner/model.ts` moved into a throwaway workspace package (`@ekza-studio/models-probe`, the editor's module a
re-export of it) measured **+0 B** without a Halo importer and **+91 B** with Halo importing five names, against
+195 B in place. But `/editor`'s main chunk was byte-identical in both builds except one module id (raw 2,666,141 B
each): the gzip difference comes from where the module lands in the chunk (ids follow paths), not from less code. A
package gives no structural saving, as T1a predicted; it also shows the placement noise of these numbers (≈ ±130 B).

### What Halo pays on `/app` if it imports a group eagerly

For T6a / T6b's choice of eager and lazy imports (§20.6). The Halo stub with a **static** import of the group,
against the same stub without (638,357 B):

| Group | `/app` Δ eager |
|---|---|
| Marking-menu geometry (brings the whole controller module) | +2,366 |
| Channels readout | +1,237 |
| Model Outliner tree + scene selection | +1,598 |
| Clip settings | +2,491 |
| Colour palette model | +3,589 |
| Command palette controller (brings Pro's menu shortcuts) | +3,290 |
| Toolkit slider (alone, or by name through the full `./toolkit` barrel: +1,438) | +1,474 |
| Toolkit slider + `paramSections` + `setOptionDefault` (Pro's React field and option box come along) | +4,813 |
| Agent panel body | +138,550 |
| Everything | +158,435 |

Only the readout (Echo chip core) and the ring geometry are eager candidates; the rest belongs behind the sheets'
`import()`. Barrels are tree-shaken per re-exported module (a named import of the slider through the full
`./toolkit` cost the same as the slider alone), so importing a name does not pull its neighbours.

## Patches for other WPs

- **T6a** (ring core eager): the geometry is in `overlays/MarkingMenu/controller.ts`, so an eager import brings the
  controller (+2.4 kB on `/app`). A geometry module (`overlays/MarkingMenu/geometry.ts`: `MM_RADIUS`, `FLICK_MS`,
  `FLICK_PX`, `COMPASS`, the angle table, `LIST_OFFSET`, `EDGE_MARGIN`, `slotToward`, `slotPosition`; the controller
  re-exports them) would cut that to the geometry itself; `./overlays` then re-exports from it. 0 B on `/editor`
  either way (the controller is lazy there). Owner of `MarkingMenu/` to apply.
- **T6b** (Options): `paramSections` (in `ParamField.tsx`) and `setOptionDefault` (in `OptionBoxView.tsx`) are
  React-free functions in React modules; moving them into `panels/toolkit/options.ts` (both modules re-import) would
  keep Pro's components out of Halo's Options chunk (−3.3 kB lazy). `./toolkit` then re-exports from it.
- **T6b** (About this character): if Pro's VRM meta tables are wanted, extract `splitList` and the option tables from
  `VrmMetaFields.tsx` into `dialogs/export/character/vrmMeta.ts` and add it to `./models` (lazy in Pro: 0 B). The
  licence choices stay io's, which Halo may not import (§6.8 words its own presets).
- **T9 / T10**: the rig Outliner tree (`outliner/model`, +195–241 B) and the Graph Editor model (+550 B) are not in
  `./models`; adding either needs a measurement and an allowance (T10's Curves use a `curve-editor` adapter).
- **Spec (§20.3 item 9)**, as built: `./models` = the Model Outliner tree and scene selection, the Channels readout,
  clip settings, the colour palette model; `./overlays` = marking-menu geometry and the command palette controller;
  `./toolkit` = the label slider, `paramSections`, `setOptionDefault`; `./agent` = the Agent panel body. Not the rig
  Outliner tree, Channels `states` / `nudge` / `kit/kernel`, the Graph Editor model or a VRM meta model.
- **Integration (T12)**: `editor-core/src/index.ts` gains `export * from './progress'` (one line after T5b's).

## Gate

`EKZA_E2E_PORT=3169 pnpm run ci` at `c4c96386` (T5c's two code commits with `halo/int` `2b280a4e` merged), local
Chrome, 7 workers, load average 20–50: **green** (exit 0).

- format, lint, typecheck, `check:deps`, `check:fixtures`, `check:licenses`, the tooling tests: green.
- Unit tests: 23 / 23 turbo tasks (editor-core 1,772 incl. `progress` 14; editor 673 + 1 skipped incl. the subpath
  test; autorig incl. its unchanged `progress.test.ts`; headless-tests 223).
- Build and `check:size`: `/editor` 895,122 B, `/autorig` 656,645 B, `/app` 639,270 B, all OK; the AR-B1 eager delta
  −566 B (enforced).
- e2e: **446 tests, 412 passed, 34 skipped, 0 failed, 0 flaky** in 3.3 min (`chrome` 386 + 26 skipped,
  `chrome-touch` 16 + 5, `webkit-ipad` 10 + 3). **Every Auto-Rig spec green: 115 / 115 `ar-*` tests** (38 files on
  `chrome`, 3 on `chrome-touch`). The skips are the existing `test.fixme` stretch items (`stretch` 9, `m6a-stretch`
  14), the conditional `m6b-skin-03-mirror-weights` skip and the per-project skips of `ha-00` (6) and `ha-t3` (4).

An earlier run at `35862f0b` (before the merge) stopped at `format:check` on three files from `halo/int` `9d7b3a09`
(`editor/test/files.test.ts`, `editor/test/test-api.test.ts`, `turbo.json`), which `halo/int` has since formatted.
