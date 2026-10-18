# WP-8 notes — editor shell, `@ekza-animator/ui`, `apps/web`

Status: implemented on branch `wp/wp-8` (2026-10-18). Everything in MVP-SPEC §7 WP-8 is built and tested against the
shared test kit. A trial merge of `wp/wp-1 … wp/wp-9` (minus 7b, not started; detached HEAD, not kept) built, passed
every editor test and ran the e2e suite: E2E-00 including the drop zone, the import summary badges (WP-4) and the
whole `/dev/shell` suite pass there; the fixes it found are on this branch (see "Integration trial"). M1-stretch items
of WP-8 (in-app glTF-Validator worker) are not done. Fix round 1 (verifier review) is recorded under "Fix round 1";
**E2E-03 fails after integration on a spec threshold, not on code: see R-4.**

## What is where

| Area | Files |
|---|---|
| Editor root, boot, providers, kernel-unavailable fallback | `packages/editor/src/{Editor.tsx,shell/EditorRoot.tsx,shell/useConstant.ts,shell/KernelUnavailable.tsx}` |
| Shell core (one per editor): frame hooks, probes, help line, confirm, `runFromUi` | `shell/createShell.ts`, `shell/types.ts`, `shell/probes.ts` |
| dockview adapter, Animate layout, persistence, Reset Workspace | `shell/{WorkspaceHost.tsx,workspace.ts,layout.ts,PanelFrame.tsx,TimelineRegion.tsx}` |
| Menu bar (registry, polls, keymap labels), status line, help line, toasts | `shell/{MenuBar.tsx,menus.ts,menuItems.ts,StatusLine.tsx,HelpLine.tsx,Toaster.tsx}` |
| Shell operators (`view.toggleMaximize`, `ui.open`, `ui.close` + W-1) | `shell/operators.ts`, `shell/operator-map.ts` |
| File pipeline (drop, pickers, `loadFile`), importer resolution, model summary | `shell/{files.ts,importers.ts,summary.ts,exports.ts}` |
| GL host (R3F demand canvas), frame gate and loop, WebGL probe | `gl/{GLHost.tsx,frameGate.ts,frameLoop.ts,webgl.ts}` |
| DOM input adapter | `input/{keyboard.ts,pointer.ts,focus.ts}`, `shell/useWindowInput.ts` |
| Dialogs | `dialogs/*` (first run, open/import, export, about, shortcuts, preferences, confirm) |
| Browser services | `services/*` (assets, download, clipboard, toasts, model loader, storage) |
| Hooks | `hooks/*` (`useEditorApp`, `useSession`, `usePrefs`, `useDocQuery` from WP-0b; shell hooks below) |
| e2e test API (§4.8) | `test-api/{createTestApi.ts,params.ts,placeholder.ts,types.ts}` |
| Test kit additions | `testing/{ShellHarness.tsx,syntheticModels.ts}`; route `apps/web/app/dev/shell/page.dev.tsx` |
| ui | `packages/ui/{tokens.json,styles.css,css/*,scripts/build-tokens.mjs,src/{primitives,icons}/*}` |
| e2e | `apps/web/e2e/{00-webgl,01-first-run,03-drop-vrm0,19-project-round-trip,20-layout-independent-hotkeys,drop-several,dev-shell}.spec.ts`, `e2e/helpers/{test-api,seed}.ts` |

## Integration contract (for panels and WP-10)

1. **Panels** render inside `PanelFrame` (`data-ekza-panel`, `data-ekza-scope`, `data-ekza-panel-instance`,
   `data-testid="panel-<instanceId>"`). The viewport frame is transparent: the GL host's canvas sits behind the whole
   workspace (`fixed inset-0`, `z-0`, no pointer events). Placeholders (`placeholder-<kind>`) fill Animate slots whose
   kind is not registered. The timeline is fixed chrome under the docks (`timeline-region`), not a dock panel.
