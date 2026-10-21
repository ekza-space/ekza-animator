# M6b C7 — rig shell: Rig & Skin workspace, modes, test pose, sources, menus, checklist, Validation: build notes

Branch `m6b/rig-shell` (from `m6b/mvp` at `22b0e11`, spec v1.3, with `m6b/rig-contracts` merged at `ea3bbc3`). Scope:
[M6B-SPEC §9.0 C7](../M6B-SPEC.md#c7--rig-shell) — §5.24 (cut to the MVP), CR-4, §7's MVP rows, shadows and
conformance, §5.17 without the ROM clip, the §0.4.5 menus, the `rig.modes` marking menu, status groups, the Rig
Toolkit frame with the MVP checklist, the Validation service and panel, tab glyph, empty states, the Getting started
card and the §0.4.9 eager gate. Decision IDs below are `M6B-C7-<n>`.

## What landed

| C7 item | Where |
|---|---|
| CR-4 (`WorkspaceDef.keyModes` in the scope chain) | `editor-core/src/keymap/scopes.ts` (`ScopeChainInput.modes`; Model's rule unchanged when absent) + one call site in `editor/src/input/keyboard.ts` (`scopeChain()` passes `def.keyModes?.(app)`) |
| WorkspaceDef | `editor-core/src/workspaces/rig.ts`: layout `rig-side`, `keyModes` (`[mode]` outside Object), `status` = the Validation glyph of the active character (`rigStatus`) |
| Modes | `operators/builtin/rig/mode.ts`: `rig.mode` (`1`/`2`, the active digit again → Object for keyboard runs, `F8` toggle, Skin needs a bound mesh: "Bind a mesh first (Skin › Bind Skin)", Shapes "Arrives after the MVP"), pick masks and default tools per mode (`MODE_MASKS`, `MODE_TOOLS`), U state; `rig.validation.profile` |
| Pose view | `operators/builtin/rig/pose.ts`: `rig.pose.view` (Bind clears and keeps a copy, Test restores, Clip after the MVP), `rig.pose.resetTest`; `shadows.ts`: `rig.animateOnly` |
| Channel sources | `evaluation/rigSource.ts`: `bind` (defaults; the MVP compiles no enabled constraint, M6B-C7-3) and `test` (defaults ⊕ test pose), `rigValues()` so the Channel Box and the manipulators read the pose on screen (two reads in `evaluation/service.ts`), the channel-edit redirect registry |
| Test pose | `rig/testPose/gesture.ts`: manipulator drags and Channel Box edits in Rig & Skin write the test pose (one 'Test Pose' step per drag; cancel restores) through the redirect hook in `edit/channels.ts` (`beginChannelEditGesture`) and `channel.setValues` (`operators/builtin/key.ts`) |
| Entering / leaving | `rig/chunk/workspace.ts` (`startRigWorkspace`, created with the services): Bind on entry, sources per character, the active character from the selection, first test write → Test + toast once per session, leaving forgets test poses, `dropTestPoses`, cancels channel gestures, closes the Last-op card, sources back to `animate`; ⑤ marked by a library preview |
| Keymap | `keymap/maya.rig.ts` (eager: `RIG_SCOPE`, `KEYING_CHORDS`, the shadow rows `RIG_SHADOW_KEYMAP`, contributed with the `maya` preset by `registerBuiltins`, M6B-C7-15) and `rig/chunk/keymap.ts` (`RIG_KEYMAP`: every other §7 MVP row, contributed by the chunk) |
| Boot into Rig & Skin | `switchWorkspace(app, 'rig')` starts `app.rig.load()` (the boot path has no `workspace.set` prepare); `app.rig.load()` retries after a failed load; `redirectedChannelEdit` refuses channel edits in Rig & Skin before the chunk's redirect exists (an inert gesture: no override, no key) |
| Hide, show, isolate | `operators/builtin/hide.ts` (§6.3 names C7 for the change): Rig variants by mode (M6B-C7-16); `modelManifest.ts` regenerated (`workspaces: ['model', 'rig']`) |
| Menus (round 1) | Skeleton › Symmetry X ✓ and Map Humanoid Bone ▸ (`registerRigDynamicMenus`: re-registered with the active skeleton's and the lead joint's args), Skeleton › Snap to Projected Center ✓ and Display › Joint Size ▸ (shell operators `rig.snap.projectedCenter`, `rig.jointSize.set`, `shell/rig/operators.ts`) |
| Validation (round 1) | `rig.out-of-sync` producer (M6B-C7-17), `skin.influences` Fix = Prune to 4, `rerun()` and the panel's [Re-run], `selectValidationRow` (Select: joints → Skeleton, points → Skin with the meshes hilited and the points selected, meshes → objects; then `view.frame {selection}`) |
| Validation | `rig/validation/{inputs,rows,checklist,index}.ts`: rows per profile (severity table §5.21, MVP rows §0.4.5), fixes, cache by document and mesh-runtime versions, profile (U), glyph, `rigChecklist` (CR-AR-4), `rigValidation(app)` |
| Services | `rig/chunk/services.ts` (validation, controller), `app/factories/rig.ts` (disposes them) |
| Layouts | `editor/src/shell/rig/layouts.ts` (`RIG_SLOTS`, `buildRigLayout`, `RIG_LAYOUTS`, `applyRigLayout`, `RIG_MARKER_PANES`); `shell/layout.ts` (slots, builder, version 1 for `rig`); viewport layouts `rig-side` (`pane-front │ pane-persp`) and `rig-markers` (`pane-front │ pane-side │ pane-persp`, 40/30/30) in `viewport/src/panes/layout.ts` and `ViewportPanel.tsx`; Rig display defaults `RIG_DISPLAY` in `viewport/src/manager/workspaceViews.ts` |
| Shell UI (lazy) | `shell/rig/index.ts` (eager hook, one line in `createShell.ts`) → `shell/rig/register.ts`: `shell/menus/rig.ts`, `overlays/menus/rig/{index,modes}.ts`, `shell/rig/status.tsx` (rigMode, poseView, rigSymmetry, rigSnap, jointDisplay), `panels/viewport/rig/overlays.tsx` (pose badge, HUD mode badge, empty state, Getting started), dock tab following the mode |
| Panels | `panels/rigToolkit/index.tsx` (frame: header, mode switcher, checklist, sections, footer), `panels/validation/index.tsx` |
| Test API | `editor/src/test-api/m6b/rig-shell.ts`: `rigState()`, `validation(profile?)`, `rigCompiles()` |
| Size gate | `apps/web/scripts/size-baseline.json` (`enforce: true`), `check-size.mjs` (per-package allowance line) |
| e2e | `apps/web/e2e/m6b-rig-{01,02,05,08}-*.spec.ts`; `helpers/m6b-rig.ts` pane ids; E2E-M6B-00's menubar check |
| READY | `c7: true` in the four `test/m6b-ready.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6B-C7-1 | **Rig pane ids are the layouts' own**: R-Side = `pane-front │ pane-persp`, R-Markers = `pane-front │ pane-side │ pane-persp`, two new `ViewportLayout` values `'rig-side'`/`'rig-markers'` (additive in `editor-core/src/types.ts`, `LAYOUT_PANES`, the user-preset validator, the status-line and Windows › Layout lists, `LAYOUT_ICONS`). C0's helper constants (`RIG_FRONT_PANE = 'pane-left'`) are corrected to `pane-front`/`pane-persp` (+ `RIG_SIDE_PANE`). | §10's rows and AS-MVP-1 name `pane-front`, `pane-side`, `pane-persp`; the shipped split is Animate's shot │ free with `pane-left`/`pane-right`. |
| M6B-C7-2 | **`S` never keys over any Rig panel**: the shadow rows bind in `rig.viewport` (§7) and also in `rig.outliner`, `rig.channelBox`, `rig.timeline`, `rig.dopeSheet`, `rig.graph` (keying chords and key deletion). | The chain over a panel is `rig.<panel>` → `<panel>` → `rig`, so the panel's shipped `key.set` row would win over a `rig` row; DoD "keys hash unchanged by S in every Rig scope". |
| M6B-C7-3 | **`bind` = channel defaults on the character's program**; no constraint-free recompile. | The MVP compiles every constraint record as a disabled op (C8a deferred, §0.3), so the program is already constraint-free; C8a swaps in `withoutConstraints` when constraints arrive (comment in `rigSource.ts`). |
| M6B-C7-4 | **Test poses through the shipped edit paths**: `beginChannelEditGesture` (manipulators, Channel Box drags) and `channel.setValues` (typed values) answer with a test-pose write while Rig & Skin is active (a redirect the rig chunk registers per app); the Channel Box and the manipulators read `defaults ⊕ test pose` (`evaluation.channelValues/channelValue` under `bind`/`test`). | §5.17 "W/E on controls in Object mode", "auto-key is off while the source is not animate": without the redirect a drag would write overrides and auto-keys. One hook line in each shipped file. |
| M6B-C7-5 | **The rig shell UI is a lazy chunk** loaded on the first Rig & Skin entry (`shell/rig/index.ts`, one line in `createShell.ts`); menus, `rig.modes`, status bodies and pane overlays register there. Pane overlays (`hud`, `emptyState`, `gettingStarted`) draw the slot's earlier registration outside Rig & Skin. | §0.4.9: C7's eager bytes are the `WorkspaceDef`, the hook and the layouts. Rig panels and their Windows items are listed in Rig & Skin only (they left Animate's "extra panels"). |
| M6B-C7-6 | **Menus list what works** (§0.4.5, Q-MVP-15), all §0.4.5 items included (fix round 1). `MenuItemDef.args` are static, so the items whose arguments come from the selection are **re-registered** when the active skeleton, its symmetry flag or the lead joint changes (`registerRigDynamicMenus`): Skeleton › Symmetry X ✓ (`skel.symmetry.set {skeleton, on}`) and Map Humanoid Bone ▸ (`skel.joint.setHumanBone {joint, bone}`, 55 bones + None grouped centre / left / right / fingers); without a skeleton or a joint they carry no args and poll-fail. Skeleton › Snap to Projected Center ✓ and Display › Joint Size ▸ (Small 0.5 · Medium 1 · Large 1.5 · Extra Large 2) run two internal shell operators (`rig.snap.projectedCenter {on?}`, `rig.jointSize.set {size \| step}`; like `workspace.showPanel`, not §6 ids; the palette does not list them). Rename waits for C2 (optional); the Component Editor item waits for C6 (optional). File › Export Character… opens the Export dialog (`ui.open {dialog: 'export'}`; `file.exportCharacter` needs a full `CharacterExportRequest`, C10's dialog builds it). | `MenuItemDef.args` are static; the status line keeps its own controls. |
| M6B-C7-7 | **Projected-centre snap is a session toggle** set by the status line (no MVP operator owns `session.rig.snap`). | §0.6 lists no snap operator; U state. |
| M6B-C7-8 | **The pose badge** is a provider of C0's badge slot with id `pose` (`hud-badge-pose-<paneId>`, `BIND POSE` / `TEST POSE`, Rig & Skin only); the HUD mode badge is `hud-rigmode-<paneId>` (`JOINT · SYM X` with `34 joints · 15/15 required`, `SKIN`). | §0.3: "BIND and TEST POSE badges through C0's badge slot", whose ids are `hud-badge-<id>-<paneId>` (M6B-C0-21). |
| M6B-C7-9 | **Validation rows**: C2's `checkSkeleton` (skel.*, xform.*) and C6's `checkSkin` (through the lazy kernel) run when they have landed (a `not-implemented` stub gives no rows); the shell computes `skin.unbound` and the VRM meta rows (`vrm.meta-required`, `vrm.licence-unset`, `vrm.thumbnail-square` = a stored thumbnail asset; squareness is C10's renderer). Only the §0.4.5 MVP codes are shown; asset-sourced characters have no Rig rows (their export lints judge them). `rig.out-of-sync` appears when C1/C2's rule reports it (`RigProblemCode`). M6a's `mesh.*` lints are not in the panel in the MVP (they run on export bytes; the three skin lints' suppression is the character export's, C10). Profiles offered: `ekza/space-avatar-v1` (default) and `local/generic`. A skin skeleton for `checkSkin` is built from the joint records (`skinSkeletonOf`), C4/C6 may share theirs. | §5.21, §0.4.5, §0.4.6. |
| M6B-C7-10 | **Checklist glyphs**: `done` when the step's check passes, `attention` when it can be worked on (① without a skeleton, ③ partly bound, ④ weight problems, ⑤ before a preview, ⑥ error rows), `todo` while the step before gives it nothing to check. ⑤ counts a library preview this session or a clip brought in (imported/embedded) or with curves; an empty new clip and test clips do not count. | §0.4.5 "done when …"; steps never locked. |
| M6B-C7-11 | **Active character** (§5.24): the selected joints' skeleton, else the selected controls', else the selected objects' owner, else the only character, else the previous one while it exists. | §5.24 "else none" kept for an empty scene; keeping the last one avoids the Toolkit flickering when the selection moves to the scene. |
| M6B-C7-12 | **Dock tabs follow the mode, remembered per mode** (fix round 2): on a mode switch the right and bottom tabs of the new mode are shown (Object → Channel Box / Validation, Skeleton → Rig Toolkit / Validation, Skin → Paint Weights / Component Editor, `RigSessionState.tabMemory`). The tabs the user left showing in the previous mode (each dock group's visible Rig tab, read from the dockview when the mode changes) are remembered for that mode first, so the next entry to it shows them (`followModeTabs`, `rememberTabs` in `shell/rig/register.ts`). A dock showing no Rig tab keeps its remembered tab. The createShell hook passes `dockview: () => workspace.dockview` (one line). | §5.24 table, §8.2 "the tab following the mode unless the user changed it in that mode (remembered per mode)". Reading the tabs at the switch needs no dock event. |
| M6B-C7-13 | **Literal updates** (§3 rule 9, assertions kept): editor-core `m6b/foundation.test.ts` (C7's operators poll on their own args), `m6b/keys-hash.test.ts` (C7 rows `checked` with a Rig & Skin fixture), editor `test-api.test.ts` (Rig & Skin glyph ○ "No skeleton yet"), web `m6a-size.test.ts` (gate enforced, per-package allowances, `packages` field). | Owners land their rows. |
| M6B-C7-14 | **M6b display flags accepted by the display operators** (`workspace.ts` `ENUM_FLAGS`/`BOOLEAN_DISPLAY_FLAGS`: joints, xrayJoints, jointAxes, jointLabels, weights, weightNumbers, lockRelative, constraintLines). `Alt+C` in Skin mode is bound to `view.display.toggle {flag: 'weights'}` per §7; toggling the enum (off ↔ greyscale) is C6's weight-display work. | The Display menu needs them; `weights` is an enum, the shipped toggle flips booleans. |
| M6B-C7-15 | **`S` never keys before the rig chunk has loaded** (fix round 1). The shadow rows (`S`, `Shift+W/E/R`, `Alt+S`, `Alt+M`, `Mod+C`/`Mod+V`/`Mod+Shift+V`, `Delete`/`Backspace` → `rig.animateOnly` over the viewport and the keying panels) are **eager** and contributed with the `maya` preset (`registerBuiltins`, one line), so a reload straight into Rig & Skin (`?ws=rig`, `prefs.lastWorkspace`) or a failed chunk load never reaches `key.set`/`pose.*`; the runner loads the chunk to run `rig.animateOnly`, which poll-fails. `switchWorkspace(app, 'rig')` starts the chunk load (the boot path enters without `workspace.set`'s prepare) and a failed load is retried by the next call; until the chunk's test-pose redirect exists, a channel edit in Rig & Skin is refused (an inert gesture). §7 says rows register with the chunk: only these shadow rows are eager (+≈200 B gzip, inside C7's allowance). | DoD "`S` never keys in any Rig scope". |
| M6B-C7-16 | **Rig variants of `view.hide`/`view.showAll`/`view.isolate`** (§0.6, §6.3, §7): by the Rig mode — Object: objects (Model's object rule); Skeleton: `H` hides the selected joints, `Alt+H` every other live joint, `Shift+H` shows them (`session.rig.hiddenJoints`, U state without a step: the closed `HideSnapshot` has no joints), `Shift+L` isolates the meshes of the selected joints' characters (else the active character's) in the pane; Skin: Model's vertex rule (the faces the selected points touch) on the hilited meshes, else the active character's bound meshes (one "Hide"/"Show" step with selection undo). Shapes is after the MVP. C3's joint overlay and picking read `hiddenJoints` (contract field, §4.6). | §6.3 names C7 for the change of the M6a operators. |
| M6B-C7-17 | **`rig.out-of-sync`** is the shell's: the rig record's `skeleton.fingerprint` (C1's `rig.autoRig.update` writes `skeletonFromDoc(…).fingerprint`) differs from `skeletonFromDoc({skeleton, joints, meshes: []}).fingerprint` (= `jointsFingerprint`, joints only) — a warning in both profiles with the Fix Update Control Rig; a row C2's `checkSkeleton` might add is not duplicated. | `DocSkeletonInput` carries no rig, so C2's rule cannot see it. |
| M6B-C7-18 | **Prune to 4** = `skin.weights.prune` with its default `below` (the closed args have no influence cap; §5.10 makes every weight tool, prune included, keep at most four influences). | §5.21 Fix column. |
| M6B-C7-19 | **`Mod+A` in Object mode** is the shipped `select.all` ("every visible control of the character"): §7 writes `select.controls {all}`, whose closed args take `ids` only. `Mod+A` in Skin mode is `select.mesh.all` and `Shift+Period`/`Shift+Comma` grow/shrink (M6a's component operators; they poll-fail outside Model until C6 opens them to Skin mode). | §7 rows of MVP operators, bound to what exists. |
| M6B-C7-20 | **Selection per mode** (§5.24): leaving Skeleton remembers its joints, leaving Object its controls; entering the mode again restores them (live records only; per app session, U state). Points stay per mesh in the component selection service (C6). | §5.24. |
| M6B-C7-21 | **Kept copy and history**: any test-pose write (an edit, or an undo/redo of a 'Test Pose' step) forgets the copy Go to Bind Pose kept for that character, so Test never brings back a pose the history removed. | Review finding (fix round 1). |

| M6B-C7-22 | **Keying is refused in Rig & Skin from every surface** (fix round 2). `rigRunRefusal` (`evaluation/rigSource.ts`) is checked by the runner before an operator's own poll and by `operators.poll` (menus, palette, Channel Box read it): in Rig & Skin `key.set`, `key.deleteAtFrame`, `key.convert`, `key.tween`, `pose.paste`, `pose.mirror`, `pose.mirrorAnimation`, `pose.plantFeet`, `pose.resetToRest`, `time.insertTime`, `time.deleteTime`, `rig.ikFk.*` and every `graph.*` write (all but `graph.keys.copy`, `graph.buffer.snapshot`, `graph.buffer.clear`) are cancelled with "Keys and poses are set in Animate". The palette leaves them out in Rig & Skin. One check, not a poll edit per operator: it covers the Channel Box's "Key Selected", `Mod+K`, the Graph Editor and the Dope Sheet alike, and the `?ws=rig` boot before the chunk. `channel.setValues` keeps its test-pose redirect (M6B-C7-4). | §5.17 "never a key", "keying is impossible in Rig & Skin". |
| M6B-C7-23 | **Selection undo in Rig & Skin** (fix round 2): the control selection operators (`select.controls`, the viewport/Outliner/Dope Sheet path, plus `select.all`, `select.none`, `select.mirror`, `select.pickWalk`) record one M6a selection part ("Select", no document step, nothing when the selection did not change) while Rig & Skin is active and `prefs.modeling.undoSelection.rig` is on; Animate is unchanged. The part is recorded inline (`selectControlsGesture` in `select.ts`), not through `selectionGesture`, to keep the mesh selection steps out of the eager bundle (−493 B gzip). Object picks (`select.objects`) record through M6a's `selectionGesture` as in Model. **Joint selections**: `select.joints` is C3's (a stub here) and the closed `SelectionSnapshot` has no `joints`/`constraints` fields yet (§5.24 "extend SelectionSnapshot", additive): that contract change and the joint/constraint selection parts go to C3 + a contract PR (INT). | §5.24 "Selection undo". |
| M6B-C7-24 | **Object mode picks meshes** (fix round 2): `select.objects` runs in Rig & Skin Object mode (manifest `workspaces: ['model', 'rig']`; other Rig modes: "Objects are picked in Object mode"; Animate: "Objects are selected in Model and Rig & Skin" instead of the component-mode text). The viewport select tool, in Rig & Skin Object mode with the meshes pick mask on, picks the nearest drawn scene mesh (`ModelSelectRuntime.pickObject`, loaded whenever meshes exist) when no control is under the cursor; a plain click on empty space also clears the objects. So the active character from the selected objects, `H`/`Shift+L` on objects and Quick Rig on the selected meshes work inside Rig & Skin. | §5.24 pick mask "meshes, joints, controls". |
| M6B-C7-25 | **View-only below 1024 px** (fix round 2): the lazy rig shell watches `matchMedia('(max-width: 1023.98px)')` (`shell/rig/viewOnly.ts`) and sets `setRigViewOnly(app)`; in Rig & Skin the runner then refuses every operator with `flags.undo` except `channel.setValues` (a test pose there) with "Open on a larger screen to edit"; test poses, the pose view, selection, modes and Validation (re-run, profile, Select) keep working. The pane banner `rig-view-only` ("Open on a larger screen to edit" — research 09 §11.2's text — and "Rig & Skin is view-only below 1024 px: test poses and Validation work") sits above the Getting started card. Without `matchMedia` the editor stays editable. | §5.24 Accessibility; research 19, research 09 §11.2. |
| M6B-C7-26 | **`Alt+H` in Skeleton mode** hides the other joints of the selected joints' skeletons only (else the active character's skeleton); other characters' joints are untouched (fix round 2). | Review finding. |

## Deferred or left to owners (MVP)

ROM clip (`skin.test.rom`), Constrain/Control menus, marking menus other than `rig.modes`, the Rig Outliner variant
(CR-5) and `rig.outliner.delete`, R-Quad/R-Paint, per-mode display switching (X-ray mesh in Skeleton mode: C3; weight
display in Skin mode: C6), IK → FK for `E` on joints (C3), Skeleton/Skin help-line texts (C3/C6), joint and constraint
selection parts (C3 with the `SelectionSnapshot` contract PR, M6B-C7-23). The view-only banner and the per-mode dock
tab memory, listed here in round 1, are implemented in round 2 (M6B-C7-25, M6B-C7-12).

## Edits outside C7's Dirs — INT approval requested (§9.0, §9.1)

C7 touched the files below beyond its Dirs. None has a recorded INT approval yet: **INT, please approve (or route)
each row when merging `m6b/rig-shell`**, and record the decision here. Rows marked *closed* are files §9.1 closes
after C0 (they need a contract PR); the others are unlisted shared or M6a files (§9.0: INT's approval).

| File | Change | Why | Status |
|---|---|---|---|
| `editor-core/src/types.ts` (*closed*) | `ViewportLayout` + `'rig-side' \| 'rig-markers'` (additive) | the R-Side/R-Markers pane ids §10 names (M6B-C7-1) | contract PR requested |
| `apps/web/e2e/helpers/m6b-rig.ts` (*closed*) | `RIG_FRONT_PANE = 'pane-front'`, `RIG_PERSP_PANE = 'pane-persp'`, + `RIG_SIDE_PANE` | C0's constants named Animate's split panes (M6B-C7-1) | contract PR requested |
| `apps/web/e2e/m6b-00-foundation.spec.ts` (*closed*) | the menubar check now expects Skeleton and Skin (C0's comment said C7 extends it) | C7's menus exist | contract PR requested |
| `editor-core/src/edit/channels.ts`, `operators/builtin/key.ts` | one redirect line each (`redirectedChannelEdit`); round 2 adds nothing to `key.ts` (keying is refused in the runner, M6B-C7-22) | test poses through the shipped edit paths (M6B-C7-4) | pending |
| `editor-core/src/evaluation/service.ts` | two reads of `rigValues` (Channel Box / manipulators show the pose on screen) | M6B-C7-4 | pending |
| `editor-core/src/operators/builtin/workspace.ts` | `workspace.set` prepare loads the rig chunk; the M6b display flags | §2.1, M6B-C7-14 | pending |
| `editor-core/src/workspaces/switch.ts` | `rig` default view (R-Side); entering Rig & Skin starts the chunk load | §8.2, M6B-C7-15 | pending |
| `editor-core/src/operators/builtin/index.ts` | one line: contribute `RIG_SHADOW_KEYMAP` with the preset | M6B-C7-15 | pending |
| `editor-core/src/operators/builtin/hide.ts`, `modelManifest.ts` (generated) | the Rig variants | §6.3 names C7 for this change (M6B-C7-16) | owner per §6.3; INT to confirm |
| `editor-core/src/index.ts` | barrel lines for C7's exports | — | pending |
| `editor/src/input/keyboard.ts` | CR-4 call site (`def.keyModes`) | CR-4 (C7's by §0.4.1) | pending |
| `editor/src/shell/{createShell.ts,StatusLine.tsx,menuItems.ts,presets.ts}` | the rig shell hook; the Rig layout list in the status line and Windows › Layout; the preset validator accepts the two layouts | M6B-C7-1, M6B-C7-5 | pending |
| `editor/src/panels/viewport/ViewportPanel.tsx`, `viewport/src/panes/layout.ts`, `viewport/src/manager/workspaceViews.ts` | the two pane grids and `RIG_DISPLAY` | §8.2 (M6B-C7-1) | pending |
| `ui/src/icons/custom.tsx` | the two layout icons | — | pending |
| tests: `editor-core/test/builtin/registration.test.ts`, `m6b/foundation.test.ts`, `m6b/keys-hash.test.ts`, `editor/test/test-api.test.ts`, `apps/web/test/m6a-size.test.ts`, `apps/web/e2e/m6a-shell.spec.ts`, the four `test/m6b-ready.ts` | literal updates, assertions kept (§3 rule 9; M6B-C7-13) and the READY flag | — | pending |
| `editor-core/src/operators/{runner.ts,registry.ts}` (round 2) | one `rigRunRefusal` check each, before the operator's poll | keying refused from every surface, view-only below 1024 px (M6B-C7-22, -25) | pending |
| `editor-core/src/operators/builtin/select.ts` (round 2) | `selectControlsGesture`: the control selection operators record a selection part in Rig & Skin | M6B-C7-23 | pending |
| `editor-core/src/operators/builtin/selectMesh.ts`, `modelManifest.ts` (generated) (round 2) | `select.objects` in Rig & Skin Object mode; reason texts | M6B-C7-24 | pending |
| `viewport/src/tools/selectTool.ts` (round 2) | `rigObjectClick`: mesh pick in Rig & Skin Object mode | M6B-C7-24 | pending |
| `editor/src/overlays/CommandPalette/controller.ts` (round 2) | keying entries left out in Rig & Skin (two lines) | M6B-C7-22 | pending |
| `editor/src/shell/createShell.ts` (round 2) | the rig shell hook also gets `dockview` | M6B-C7-12 | pending |
| `apps/web/scripts/{check-size.d.mts,size-baseline.json}` | the MVP gate (`enforce: true`, per-package allowances) | §9.1 gives C7 the gate through the B9 owner's review | pending |

## Fix round 1 (review of `c078648`)

| Finding | Disposition |
|---|---|
| major — `S` keys when booting into Rig & Skin | fixed: M6B-C7-15; unit test "booting straight into Rig & Skin", e2e E2E-RIG-02 `?ws=rig` scenario |
| major — `view.hide`/`showAll`/`isolate` Rig variants missing | fixed: M6B-C7-16; unit test "hide, show and isolate in Rig & Skin" |
| major — closed/unowned files without INT approval | listed above for INT; no approval can be recorded by C7 itself |
| minor — §7 rows missing | fixed: `skin.paint.mode` steps, `Mod+A` per mode, grow/shrink (M6B-C7-19); conformance test checks every §7 MVP row and chord/scope uniqueness |
| minor — `rig.out-of-sync` has no producer | fixed: M6B-C7-17 |
| minor — §0.4.5 menu items moved out | fixed: M6B-C7-6 (revised) |
| minor — kept copy vs undo | fixed: M6B-C7-21 |
| minor — Validation details | fixed: Prune to 4 (M6B-C7-18), Select switches mode, selects points and frames, [Re-run] |
| minor — selection per mode, banner, dock-tab memory | selection per mode fixed (M6B-C7-20); the banner and the per-mode dock-tab memory listed as MVP deferrals |

## Fix round 2 (review of `300566d`)

| Finding | Disposition |
|---|---|
| major — a test pose can become a key through the palette / Channel Box "Key Selected" (key.set, key.deleteAtFrame, pose.mirror, graph.keys.keyCurves finish in Rig) | fixed: M6B-C7-22; unit test "keying is impossible in Rig & Skin" (test pose, then key.set all/selected, key.deleteAtFrame, pose.mirror/paste/resetToRest, graph.keys.keyCurves/delete, time.insertTime: cancelled, `operators.poll` says why, keys hash, store version and history unchanged; Animate keys as before); e2e E2E-RIG-05 MVP part 2 (the Channel Box's right-click Key Selected, the palette without keying entries, key.set / pose.mirror / graph.keys.keyCurves refused, keys hash and counts unchanged) |
| major — selection undo in Rig & Skin not implemented | fixed for controls and objects: M6B-C7-23; unit tests "selection undo in Rig & Skin" (one step per gesture, nothing for a no-op, undo/redo restore, no document change; Animate unchanged); e2e E2E-RIG-01 MVP part 2 (an Object-mode mesh click records Select; undo/redo) and E2E-RIG-05 part 2. Joint/constraint parts: C3 + contract PR (recorded above; INT to route) |
| major — closed/shared files without INT approval | the table above now lists round 2's edits too; C7 cannot record INT's approval itself |
| minor — meshes cannot be picked in Rig Object mode; wrong reason text | fixed: M6B-C7-24; unit test "Object mode picks meshes"; e2e E2E-RIG-01 MVP part 2 (click on the framed cube → Quick Rig enabled) |
| minor — `Alt+H` hides every character's joints | fixed: M6B-C7-26; unit test "Alt+H in Skeleton mode is limited to the skeletons in scope" |
| minor — banner < 1024 px and per-mode dock tab memory deferred without approval | implemented: M6B-C7-25 (unit tests in editor-core and editor; e2e E2E-RIG-01 MVP part 2 at 900 px: banner, edit refused, banner gone at full width) and M6B-C7-12 (editor unit tests "the dock tabs per mode") |

## Eager route (§0.4.9)

Production build (no `NEXT_PUBLIC_EKZA_E2E`), `check:size` (gzip -9, first visit), fix round 2: **893,585 B** (gate
900,000 B, headroom 6,415 B); the M6b MVP eager delta **+4,016 B** over the 889,569 B baseline (allowance +6,144 B,
enforced). C0 recorded 891,104 B, so **C7's own delta is +2,481 B** (allowance 2,560 B). Round 2 added +595 B over
round 1's 892,990 B: the runner/registry refusal (one regex of the keying ids, the view-only reason), the inline
control selection part, the Object-mode mesh pick in the select tool and the palette filter. A first cut that reused
M6a's `selectionGesture` pulled the mesh selection steps into the eager bundle (+493 B; 2,865 B over C0, above the
allowance) and was replaced by the inline part. The banner, the width watcher and the dock tab memory are in the lazy
rig shell chunk; the `select.objects` change is in the lazy Model operators chunk (its manifest is eager, +5 B).

Round 1: **892,990 B**; the M6b MVP eager delta **+3,421 B**; C7's own delta **+1,886 B**: the `WorkspaceDef`
additions (layout, `keyModes`, `rigStatus`), CR-4's chain and call site, the Rig dock layout and viewport presets
(`shell/rig/layouts.ts`, the triple pane grid, `RIG_DISPLAY`, the icon), the M6b display flags, the channel-source
reads and redirect hooks (with the refused edit before the chunk), the rig shell hook, and — new in round 1 — the
eager shadow rows and the chunk load on entry (+401 B; the round-0 measure was 892,589 B, +1,485 B). The Rig hide
variants are in the lazy Model operators chunk; the rest of the Rig rows, the menus and the shell operators are lazy.

## Gates, fix round 2 (local, real Chrome; port 3164)

`EKZA_E2E_PORT=3164 pnpm run ci` (load average 73–92 from other processes):

- format:check, lint, typecheck, check:deps, check:fixtures, check:licenses: pass.
- test: one M6a viewport test failed under load (`m6a-transform/runtime.test.ts` "Esc (cancel) during a drag": the
  scale chunk "Failed to fetch dynamically imported module", so the drag never armed; Model workspace, not Rig & Skin);
  it passes alone (29/29) and the next `pnpm run test` was green: 15/15 tasks (editor-core 1372, editor 534 + 1
  skipped, viewport 243 + 1 skipped, headless 193, curve-editor 209 + 3 skipped, the rest as before).
- build: pass; check:size 893,585 B (see above).
- test:e2e: the first two runs stopped before any test — `next build` of the e2e server panicked in Turbopack
  ("TaskId … all_assets_from_entries_filtered was canceled", the same task id twice: a stale persistent cache after the
  interleaved production and e2e builds). With the worktree's `apps/web/.next/cache/turbopack` removed: **226 passed,
  27 skipped, 0 failed** (the shipped skips plus C7's four gated full rows).
- C7's specs (with m6b-00-foundation and m6a-shell): green, including the new MVP parts E2E-RIG-01 part 2 (mesh pick,
  selection undo, view-only at 900 px) and E2E-RIG-05 part 2 (Key Selected, palette, refused keying, selection undo).
- Port 3164 free at the end.

## Gates, fix round 1 (local, real Chrome; port 3164)

`EKZA_E2E_PORT=3164 pnpm run ci` (machine load average 60–97 from other processes throughout):

- run 1 stopped at lint (a conditional `expect` in the new select test, an unnecessary cast); fixed.
- run 2: format:check, lint, typecheck, check:deps, check:fixtures, check:licenses, test (editor-core 1366, editor
  531 + 1 skipped, the other packages as before), build and check:size all pass; test:e2e **222 passed, 27 skipped,
  2 failed**: `m6a-content` reference images (30 s test timeout) and `shading-01-blinn` (a 5 s pixel-readback poll).
  Neither touches Rig & Skin. Both pass when run again on the same build (`m6a-content` 8/8, `shading-01` alone, then
  with `m6a-30-seed-san` ×2 each, 4/4). A second full e2e pass on the same build: 222 passed, 2 failed
  (`shading-01` again, `m6a-30-seed-san`), both green on the repeat run: timing under contention, not a regression.
- C7's specs: E2E-RIG-01/-02/-05/-08 ungated parts green, including the new `?ws=rig` scenario of E2E-RIG-02 and the
  [Re-run] check of E2E-RIG-08; the four gated full rows stay `test.fixme` with their gates.
- Separate production build (no `NEXT_PUBLIC_EKZA_E2E`): `check:size` 892,990 B, eager delta +3,421 B (see above).
- Port 3164 free at the end.

## Gates, round 0 (local, real Chrome; port 3164)

`EKZA_E2E_PORT=3164 pnpm run ci`: **exit 0** (third run; the machine's load average was 10–38 from other processes).

- format:check, lint, typecheck, check:deps, check:fixtures, check:licenses: pass.
- test (turbo): editor-core 1356, editor 529 (+1 skipped), mesh-core 905, anim-core 671, doc 263, io 262, viewport 243
  (+1 skipped), rig 232, curve-editor 209 (+3 skipped), headless 193, ui 94, doc-yjs 85, mesh-view 75, web 22. No skip
  added. C7's: editor-core `test/m6b/rig-shell.test.ts` (16), the C7 rows of `m6b/keys-hash.test.ts` (P-C6, now
  `checked`), editor `test/m6b-rig-shell.test.tsx` (8).
- build: pass; check:size as above (`Rig & Skin workspace` lazy 9.9 kB).
- test:e2e (local Chrome GPU, project `chrome`): **223 passed**, 27 skipped (the shipped skips plus C7's four gated
  rows: E2E-RIG-01 `c1, c2, c3, c4, c6, c10, c12`, E2E-RIG-02 `c1, c2, c4`, E2E-RIG-05 `c1, c2, c3, c4`, E2E-RIG-08
  `c1, c2, c10`, as `test.fixme` with their full bodies). The ungated MVP parts of all four run green: modes, digits,
  `F8`, `S` never keys, `Mod+E`, `Alt+C` (RIG-02 on Polybot); test poses through the rotate manipulator, Bind ↔ Test,
  undo inside Rig & Skin, leaving drops the steps (RIG-05 on Polybot); the checklist at ①, the empty state, Getting
  started, R-Side panes (RIG-01); the Validation panel, its profile and empty states (RIG-08).
- Runs 1 and 2 failed on one test each: run 1 `editor-core ops-ui/kernel-ops` (a shipped M6a timing flag,
  `preview.slow`, under load; green alone and in run 3); run 2 `e2e/m6a-shell` (the Rig & Skin glyph literal, updated:
  ○ without a skeleton).
- The 3164 server was Playwright's own and stopped with the run; the port is free.
