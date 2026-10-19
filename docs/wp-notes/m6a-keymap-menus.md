# M6a B0b — keymap rows, scope chain, menus: build notes

Branch `m6a/keymap-menus` (from `m6a/spec` at `ec541b4`, with `m6a/contracts-foundation` merged at `4d70522`). Scope:
[M6A-SPEC §9 B0b](../M6A-SPEC.md#b0b--keymap-rows-scope-chain-menus) with the shared-file roles of §9.1. Decision
IDs below are `M6A-B0B-<n>`.

## What landed (by spec responsibility)

| B0b item | Where |
|---|---|
| Hierarchical scope chain (§5.17) | `editor-core/src/keymap/scopes.ts` (`keyScopeChain`, `MODEL_SCOPE`, `chordInput`, `resolveChord`); `editor/src/input/keyboard.ts` `scopeChain(app, hover)` reads the active workspace's `keyScope` and the component mode. The shell, the test API's `resolveKey` and the menu bar all use it. |
| Adapter order (§5.17) | `KeyboardAdapter`: (1) `capture` dep → `app.capture.key` while armed (keydown; its keyup is swallowed too); (2) `viewportTool` dep → the active viewport tool's `key()` for codes in `ToolDef.keys` (any phase) or the reserved modal keys (`RESERVED_MODAL_KEYS`: Backspace, Enter, NumpadEnter, PageUp, PageDown, Escape) while `placing`/`dragging`; (3) the keymap with tap/hold deferral. |
| Viewport tool-key bridge | `ToolKeyEvent` with `ctrl` (literal Control) and `repeat`, on keydown and keyup; the tool that got a keydown gets its keyup wherever the pointer is; a window blur sends `up` for every held tool key. `viewportToolTarget(app, activeTool)` + `ViewportManager.activeTool()`. |
| Tap/hold contract | `KeymapManager.isTapHoldKey(code, scopes, mods)`: `Space` as shipped (every scope, any modifiers); `KeyB` only unmodified with `model.viewport` in the chain. `X`/`V`/`J`/`D`/`I` are never deferred. |
| `KeymapManager.preset: string` | Already the B0a contract (`'maya'`); unchanged. |
| Every §7 row | `editor-core/src/keymap/maya.ts` (the M6a block); the Animate shadows through `model.animateOnly` in `model.viewport`; `select.mesh.grow`/`shrink` fire on auto-repeat (manager `REPEATABLE`, adapter `REPEATING_OPERATORS`). |
| Tool modifiers in the cheat sheet | `editor-core/src/keymap/toolModifiers.ts` (`TOOL_MODIFIERS`, `TOOL_HOLD_CODES`, `toolModifierKeys`); `ShortcutsDialog` gains a "Tool modifiers" section and Model scope headings. |
| Every §8.3 menu item | `editor-core/src/operators/builtin/menus.ts` (`MODEL_MENU_ITEMS` inside `BUILTIN_MENU_ITEMS`, every item `workspaces: ['model']`); Mesh › Mesh Check is the shell's item in `editor/src/shell/menuItems.ts`. |
| Menu-bar menu sets per workspace | `MODEL_MENUS` (data for B9's Model `WorkspaceDef.menus`); `editor/src/shell/menus.ts` `topMenus(items, workspace)` and `menuContents` (workspace and mode filtering). |
| Help-line resolution under the pointer | `keyboard.ts` `keyHints(app, scopes)` / `helpHints(app, hover)`: the meaning of the §8.2 chords where the pointer is, labelled through `KeymapManager.label` (`⌘E Extrude` / `Ctrl+E Extrude`); `null` in Animate. B9 renders it in `HelpLine.tsx`. |
| `preventDefault` for the QA-matrix chords | `isQaChord`: F10, Mod+B, Mod+D, Mod+G, Mod+Shift+E, Mod+K keep their browser default suppressed even where nothing is bound (and while a dialog is open), never inside text fields. |
| Conformance test of §7 | `editor-core/test/keymap.conformance.test.ts` (the table half) + `editor/test/input/conformance.test.tsx` (the DOM-adapter half, M6A-B0B-2). |
| E2E-MOD-03 | `apps/web/e2e/m6a-03-mod-e-scopes.spec.ts` (gates below). |

## Decisions and deviations

| ID | Decision | Why |
|---|---|---|
| M6A-B0B-1 | **The chain builder lives in editor-core** (`keyScopeChain`, pure); `scopeChain()` in `keyboard.ts` (the §5.17 place) wraps it with the session. | One implementation for the adapter, the test API, the menu bar's shortcut labels and the editor-core conformance tests (editor-core cannot import the editor). |
| M6A-B0B-2 | **Conformance split in two files**: the table checks in `editor-core/test/keymap.conformance.test.ts` (§7 names this file); the DOM-adapter cases (real `keydown`/`keyup` through the shell's window listeners) in `editor/test/input/conformance.test.tsx`. | The DOM adapter is in the editor package. |
| M6A-B0B-3 | **"F11 is never bound" means unmodified F11** (and with Shift/Alt); `Mod+F11` is the §7 Convert to Faces row (research 16 §19.2: Ctrl+F9/F10/F11 bound). F12 is checked with every modifier. | §7 binds `Mod+F11` and lists `F11` as never bound; both hold only with this reading. |
| M6A-B0B-4 | **E2E-MOD-03 gates**: part (a) needs the Model workspace, which only B9 registers (`ws=model` keeps Animate until then), so it is `test.fixme('b9: …')`. §10.1's Gates column says only "part (b): b3, b7, b10". **Contract PR requested** (INT): "part (a): b9; part (b): b3, b7, b10". Part (b) is `test.fixme('b3, b7, b10: …')`; part (c) runs now. | B0b's dependsOn is B0a only; B9 merges after B0b on the schedule (4.5–11 vs 4.5–7). |
| M6A-B0B-5 | **The help-line literal "Select faces or border edges"** exists nowhere yet: in object mode `meshOperator` (B7) answers "Extrude: enter a component mode first", the stub "not available yet". Part (a) asserts the help line shows `mesh.extrude`'s own poll reason (read through `run()`); the literal sits in part (b), so INT sees it when B3/B7/B10 land. **Owner of the wording: B7 (`mesh/operator.ts`) or B11 (registration)** — flagged for them. The assertion reads the DOM (`helpline-text`) because `helpLine()` is B11's test-API function. | §7/§10.1 name the text; no package's scope says who writes it. |
| M6A-B0B-6 | **The Export chords in E2E-MOD-03 load the Polybot sample first**: `ui.open {dialog: 'export'}` polls "Load a character to export" in an empty scene (shipped). The scenario checks key routing. When B8/B13 let Export open for meshes, part (a) can drop the sample. | Shipped poll. |
| M6A-B0B-7 | **`MenuItemDef.modes` hides** an item outside its modes. Used only where one menu entry has two operators: Edit › Delete (`scene.delete` in object mode, `mesh.delete` in component modes) and Select › All (`select.objects {all: 'meshes'}` / `select.mesh.all`). Every other Model item is always listed and shows its poll reason when it cannot run (Maya's static menus). | §8.3 lists one Delete and one All. |
| M6A-B0B-8 | **Animate-only shipped items**: Edit › Copy/Paste/Delete (pose clipboard) and Select › All/None/Mirror (controls) get `workspaces: ['animate']`, so Model's Edit and Select menus list Model items only. Animate lists exactly what it listed. | Model shadows the pose clipboard keys (§5.17); control selection is invisible there. |
| M6A-B0B-9 | **Menu items where §8.3 meets a gap**: Faceted ✓ is **not landed** (`mesh.setAttributes` is internal, hidden from menus; a non-internal toggle operator is B13's, through a contract PR to §8.3); Create › Reference Image › Front/Side/Top… run `imagePlane.import {camera}` without bytes (B13's operator opens its picker, or B13 points the items at its dialog); Edit Mesh › Assign Colour ▸ has one item, "Active Swatch" (`mesh.paint` without args; B13 adds per-swatch items); Mesh Display › Show › Normals is `view.display.set {patch: {normals: 'both'}}` plus "Hide Normals" (`'off'`), the other Show flags `view.display.toggle {flag}`; Select › Edge Loop/Edge Ring are `select.mesh.convert {to: 'edge', mode: 'loop' / 'ring'}` (menu runs carry no pointer component); Select › Object Mode is `select.mode {mode: 'object'}` (F8 toggles, so it shows no chord); Modify › Freeze Transformations passes `{translate, rotate, scale: true}`. | §8.3 lists items without operators or args. |
| M6A-B0B-10 | **Shortcut labels follow the chain where the menu opens**: `shortcutFor(keymap, op, args, scopes?)` prefers a binding that really runs the item there; File › Export shows `Mod+Shift+E` in Model and `Mod+E` in Animate. Without `scopes` (status-line tips) it behaves as shipped. | §7 changelog: "the Export key in Model". |
| M6A-B0B-11 | **QA chords suppressed in Animate too** when unbound there (e.g. `Mod+D` no longer opens the bookmark dialog over the viewport). Dispatch is unchanged: the DOM-adapter test asserts M2a's runs for `Mod+V`, `Mod+I`, `Mod+D`, `Alt+V`, `Alt+X`, `Alt+J`, Graph `B`/`I`. | §9 B0b "`preventDefault` for the QA-matrix chords". |
| M6A-B0B-12 | **`Mod+K` (command palette) reaches Animate** (§7 scope `G`); the M2a snapshot test lists it with the §3 rule 10 changes (`Mod+Shift+E`, `R`, `4`–`7`) as the only new Animate answers. | §7 row; §3 rule 10 does not list it, §7 does. |
| M6A-B0B-13 | **Animate unchanged, proven by a recorded table**: `editor-core/test/keymap-m2a-resolve.json` is the answer of the v0.2.0 `maya` table (`maya.ts` unchanged since v0.2.0) for every physical key × 11 modifier sets × every Animate chain × trigger, both platforms (731 answers). Never regenerate it from a changed keymap. | §9 B0b DoD. |
| M6A-B0B-14 | **The capture hook runs on keydown only** (`NumericCaptureApi.key` has no event type); a consumed keydown's keyup is swallowed so it cannot finish a tap. | §4.6 signature. |
| M6A-B0B-15 | **Observed, left as specified** (for B9/B10/owner): Shift+Arrow in component modes still runs the control pick-walk add (`select.pickWalk`, `viewport` scope; §7 shadows the plain arrows only); `S`/`Mod+C`/`Mod+V` over the Model Outliner keep their shipped Outliner meaning (§5.17 shadows them in `model.viewport` only); `K`/`R` in Model say "Unknown viewport tool …" until B9 adds the new tools to `view.tool`'s built-in set and their owners register them. | Spec text. |
| M6A-B0B-16 | **Size**: `RESERVED_MODAL_KEYS` sits in `scopes.ts` (eager, the adapter needs it) so `toolModifiers.ts` is imported only by the lazy Shortcuts dialog. | Eager-route budget. |

## Literal updates (§3 rule 9)

- `editor-core/test/builtin/registration.test.ts`: `MENUS` gains the Model menu ids (§3 rule 9 "the menu-bar menu list");
  a new check asserts every item of a Model-only menu carries `workspaces: ['model']`.
- `editor/test/m2a-a2-shortcuts.test.tsx`: the control pick-walk rows are picked by `'Pick Walk ('`, since the §7 arrows
  in `model.viewport.component` add `Pick Walk Components (…)` rows to the sheet (§3 rule 9 "the keymap table test").

## Minimal edits in files other packages own

Additive, each needed to wire a B0b responsibility: `editor/src/shell/createShell.ts` (B9: the adapter's `scopeChain`,
`capture` and `viewportTool` deps), `editor/src/shell/MenuBar.tsx` (B9: passes the active workspace to `topMenus`),
`editor/src/test-api/m6a/shell-workspaces.ts` (B9: `resolveKey` over the adapter's chain, as its B0a comment
asked), `viewport/src/manager/ViewportManager.ts` (B9: public `activeTool()` for the tool-key bridge),
`editor/src/dialogs/ShortcutsDialog.tsx` (no M6a owner: Model scope headings, the tool-modifier section),
`editor-core/src/index.ts` (barrel exports).

## Eager route

Production builds, `check:size` (gzip -9, first visit): base `381595c` (B0a merged) **864,427 B** → this branch
**869,233 B** (**+4,806 B**; gate 900,000 B green, no boundary violation). Attribution (`ANIMATOR_SOURCE_MAPS=1`,
`attribute-chunks.mjs`, base vs branch): editor-core `operators` +2.3 kB (the ~100 Model menu items), `keymap` +1.1 kB
(the §7 rows, scope chain, tap/hold), editor `input` +0.7 kB (adapter order, tool bridge, help hints), `shell` +0.3 kB
(menu sets). M6a so far is +23,966 B over the M2a baseline (845,267 B), above the +20,480 B allowance of §5.27:
**the pending owner decision of `m6a-contracts-foundation.md` ("Decision requested: the M6a eager allowance") covers
B0b too**. Registering the Model menu items on the first Model entry (option C there) would move ≈ 2.3 kB out of the
route.

## Hand-off

`editor-core/src/keymap/**`, `editor-core/src/operators/builtin/{menus.ts,keymapShadows.ts}`,
`editor/src/shell/{menuItems.ts,menus.ts}` and `editor/src/input/keyboard.ts` pass to **B9** after this merges. For
B9: register Model with `keyScope: 'model'` and `menus: MODEL_MENUS`; render `helpHints(app, hover)` in the help line
in Model; the adapter's `viewportTool` dep reads `ViewportManager.activeTool()`. For B11: the capture handler is
`app.capture.key`, called by the adapter while `app.capture.state.armed !== null`. For B10–B13: new rows and items go
through contract PRs to §7/§8.3 (tests: `keymap.m6a.test.ts` table, `keymap.menus.test.ts`).

## Gates (local, real Chrome; port 3161)

`format:check`, `lint`, `typecheck`, `check:deps`, `test:tooling` green; `pnpm run test` 15/15 tasks green (editor-core
53 files / 843 tests, editor 38 files / 397 passed + 1 skipped, headless-tests 173, the rest unchanged); `build` green,
`check:size` 869,233 B (gate 900,000 B, no boundary violation); `m6a-03-mod-e-scopes.spec.ts` part (c) green, parts
(a)/(b) `test.fixme` (M6A-B0B-4); the full e2e suite (`EKZA_E2E_PORT=3161 pnpm run test:e2e`, project `chrome`)
**110 passed, 12 skipped, 0 failed** (B0a: 109 passed, 10 skipped; +1 E2E-MOD-03 (c), +2 gated parts).
