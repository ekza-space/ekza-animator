# Halo T3 — host re-homing and the Pro switch

Work package T3 of [STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §21 (v0.2, ADR 0023), branch `halo/t3-host` off
`halo/int` (`fcf43871`, T2 merged; `halo/int` merged in again before the gate, up to `9d7b3a09`: T4, T5a, T0, T5b).
Spec items: §20.3 item 12 (host re-homing), §16.1 (the Pro → Simple layout switch, `watchRigViewOnly` Pro-only), §1.1 /
ST-30 (the "Ekza Studio Pro" title behind a flag), J10 (recovery), and two patches other packages asked of T3: T5a's
(§20.3 item 7: the UI wrappers at idle) and T0's (§16.4, S24: write unsaved work when the page is hidden).
Decisions: [DECISIONS-OPEN §P](../DECISIONS-OPEN.md) rows `ST-T3-*`.

## 1. What moved to the host

Before T3 only the Studio shell registered these, so they vanished with Pro (a switch to Halo or Auto-Rig on the same
page) and never existed on `/app` or `/autorig`. Now the page's host registers them, **once per app, lazily, kept until
the host goes** (`editor/src/host/registrations/**`, started by `createHostShell`):

| Part | What | When it loads | Before T3 |
|---|---|---|---|
| `index.ts` (eager) | the seam: starts the Recovery watcher, loads `./parts` at once (retried at the next session change if offline) | with the host | — |
| `recovery.ts` (eager) | the Recovery prompt's timing (`watchRecovery`) and the shell hook (`provideRecoveryHook`) | with the host | `promptRecovery` in Pro's `createShell` |
| `parts.ts` (lazy, at once) | `view.selectionMask`, `view.toggleFullscreen` (`./view`); the UI wrappers at idle (`loadUiWrappers`, T5a); the workspace parts below | requested at host creation | view ops: eager in Pro's `shell/operators.ts`; wrappers: nowhere |
| `model.ts` (lazy) | Model's marking-menu definitions: `model.modes`, `model.convert` (B10), `model.options`, `model.options.lmb`, `model.space.move`, `model.space.rotate` (B12a), `model.primitives`, `model.tools.*`, `model.merge` (B11) — the list is `overlays/menus/index.ts` `MODEL_MARKING_MENUS` | first Model entry | B10 eager at shell creation; B12a and B11 lazy on the first Model entry, from Pro's `ModalReadout` and option-box overlay |
| `rig.ts` (lazy) | `RIG_MENU_ITEMS`, the selection-dependent Skeleton items (`registerRigDynamicMenus`), `RIG_MARKING_MENUS` (`rig.modes`), `rig.snap.projectedCenter`, `rig.jointSize.set` | first Rig & Skin entry | Pro's lazy rig chunk (`shell/rig/register.ts`) |
| `agent.ts` | `useAgentPill(open, ready)`: the live pill from the agent slot and the once-per-page `?agentPort=` opener | imported by a shell (Pro's status line; Halo's Ask sheet later) | inline in Pro's `StatusLine` |

Every contribution goes through `registerOnce` (`once.ts`): an id that is already registered (an extension, a test, a
second registration of the part) is left alone, and the part's disposer removes only what it added.

**Stays in Pro** (Pro-only UI): the HUD and `BIND POSE` pane overlays (`registerModelSelectUi()`), the modal readout
slot (`registerModelTransformUi()`), the option-box overlay, the rig status-line groups, pane overlays, dock tabs
following the mode, the help line, the skeleton UI and **`watchRigViewOnly`** (AR-V1: below 1024 px Pro's Rig & Skin
is view-only; Halo edits at every width, §16.1, AS-ST-7). Pro's `shellOperatorDefs` keeps `view.toggleMaximize` and the
workspace / preset / chrome commands (dockview's).

### Recovery (J10, §17)

The host decides *when* — once per page load, when orphaned slots exist, no dialog is open, after the first-run dialog
of a shell that opens one, never on a page that received a handoff record — and the mounted shell decides *how*:

```ts
// @ekza-studio/editor (host/registrations): the mounted shell's hook (latest wins; the disposer withdraws it)
interface RecoveryHook { readonly firstRun: boolean; offer(): void }
function provideRecoveryHook(app: EditorApp, hook: RecoveryHook): Disposer;
```

- **Pro**: `{ firstRun: host.params.from === null, offer: () => ui.open {dialog: 'recovery'} }` — T2's patch **P6**:
  a page opened `from=autorig` *or* `from=halo` shows no first-run dialog, so the offer does not wait for it.
- **Halo** (T11): `{ firstRun: false, offer: () => <Home › Continue> }` — no modal (§17).
- **Auto-Rig**: provides none and keeps its own card (`ModelStep` reads `session.recovery`), as before.
- Without a hook nothing is offered; the slots stay for File › Recover… and a later shell's hook.

`promptRecovery({app, runFromUi, skip?, firstRun?})` remains for harnesses (both halves at once);
`startShellAutosave({app, target?})` no longer prompts (its `prompt` and `runFromUi` options are gone; the host was
its only caller).

**Hidden pages (T0's patch, §16.4, S24)**: `startShellAutosave` also writes the snapshot (`controller.writeNow()`) on
`pagehide` and on `visibilitychange` to hidden — iPad Safari fires `beforeunload` but never shows its prompt, and a
hidden tab may be discarded. **Only while the project is dirty** (a deviation from T0's line, ST-T3-9): on a desktop a
write after `beforeunload`'s clean would leave this page's own snapshot as an orphan, and the next load would offer a
Recovery dialog for a clean project; T0's iOS store keeps the snapshot through clean ends anyway.

## 2. The Pro switch (§16.1, J9)

- **`shell.halo`** (`shell/menuItems.ts`): internal (hidden from the palette), not undoable; `poll` prefetches the lazy
  half, `prepare` runs `hostNavigation(app).go(haloRequest(app))` = `{to: 'halo', from: 'studio', workspace}` — a
  same-page switch, the document, undo history, selection, time and cameras kept. Without the chunk it still
  navigates (`{to: 'halo', from: 'studio'}`).
- **`shell/haloSwitch.ts`** (lazy, like `autoRigSwitch.ts`): `haloRequest` and `rememberSimpleLayout()` — §1.2 "using
  the layout switch updates the remembered entry": a remembered `'studio'` becomes `'halo'`, Ask and Auto-Rig stay;
  **behind `HALO_ENTRY`**, so it writes nothing until T12 (a stored `'halo'` reads as Ask while the flag is off).
- **Help › Switch to the Simple Layout** (`shell.help.halo`, after Switch to Auto-Rig), **File › Switch to the Simple
  Layout** (`shell.file.halo`, after Auto-Rig This Model…), and the status line's **▤ Simple layout** button
  (`status-halo`, its own *Layout* group right after the AI pill).
- The stage mapping of §16.1 (Model → Make, Rig & Skin → Rig, Animate → Animate) travels as the workspace (`ws=` and
  `takeWorkspace()`); the finer arrival — Paint when the Paint Colour tool is active, the Thread at Curves when keys
  are selected, a selected joint's Halo — is Halo's arrival reading the same session (T6a), since `NavigationRequest`
  has no Halo state for Pro to send (ST-T2-2).
- **Title**: `PRO_TITLE = false` (`shell/menuItems.ts`) → `PRO_NAME` = "Ekza Studio" in Pro's menu-bar mark; T12 turns
  it on ("Ekza Studio Pro", ST-30). Constant-folded: 0 B now.

## 3. Exit test

| Check | Result |
|---|---|
| Registrations present with Pro unmounted (unit) | `test/halo-t3-registrations.test.tsx` (11 tests, green): a host alone (Halo-shaped mount) gets the view operators at once, Model's marking menus on the first Model entry and Rig & Skin's menu items, dynamic Skeleton items, `rig.modes` and both settings on the first Rig & Skin entry, all usable (`rig.jointSize.set`, `view.selectionMask` run); after Pro mounts, registers its own operators and unmounts, everything re-homed is still there and Pro's own (`workspace.reset`) is gone; `host.dispose()` removes them; a second registration of a part changes nothing |
| `watchRigViewOnly` still Pro-only (unit) | same file: with a narrow window (only the view-only query matches) the host alone in Rig & Skin leaves `rigViewOnly(app)` false; Pro mounted makes it true; Pro gone, false again, the rig registrations still present |
| Recovery hook (unit) | no hook → no offer; a hook offers once per page load; a handoff page never offers; Pro waits for its first-run dialog on its own page; `from=halo` and `from=autorig` offer at once (P6) |
| Pro switch (unit) | `shell.halo` pushes `/app?ws=rig&from=studio`, `takeWorkspace()` = `rig`, a remembered `'studio'` is kept while `HALO_ENTRY` is off; Help › and File › items present; `PRO_NAME` pinned |
| Pro switch and registrations in a browser (e2e, `chrome`) | `e2e/ha-t3-pro-switch.spec.ts` (2 tests): the status line's ▤ Simple layout switches a Pro page in Rig & Skin to `/app?e2e=1&ws=rig&from=studio` on the same page (page mark kept, document and history equal); in Halo `view.selectionMask`, `rig.jointSize.set` and `rig.snap.projectedCenter` run and `edit.undo` takes back the import; Help › Switch to the Simple Layout does the same from Animate. Green alone with ha-12 (6/6) and in the gate |
| Hide flush (unit) | `recovery.test.tsx`: `pagehide` writes nothing while clean; a `visibilitychange` while visible writes nothing; `pagehide` while dirty writes the page's slot |
| All Pro e2e green | see *Gate* |
| `/editor` within ST-B1 | see *Measurements* |

## 4. Measurements (production build, gzip -9, `check:size`)

| Route | `halo/int` `fcf43871` | `halo/int` `154e7188` | T3 (`eb70f436`) | Δ vs `154e7188` |
|---|---|---|---|---|
| `/editor` | 892,680 B | 892,678 B | **891,883 B** | **−795 B** |
| `/autorig` | 653,319 B | 653,319 B | **653,471 B** | **+152 B** |
| `/app` | 635,893 B | 635,895 B | 636,050 B | +155 B (unenforced) |

T3's allowance (T1a's ST-B1 proposal): 256 B on `/editor` and `/autorig` for the re-homing, plus 128 B on `/editor`
for the Pro switch items. Both routes are inside it; `/editor` is net smaller because the re-homing moved eager Pro code
into lazy chunks:

- **Out of `/editor`'s eager scripts**: B10's `model.modes` / `model.convert` data (now with the first Model entry),
  `view.selectionMask` / `view.toggleFullscreen` (now the host's lazy chunk), the modal readout's loader of B12a's menus,
  the inline `promptRecovery`.
- **Into every route's eager scripts** (`/autorig`, `/app`, `/editor`): the seam (one async loader, the session
  subscription) and the Recovery watcher (`recovery.ts`; Turbopack keeps it a separate module, ≈ 60 B of wrapper,
  because Pro's shell and the host both import it).
- **Into `/editor` only**: `shell.halo`, its two menu items, the status-line button and the lazy loader of
  `haloSwitch.ts`.

A first version with one async loader per part (view, model, rig) measured `/editor` −612 B, `/autorig` **+333 B**:
each Turbopack async loader is ≈ 110 B raw with an incompressible chunk name. One lazy `parts` chunk that loads the
workspace parts itself brought `/autorig` to +152 B (ST-T3-1).

## 5. Gate

`EKZA_E2E_PORT=3168 pnpm run ci` — see the result below (filled in after the run).

## 6. Deviations and files outside the row

- **`editor/src/host/createHost.ts`** (T2's file; patch **P-T3-1**, applied here because the exit test needs the host
  to start the registrations): imports and calls `startHostRegistrations(app, params)` after `registerShellNavigate`;
  `startShellAutosave({ app })` (no `prompt: false`, no `runFromUi`); two comments.
- **`editor/src/panels/toolkit/ModelOpsSlot.tsx`**: dropped its parallel prefetch of `overlays/menus/tools` (the host
  registers B11's menus now; the prefetch and its comment would have been dead).
- **`editor/src/shell/MenuBar.tsx`**: the mark reads `PRO_NAME` (the title flag).
- **`turbo.json`**: biome formatting of `halo/int`'s `//#test:tooling` inputs line (it failed `format:check`); no
  content change.
- Tests adapted to the move: `commands.test.ts` (waits for the lazy `view.selectionMask`), `layout-presets.test.tsx`
  (`view.toggleFullscreen` from `viewOperatorDefs`), `recovery.test.tsx` (the prompt through `promptRecovery`).
- `registerModelTransformMenus` (`overlays/menus/options.ts`) and `registerRigShellOperators`
  (`shell/rig/operators.ts`) are removed (no callers left); `registerModelOpsMenus` (`tools.ts`) stays for harnesses.
- The switch items are **visible** on `halo/int` (not behind a flag), as T1a spiked and measured them; ST-30's "`/app`
  by URL only until T12" holds for users because `halo/int` reaches `dev` only at T12 (ST-T3-4).

## 7. Patches for other packages

| # | File (owner) | Patch | Why |
|---|---|---|---|
| P-T3-1 | `packages/editor/src/host/createHost.ts` (T2 / integration) | applied in this branch (§6) | the host starts the registrations |
| P-T3-2 | `packages/editor/src/host/index.ts` (integration) | `export { provideRecoveryHook, type RecoveryHook } from './registrations';` and `export { useAgentPill } from './registrations/agent';` | Halo's Home › Continue (T11) and Ask sheet (T6a/T10) reach them through `@ekza-studio/editor/host` |
| P-T3-3 | `packages/editor/src/shell/menuItems.ts` + `apps/web/app/(studio)/editor/page.tsx` (T12) | `PRO_TITLE = true`; `metadata.title = { absolute: 'Ekza Studio Pro' }` | ST-30: the title flips with `HALO_ENTRY` |
| P-T3-4 | `packages/halo/src/shell/**` (T6a, T11) | arrival: Paint when `tools.viewport` is the Paint Colour tool, the Thread at Curves when keys are selected, a selected joint's Halo; `▤ Pro layout` updates a remembered `'halo'` to `'studio'` behind `HALO_ENTRY`; `host.mount` + `provideRecoveryHook(app, { firstRun: false, offer })` (Home › Continue); Halo's idle prefetch calls `loadUiWrappers(app)` too | §16.1, §1.2, J10; the host's side is done |
| P-T3-5 | `docs/STUDIO-TOUCH-SPEC.md` §20.3 item 12 (owner / T12; add to T2's P7) | "lazy, once per app: view operators at once, Model's marking menus and Rig & Skin's menus and settings on their workspace's first entry; the recovery hook is `provideRecoveryHook(app, {firstRun, offer})`" | the spec text says only "idempotent, lazy, host-level" |

## 8. Follow-ups (not in T3's row)

- Pro's arrival toast *"Same project, every panel at once · Undo still works"* (§16.1) and the view-only line's *Back
  to the Simple layout* in Pro's Rig & Skin below 1024 pt (§15.0, §16.1) belong to Pro's `EditorShell` arrival and
  `panels/viewport/rig/overlays` — T12 or a Pro follow-up.
- On `/autorig` the host now also registers (lazily) the view operators, Rig & Skin's menus and settings on the
  first Rig & Skin entry and the UI wrappers at idle (the agent operators load with them). Auto-Rig shows none of them;
  the page fetches the `parts` chunk at boot and the rig and wrapper chunks later.
