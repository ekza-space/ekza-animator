# WP-7b — editor-core operator catalog and workflows: build notes

Branch `wp/wp-7b` (from `wp/wp-7a`). Scope: MVP-SPEC §7 WP-7b — `packages/editor-core/src/operators/builtin/`,
`packages/editor-core/src/workflows/`, their tests in `packages/editor-core/test/builtin/` and the `ops.*` files of
`packages/headless-tests`. No contract file changed (`types.ts`, `operators/args.ts` untouched: the two additional
operators extend `OperatorMap` by declaration merging, see below); no `package.json` or lockfile change; no file of
another work package edited.

## What is implemented

| Responsibility (§7 WP-7b) | Where |
|---|---|
| Every §4.9 operator owned by 7b (74), `prepare`/`apply` split, composition through the edit kernel and workflows only | `src/operators/builtin/{file,edit,select,key,pose,time,graph,clip,view}.ts` |
| Model import §4.11.6 (parse, budgets, format, skeleton, `no-skin`, asset store, auto-rig, clip conversion with fps detection / key mode / Euler filter / reduction, provenance, records in one transaction, shot camera, session) | `src/workflows/importModel.ts`, `clipWrite.ts`, `camera.ts`, `records.ts` |
| VRMA import §4.11.7 (`readVrma` → `importHumanoidClip` onto the target humanoid, provenance from `ekza_animation_v1` when the Animator wrote the file) | `src/workflows/importAnimation.ts` |
| Provenance and sample licences (ADR 0010 §3, ADR 0012) | `src/workflows/provenance.ts`, `samples.ts` |
| Export §4.11.10 through the built-in exporters (bake / animation GLB / VRMA, step schedules, self-contained clips, metadata, licence gate, profile preflight, host validation) | `src/workflows/export.ts`, `src/operators/builtin/exporters.ts` |
| Projects (`.ekzanim` save/open, JSON debug variant) | `src/workflows/project.ts` |
| Built-in importers (with the shared resolution rule), exporters, export profiles, menu items, `MAYA_KEYMAP`, `registerBuiltins`, `registerBuiltinOperators` | `src/operators/builtin/{importers,exporters,menus,index}.ts` |
| Selection targets, pose values, key clipboard | `src/workflows/{targets,pose,keyClipboard,session,names}.ts` |

`registerBuiltinOperators` skips ids that are already registered (a host or extension may override a built-in);
`registerBuiltins` likewise for importers, exporters, profiles and menu items, then contributes `MAYA_KEYMAP`. Both
return one disposer that removes exactly what they added. `BUILTIN_OPERATORS` (all definitions) is exported from the
module for tests; the package entry exports only the §7 API.

### Additional operators (requested by WP-9, added by declaration merging on `OperatorMap`)

| Id | Why |
|---|---|
| `select.channels { refs, mode }` | WP-9 R-1: Channel Box and Graph channel list share `Selection.channels`; keymaps and the test API can select channels. |
| `view.camera.setSettings { camera, fovY?, near?, far?, aspect? }` (undoable) | WP-9 R-3: the Attributes panel's lens and clip-plane fields; validated (0 < fovY < π, near > 0, far > near, aspect > 0 or null). WP-5 should not register the same id. |

## Interpretations and decisions (please review; each is small and reversible)

