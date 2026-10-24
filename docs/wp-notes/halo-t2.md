# Halo T2 — shell contracts and route

Work package T2 of [STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §21 (v0.2, ADR 0023), branch `halo/t2-contracts` off
`dev` (merged up to `7af76d0d`). T2 owns `editor-core/src/types.ts` for the whole Halo build: other packages send line
patches for it through the integration agent. Decisions: [DECISIONS-OPEN §P](../DECISIONS-OPEN.md) rows `ST-T2-*`.

## 1. Frozen contracts (§20.4)

These are the shapes the other packages code against. Changing one after T2 merges needs a PR that updates the spec
first (spec header). Where they differ from the §20.4 sketch, the row says why (ST-T2-1…4).

### editor-core `types.ts`

| Contract | Shape | Notes |
|---|---|---|
| `ShellRoute` | `'autorig' \| 'studio' \| 'halo' \| 'chooser'` | `'studio'` keeps meaning the Pro layout (`/editor`) internally (§1.3) |
| `ShellKind` (new) | `Exclude<ShellRoute, 'chooser'>` | `MountedShell.kind`, `NavigationRequest.from`, `HandoffInfo.route`, `EditorParams.from` |
| `ArrivalAction` | `{kind:'preset', preset: string} \| {kind:'panel', panel: PanelKind} \| {kind:'dialog', dialog: UiDialog}` | `dialog` is typed `UiDialog`, not `string` |
| `NavigationRequest` | `{to; workspace?; from?: ShellKind; newTab?; subject?; arrival?: ArrivalAction}` | **`arrival`, not `then`** (ST-T2-1) |
| `HaloStage` (new) | `'make' \| 'paint' \| 'rig' \| 'animate'` | §7.1, ST-3 |
| `HaloHandoffState` | `{stage: HaloStage; sheet?; threadLayer?: 0\|1\|2; destination?; fingers?: 'mittens'\|'thumb'\|'all'}` | as the sketch |
| `HandoffInfo` | `route: ShellKind`; `+ halo?: HaloHandoffState`; `+ arrival?: ArrivalAction` | optional: records of earlier builds have neither |
| `ToolPointerEvent` | `+ pressure?, tiltX?, tiltY?, altitude?, azimuth?, pointerId?, isPrimary?, coalesced?: readonly {x, y, pressure, t}[], virtual?` | §20.3 item 5; units in the comments (degrees for tilt, radians for altitude/azimuth, pane CSS px, ms); T1 fills them |
| `PrefsLayer` (new), `PrefsStore` | `PrefsStore = StoreApi<Prefs> & { override?(layer: PrefsLayer, patch): Disposer }` | T0 implements; **optional** (ST-T2-4); `getState()` is the effective value |
| `SaveTicket` (new), `FileService.save?` | as the sketch, `save?(file): SaveTicket` | T0 implements; **optional** (ST-T2-4); `download` kept |

The viewport contracts of §20.4 (`ViewportManager.navigate / setModifierSource / setPointerArbiter /
setDisplayOverlay`, `VirtualModifiers`, `ModifierSource`, `ArbiterConfig`, `DisplayOverlay`) live in `@ekza-studio/viewport`
(T1a spikes, T1 builds); `FormDef` lives in `editor-core/src/forms` (T5a). Neither is in `types.ts`.

### `operators/args.ts`

- `'shell.navigate': { args: { to: ShellRoute; workspace?; from?: ShellKind; newTab?; arrival?: ArrivalAction }; result: void }`
  (new, U).
- `'autorig.navigate'`: `to: Exclude<ShellRoute, 'halo'>` — its routes, poll messages and agent schema are unchanged.

### editor host (`@ekza-studio/editor/host`)

- `MountedShell.kind: ShellKind`; `+ haloState?(): HaloHandoffState` (Halo only; Auto-Rig's `handoffState` unchanged,
  ST-T2-2).
- `HostNavigation`: `+ takeArrival(): ArrivalAction | null`, `+ takeHalo(): HaloHandoffState | null` (read once);
  `takeWorkspace()` now serves Halo too. A same-page `go` from Halo runs `leave()` (Halo commits its tool session), then
  captures `haloState()`; any other leaving shell hands over no Halo state. `arrive(record)` sets both from the record.
- `routeHref`: every route explicit (`ROUTE_PATHS = {studio:'/editor', autorig:'/autorig', halo:'/app'}`); `ws=` for
  Studio and Halo; `stage` is an arrival parameter (dropped on every switch).
- `HostShell.notePointer(type)`: the window input adapter reports each press's pointer type (and a mouse move); after a
  touch or pen press the key scope is `hover ?? lastPanel` (§20.3 item 13, ST-T2-5).
- Pro (`StudioShell`): no first-run dialog when `params.from !== null` (adds `halo`); applies a same-page switch's
  arrival action (`workspace.preset.apply` / `workspace.showPanel` / `ui.open` with the action as arguments; presets and
  panels wait up to 60 frames for the dockview workspace).

### Test API (`test-api/halo.ts`, types)

- `halo(): HaloTestState | null` — `{stage, sheet, noun: {kind, id} | null, petals: string[], threadLayer, thumb: {mode:
  'hidden'|'off'|'once'|'locked'|'held', tap, drag}, visibleTargets, touches, slices: Record<string, unknown>}`, fed by
  `provideHaloTestState(app, provider)` (marker-free, like `autorig.ts`). `slices` takes the per-package extras so the
  shape does not need to change for T7–T11.
- `mountedShell(): ShellKind | null`; `navigate(request: NavigationRequest): Promise<void>` (the port, as a UI control
  calls it).

### Entry (`apps/web/app/entry.ts` + `editor/src/dialogs/entryChoice.ts`)

- `EntryChoice = 'autorig' | 'studio' | 'halo'`; `ENTRY_ROUTES = {autorig:'/autorig', studio:'/editor', halo:'/app'}`.
- `HALO_ENTRY = false` in both copies (held equal by `entry-contract.test.ts`). Off: `REDIRECT_SCRIPT` is byte for byte
  the shipped script (pinned in the test), a stored `'halo'` reads as Ask, the landing renders today's two cards and
  Start in today's three rows. On (T12): a first visit, a malformed record or blocked storage opens `/app`; a remembered
  `studio`/`autorig` still wins; `/?chooser=1` lists three rows (Ekza Studio, Ekza Studio Pro, Rig a model for me); Start
  in offers Default (Ekza Studio) / Ekza Studio / Ekza Studio Pro / Rig a model for me. `redirectScript(haloEntry)` and
  `redirectHref(…, haloEntry)` take the flag so both rules are tested now.

### `@ekza-studio/halo` (`packages/halo/src/index.ts`)

`HALO_SHELL_MARKER = 'ekza-halo-shell'`, `HALO_SESSION_KEY = 'ekza-studio:halo:session:v1'`, `HALO_STAGES`,
`stageOfWorkspace` (Model → make, Rig & Skin → rig, Animate → animate, else make), `workspaceOfStage`, the type
re-exports `HaloStage` / `HaloHandoffState`, and `HaloShell` — empty: it mounts `{kind:'halo', haloState}` and shows a
header with *▤ Pro layout* (a same-page `go({to:'studio', from:'halo'})` from the tap handler). T6a replaces the shell
under `src/shell/**` and re-exports it from `index.ts` (a line patch). Every allowed dependency is declared now
(anim-core, doc, editor-core, viewport, curve-editor, ui, editor, react) so stage packages need no manifest edits.

### Route and tooling

- `apps/web/app/(studio)/app/`: `page.tsx` (title "Ekza Studio"), `layout.tsx` (`viewport-fit=cover`, the manifest link
  `/manifest.webmanifest`, which 404s until T0 ships the file), `HaloEntryIsland.tsx` (`next/dynamic`, `ssr: false`),
  `HaloEntry.tsx` (`useShellEntry({Host: StudioHost, Shell: HaloShell, …})`).
- `check:size`: `ROUTES += 'app'`; `ROUTE_LIMITS.app = {gate: 700,000, target: 660,000, firstVisit: []}`;
  `ROUTE_BOUNDARIES.app` = dockview, Studio shell, Auto-Rig shell, curve editor; `halo-shell` banned on `/editor` and
  `/autorig`; `ROUTE_INITIAL_MARKERS.app = ['ekza-studio-host', 'ekza-halo-shell']`; `size-baseline.json routes.app`
  unenforced (`enforce: false`, placeholder total recorded).
- `check-deps`: `@ekza-studio/halo` allow-list; `web` may depend on it. oxlint: `packages/halo/src/**` and its tests may
  import only the §20.1 list (with the not-yet-existing subpaths `editor-core/forms`, `ui/touch`, `editor/models`,
  `editor/overlays`, `editor/toolkit`, `editor/agent` pre-admitted); `apps/web/app/**` may import `@ekza-studio/halo`.

## 2. Exit test

| Check | Result |
|---|---|
| Empty `HaloShell` mounts at `/app`, `chrome` | ha-12 test 1 green: host test API, `mountedShell() === 'halo'`, title, no first-run dialog, neither other shell nor the curve editor fetched |
| … `webkit-ipad` | T0's project is not merged: run by hand with a temporary config (`devices['iPad Pro 11']` and its landscape variant, WebKit build 2370 through `executablePath`, since Playwright 1.63's build 2359 is not installed here): **all four ha-12 tests green in both orientations (8/8)** |
| Halo → Pro → Halo keeps the undo history (ha-12 skeleton) | ha-12 test 2 green on `chrome` and WebKit: document, history, selection, autosave slot, store version and the very GL canvas and context survive both switches; `edit.undo` in Halo takes back "Use Clip Walk" |
| Pro layout button, arrival action, `from=halo` | ha-12 tests 3–4 green |
| Entry contract | `entry-contract.test.ts` green (flag off = shipped script; flag on rules run in a VM) |
| `/app` measured, unenforced | 635,275 B (gate 700,000, target 660,000: target met) |

