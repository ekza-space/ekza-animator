# Halo T5b — Auto-Rig orchestration into editor-core (`autorigFlow`)

Branch `halo/t5b-autorigflow` from `dev` (dev merged again before the gate). Spec: STUDIO-TOUCH-SPEC §20.3 item 10,
§12.2, §16.3, §21 (T5b row), §22 AS-ST-5 / AS-ST-15; AUTORIG-SPEC §4–§5, §20–§21 (AR-R5-1 stays in `autoRigBlock`,
which the flow runs through `autorig.rig`'s poll). Decisions: DECISIONS-OPEN §P `ST-T5B-*`.

## What moved

The orchestration the Auto-Rig wizard owned — which operators run, in which order, with which arguments, and what
the flow remembers between them — is now `packages/editor-core/src/autorigFlow/**`, exported from the package root.
It is React-free and string-free: every document change is an operator run through the host's funnels, the shell
keeps the U state behind a small store port and words every outcome itself.

| Flow module | From (Auto-Rig) | What |
|---|---|---|
| `host.ts` | — | `AutoRigFlowHost` (`app`, `state`, funnels `run` = the person's run, `quiet` = bookkeeping), `AutoRigFlowState` / `AutoRigFlowStore` (subject, intake, start pose, parts, rigid parts, painted flag, straighten measure, bound key), `memoryAutoRigFlowStore`, `autoRigFlowHost`, `quietRun`, `enterRigWorkspace` |
| `subject.ts` | `progress/index.ts` (`resolveSubject`, copied; see T5c below) | `resolveAutoRigSubject`, `AUTORIG_FLOW_PROFILE`, `flowCharacterId`, `liveSubjectMeshes` |
| `intake.ts` | `steps/model/flow.ts`, `fixes.ts` | the New question then `file.new` (`freshDocument`), `intakeModel` (Rig & Skin, `autorig.intake` / `autorig.sample`, then `routeIntake`: static → ① with its default parts, VRM / rigged humanoid → ④, rigged other → *Re-rig*, project → its character, its meshes or a choice), `reinspectSubject` (`autorig.inspect`, the file's fields kept, the start pose once), `takeHandedSubject`, `chooseFlowCharacter`, `continueFromSlot`, `discardSlot`, `reRigArgs` |
| `checks.ts` | `steps/model/checks.ts` | `AUTORIG_FIX_ORDER` (stand up → size → freeze → centre → face), `firstFix`, `transformsUniform` (a module of its own: ①'s footer is on `/autorig`'s first visit) |
| `fixes.ts` | `steps/model/fixes.ts` | `nextFix`, `fixArgs` (ticked parts measured, the others follow: `with`), `applyFix` (`autorig.fix`, then the report again), `AUTORIG_TARGET_HEIGHT` (1.70 m, ①'s Set height field) |
| `parts.ts` | `steps/model/parts.ts` | `separateMeshes` / `defaultParts` / `meshBounds` (the 1/96 contact grid), `leftOutParts` |
| `markers.ts` | `steps/markers/enter.ts` | `markerMeshes`, `openMarkers` (`select.objects` + `skel.quickRig.start`; an open session on the same meshes kept), `recordStartPose` / `guessedStartPose` (5° pose class, *From Studio*), `AUTORIG_FINGER_PRESETS` + `chooseFingers` (`skel.quickRig.setPreset`) |
| `rig.ts` | `steps/rig/run.ts` | `rigRunArgs` (straighten from the start pose, a re-run only while `skel.tpose` is there; rigid parts; `confirm` when nothing was painted since the flow's own bind, AR-D8-8), `runRig` (stages for the progress, the straighten measure, the subject adopted; outcomes `finished` / `confirm-required` / `cancelled` / `interrupted` / `failed`), `rebindSkin` (*Bind again*, Done's rebind; rigid parts again; straighten on request), `cancelRig`, `bindPartsRigidly`, `followRigStages`, `stageAfter`, `weightsKey`, `rebindUnasked` |
| `straighten.ts` | `steps/rig/stretch.ts` | AR-R4-3's torn-length measure and `watchStraighten(app, character, record)`, `tornNow` |
| `painted.ts` | `steps/rig/painted.ts`, `slice.ts` | `watchPaintedSinceBind(app, port)`, `paintedAfterRun`, `paintTracked` |
| `hands.ts` | `steps/rig/hands.ts` | *Adjust joints* → Done: the hands follow their forearms (AR-D7-16) |
| `motion.ts` | `steps/rig/motion.ts` (the effect) | `startMotionTest(host, character, clip, report)` → `{stop()}`, `MOTION_CLIPS`; waits for the character's runtime before the first preview (ST-T5B-9) |
| `library.ts` | `steps/animations/actions.ts` (two calls) | `previewLibraryClip`, `addLibraryClip` (`autorig.clip.add {character, clip, params, replace?}`) |
| `export.ts` | `steps/export/files.ts`, `enter.ts`, `ExportStep.tsx` | `exportSlugOf` / `exportFileNameOf` (io's `omobaSlug` and `exportFileName`, mirrored; a test holds them equal), `exportAvatarName`, `recommendedTarget`, `prepareExport` (thumbnail, remembered author), `downloadExport` (`autorig.export {character, target, fileName: ''}`), `exportSaved` |
| `log.ts` | — | `recordAutoRigFlow(host)`: every funnel run in start order with comparable arguments (ids by first appearance, bytes by length, keys sorted), its status and the document runs it caused (`onBeforeDocumentRun`, a composition's inner runs included) |
| `journey.ts` | — | `runAutoRigJourney(host, input)`: ①–⑤ headless with the wizard's defaults, only flow calls |

**Wizard seams** (`packages/autorig/src/steps/**`, the UI unchanged): `model/flowHost.ts` makes the wizard a flow host
(`run` = `ctx.run`, which toasts; `quiet` = `app.runUntyped`; the store maps onto the session's subject / intake /
start pose, the `model` slice's parts, the `rig` slice's rigid parts / painted / straightened, and ③'s `boundKey`).
`model/{flow,fixes,checks,parts}.ts`, `markers/enter.ts`, `rig/{run,stretch,painted,hands,slice,motion}.ts`,
`animations/actions.ts` (preview and Add only), `export/{files,enter,ExportStep}.ts(x)` call the flow and keep their
transient UI state, footers, framing and step changes. Every function the views and the autorig tests import keeps its
name and signature (thin wrappers or re-exports).

Not moved (shell chrome, owned elsewhere or UI): the step entry order (§4.2: preview stop, Esc, workspace, rig mode;
`autorig/src/shell/entry.ts`), hidden parts / controls while a view shows (`autorig.parts`, `autorig.controls`),
pane framing, ③'s sub-tool modes (`rig/mode.ts`), ④'s manifest grid, ✎ edit and clip rows, ⑤'s checklist labels,
left-out clips and measures, the remembered author's storage.

**Scope note.** The T5b row owns `autorig/src/steps/{model,rig,motion,export}`; there is no `motion` directory (the
motion test lives in `rig/motion.ts`). The goal also names markers / guess and library use, so `markers/enter.ts` and
`animations/actions.ts` got re-import seams too (no other WP owns them; T0's one-line edit is in `AnimationsStep.tsx`).

## The operator log (AS-ST-5, AS-ST-15)

- `packages/editor-core/test/autorigFlow/journey.test.ts`: the journey on the production kernel (the editor-core mesh
  test app, `fetch` serving `/samples/` from `fixtures/models` and `/library/` from `apps/web/public/library`) for the
  **Cube Lad** (T-pose), **Polybot A-pose** and a **Cube Lad in centimetres** (its node ×100, AR-R5-1's case: ① runs
  the *Size* fix first), recorded with `recordAutoRigFlow`, compared with the references
  `packages/editor-core/test/autorigFlow/logs/{cube-lad,polybot-apose,cube-lad-cm}.json` (`UPDATE_AUTORIG_LOGS=1`
  rewrites them; then `biome format --write`), plus the history steps, a saved Ekza VRM (`cube-lad.vrm`) and a
  deterministic re-run.
- `packages/autorig/test/steps/flowLog.test.ts`: the wizard's own step functions (① `loadSample` / `loadFiles` and
  the report's fix buttons' `applyFix`, ② `enterMarkers`, ③ `runAutoRig`, ④ `loadManifest` + `addClip`, ⑤
  `enterExport`; the motion test, the licence edit and *Download* as their hook / body / effect call them) record
  **exactly the same logs** from the wizard's funnels, for all three models.

The recorded sequence of the samples (Polybot's `autorig.rig` is `{straighten: true}` and adds
`skel.pose.applyAsRest`; the centimetre Cube Lad starts `autorig.intake {bytes, name}`, then `autorig.fix {fix:
'scale', height: 1.7, meshes}` → `scene.object.transform` and `autorig.inspect`, then the same rows 3–12):

| # | via | operator | document runs |
|---|---|---|---|
| 1 | quiet | `workspace.set {workspace: 'rig'}` | — |
| 2 | run | `autorig.sample {sample}` | `mesh.importStatic` |
| 3 | quiet | `select.objects {ids: [msh#1], mode: 'replace'}` | — |
| 4 | quiet | `skel.quickRig.start {meshes: [msh#1]}` | — |
| 5 | quiet | `autorig.rig {rigidParts: false, straighten}` | `skel.quickRig.commit`, `skin.bind` (+ `skel.pose.applyAsRest`) |
| 6 | quiet | `library.preview {character: chr#1, clip: 'walk'}` | — |
| 7 | quiet | `library.stop` | — |
| 8 | run | `autorig.clip.add {character, clip: 'walk', params: identity}` | `library.useClip` |
| 9 | run | `char.renderThumbnail {character}` | `char.renderThumbnail` |
| 10 | run | `char.setVrmMeta {character, patch: {authors: ['Tester']}}` | `char.setVrmMeta` |
| 11 | run | `char.setVrmMeta {character, patch: {licensePreset: 'cc0'}}` | `char.setVrmMeta` |
| 12 | run | `autorig.export {character, fileName: '', target: 'ekza-vrm'}` | — |

Halo's J1 (T9) records its *Rig it* recipe over its own host with `recordAutoRigFlow` and compares with these files.
**A race fixed on the way (ST-T5B-9).** Under load (the first gate ran at load average ~97) the motion test right
after *Auto-rig* was refused with "The character is still loading" — the character's runtime is built after Create
Skeleton commits — and nothing restarted it, so ③'s character stood still until the next edit. `startMotionTest` now
waits for the runtime (`app.characters.subscribe`) before its first preview; a unit test holds it.

## Gate and sizes

Measured with `check:size` (production build, gzip -9):

| Route | branch start (dev 959c587b) | after the move (pre-merge) | after merging dev (gate) |
|---|---|---|---|
| `/editor` | 891,449 B | 891,450 B (+1, chunk-name noise) | see the gate run below |
| `/autorig` | 652,330 B | 652,298 B (−32) | see the gate run below |

- The first visits do not grow; the boundaries hold; `/autorig` keeps its 91 lazy chunk groups. The summed lazy-group
  bytes grew by 12.0 kB (1,825.8 → 1,837.8 kB): the shared flow-host module (~1.2 kB) is now counted in each of the
  ten lazy groups that run a step action (it is downloaded once). Not gated (ST-T5B-6).
- `EKZA_E2E_PORT=3166 pnpm run ci` (format, lint, typecheck, deps, fixtures, licences, unit tests incl. agent-tools,
  build, `check:size`, e2e incl. every `ar-*` spec): see "Gate run".

## Patches needed from other WPs

- **T5c** (progress move): `autorig/src/progress/index.ts` still has its own `resolveSubject` and `AUTORIG_PROFILE`;
  when it moves to `editor-core/src/progress`, import `resolveAutoRigSubject` / `AUTORIG_FLOW_PROFILE` from
  `../autorigFlow/subject` instead of keeping a second copy (and let Auto-Rig re-export them).
- **T2** (`editor-core/src/types.ts`): no line patch needed — the flow's types live in `autorigFlow/host.ts`.
  `AUTORIG_FINGER_PRESETS` is keyed `mittens | thumb | all | minimal`, so `HaloHandoffState.fingers` maps straight onto
  it (`chooseFingers(host, handoff.fingers)` when Auto-Rig ② is entered from Halo).
- **Integration (T12)**: `editor-core/src/index.ts` gains one line (`export * from './autorigFlow'`, ST-T5B-1);
  DECISIONS-OPEN §P gains the `ST-T5B-*` rows after ST-40 (other WPs append there too).
- **T9 / T11**: Halo's *Rig it* runs `openMarkers` → `chooseFingers` → `runRig` (`onStage` drives the story line,
  `confirm-required` is the inline rebind card) → `startMotionTest`; Home's intake runs `freshDocument` +
  `intakeModel` and routes by `AutoRigIntakeRoute`; Share names files with `exportFileNameOf` and downloads with
  `downloadExport`; Checks list `AUTORIG_FIX_ORDER` rows and run `applyFix`.
- **agent-tools** (follow-up, not required): `tools/setup/run.ts` `rig_create` repeats the straighten and rigid-parts
  defaults (guess arm angle > 5°, more than one mesh). They equal the flow's today; calling `armPoseClass` /
  `rigidPartsOn` would keep them so. The MCP toolset and its tests are unchanged (259 passed).

## Gate run

(filled in below after the final run)