2. **GL host**: `new ViewportManager({ app, renderer })` + `registerViewportContributions(app, vm)` in `onCreated`,
   after `app.services.models.setRenderer(gl)`; `useFrame(() => vm.render(), 1)`; `addEffect` runs
   `playback.advance` + `evaluation.tick` + `useFrameCallback('before')`; `addAfterEffect` runs
   `useFrameCallback('after')`. `app.setFrameRequester` goes through a frame gate (requests made during a frame keep
   R3F's demand loop alive). Without WebGL a plain rAF scheduler drives the same hooks.
3. **Hover and keys**: the panel under the pointer comes from the closest `data-ekza-panel` element; viewport panes
   from `vm.paneAt()` or the closest `data-ekza-pane` (WP-5) / `data-pane-id` element. Key dispatch runs with
   `RunContext { panel, paneId }`. `keydown` events with `defaultPrevented` are ignored (WP-9 R-5).
4. **Shell hooks for panels** (additive exports): `useViewportManager()`, `useFrameCallback(phase, cb)`,
   `useHelpLine()`, `useTestProbe(kind, probe)`, `useRunOperator()` (runs report like the shell's own controls:
   failures toast, cancellations in the help line — addresses WP-9 D-10 and the viewport's sample buttons, which call
   `app.run` and leave a refused run unreported).
5. **Test API probes — WP-10 wiring** (three lines; the shapes are exactly what the panel packages already export;
   this base has none of the three exports, so the wiring cannot land on `wp/wp-8` itself):

   ```ts
   // GLHost.attachRenderer, after the manager exists; the returned disposer must run in attachRenderer's teardown
   // (next to disposeContributions), so a lost/remounted canvas never leaves a probe of a disposed manager behind:
   const disposeProbe = vm === null ? () => {} : shell.probes.set('viewport', viewportTestApi(vm)); // WP-5
   // createShell (or the test API):
   shell.probes.set('graph', graphTestHooks(app));                              // panels/graph (WP-6)
   shell.probes.set('timeline', {                                               // panels/timeline (WP-6t)
     screenOfFrame: (f) => screenOfTimelineFrame(app, f),
     screenOfTick: (f) => screenOfTimelineTick(app, f),
   });
   ```

   Without a viewport probe the test API answers `panes()`, `cameraOf()`, `screenOfControl()`,
   `screenOfManipulator()` from the ViewportManager's public API (camera kind `'unknown'`, `locked: false`); without
   graph/timeline probes those functions return null. The fix-round trial applied exactly these lines: typecheck
   clean and E2E-01 passes, so WP-10 drops E2E-01's `test.fixme` with them.
6. **Keymap**: the shell contributes no bindings; `MAYA_KEYMAP` (WP-7a, contributed by WP-7b's `registerBuiltins`)
   carries §4.10 including Space tap → `view.toggleMaximize`. Menu items for the shell's own commands are contributed
   by the shell (`shell.*` ids); WP-7b's `BUILTIN_MENU_ITEMS` add the editing commands (same op + args are shown once).

## Deviations and decisions (smallest sane ones; all reversible)

| # | What | Why |
|---|---|---|
| W-1 | Four shell operators beyond §4.9 owner 8, typed through `OperatorMap` declaration merging (`shell/operator-map.ts`): `prefs.set {patch}`, `workspace.reset`, `workspace.showPanel {panel}`, `view.selectionMask {mask}` (all non-undoable, P/U state). | Menus, the status line and the Preferences dialog act only through operators (ADR 0008); §4.9 has none for these. Requested for §4.9 below. |
| W-2 | Layout storage: key `ekza-animator:layout:v1:animate`, value `{schemaVersion: 1, workspace, dockview}`; a newer, unreadable or foreign layout falls back to the default with an info toast; stored panels map to this build's components by `params.kind` (placeholder when unregistered). `?e2e=1` uses in-memory storage. | research 09 §9.2; a stale layout must never break the editor. |
| W-3 | `renderedFrames()` counts every frame of the GL host's canvas, whether or not the ViewportManager had dirty panes. | The idle check (E2E-00, ARCHITECTURE §14) must catch a spinning demand loop, not only pane redraws. |
| W-4 | When `createEditorApp` throws (stubbed kernel), `/editor` shows "The editor could not start" with a WebGL canvas and a degraded test API (`ready`, `webgl`, `renderedFrames`; the rest throws `not-implemented`). | E2E-00 and the Tailwind smoke run before WP-7a lands; a real kernel failure is visible instead of a blank page. |
| W-5 | `/dev/shell` (dev/e2e-only `page.dev.tsx`, like B-15): the whole shell over the fake app and the synthetic wave document, exposing `window.__EKZA_DEV_SHELL__ = { app, shell }`. `createSyntheticModelLoader()` (in `@ekza-animator/editor/testing`) takes the renderer and never yields a display model. The `/dev/panels` harness (WP-0b) now mounts its panel inside a shell context (`RegisteredPanel`, shell hooks, probes) with the GL host for the viewport panel, and its fake app gets the same loader. | Shell e2e before the kernel merges. A loader makes the shell's GL host own the ViewportManager (WP-5 V-9 hosts its own canvas only for apps without one) and keeps the kernel from warning about synthetic characters it cannot display. |
| W-6 | Import dialog: all embedded clips checked when ≤ 8, else none (§4.11.6); extra controls `import-fps`, `import-euler-filter`, `import-secondary`, `import-clips-all/none`, `import-cancel`; `import-summary-error[data-error-code]` when the summary could not be read (the import can still run). | §4.11.6 dialog defaults; machine-readable summary errors for e2e gating. |
| W-7 | Export dialog: loop closure defaults on when every selected clip loops (§4.11.10); extra ids `export-character`, `export-filename`, `export-close-loop`, `export-constant-tracks`, `export-warnings`. Restricted VRM licences show `export-ack-license` for bakes only. | §4.11.10, research 09 §10.3–10.4. |
| W-8 | `runFromUi` reporting: failed runs toast `<label> failed: <message>` (a `not-implemented` stub reads "… is not implemented in this build"); cancelled runs show in the help line (warning). Files dropped on the window are reported once. | One place for user-facing operator outcomes; e2e can tell stubs from bugs. |
| W-9 | Auto-repeat: the adapter looks a held chord up without the repeat flag to decide `preventDefault`, and lets the keymap decide whether the repeat fires (plus its own `REPEATING_OPERATORS` filter for keymaps that ignore `repeat`). | WP-7a's keymap returns null for refused repeats; a held Mod+S otherwise reached the browser's Save Page dialog. |
| W-10 | The adapter maps a Space **tap** bound to `view.toggleMaximize` to `time.togglePlay` when `prefs.spaceBehaviour === 'play'`. | §4.10; harmless next to WP-7a's preference binding (only that op is mapped). |
| W-11 | Dropped or picked files open strictly one after another through the importer registry (longest extension, then `sniff`): projects first, then models, then everything else (animations need their character), drop order otherwise (`openOrderRank`, by name, so files are read one at a time). A model opens the import dialog (summary via io's `parseGlb`/`detectModelFormat`/`readVrmLicense`) and the next file waits until that dialog has closed: confirmed (after the import ran), cancelled, or replaced by another dialog. Later drops queue behind earlier ones; shell disposal releases every waiter and stops the queue. Projects ask before replacing unsaved work. The test API's `loadFile` keeps resolving as soon as the dialog shows (`OpenFileOptions.waitForDialog` is the drop path's switch). The Import picker accepts several files. The shell resolves importers itself instead of running `file.open`, because the import dialog sits between the drop and `file.importModel`. | §4.8 "same path as drag-and-drop"; research 09 §10.2. A model must never replace another pending one (fix round 1). |
| W-12 | `--font-mono` is a token (alias of `--font-code`). Fonts are self-hosted via `@fontsource-variable` (resolves B-13). dockview's structural CSS is vendored by `build-tokens.mjs` (`css/dockview-core.css`, themes stripped) under a token theme (`css/dockview-theme.css`). | WP-6t reads `--font-mono`; Tailwind's inline theme does not emit it. `editor` is `sideEffects: false`, so it cannot import dockview's CSS. |
| W-13 | `EditorProps.samplesPath` is accepted but unused, and `createValidatorWorker` is accepted with `services.validate = null` (M1-stretch). | `file.loadSample` (WP-7b) fetches `/samples/<file>` (§4.9) and `EditorServices` has no samples base; see request R-2. |
| W-14 | The production editor keeps `createEditorApp`'s default store (no `strictPut: false`). | `createEditorApp` takes a whole `store`, not store options; WP-2 D2-11 leaves it optional. WP-10 decides. |
| W-15 | e2e gating before integration: helpers turn a missing kernel (`kernel-unavailable`), an unregistered operator (`unknown operator`), a stub (`not-implemented`), a placeholder panel or a "not implemented in this build" toast into `test.fixme` naming the blocking WP; `requireOperator` probes operators that panels run directly. | §8.1 without weakening assertions: the specs run unchanged once the pieces land — except E2E-03's facing threshold (R-4) and E2E-01's probe gate (contract item 5). |
| W-16 | While a dialog or menu owns the keyboard, Mod chords the keymap binds keep their browser default suppressed without dispatching, except the text-editing chords (Mod+A/C/V/X/Y/Z) and, in text fields, everything but Mod+S. A Space tap or hold interrupted by a dialog fires nothing. | Mod+S/Mod+O reached the browser's Save page / file picker behind dialogs; copying a dialog's licence text must keep working. |
| W-17 | While the editor is mounted `<html>` carries `data-ekza-editor` (and `data-ekza-motion="off"` with `?e2e=1`); the motion-off, reduced-motion and scrollbar rules of `ui/styles.css` match it, so they reach content Radix portals to `<body>`. | §4.8 "disables UI transitions" covers dialogs, menus, tooltips and popovers. |

## Requested contract changes

| # | Where | Request |
|---|---|---|
| R-1 | MVP-SPEC §4.9 (owner 8) | Add `prefs.set`, `workspace.reset`, `workspace.showPanel`, `view.selectionMask` (W-1) to the catalog and `OperatorMap`. |
| R-2 | §4.5 / §4.9 `file.loadSample` | Give samples a base URL (`EditorServices.samplesPath` or a `file.loadSample` arg) so `EditorProps.samplesPath` takes effect (static exports under a sub-path). |
| R-3 | §4.8 | State that `renderedFrames()` counts frames of the editor's canvas (W-3), and that `panes()[].camera` may be `'unknown'` before the viewport probe is wired. |
| R-4 | §4.11.9 facing check, §6.2 E2E-03, US-02 | **The facing threshold cannot be met on Polybot.** `f = normalize((W(leftUpperLeg) − W(rightUpperLeg)) × (W(head) − W(hips)))` at rest is `(0, −0.0485, 0.998824)` for Polybot: its rest head sits 1.35 cm in front of the hips in canonical space, tilting f by ~2.8° about X (Seed-san: 0.999175). The verifier measured this through the test API on the merged build and recomputed it independently from the GLB node TRS with the VRM 0.x conjugation; the test API follows the formula exactly. Proposal (preferred): make the check yaw-only — project f onto XZ before the dot product (`f_xz = normalize(f.x, 0, f.z)`, `f_xz · (0,0,1) > 0.999`), which gives 1.0 on both fixtures and still catches a missing π-yaw (−1) or a quarter turn (0). Alternative: lower the threshold to 0.998 (allows ~3.6° of pitch). Until decided, E2E-03 fails after integration on `expect(facing[2]).toBeGreaterThan(0.999)`; the assertion is left as specified and carries an R-4 comment. Whoever decides updates §4.11.9, the E2E-03 row, US-02 and `apps/web/e2e/03-drop-vrm0.spec.ts` together (with yaw-only: also the unit facing tests of WP-3/WP-4 that cite §4.11.9). |

## Notes for other work packages

- **WP-5**: the sample buttons and "Open file…" could use `useRunOperator()` so a refused run is reported.
- **WP-6/WP-9**: the `ui` primitives (`ContextMenu*`, `Popover*`, `NumberField` with expressions, `Select`, `Tooltip`,
  `Toggle*`) and icons (`TANGENT_ICONS`, `INFINITY_ICONS`, `DISPLAY_ICONS`, tools, spaces, camera lock, layouts,
  loops) are available to replace the local stand-ins (WP-6 `panels/graph/controls.tsx`, WP-9 D-3); every token in
  WP-6, WP-6t and WP-9 R-4 is defined in `css/tokens.css`.
- **WP-7b**: `registerBuiltins` must contribute `MAYA_KEYMAP`, the importers (`gltf-model` → `file.importModel` for
  `glb`/`vrm`, `vrma` → `file.importAnimation`, `ekzanim` → `file.openProject` incl. `ekzanim.json`), exporters,
  export profiles and `BUILTIN_MENU_ITEMS`. The shell's drop/pickers depend on the importer registry.
- **WP-10**: wire the probes (contract item 5); drop the `test.fixme` gates as they stop triggering (they are inert
  once everything has landed); E2E-03/19/20 seed through `apps/web/e2e/helpers/seed.ts` (`seedSample`,
  `seedWaveClip`, `controlId`).

## Fix round 1 (verifier review of 2026-10-18)

| Finding | Fix |
|---|---|
| Major: a multi-file drop lost every model but the last, and ran `.vrma` before its character | W-11: ordered, sequential, dialog-waiting pipeline with a drop queue (`shell/files.ts`, `openOrderRank` in `shell/importers.ts`). Unit tests (`files.test.ts`: two models + `.vrma` dropped first, cancel/replace, queued drops, dispose, `loadFile` semantics) and a browser test through the real dialog (`shell.test.tsx`: window drop of `.vrma` + two `.vrm`, confirm, cancel). New e2e `drop-several.spec.ts` (Polybot + Seed-san in one real drop → two characters; fixme on WP-7b like E2E-03). The import dialog shows the file name as `import-file-name`. |
| Major: E2E-03 fails after merge (facing 0.99882 < 0.999) | Spec issue, not code: R-4. Assertion unchanged, commented. |
| `?e2e=1` motion-off missed portalled UI | W-17. |
| StrictMode booted a second, never-disposed editor | `useConstant` (`shell/useConstant.ts`): the state initializer only allocates a lazy cell, so the boot runs once; also used by the panel harness. Covered by a StrictMode test that fails with the old `useState(() => boot())`. |
| Bound chords reached the browser behind dialogs; a pre-dialog Space tap fired on release | W-16, `input.test.ts`. |
| Inline oxlint suppression in the panel harness | The harness's home link is a button (`window.location.assign`); no suppression left in WP-8's code. |
| Storage read the stale localStorage value after a failed write | Fallen-back keys read from memory until a write succeeds (`services/storage.ts`, test with a quota-throwing `setItem`). |
| Probes left to WP-10 | Unchanged on this base (no exports to wire); contract item 5 now says where the viewport probe's disposer goes. |

## Integration trial (2026-10-18, detached HEAD over all WP branches, not kept)

Two trial merges of `wp/wp-8` with `wp/wp-1, 2, 3, 7a, 4, 5, 6, 6t, 9` (and `7b`, still equal to 7a) were
conflict-free. The first found, and this branch fixes: duplicate viewport contributions when a panel hosts its own
manager (the GL host now logs and keeps rendering; harnesses and shell tests give the fake app a model loader),
`renderedFrames` not moving during playback with a real manager (W-3), shell tests that assumed an empty preset keymap
or placeholder panels, display warnings for synthetic characters (W-5), held-chord defaults (W-9) and the panel
harness starting a second viewport canvas. The second, with every fix: typecheck clean; editor tests 234 passed /
2 skipped (other WPs' gated tests); e2e: E2E-00 (both tests, drop zone included), the import summary badges (WP-4),
all `/dev/shell` and resilience specs pass; E2E-01/03/19/20 are fixme on WP-7b (`file.loadSample`, importers).
`/editor`, `/dev/shell` and `/dev/panels?panel=viewport` render the real panels over the shell's single canvas with
no console errors.

Fix-round trial (2026-10-18, `git clone --shared` in a scratch directory, deleted afterwards): `wp/wp-8` at 9eeaeef
merged with `wp/wp-1, 2, 3, 4, 7b (incl. 7a), 5, 6, 6t, 9` without conflicts; typecheck clean; editor tests 251 passed
/ 2 skipped; e2e (chrome) 19 passed — including the new `drop-several` (two models, one drop, both imported), E2E-19
and E2E-20 — E2E-01 fixme on the unwired viewport probe (contract item 5), and E2E-03 failing only on the R-4
threshold (`0.9988237539 > 0.999`).

## Tests

- `packages/editor/test/` (Vitest browser mode, real Chrome): `input.test.ts` (scope chain from the hovered panel,
  tap vs hold incl. pointer and interrupt, text-input suppression, `code` with non-Latin `key`, Option chords,
  repeats, WP-5 pane surfaces), `workspace.test.tsx` (Animate docks, layout persistence round trip, invalid/newer
  layouts, throwing storage, reconcile, maximize, show panel), `shell.test.tsx` (chrome, status line, first run,
  window key routing, toasts with Undo, window drops, menus, demand frame loop, context loss, **no React commits
  during playback/scrubbing**), `dialogs.test.tsx`, `files.test.ts`, `commands.test.ts`, `test-api.test.ts`,
  `hooks.test.tsx`, `panel-harness.test.tsx`.
- `packages/ui/test/tokens.test.ts`: generated CSS is current, contrast table (research 09 §8.3), dockview CSS.
- `packages/editor/test/ui-primitives.test.tsx`: ContextMenu, DropdownMenu, Popover, Tabs, Select, IconButton and the
  icon set in a real browser (the ui package's own Vitest runs in Node).
- e2e (`EKZA_E2E_PORT=3109 pnpm --filter web e2e`): `00-webgl` (2), `01`, `03`, `19`, `20`, `drop-several`, `dev-shell` (9),
  `resilience` (NFR-12 storage blocked, NFR-13 forced context loss; M1-stretch automation of the manual QA items, on
  `/dev/shell`), `tailwind-smoke`, `dev-panels`.
