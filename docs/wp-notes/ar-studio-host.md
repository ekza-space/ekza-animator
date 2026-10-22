# Auto-Rig D1 — studio host: HostShell / StudioShell split, the `(studio)` route group, handoff record, navigation port: build notes

Branch `autorig/studio-host` (from `autorig/mvp` at `04e2c54`, D0's `autorig/contracts` merged at `ed07e32`). Scope:
[AUTORIG-SPEC §10 D1](../AUTORIG-SPEC.md#d1--studio-host) with §4.4 (the Shell split, same page, handoff record),
§3.4/§4.5 (`autorig.navigate`), §7.0–§7.2 (sizes) and §8.3 (AR-V1). Decision IDs below are `AR-D1-<n>`. The work
package prompt named these notes `autorig-studio-host.md`; the spec's D1 Dirs name `ar-studio-host.md`, which this file
follows (as D0 did).

## What shipped

| Part | Where |
|---|---|
| **HostShell** (one per page load): UI store, frame hooks + fallback scheduler, help line, confirm, `runFromUi`, file pipeline, export recorder, keyboard adapter, probes, autosave start (no Recovery prompt), the command palette behind the overlay port (`openCommandPalette`; `openMarkingMenu` goes to the mounted shell), the host's shell operators (`ui.open`, `ui.close`, `prefs.set`, `view.selectionMask`, `view.toggleFullscreen`), the navigation port, the mounted-shell slot | `editor/src/host/createHost.ts`, `host/types.ts` (`HostShell`, `MountedShell`, `HostNavigation`) |
| **`StudioHost`** (React): boot (services, EditorApp, skin worker, e2e prefs, HostShell, a `?handoff=` record), `GLHost`, the window input adapter, `DialogHost`, `CommandPaletteHost`, the toasts (lazy), the drop overlay, the test API (installed once the route's shell mounted, on both routes), disposal after the shells' | `host/StudioHost.tsx`, `host/context.tsx` (`useHost`, `useHostUi`, `HostProvider`) |
| **StudioShell**: `createShell({host})` adds the panel registry, the dockview workspace adapter, layout presets, Studio's shell operators (the rest of `shellOperatorDefs`), menu items, marking menus, the Graph Editor / time-slider probes, the model HUD/transform UI, the rig shell (`registerRigShell`, whose disposer clears the view-only flag) and the Recovery prompt (`promptRecovery`, once per page load, skipped on a handoff page). `createShell` without a host makes one of its own (unit tests, harnesses) | `shell/createShell.ts`, `shell/types.ts` (`Shell extends HostShell, MountedShell`) |
| `StudioShell` component (the `/editor` route's shell): applies the arriving workspace (`navigation.takeWorkspace()`, else on the page's first Studio shell `ws=` or `prefs.lastWorkspace`), mounts itself in the host, opens the first-run dialog (Studio only), renders `EditorShell` under `data-shell="ekza-studio-shell"`; disposed a task after it unmounts | `shell/EditorShell.tsx` |
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
| AR-D1-2 | **Lazy, to pay for the split**: the toasts and Radix's toast provider (loaded with the page's first toast and kept; no toast shows on a normal first visit), the kernel-failure page (`KernelUnavailable`, only when the kernel cannot start), the handoff writer/reader and `takeHandoff` (only the new-tab flow, the fallback and `?handoff=` pages) | AUTORIG-SPEC §7.0 rule 5. Without them the per-route design measured `/editor` 897,984 B (+2,252 B over D0, over D1's 1,408 B) |
| AR-D1-3 | `useShell()` keeps returning `Shell`: under Studio's `ShellProvider` (or the mounted Studio shell the dialog layer provides) it is the Studio shell, elsewhere the HostShell. `useOptionalShell()` likewise | D1 may not edit `dialogs/*Dialog.tsx` (A0, D2 own lines there); those dialogs read only HostShell members; the Studio-only Layout presets dialog opens from Studio's menus |
| AR-D1-4 | The host registers five of `shellOperatorDefs`' rows (`HOST_OPERATOR_IDS`); the Studio shell registers the others. `shell/operators.ts` is unchanged | the HostShell's operators exist on both routes (§4.4) without editing a file outside the Dirs |
| AR-D1-5 | The Recovery prompt is the Studio shell's (`promptRecovery`, once per page load per app); the host starts autosave with `prompt: false`. A handoff page never prompts | §4.4: Auto-Rig shows its own Continue card (D3); "without the Recovery dialog" |
| AR-D1-6 | Handoff rows live in the existing `slots` object store (`handoff:<id>`, `info: null`) instead of a new object store | no database version bump (other open tabs keep their connection); the slot and blob collections then keep a record's assets and blobs with no extra code |
| AR-D1-7 | The receiver opens the record through `file.openProject` with the `.ekzanim.json` variant built from the record (`writeProjectJson`) after putting its assets and blobs, not through `file.recover` | the shipped load path with migrations and session repair, reachable from `editor` (the recover path's helpers are editor-core internals); no `markRecovered`, no Recovery dialog, the page's own fresh slot. The document opens clean (as an opened project); the source tab keeps its own state |
| AR-D1-8 | Without a client router (`StudioHost` without `navigate`: the harness, the two-island fallback) a switch hands over through a record and reloads in this tab | §4.4 fallback; the same lazy writer |
| AR-D1-9 | The view-only rule per shell (AR-V1) needed no change in `shell/rig/viewOnly.ts`: `watchRigViewOnly`'s disposer already clears the flag; the Studio shell's disposal (a task after it unmounts) now disposes the rig shell UI that holds it | E2E-AR-01 view-only case at 390×844 |
| AR-D1-10 | The 390×844 case runs the inner operators Auto-Rig will compose (`mesh.importStatic`, `skel.quickRig.commit`, `skin.bind`) instead of `autorig.rig`/`autorig.sample` | both are D0 stubs until D3/D4 |
| AR-D1-11 | `/autorig`'s and `/editor`'s loading text comes from the page islands (`next/dynamic` `loading`), fixed over the page | the layout island stays minimal (0.4 kB); on a switch it covers the host until the arriving entry registers |

**Shared files touched outside the D1 Dirs** (for D7's approval): `.oxlintrc.json` (apps/web may import
`@ekza-studio/editor/host`), `packages/editor-core/src/index.ts` and `src/workspaces/index.ts` (one export line each for
`provideNavigation` / `hostNavigation`), `packages/editor/src/shell/Toaster.tsx`'s provider (in the Dirs), new test files
`packages/editor/test/ar-host-{handoff-store,handoff,navigation,shells}.test.ts(x)`,
`packages/editor-core/test/autorig/{navigate,handoff-prune}.test.ts`, and the D0 tests updated for the landed
`autorig.navigate`: `editor-core/test/autorig/composition.test.ts` (its poll reason), `editor-core/test/m6b/keys-hash.test.ts`
(the D1 row turned `checked` with a recording port), `packages/editor/test/test-api.test.ts` (the params literal),
`apps/web/e2e/ar-00-foundation.spec.ts` (navigate's own refusal).

## Sizes (production build, `check:size`, gzip -9)

| Build | `/editor` (eager + First-run) | delta vs D0 (895,732 B) | `/autorig` |
|---|---:|---:|---:|
| D0 head (`ed07e32`) | 895,732 B | — | 134,011 B (placeholder) |
| Shared layout as sketched (host group + `React.lazy` shell) | 906,914 B | +11,182 B | 662,648 B |
| Per-route entries, first cut | 902,740 B | +7,008 B | 666,370 B |
| + entry imports only the package root (one module graph) | 898,564 B | +2,832 B | 662,538 B |
| + lazy kernel-failure page, slim layout island, lazy `takeHandoff`, boot-time handoff read | 897,984 B | +2,252 B | 661,863 B |
| + lazy toasts (shipped) | **892,999 B** | **−2,733 B** | **653,115 B** |

`/editor` eager scripts 886,039 B + First-run dialog 6,960 B; the D1 delta is within its 1,408 B (it frees bytes).
`/autorig` 653,115 B is under the 660,000 B gate (target 620,000 B): the host, the kernel, three.js, R3F and the
viewport, without dockview, the curve editor, the panels or the Studio shell (every boundary of §7.2 holds). The
integration agent records `routes.autorig` in `size-baseline.json` at the merge (§10 D1).

## Tests

- Unit (editor-core): `test/autorig/navigate.test.ts` (no port → refusal; forwarded once, no history step; disposer
  order; argument polls), `test/autorig/handoff-prune.test.ts`, the D1 row of the P-C6 table, the composition test's
  navigate reason.
- Unit (editor, Chrome): `ar-host-handoff-store.test.ts` (real IndexedDB: round trip once, never an orphan, own slot
  untouched, shared assets/blobs kept, expiry, pruning), `ar-host-handoff.test.ts` (writer, hand-over),
  `ar-host-navigation.test.ts` (`routeHref`, same-page go, chooser, new tab inside the gesture, failure toast, the
  no-router fallback, the port's lifetime), `ar-host-shells.test.tsx` (a shell swap keeps the app, history and test
  API; Studio's operators leave and return; the first-run dialog only with Studio; StrictMode boots one app).
- E2E-AR-01 (`apps/web/e2e/ar-01-host-*.spec.ts`, helper `helpers/ar-host.ts`): the test API on `/autorig`; the round
  trip with a document built through operators (page mark, history, counts, selection, slot; Mod+Z undoes "Use Clip
  Walk" afterwards); the first-run dialog only from Studio and Studio's operators back with its shell; the new-tab
  handoff on a clean document with autosave paused (no Recovery dialog although an orphan waits, own fresh slot,
  parameter dropped, source slot untouched, no record left); an expired record; the 390×844 view-only case.

## Gates

Recorded in the final report of this package (format, lint, typecheck, check:deps, unit tests, build, check:size on
both routes, E2E-AR-00/01 and the full e2e suite on port 3162, local Chrome).