| # | What | Why |
|---|---|---|
| B7-1 | **Confirmations are the shell's**: `file.new` and `file.openProject` replace the document without asking; the shell confirms a dirty project first (WP-8 already does for opening). | `EditorServices` has no dialog service; operators must stay headless. |
| B7-2 | Importing a model that is **already in the project** imports another character (name `… 2`) and warns, instead of asking "new character or cancel" (§4.11.6 step 3). | Same reason; the import dialog can ask before running the operator. |
| B7-3 | **Compressed animation data**: with the default clip choice (`clips` omitted or `'all'`) the model is imported without clips and a warning; when the caller picked clips by index the import fails with `compressed-animation`. | §4.11.6 step 4 names the error; refusing the whole model by default would make meshopt-compressed avatars unusable even though their meshes load. |
| B7-4 | Operator default for embedded clips = the import dialog's: all when ≤ 8, else none; samples use their default clip (`Idle_Loop` for UAL). | §4.11.6 "Import dialog defaults"; the test API's `auto` imports get the same behaviour as the dialog. |
| B7-5 | Imported clips are `loop: true` when their name contains "loop" (case-insensitive), else `false`. | Clip `loop` decides evaluation outside the range and the export's loop closure; UAL names its cycles `*_Loop`. |
| B7-6 | The **first character sets the scene clock**: importing into a project without characters sets `sceneFps`/`sceneRange` to the first imported clip (and the project name to the file's base name while it is "Untitled"). | §4.11.8 "With one character, clip fps = scene fps and sceneStart = 0, all mappings are the identity" (UAL at 24 fps). |
| B7-7 | Characters are placed side by side along +X, `index · 1.2 · height` apart; the shot camera `shotCam` (created only when the project has none) is **locked**, 50 mm, yaw 30° towards the character's left, at 0.72·H looking at 0.5·H, with the height in frame plus 10 %. | §4.11.6 step 8; E2E-01 expects the left pane's shot camera locked. |
| B7-8 | `import-reduce` / `reduce`: an explicit `reduce` option wins; else `prefs.reduceOnImport` ('auto' reduces when any channel has more than 0.5 keys per frame, resampled clips always). Source key times are kept by default only when they land on whole frames at the chosen rate (`fps / detected` an integer), so import never makes sub-frame keys by default; forcing `source-times` otherwise warns. | §4.11.6 step 5–6. |
| B7-9 | Character display name: the VRM meta title (ignoring converter defaults such as the literal "undefined"), else the file's base name; unique among characters. | Readable outliner rows ("Seed-san"). |
| B7-10 | **Pose tools write only channels whose value changes** (> 1e-12), so a reset, paste, mirror or plant does not key or override channels it did not move; locked channels are reported once. `pose.copy` with nothing selected copies the whole character (secondaries included). `pose.paste` pastes onto the selected controls only when the selection shares controls with the pasted pose, else onto every matching control. | §4.11.2 rules stay the single path (`applyChannelEdits`); avoids key churn under auto-key. |
| B7-11 | **Curve-level Graph operators** (`graph.tangent.set` without selected keys, `graph.curve.setWeighted`, `graph.infinity.set`, `graph.curves.simplify`, `graph.keys.keyCurves`, and `graph.tangent.lockWeight` without selected keys) act on: the curves of the selected keys, else of `selection.channels`, else of the selected controls, else every curve of the active clip (what the Graph Editor shows). | WP-6 request; E2E-07 sets post-infinity right after keying, E2E-10 frees weights before selecting a key. |
| B7-12 | `graph.tangent.unify` keeps keys whose sides share one computed slope (auto, spline, clamped, flat, … on both sides, or a stepped out side) computed and only clears `broken`; otherwise it runs the kernel's `setKeyHandle` with the resolved out handle, which keeps the out angle and turns the in side collinear with its own length. | §4.9 "unify keeps the out handle angle and each side's length" without freezing auto tangents. |
| B7-13 | `graph.keys.setFields`: frame and value fields are not snapped (typed values are exact); an angle typed on a **unified** key also turns the opposite side collinear (Maya), keeping its length; a weight changes only its own side; weight fields are ignored on non-weighted curves; `relative` adds to angles/weights as well. Collisions from typed frames resolve like a drag commit. | §4.11.4 numeric fields; Maya behaviour for unified keys. |
| B7-14 | `time.setFrame { unit: 'scene' }` sets the scene clock as given (no snapping or clamping); clip-frame sets snap (when `snapToFrames`) and clamp to the active clip range. `time.step` clamps at the range ends; `time.nextKey/prevKey` wrap around like Maya and never snap (keys may sit between frames). | §4.9 / §4.11.8. |
| B7-15 | `channel.setValues` declares **no coalescing**. | WP-7a suggested it for nudges, but WP-9 sends a nudge burst as one gesture or one run and passes a label for typed values too, so label-based coalescing would merge separate typed edits. |
| B7-16 | `clip.duplicate` does not switch the active clip; the copy is named `<name> copy` (`… copy 2`, … when taken) and ordered right after the source; layers, curves (canonical) and keys get new ids, provenance and source are copied. `clip.delete` soft-deletes the clip record only (its layers/curves stay attached to the deleted clip, so undo restores everything); the next clip in order (else the previous) becomes active, or a new empty `clip1` is created in the same step. | §4.9. |
| B7-17 | `clip.setSettings`: `fpsMode` defaults to `keep-seconds`; it rescales every key of the clip (all layers) and handle `dt` by `newFps/oldFps`, rounds the range ends to whole frames (end ≥ start + 1) and rounds the contact frame; a contact outside the final range is clamped. Validation: slot vocabulary v1 (no `tpose`), ≤ 8 lowercase tags, contact inside the range, provenance sources with SHA-256 or null. | §4.9, ADR 0010 §5. |
| B7-18 | `clip.new` makes the new clip active at its start frame; the default name is the first free `clipN`. | §4.9 "becomes active". |
| B7-19 | **Export**: the licence gate (`modification: prohibited` or `allowRedistribution: false`) applies to `bake-into-model` only (VRMA always allowed); profile preflight errors (duplicate export names always; under Ekza profiles slot names, non-redistributable clips and required clips — for bakes the model's own animations count) make the poll fail; `rootMotion: 'in-place'` without a joint to lock exports as `hips` with lint `export.in-place-unavailable` (warning). Several clips in one file get the union of their tracks (two-pass bake) when `includeConstantTracks`; surgeon bakes also include `preexistingTracks`. `projectSha256` is null. `ekza_animation_v1.rig` is `vrm-humanoid` for VRMA and bakes into VRMs, else `gltf-nodes`. File-name `{clip}` token: the clip export names joined by `-`, or `<n>_clips` beyond three. | §4.11.10, ADR 0005/0010. |
| B7-20 | When the host provides `services.validate`, `file.export` attaches the report to each artifact and turns policy violations (§4.11.13: errors for fresh writers, new `(code, pointer)` errors vs the source for surgeon outputs) into error lints `validator.<code>`, which block the download like any error lint. | One rule for "errors block the download". |
| B7-21 | `file.loadSample` fetches `/samples/<file>` relative to the page origin (no base path). Node tests stub `fetch`. | §4.9; the web app serves the samples there (`copy-assets.mjs`). |
| B7-22 | `file.openProject` with the JSON variant opens even when a referenced model is not in the asset store (warning toast; that character gets no runtime until the model is added). | ADR 0011 §3 "requires the referenced models to be supplied or already cached" — refusing would lose the curves. |
| B7-23 | `edit.copy/paste/delete` dispatch on the run context's panel, else the panel under the pointer; graph and timeline go to the key operators, everything else (viewport, outliner, Channel Box, none) to the pose operators. A failed target fails the dispatcher with the same code. `file.open` likewise forwards the importer's failure. | §4.9; the runner never throws, so failures must surface in the result. |
| B7-24 | `edit.escape`: cancels channel-edit gestures (overrides restored), else any other active store preview, else closes the dialog, else stops playback. | §4.9. |
| B7-25 | Selection operators are not undoable and record no history step; `select.controls` with another character's controls makes it active and replaces the selection (mode `remove` of foreign ids changes nothing); every control change prunes `selection.keys` to the curves the Graph Editor still shows and `selection.channels` to selected controls. | §4.9, ADR 0008 §8. |
| B7-26 | `view.tool` accepts any id while no tool is registered for the panel (headless), else only registered tools. | Tools register with their panels (WP-5/6). |
| B7-27 | Plateau (`graph.tangent.set { type: 'plateau' }`, key 7) and `rig.setRotateOrder` poll-fail with "not available yet" (M1-stretch, §1.2). | See "M1-stretch" below. |

## Dependencies on other work packages

Everything here calls the real sibling packages through their §7 public APIs only (no private stand-ins):
anim-core (`tangentFields`, `handleFromFields`, `eulerFilterCurves`, `reduceKeys`, math), doc (`fractionalIndex`,
`emptySnapshot`, `SCHEMA_VERSION`, ids), rig (`autoRig`, `compileRig`, `writeRigDefinition`, `importRawClip`,
`importHumanoidClip`, `detectClipFps`, `mirrorPose`, `makePoseClipboard`, `applyPoseClipboard`, `plantFeetChannels`,
`isHumanoidProgram`, `computeStepSchedule`, `humanoidRestWorldPositions`, `nodeForControl`), io (`parseGlb`,
`checkInputBudget`, `detectModelFormat`, `skeletonFromGltf`, `readAnimations`, `readVrma`, `readVrmLicense`,
`bakeClip`, `bakeIntoModel`, `writeAnimationGlb`, `writeVrma`, `preexistingTracks`, `ekzaAnimationMeta`,
`exportFileName`, `clipExportName`, `clipFramesToSeconds`, `compareValidation`, `readProjectArchive`,
`writeProjectArchive`, `writeProjectJson`, `BUILTIN_EXPORT_PROFILES`). io's extra exports (`importProvenance`,
`inspectVrma`, `setGltfValidator`) are not used, so this branch type-checks against the WP-0a stubs.

Tests that need an implementation skip themselves until it lands (§8.1), with the blocking WPs in their titles:

| Tests | Blocked by | Status on this branch |
|---|---|---|
| `editor-core/test/builtin/*` (126 tests) | `clip.*` → WP-2 (`fractionalIndex`); `setFields`, Euler filter, Simplify → WP-1; pose clipboard, mirror, feet → WP-3 | 102 run now, 24 skip |
| `headless-tests/test/ops.*` (58 tests: import of the three fixtures, sample loading, export of all three kinds with the validator policy, projects, pose tools on the real rig, undo/redo exactness of every undoable operator, a 30-step session) | WP-1, WP-2, WP-3, WP-4 | skip |

**Integration evidence.** Every skipped test was run by overlaying the sibling branches' sources into this worktree
(working tree only, never committed: `wp/wp-1` anim-core @ 4aa4289, `wp/wp-2` doc @ 4277f31, `wp/wp-3` rig @ 0628635,
`wp/wp-4` io @ ec87ac7): editor-core 451/451 tests pass (all WP-7a tests included), headless `ops.*` 58/58 pass, and
`tsc -b` is clean in both states.

Notable results with the real packages: UAL `Idle_Loop` imports at 24 fps on whole frames 0…60 and matches the
source samplers within 1e-4 rad / 1e-5 m at every source key time without reduction; with default reduction the
dense curves shrink ≥ 3× and the pose error stays within 0.3°; Polybot Plant Feet returns both feet to their pins
within 1e-4 m / 1e-4 rad; Seed-san bake adds no validator error, keeps the BIN prefix and `VRMC_vrm`, and re-imports
with rz(15) = −30°; VRMA exports validate with 0 errors and round-trip onto Seed-san within 1e-4 rad; the
animation-only GLB of UAL re-reads to the editor pose within 1e-4 rad; UAL in-place bake keeps 46 animations with
`Idle_Loop` at index 9; `.ekzanim` save → open is identical (counts, curves, channel values at 5 frames, model bytes).

## Requested contract changes and notes for other work packages

- **§4.5 `OperatorMap`** (operator freeze): add `select.channels` and `view.camera.setSettings` (above) to
  `operators/args.ts`; they are declared by module augmentation in `operators/builtin/{select,view}.ts` until then.
- **§4.9**: state B7-1/B7-2 (confirmations belong to the shell) and B7-3 (compressed animation by default).
- **WP-8**: `file.importModel`/`file.loadSample`/`file.openProject`/`file.export` set `session.busy` during
  `prepare` (`progress` is a fraction for imports); import warnings come back in `ImportResult.warnings` and as one
  warning toast; `file.export` downloads the artifacts without error lints itself (the recorder sees them through
  `services.files.download`) and returns all artifacts, blocked ones included, so the dialog can list their lints.
  Pass `services.validate` (the stretch validator worker) to get validation reports and policy lints.
- **WP-5**: `view.camera.setSettings` is registered here; the Attributes panel enables its lens fields by polling it.
- **WP-6t / WP-6**: the band menu and the Graph Editor run `graph.keys.*`, `graph.tangent.set` etc. on
  `selection.keys`; key parts without the key part (handles only) are honoured by `graph.tangent.set` (that side) and
  ignored by move/scale/delete/copy (key parts only).
- **WP-10 (e2e)**: E2E-01 relies on B7-7 (locked `shotCam`); E2E-04 on B7-4/B7-8 (UAL with `Idle_Loop` only, 24 fps,
  reduced); E2E-27 on `time.setFrame { unit: 'scene' }` (B7-14).

## M1-stretch

Not done yet: plateau tangents (WP-1 implements plateau as AnimX legacy auto; enabling is a one-line change in
`graph.ts` `NOT_YET` plus a test), pose-preserving rotate-order change (`rig.setRotateOrder` over WP-3's
`convertRotateOrderKeys`), animation-only GLB import onto a character (FR-IO-10, WP-3's `remapRawClipByName`).

## Gates (run in this worktree)

See the final report of this work package for the gate results.