### Gate

`EKZA_E2E_PORT=3163 pnpm run ci` at `e000a6bd` (dev `7af76d0d` merged): **green** — format, lint (`oxlint
--type-aware`), typecheck, check:deps, fixtures, licences, 23 test tasks (editor-core 1,705, editor 627 + 1 skipped,
halo 6, web 102, autorig 112, …), the production build, check:size (all three routes OK) and the e2e suite (369 passed,
24 skipped stretch specs, 0 failed; ha-12 4/4). Two earlier runs failed in the unit step only, on the same
timing-sensitive editor browser tests (`input.test.ts` dropdown hover, `shell.test.tsx` Space tap and the frame loop, then
a cascade from editors the timed-out tests left mounted) and once on the MCP bridge's confirm-deadline test, while a VM on
the machine held the load average at 60–120 (14 cores). Each passed alone, the whole editor suite passed alone (64 files),
and nothing in them reaches T2's code paths (synthetic pointer events have an empty `pointerType`).

## 3. Measurements (production build, gzip -9, `check:size`)

| Route | dev `d5d123c3` | T2 | Delta |
|---|---|---|---|
| `/editor` | 891,790 B | 892,064 B | **+274 B** (limit 897,736 B, gate 900,000 B) |
| `/autorig` | 652,528 B | 652,691 B | **+163 B** (gate 660,000 B) |
| `/app` | — | 635,275 B | placeholder, unenforced |

