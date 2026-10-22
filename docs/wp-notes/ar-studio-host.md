# Auto-Rig D1 — studio host: HostShell / StudioShell split, the `(studio)` route group, handoff record, navigation port: build notes

Branch `autorig/studio-host` (from `autorig/mvp` at `04e2c54`, D0's `autorig/contracts` merged at `ed07e32`). Scope:
[AUTORIG-SPEC §10 D1](../AUTORIG-SPEC.md#d1--studio-host) with §4.4 (the Shell split, same page, handoff record),
§3.4/§4.5 (`autorig.navigate`), §7.0–§7.2 (sizes) and §8.3 (AR-V1). Decision IDs below are `AR-D1-<n>`. The work
package prompt named these notes `autorig-studio-host.md`; the spec's D1 Dirs name `ar-studio-host.md`, which this file
follows (as D0 did).

## What shipped

| Part | Where |
|---|---|
| **HostShell** (one per page load): UI store, frame hooks + fallback scheduler, help line, confirm, `runFromUi`, the file pipeline (a facade whose code loads on first use or on a file drag), export recorder, keyboard adapter, probes, autosave start (no Recovery prompt), the command palette behind the overlay port (`openCommandPalette`; `openMarkingMenu` goes to the mounted shell), the host's operators (`ui.open`, `ui.close`, `prefs.set`), the navigation port, the mounted-shell slot | `editor/src/host/createHost.ts`, `host/operators.ts`, `host/types.ts` (`HostShell`, `MountedShell`, `HostNavigation`) |
| **`StudioHost`** (React): boot (services, EditorApp, skin worker, e2e prefs, HostShell, a `?handoff=` record), `GLHost`, the window input adapter, `DialogHost`, `CommandPaletteHost`, the toasts, the drop overlay, the test API (installed once the route's shell mounted, on both routes), the kernel-failure page (lazy), disposal after the shells' | `host/StudioHost.tsx`, `host/context.tsx` (`useHost`, `useHostUi`, `HostProvider`) |
| **StudioShell**: `createShell({host})` adds the panel registry, the dockview workspace adapter, layout presets, Studio's shell operators (`shellOperatorDefs`: maximize, workspace, presets, selection mask, full screen), menu items, marking menus, the Graph Editor / time-slider probes, the model HUD/transform UI, the rig shell (`registerRigShell`, whose disposer clears the view-only flag) and the Recovery prompt (`promptRecovery`, once per page load, skipped on a handoff page). `createShell` without a host makes one of its own (unit tests, harnesses) | `shell/createShell.ts`, `shell/types.ts` (`Shell extends HostShell, MountedShell`) |
| `StudioShell` component (the `/editor` route's shell): applies the arriving workspace (`navigation.takeWorkspace()`, else — when Studio is the page's first shell — `ws=` or `prefs.lastWorkspace`, else the session's), mounts itself in the host, opens the first-run dialog (Studio only), renders `EditorShell` under `data-shell="ekza-studio-shell"`; disposed a task after it unmounts | `shell/EditorShell.tsx` |
| `EditorRoot` / `Editor` = `StudioHost` + `StudioShell` in one tree (harnesses, unit tests, the package's `Editor`) | `shell/EditorRoot.tsx`, `Editor.tsx` |
| Contexts: `ShellProvider` provides the host context too; `useShell()` / `useOptionalShell()` answer with the host outside Studio (host-mounted dialogs and `PaneView` hooks read only HostShell members); `DialogHost` provides the mounted Studio shell to its dialogs | `shell/context.tsx`, `dialogs/DialogHost.tsx` |
| Navigation port (eager): `provideNavigation` / `hostNavigation` | `editor-core/src/workspaces/ports.ts` (+ one export line each in `workspaces/index.ts` and `src/index.ts`) |
| Host port implementation: `routeHref` (keeps the page's switches such as `e2e`, `ns`, `platform`; drops `ws`, `handoff`, `from`, `step`, `sample`, `chooser`), same-page `go` (the leaving shell's `leave()`, the host's palette/confirm/dialog/keyboard closed, then `push`), `takeSubject` / `takeWorkspace` / `takeHandoffInfo` once; chooser = page load; new tab and the no-router fallback through the handoff record | `host/navigation.ts` |
| `autorig.navigate` (rig chunk): the port's palette/script/MCP wrapper; "No navigation in this host" without a port; argument polls | `editor-core/src/operators/builtin/rig/wizard/navigate.ts` |
| Handoff record in the IndexedDB store: rows `handoff:<id>` of `slots` with `info: null` (never orphans, never claims) and the `HandoffInfo`; assets and blobs kept by the shared collections; `writeHandoff` through the slot writer (`put`), `pruneHandoffs` eager, `takeHandoff` (read-and-delete, expired after 10 min) a lazy chunk | `services/autosave.ts`, `host/handoffStore.ts` |
| Handoff writer, new-tab flow, receiver (lazy chunk): snapshot + present assets + blob closure (pinned while written) + info; the tab opened in the gesture is pointed at `…&handoff=<id>`, a failed write closes it with a toast; the receiver puts assets and blobs, opens the document through `file.openProject`'s JSON-variant path (migrations, read-only rule, session repair, history cleared), hands the info to the port, toasts "Opened in Studio; undo history starts here"; a missing or expired record toasts "This hand-over has expired — open the file from the source tab" | `host/handoff.ts` |
| Housekeeping: handoff records older than 10 minutes pruned when the slot is claimed | `editor-core/src/app/autosave.ts` |
| URL params `handoff=<id>` and `from=studio|autorig`, read in any build | `test-api/params.ts` |
| Test API installed by the host (`createTestApi(host)`); the owner groups get `studioView(host)` (the mounted Studio shell's members while one is mounted, else the host's) | `test-api/createTestApi.ts` |
| `@ekza-studio/editor/host`: `StudioHost`, `useHost`, `useHostUi`, `HostProvider`, `createHostShell`, `PaneView`, the R-Markers constants, `hostNavigation`, `routeHref`, `openDialog`, `openOverlay`, `provideAutoRigTestState`, the types | `host/index.ts` |
| R-Markers pane ids/sizes/preset ids moved to the host (re-exported by `shell/rig/layouts.ts`) | `host/panes.ts` |
| Route group | `apps/web/app/(studio)/{layout.tsx,StudioHostIsland.tsx,Loading.tsx,hostProps.ts}`, `(studio)/editor/{page,EditorEntryIsland,EditorEntry}.tsx`, `(studio)/autorig/{page,AutoRigEntryIsland,AutoRigEntry}.tsx` (D3 owns `(studio)/autorig/**` after the merge) |

## Decisions and deviations

| ID | Decision | Why / evidence |
|---|---|---|
| AR-D1-1 | **Shared layout, per-route entry groups** (the design shipped). Each route's page loads one `next/dynamic` entry group — `StudioHost` + Studio's shell on `/editor`, `StudioHost` + the Auto-Rig shell on `/autorig` — and registers `{Host, props, Shell}` with the `(studio)` layout's island (`useShellEntry`). The island, which Next keeps mounted across client navigations between the two routes, renders the **first** registered host once and swaps only the shell. Both entries carry the host's modules, but Turbopack instantiates a module once per page (by module id, whichever chunk brought it), so the second entry's `StudioHost`, contexts and stores are the same objects: the EditorApp, the undo history, the selection, the cameras, autosave and the WebGL context survive a switch (E2E-AR-01 proves it: a page mark, `history()`, counts, selection, the autosave slot, Mod+Z afterwards) | The spec's sketch (a layout-level host group with the shell `React.lazy`-loaded from inside it, §7.2 rule 4) was built first and measured **`/editor` 906,914 B, +11,182 B over D0** (the editor split into a 528.6 kB host group and a 231.1 kB shell group — a second gzip stream — and the dialog groups, whose loaders sit in the host, copying the Radix/ui modules the Studio shell group held: First-run dialog 6,854 → 14,363 B, Export 37.9 → 45.9 kB). Per-route entries keep `/editor` one group as before. Cost of a switch: the arriving route's entry group is fetched once (the shell's code plus copies of host modules that are not instantiated again). D0's marker promotion is not needed (the entries are page `next/dynamic` files, measured through the page manifest); the `ekza-studio-host` / `ekza-studio-shell` / `ekza-autorig-shell` markers stay in the code |
| AR-D1-2 | **Lazy, to pay for the split** (§7.0 rule 5): the file pipeline with the importer table and the model summary (a facade in the host loads them on the first file, or on intent when a file is dragged over the window; a failed load says "Couldn't load the file import…" and the next file tries again), the kernel-failure page (`KernelUnavailable`, only when the kernel cannot start), the handoff writer/reader and `takeHandoff` (only the new-tab flow, the fallback and `?handoff=` pages). The toasts stay eager: a lazy toast layer measured −5 kB but cannot report a chunk that fails to arrive (E2E-M2A-22, M2A-A5-10), so it was reverted | without them the per-route design measured `/editor` 897,984 B (+2,252 B over D0, over D1's 1,408 B) |
| AR-D1-3 | `useShell()` keeps returning `Shell`: under Studio's `ShellProvider` (or the mounted Studio shell the dialog layer provides) it is the Studio shell, elsewhere the HostShell. `useOptionalShell()` likewise | D1 may not edit `dialogs/*Dialog.tsx` (A0, D2 own lines there); those dialogs read only HostShell members; the Studio-only Layout presets dialog opens from Studio's menus |
| AR-D1-4 | `ui.open`, `ui.close` and `prefs.set` (with `UI_DIALOGS`, `PREF_KEYS` and the dialog poll) moved from `shell/operators.ts` to `host/operators.ts`, registered by the host; `shellOperatorDefs` keeps the Studio rows. **D2 adds its *Start in* preference key to `PREF_KEYS` in `host/operators.ts`** | the HostShell's operators exist on both routes (§4.4), and `/autorig` no longer carries the layout-preset code `shell/operators.ts` imports (−4.7 kB on `/autorig`). `shell/operators.ts` is outside the Dirs: for D7's approval |
| AR-D1-5 | The Recovery prompt is the Studio shell's (`promptRecovery`, once per page load per app); the host starts autosave with `prompt: false`. A handoff page never prompts | §4.4: Auto-Rig shows its own Continue card (D3); "without the Recovery dialog" |
| AR-D1-6 | Handoff rows live in the existing `slots` object store (`handoff:<id>`, `info: null`) instead of a new object store | no database version bump (other open tabs keep their connection); the slot and blob collections then keep a record's assets and blobs with no extra code |
| AR-D1-7 | The receiver opens the record through `file.openProject` with the `.ekzanim.json` variant built from the record (`writeProjectJson`) after putting its assets and blobs, not through `file.recover` | the shipped load path with migrations and session repair, reachable from `editor` (the recover path's helpers are editor-core internals); no `markRecovered`, no Recovery dialog, the page's own fresh slot. The document opens clean (as an opened project); the source tab keeps its own state |
| AR-D1-8 | Without a client router (`StudioHost` without `navigate`: the harness, the two-island fallback) a switch hands over through a record and reloads in this tab | §4.4 fallback; the same lazy writer |
| AR-D1-9 | The view-only rule per shell (AR-V1) needed no change in `shell/rig/viewOnly.ts`: `watchRigViewOnly`'s disposer already clears the flag; the Studio shell's disposal (a task after it unmounts) now disposes the rig shell UI that holds it | E2E-AR-01 view-only case at 390×844 |
| AR-D1-10 | The 390×844 case runs the inner operators Auto-Rig will compose (`mesh.importStatic`, `skel.quickRig.commit`, `skin.bind`) instead of `autorig.rig`/`autorig.sample` | both are D0 stubs until D3/D4 |
| AR-D1-11 | `/autorig`'s and `/editor`'s loading text comes from the page islands (`next/dynamic` `loading`), fixed over the page | the layout island stays minimal (0.4 kB); on a switch it covers the host until the arriving entry registers |
| AR-D1-12 | A Studio shell arriving by a switch keeps the session's workspace unless the request names one; only when Studio is the page's first shell does it apply `ws=` or `prefs.lastWorkspace` (as before the split) | Auto-Rig drives `rig`/`animate` itself (§4.2); a switch must not jump to a remembered workspace. `shellShown` marks a host once its first route shell mounted |
| AR-D1-13 | **Studio's `leave()`** (fix round 1): closes its marking menus, runs `library.stop` when the clip library is loaded, then `edit.escape` (the shipped Esc semantics: cancels a channel/transform gesture, ends the extrude session, else stops playback); the host then closes the palette, the confirm and the dialog. **Quick Rig is not cancelled**: the arriving shell's entry decides (Auto-Rig's ② keeps the session, any other step runs `skel.quickRig.cancel`, §4.2) | §4.4 "before the push the leaving shell stops previews, ends tool sessions and closes its dialogs". The runs go straight to `app.runUntyped` (no help-line message for "No clip preview is playing"); an operator that is not registered is skipped. Unit: `ar-host-navigation.test.ts` ("Studio's leave() stops the library preview, then ends the tool session"). **D3**: the Auto-Rig shell's own `leave()` (it has previews in ③/④) is D3's, with the same order |
| AR-D1-14 | `autorig.navigate {newTab: true}` from the palette or the MCP bridge opens the tab in `prepare`, after the runner awaited the rig chunk: the gesture's transient activation may have expired and the pop-up can be blocked. The port then hands over through the record **in this tab** (the page-load fallback; the document arrives, the source page is replaced). Documented in the operator's header | UI controls (D3's *Open in Studio (new tab)*) call the port from their own click handler, inside the gesture, as the spec's flow requires; the operator stays a script/MCP convenience |
| AR-D1-15 | `state().storeVersion` (`app.store.version`) added to the test API's `state()` — one additive line in the contract file `editor/src/test-api/types.ts` (outside D1's Dirs; **for D7's approval and the spec's §4.8 contract copy**) | §10 D1 DoD names "the store version" among what the test API answers on both routes and what a switch keeps; E2E-AR-01 now compares it across `/editor` → `/autorig` → `/editor`, and AS-AR row 5 (D4/D5) needs it too |
| AR-D1-16 | E2E entries to `/autorig` go through `openAutoRigReady` (D1's `helpers/ar-host.ts`): D0's `openAutoRig` and then `waitForTestApi` | D0's helper returns once the Auto-Rig shell marker is in the DOM; the host installs the API after the shell mounted (through a lazy chunk), so under the full suite's load a call right after it found no API (the fix-round-1 blocker, `file.loadSample: no test API`). D0's helper is unchanged (D7 may fold the wait into it at the merge). E2E-AR-01 also checks the GL host's very canvas and WebGL context (tagged before, `isContextLost() === false` after) instead of a frame count |

**Shared files touched outside the D1 Dirs** (for D7's approval): `.oxlintrc.json` (apps/web may import
`@ekza-studio/editor/host`), `packages/editor-core/src/index.ts` and `src/workspaces/index.ts` (one export line each for
`provideNavigation` / `hostNavigation`), `packages/editor/src/shell/operators.ts` (AR-D1-4: three operators and their
tables moved to the host), `packages/editor/test/files.test.ts` (one test waits for the confirm prompt instead of one
macrotask: the pipeline's code now loads first), new test files
`packages/editor/test/ar-host-{handoff-store,handoff,navigation,shells}.test.ts(x)`,
`packages/editor-core/test/autorig/{navigate,handoff-prune}.test.ts`, and the D0 tests updated for the landed
`autorig.navigate`: `editor-core/test/autorig/composition.test.ts` (its poll reason), `editor-core/test/m6b/keys-hash.test.ts`
(the D1 row turned `checked` with a recording port), `packages/editor/test/test-api.test.ts` (the params literal),
`apps/web/e2e/ar-00-foundation.spec.ts` (navigate's own refusal). Fix round 1 adds `packages/editor/src/test-api/types.ts` (one
additive `state().storeVersion` line, AR-D1-15).

**For D7 at the merge** (§10.0 shared-file rule): approve the paths above; copy AR-D1-1 (with the measured +11,182 B of
the sketched layout-level host group), AR-D1-4 (host operators; D2's *Start in* key goes to `host/operators.ts`),
AR-D1-13 (Studio's `leave()`, Quick Rig left to the arriving shell), AR-D1-14 (palette `newTab` pop-up limitation) and
AR-D1-15 (`storeVersion` in the §4.8 contract) into DECISIONS-OPEN §M; record `routes.autorig` in `size-baseline.json`;
take the `/autorig` gate question below to the owner (§7.2).

## Sizes (production build, `check:size`, gzip -9)

| Build | `/editor` (eager + First-run) | delta vs D0 (895,732 B) | `/autorig` |
|---|---:|---:|---:|
| D0 head (`ed07e32`) | 895,732 B | — | 134,011 B (placeholder) |
| Shared layout as sketched (host group + `React.lazy` shell) | 906,914 B | +11,182 B | 662,648 B |
| Per-route entries, first cut | 902,740 B | +7,008 B | 666,370 B |
| + entry imports only the package root (one module graph) | 898,564 B | +2,832 B | 662,538 B |
| + lazy kernel-failure page, slim layout island, lazy `takeHandoff`, boot-time handoff read | 897,984 B | +2,252 B | 661,863 B |
| + lazy toasts | 892,999 B | −2,733 B | 653,115 B |
| toasts eager again (E2E-M2A-22), lazy file pipeline | 896,410 B | +678 B | 660,294 B |
| + host operators of their own (AR-D1-4) | 896,248 B | +516 B | 655,553 B |
| + arrival keeps the workspace (AR-D1-12) | 896,278 B | +546 B | 655,591 B |
| + Studio's `leave()` (AR-D1-13), `storeVersion` (AR-D1-15) — **shipped** (fix round 1, the final `pnpm run ci`) | **896,327 B** | **+595 B** | **655,590 B** |

`/editor` 896,327 B (eager scripts + First-run dialog 6,854 B); the D1 delta +595 B is within its 1,408 B (813 B
unused; the AR-B1 total is +639 B over the 895,688 B baseline with D0's +44 B, limit 897,736 B). `/autorig` 655,591 B is under the
660,000 B gate (target 620,000 B): the host, the kernel, three.js, R3F and the
viewport, without dockview, the curve editor, the panels or the Studio shell (every boundary of §7.2 holds). The
integration agent records `routes.autorig` in `size-baseline.json` at the merge (§10 D1).

### `/autorig` attribution against §7.1 (fix round 1)

`STUDIO_SOURCE_MAPS=1 pnpm --filter web build` (a production build with browser maps; the maps' `sourceMappingURL`
comments add ≈ 0.1 kB, so this build measures `/autorig` at 655,706 B), then `check:size`'s attribution and
`attributeFiles(readRouteScripts(nextDir, 'autorig'))` of `scripts/attribute-chunks.mjs` (gzip -9, a chunk's bytes
shared across its sources by their standalone gzip; 6 initial scripts, 0 without a map):

| Part (§7.1 row) | §7.1 estimate | measured | Δ |
|---|---:|---:|---:|
| three 174.3 + R3F 52.2 + camera-controls 9.4 (+ R3F's its-fine, react-use-measure, suspend-react, zustand 3.2) | ≈ 237 kB | 239.1 kB | +2.1 kB |
| next runtime 127.4 (+ scheduler, use-sync-external-store, shared, @swc/helpers 4.1) | ≈ 127 kB | 131.5 kB | +4.5 kB |
| editor-core (operators registered eagerly; M6b grew them: operators 41.9, workflows 16.1, edit 12.5, app 5.3, keymap 3.7, session 3.2, history 3.1, workspaces 2.9, evaluation 2.8, …) | ≈ 85 kB | 100.9 kB | **+15.9 kB** |
| rig 36.9 + viewport 39.2 + doc 23.1 + io 5.7 + anim-core 16.2 + ui 1.4 | ≈ 130 kB | 122.5 kB | −7.5 kB |
| **host part** = `@ekza-studio/editor` 20.0 (host 4.6, services 3.8, input 3.2, shell contexts/types/autosave/Toaster 3.0, gl 1.9, dialogs 1.6, test-api 0.5, hooks 0.5, overlays 0.5, panels 0.5) + Radix/floating-ui/lucide 29.5 (the host's `TooltipProvider` ≈ 14 kB with popper and floating-ui; the toasts ≈ 10 kB with collection, dismissable layer, presence, portal) + `apps/web` layout island and entry 1.1 | ≈ 30 kB | **50.7 kB** | **+20.7 kB** |
| `autorig` frame + ① + i18n | ≈ 25 kB | 0.6 kB (D0's placeholder) | — |
| Turbopack runtime 4.1 + unmapped wrapper 6.3 | — | 10.4 kB | +10.4 kB |
| **Total** | **≈ 635 kB** | **655.7 kB** | +20.7 kB |

**Headroom warning for D3 and D7.** The normal build measures `/autorig` at 655,590 B (the final run, table above):
**4,410 B under the 660,000 B gate**. §7.1 budgets ≈ 25 kB for D3's frame, step ① and the i18n
table, so **D3's frame as estimated would put `/autorig` at ≈ 680 kB, ≈ 20 kB over the gate**. The overrun is not the
wizard's: it is editor-core's eager operators (+15.9 kB over §7.1, M6b growth) and the host (+20.7 kB, mostly the
Radix tooltip/toast layers it provides on both routes), against a few kB saved on rig/viewport/doc. Levers, measured
above, for D3/D7 before the gate question goes to the owner (§7.2: never raised silently):
- D3 loads the wizard frame's heavy parts (step ② onwards, sheets, i18n beyond ①) lazily; only the frame and ① are
  eager;
- the host's `TooltipProvider` (≈ 14 kB with `@radix-ui/react-tooltip`, popper and floating-ui) could move into the
  shells if Auto-Rig's step ① shows no tooltip (Studio keeps it eager, its panels use tooltips; Radix tooltips need a
  provider above them, so D3 decides);
- editor-core's eager operator registration (100.9 kB) is the largest single lever and is not D1's (§7.1 assumed it
  eager "as in `/editor`").

## Tests

- Unit (editor-core): `test/autorig/navigate.test.ts` (no port → refusal; forwarded once, no history step; disposer
  order; argument polls), `test/autorig/handoff-prune.test.ts`, the D1 row of the P-C6 table, the composition test's
  navigate reason.
- Unit (editor, Chrome): `ar-host-handoff-store.test.ts` (real IndexedDB: round trip once, never an orphan, own slot
  untouched, shared assets/blobs kept, expiry, pruning), `ar-host-handoff.test.ts` (writer, hand-over),
  `ar-host-navigation.test.ts` (`routeHref`, same-page go, chooser, new tab inside the gesture, failure toast, the
  no-router fallback, the port's lifetime, Studio's `leave()` stopping the preview and ending the tool session),
  `ar-host-shells.test.tsx` (a shell swap keeps the app, history, `state().storeVersion` and test API; Studio's
  operators leave and return; the first-run dialog only with Studio; StrictMode boots one app).
- E2E-AR-01 (`apps/web/e2e/ar-01-host-*.spec.ts`, helper `helpers/ar-host.ts`): the test API on `/autorig`; the round
  trip with a document built through operators (page mark, history, store version, counts, selection, slot, the GL
  host's very canvas and WebGL context; Mod+Z undoes "Use Clip Walk" afterwards); the first-run dialog only from Studio and Studio's operators back with its shell; the new-tab
  handoff on a clean document with autosave paused (no Recovery dialog although an orphan waits, own fresh slot,
  parameter dropped, source slot untouched, no record left); an expired record; the 390×844 view-only case.

## Gates

Fix round 1, on the final commit: `EKZA_E2E_PORT=3162 pnpm run ci` **green** (format, lint, typecheck, check:deps,
fixtures, licences, every package's unit tests, clean build, check:size — `/editor` 896,327 B, AR-B1 +639 B ≤ 2,048 B,
`/autorig` 655,590 B, every boundary holds — and the full e2e suite on local Chrome: 263 passed, 24 skipped — the
stretch `fixme`s — 0 failed). The D1 specs plus `ar-00` with `--repeat-each=5` at the default worker count: 45/45.
Two earlier full runs in this round lost tests to load timing outside D1, each passing alone and in the final run:
`input.test.ts` (KeyboardAdapter type-ahead, 30 s timeout under turbo's parallel load; 3/3 alone), and
`m2a-25-upgrade-m1-rig` ("has no runtime yet") with `m6b-rig-01-checklist` (the joint drag's "Move Joint"), 16/16 with
`--repeat-each=4`. The reviewer's blocker (`file.loadSample: no test API` in `ar-01-host-handoff`) did not recur.

Round 0: `EKZA_E2E_PORT=3162 pnpm run ci` green on `0246590` (format, lint, typecheck, check:deps, fixtures, licences, every
package's unit tests, clean build, check:size on both routes as above, the full e2e suite on local Chrome: 263 passed,
24 skipped — the stretch `fixme`s — 0 failed). An earlier run lost one editor unit test to a 30 s timeout under turbo's
parallel load (`input.test.ts`, untouched by D1; it passes alone and in the next run); an earlier full e2e run under
seven workers had four load-timing failures (`acceptance-round1` press interval, `m6a-25`, `m6a-26`, `shading-01`)
that pass alone and in the final run.
