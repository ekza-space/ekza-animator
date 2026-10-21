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
| Keymap | `keymap/maya.rig.ts` (`RIG_KEYMAP`, contributed by the chunk) |
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
| M6B-C7-6 | **Menus list what works** (§0.4.5, Q-MVP-15). Items whose arguments come from the selection (Skeleton › Symmetry X, Snap to Projected Center, Map Humanoid Bone ▸, Rename) are in the status line (`status-rigsym`, `status-rigsnap-center`) and C3's Toolkit section instead of the menu bar; Display › Joint Size ▸ is the status line's ⊖⊕ (it edits `prefs.rigging.jointSize` by steps); the Component Editor item waits for C6 (optional). File › Export Character… opens the Export dialog (`ui.open {dialog: 'export'}`; `file.exportCharacter` needs a full `CharacterExportRequest`, C10's dialog builds it). | `MenuItemDef.args` are static. |
| M6B-C7-7 | **Projected-centre snap is a session toggle** set by the status line (no MVP operator owns `session.rig.snap`). | §0.6 lists no snap operator; U state. |
| M6B-C7-8 | **The pose badge** is a provider of C0's badge slot with id `pose` (`hud-badge-pose-<paneId>`, `BIND POSE` / `TEST POSE`, Rig & Skin only); the HUD mode badge is `hud-rigmode-<paneId>` (`JOINT · SYM X` with `34 joints · 15/15 required`, `SKIN`). | §0.3: "BIND and TEST POSE badges through C0's badge slot", whose ids are `hud-badge-<id>-<paneId>` (M6B-C0-21). |
| M6B-C7-9 | **Validation rows**: C2's `checkSkeleton` (skel.*, xform.*) and C6's `checkSkin` (through the lazy kernel) run when they have landed (a `not-implemented` stub gives no rows); the shell computes `skin.unbound` and the VRM meta rows (`vrm.meta-required`, `vrm.licence-unset`, `vrm.thumbnail-square` = a stored thumbnail asset; squareness is C10's renderer). Only the §0.4.5 MVP codes are shown; asset-sourced characters have no Rig rows (their export lints judge them). `rig.out-of-sync` appears when C1/C2's rule reports it (`RigProblemCode`). M6a's `mesh.*` lints are not in the panel in the MVP (they run on export bytes; the three skin lints' suppression is the character export's, C10). Profiles offered: `ekza/space-avatar-v1` (default) and `local/generic`. A skin skeleton for `checkSkin` is built from the joint records (`skinSkeletonOf`), C4/C6 may share theirs. | §5.21, §0.4.5, §0.4.6. |
| M6B-C7-10 | **Checklist glyphs**: `done` when the step's check passes, `attention` when it can be worked on (① without a skeleton, ③ partly bound, ④ weight problems, ⑤ before a preview, ⑥ error rows), `todo` while the step before gives it nothing to check. ⑤ counts a library preview this session or a clip brought in (imported/embedded) or with curves; an empty new clip and test clips do not count. | §0.4.5 "done when …"; steps never locked. |
| M6B-C7-11 | **Active character** (§5.24): the selected joints' skeleton, else the selected controls', else the selected objects' owner, else the only character, else the previous one while it exists. | §5.24 "else none" kept for an empty scene; keeping the last one avoids the Toolkit flickering when the selection moves to the scene. |
| M6B-C7-12 | **Dock tabs follow the mode** (right dock only: Object → Channel Box, Skeleton → Rig Toolkit, Skin → Paint Weights, `RigSessionState.tabMemory`); the bottom dock holds Validation (the Component Editor is optional, C6). | §5.24 table; no remembered user change per mode yet (no dock event for it in the shell API). |
| M6B-C7-13 | **Literal updates** (§3 rule 9, assertions kept): editor-core `m6b/foundation.test.ts` (C7's operators poll on their own args), `m6b/keys-hash.test.ts` (C7 rows `checked` with a Rig & Skin fixture), editor `test-api.test.ts` (Rig & Skin glyph ○ "No skeleton yet"), web `m6a-size.test.ts` (gate enforced, per-package allowances, `packages` field). | Owners land their rows. |
| M6B-C7-14 | **M6b display flags accepted by the display operators** (`workspace.ts` `ENUM_FLAGS`/`BOOLEAN_DISPLAY_FLAGS`: joints, xrayJoints, jointAxes, jointLabels, weights, weightNumbers, lockRelative, constraintLines). `Alt+C` in Skin mode is bound to `view.display.toggle {flag: 'weights'}` per §7; toggling the enum (off ↔ greyscale) is C6's weight-display work. | The Display menu needs them; `weights` is an enum, the shipped toggle flips booleans. |

## Deferred or left to owners (MVP)

ROM clip (`skin.test.rom`), Constrain/Control menus, marking menus other than `rig.modes`, the Rig Outliner variant
(CR-5) and `rig.outliner.delete`, R-Quad/R-Paint, `view.hide`/`showAll`/`isolate` Rig variants for joints and points
(H hides objects as in Model until C3/C6 add joint/point hiding), the < 1024 px view-only banner, the per-mode dock
tab memory of user changes, per-mode display switching (X-ray mesh in Skeleton mode: C3; weight display in Skin mode:
C6), IK → FK for `E` on joints (C3), Skeleton/Skin help-line texts (C3/C6).

## Eager route (§0.4.9)

Production build, `check:size` (gzip -9, first visit): **892,589 B** (gate 900,000 B, headroom 7,411 B); the M6b MVP
eager delta **+3,020 B** over the 889,569 B baseline (allowance +6,144 B, now enforced). C0 recorded 891,104 B, so
**C7's own delta is +1,485 B** (allowance 2,560 B): the `WorkspaceDef` additions (layout, `keyModes`, `rigStatus`),
CR-4's chain and call site, the Rig dock layout and viewport presets (`shell/rig/layouts.ts`, the triple pane grid,
`RIG_DISPLAY`, the icon), the M6b display flags, the channel-source reads and redirect hooks, and the rig shell hook.
`Rig & Skin workspace` (rig-workspace) stays lazy at 9.9 kB; the rig shell UI is its own lazy group.

## Gates (local, real Chrome; port 3164)

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