The deltas are the shared host code, not the route: `routeHref`'s route table, `takeArrival`/`takeHalo`, the key-scope
rule and `notePointer` (host, both routes), `from=halo` (params), and on `/editor` only Pro's arrival handling. Proposed
ST-B1 allowance for T2: **320 B on `/editor`, 192 B on `/autorig`** (owner decision after T1a). The Model workspace
chunk warning (250,203 B > 250,000 B) is the same on `dev`.

## 4. Deviations from the row

- **`then` → `arrival`** (and `takeThen` → `takeArrival`) — ST-T2-1.
- **`shell.navigate` is defined but not registered yet**: the operator, its validation and `registerShellNavigate` are
  in `editor-core/src/operators/builtin/shellNavigate.ts` with unit tests, but the host can only import it once
  `editor-core/src/index.ts` (not in the row) exports it — patch P1. Until then UI controls and the test API call the port
  directly (as the spec wants for taps anyway).
- **`provideHaloTestState` is not on `@ekza-studio/editor/host` yet** (`host/index.ts` is not in the row) — patch P2. The
  test API's `halo()` works and answers null until a shell provides state.
- Files touched outside the row, each the minimum to keep the gate green or to make the row's files build:
  - tests pinned to the old two-route / two-choice shapes: `apps/web/test/ar-size.test.ts` (3 expectations),
    `apps/web/test/entry-choice.test.ts` (1), `apps/web/test/route-scripts-group.test.ts` (1);
  - `apps/web/scripts/check-size.d.mts` (the type companion of `check-size.mjs`: `HALO_GATE_BYTES`,
    `HALO_TARGET_BYTES`);
  - the new package's own config and test: `packages/halo/{vitest.config.ts, src/tsconfig.json, test/tsconfig.json,
    test/contracts.test.ts}`;
  - new test files: `packages/editor-core/test/halo/shell-navigate.test.ts`, `packages/editor/test/halo-t2-host.test.ts`,
    `apps/web/e2e/ha-12-round-trip.spec.ts`;
  - `pnpm-lock.yaml` (`pnpm install --offline`: the `packages/halo` importer and the `web` link only; no external
    package added);
  - `editor/src/dialogs/DialogHost.tsx`: comments only; `FirstRunDialog.tsx`: unchanged (nothing to change while the
    flag is off).
- `curve-editor` is in Halo's lint allow-list: oxlint's `no-restricted-imports` also matches dynamic `import()`, so
  "lazy imports only" cannot be a lint rule; the `/app` `curve-editor` size boundary and ha-12 enforce it (ST-T2-8).

## 5. Line patches for other files (to apply at `halo/int`)

| # | File (owner) | Patch | Why |
|---|---|---|---|
| P1 | `packages/editor-core/src/index.ts` (integration) | `export { NO_SHELL_NAVIGATION, registerShellNavigate, SHELL_ROUTES } from './operators/builtin/shellNavigate';` — then in `editor/src/host/createHost.ts` (T2) after `registerHostOperators`: `disposers.push(registerShellNavigate(app));` | registers `shell.navigate` on every route (host-level, like `ui.open`); headless apps stay without it, so the agent reference and policy tests do not change |
| P2 | `packages/editor/src/host/index.ts` (integration) | `export { type HaloTestState, provideHaloTestState } from '../test-api/halo';` | T6a's shell registers `halo()` state |
| P3 | `packages/ui/styles.css` (T4) | `@source "../halo/src";` | Tailwind classes used only by Halo (the empty shell uses classes the editor already has) |
| P4 | `apps/web/playwright.config.ts` (T0) | the `webkit-ipad` project runs `ha-*` including `ha-12-round-trip.spec.ts`; install WebKit for Playwright 1.63 (`pnpm exec playwright install webkit`, build 2359) | the T2 WebKit check was manual |
| P5 | `apps/web/e2e/bench/budgets.bench.ts` (T12) | `captureRouteScripts(page, origin, route)` and an `app route JS` test waiting for `[data-shell="ekza-halo-shell"]` | §20.6 "the route is added to budgets.bench.ts" |
| P6 | `packages/editor/src/shell/createShell.ts:113` (T3, with the `promptRecovery` re-homing) | `firstRun: host.params.from === null` | `/editor?from=halo` (or a later `from`) opens no first-run dialog, so the Recovery prompt must not wait for it; reachable today only by a typed URL (a switch carries `?handoff=` and skips the prompt) |
| P7 | `docs/STUDIO-TOUCH-SPEC.md` §20.4 (owner / T12) | `then` → `arrival`; add `ShellKind`, `HaloStage`, `MountedShell.haloState`, `HostNavigation.takeArrival`/`takeHalo`, `HostShell.notePointer`; `PrefsStore.override?` and `FileService.save?` optional | the spec is binding after T1a and T2 merge |

## 6. Follow-ups

- Pro applies the arrival action of a **same-page** switch. A new-tab record's `arrival` reaches the port
  (`takeArrival()` after `arrive`), but Pro reads it at mount, before the record arrives; applying it after a record is
  a T3/T12 follow-up (the Share sheet's *Open in a new tab* is the only source).
- `haloState()` of the empty shell reports only the stage (from the session's workspace); T6a's controller reports the
  sheet, Thread layer, destination and finger preset, and reads `takeWorkspace()` / `takeHalo()` / `?stage=` on arrival.
- `/app`'s manifest link 404s until T0 ships `public/manifest.webmanifest`.
