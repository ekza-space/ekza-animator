# Halo T6b — manifest, parity and sheets (`halo/t6b-parity`)

[STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §0–§8, §15, §20.4–§20.5, §21 (T6b row), §22 (AS-ST-2, AS-ST-14, AS-ST-17,
AS-ST-18, AS-ST-20); [ADR 0023](../adr/0023-studio-touch-ui.md); [DECISIONS-OPEN §P](../DECISIONS-OPEN.md) ST-15,
ST-18, ST-29, ST-32, ST-36, ST-38 and the rows `ST-T6B-*`. Branch off `dev` `b58356a5` (the foundation T0–T5c), with
`dev` merged again at `054b8789` (SIZE-1) and `ce66bd1e` (C2, the character package). The owner's requirement this
package guards: *keep ALL the functionality*. Every capability of Studio Pro stays reachable in the Simple layout, and
a browser test proves it.

## What landed

| Part | Where |
|---|---|
| The Disclosure Manifest: one entry (or per-argument entries) for every live operator of every mount | `halo/src/manifest/disclosure.ts` |
| Its types: surfaces (petal, More row, tray, sheet section, frame part), owners, `proOnly`, `plumbing`, `searchOnly`, `wraps`, argument predicates | `halo/src/manifest/types.ts` |
| The reasoned Pro hand-offs (PRO_CHROME) and the plumbing allow-list | `halo/src/manifest/{proOnly,plumbing}.ts` |
| Every `UiDialog` → a Halo surface (inline confirm cards, sheets, pickers, Home, Pro chrome, deferred) | `halo/src/manifest/dialogs.ts` |
| Plain verb labels (ST-18): the manifest's words, Pro names one layer down | `halo/src/manifest/labels.ts` |
| Parameter surfaces for `param-lint` (chips / forms / Options): turns T5a's surface checks on | `halo/src/manifest/paramSurfaces.ts` |
| The live census of an app (operators, deferred stubs marked, menu, marking-menu and key-binding pairs) and the join of several mounts | `halo/src/manifest/census.ts` |
| The parity check (§20.5 tests 1–8, 10) and the `searchOnly` ratchet with per-package targets | `halo/src/manifest/check.ts`, `searchOnly.baseline.json` |
| The parity probe (e2e builds: `window.__EKZA_HALO_PARITY__`) | `halo/src/manifest/probe.ts` |
| The sheet contract (`HaloSheetContext`, sections) and the lazy loaders | `halo/src/manifest/{sheets,sheetLoaders}.ts` |
| The verb table (≤ 6 petals per noun and stage, ▾ choices, in-place variants) | `halo/src/verbs/table.ts` |
| Nouns from the selection; ⋯ More and search derived from the manifest | `halo/src/verbs/{nouns,derive}.ts` |
| The Path, readiness (one list), destinations, the status corner and the Next chip | `halo/src/path/**` |
| Sheets: More (with Options and pre-run forms), Numbers, Scene, View, Settings, Health, Help, About this character | `halo/src/sheets/{more,numbers,scene,view,settings,health,help,about}/**` |
| The prefs descriptor table (label, section, unit, range, options, writer for every `Prefs` leaf) | `editor-core/src/prefs/descriptors.ts` (+ one export statement in `editor-core/src/index.ts`) |
| The static call-site scan | `tooling/halo-callsites.mjs` (+ test and fixtures) |
| FEATURES.md row ids in §15 (`F<section>:<Feature name>`) | `docs/STUDIO-TOUCH-SPEC.md` §15, `halo/test/features-map.test.ts` |
| e2e: browser parity, the Path and readiness, accessibility and layout | `apps/web/e2e/{ha-parity,ha-05-path-readiness,ha-15-a11y-layout}.spec.ts` |
| A dev harness for the T6b parts until T6a's frame hosts them | `halo/src/manifest/dev/**` (`@ekza-studio/halo/dev`), `apps/web/app/(studio)/dev-halo/**` |
| The PR checkbox *"Ekza Studio path (manifest entry) added or not needed"* | `.github/PULL_REQUEST_TEMPLATE.md` |

## Parity: how it works and the numbers

**The census is taken in a browser across every mount** (§20.5). `ha-parity` opens the harness, which installs the
probe; loads Polybot; then on one page, with one EditorApp, it switches to Halo, Studio Pro and Auto-Rig. On Halo and
Pro it enters Model, Rig & Skin and Animate. On Pro it also shows every panel. Every lazy operator chunk is loaded
(rig workspace, clip library, Model operators, UI wrappers and the agent operators they bring). The censuses are
joined: an operator seen in any mount counts, and a stub replaced by its real definition later is live.

**The check runs in the page** against four inputs:
- the manifest;
- `tooling/halo-callsites.mjs`, a TypeScript-AST scan of `editor/src/{panels,overlays,shell,dialogs}` and
  `autorig/src`;
- the joined menu, marking-menu and key-binding pairs;
- the `UiDialog` map.

**Coverage.** Every live, non-stub operator, internal ones included, has an entry. Every entry names a live operator.
Every (operator, arguments) pair is covered. The literal arguments read from source and menus are matched against the
per-argument predicates; a `'*'` (a value the scan cannot read) matches dynamically and is counted. Every `UiDialog`
that `ui.open` is asked for has a surface. Petals resolve in the verb table, sheet sections exist, tray operators list
the stage's workspace, and tool operators have a hands-on binding. `proOnly` is limited to the PRO_CHROME list and
plumbing to the allow-list.

| At this branch (dev `ce66bd1e` merged) | |
|---|---|
| Live operators (every mount, every chunk) | 347 before C2 · 351 with C2 (48 deferred stubs excluded) |
| Pairs checked | 1,003 before C2 (scan 353, menus 253, marking menus 164, key bindings 233); 1 dynamic |
| Violations | **0** |
| By kind | surfaces 322 · proOnly 8 · plumbing 7 · wraps 6 · searchOnly (explicit) 4 |
| Reachable without search, T6a + T6b built | 231 |
| Reachable with only T6b's own surfaces | 66 |
| Reachable once T7–T11 land (every planned surface) | 328 (the other 19: 8 proOnly, 7 plumbing, 4 explicit searchOnly) |

**The `searchOnly` ratchet (§20.5 test 5).** It counts two kinds of entry:
- explicit `searchOnly` entries: the developer items `file.saveJson` and `ui.commandPalette`, and the agents'
  explicit-target writers `key.write` and `key.delete`;
- surface entries whose surfaces are all *pending*, that is, owned by a package that has not landed.

`searchOnly.baseline.json` records the baseline. `ha-parity` fails on a new item, and fails when the total or any
stage exceeds it. A count below the baseline is annotated with "lower the baseline". `EKZA_HALO_PARITY_WRITE=1`
rewrites the file after a deliberate change.

| `searchOnly` | Total | Explicit | Pending | Make | Paint | Rig | Animate | All stages |
|---|---|---|---|---|---|---|---|---|
| Baseline (T6a + T6b built) | 111 | 4 | 107 | 1 | 12 | 18 | 51 | 29 |

**Per-package targets.** Each target is the count once that package's surfaces land (on top of T6a + T6b):

| T7 | T8 | T9 | T10 | T11 | All landed (GA) |
|---|---|---|---|---|---|
| 70 | 95 | 90 | 88 | 99 | **4** (the explicit items only) |

When a package lands, it adds itself to `BUILT_OWNERS` (`manifest/types.ts`), adds its sheet loaders and sections, and
lowers the baseline.

## Sheets

All eight are lazy chunks behind `SHEET_LOADERS`. They are docked, non-modal Radix dialogs from the touch kit: right
edge on wide containers, bottom otherwise. They run operators only through `ctx.run`. The logic is in pure models with
Node tests; the views are thin.

| Sheet | Sections | Runs |
|---|---|---|
| More | (per noun: On the Halo, then the manifest's groups) | the row's operator; ⚙ Options (option box at touch density, Run, *Make default* — the only write to the option defaults); pre-run forms (`@ekza-studio/editor-core/forms`, ✓ Run); the poll reason inline and its one-tap fix; *Open this in the Pro layout ▸* |
| Numbers | transform, pivot, shapeInputs, mesh, character, channels, joint, camera, imagePlane, animation | `channel.setValues` (Pro's numbers and signs, degrees shown and radians stored), `channel.toggleLock`, `select.channels` + `key.set`, `scene.object.transform`, `mesh.pivot.*`, `mesh.primitive.set`, `scene.rename`, `mesh.setAttributes`, `imagePlane.set`, `view.camera.setSettings`, `skel.joint.rename` / `setRest`, `clip.rename` / `setSettings` |
| Scene | objects, characters, references, cameras, reparent, visibility | `select.objects` / `controls` / `joints`, `scene.rename` / `parent` / `unparent` (row menu, *Parent to…*, and a pointer-event lift-and-drop recognizer, no HTML5 drag-and-drop), `view.hide` / `showAll`, `imagePlane.set`, `view.lookThrough`, `view.toggleCameraLock`, `autorig.parts` |
| View | look, show, panes, cameras, selection, manipulator, hideUi, fullScreen | `view.shading`, `view.display.toggle` / `set`, `rig.toggleSecondary`, `rig.jointSize.set`, `autorig.controls`, `view.layout`, `view.toggleMaximize {paneId}`, `view.lookThrough`, `view.copyViewToShot`, `view.toggleCameraLock`, `view.camera.setSettings`, `view.selectionMask`, `view.manipulatorSize`, `view.setManipSpace`, `view.toggleFullscreen`, `ctx.hideUi` — the only Halo controls that write the pane display memory (§16.4) |
| Settings | startIn, input, keyboard, display, animation, import, advanced (transform, modeling, rigging, export, undo, autosave) | generated from the descriptor table: `prefs.set`, `rig.jointSize.set`, `skin.paint.set`, `view.setNavProfile`; *Auto Key in Studio Pro* (`key.toggleAutoKey`); the shared §16.4 keys labelled; Start in is an explanation row with a link to the chooser (ST-T6B-12); a `data-slot="halo.input"` block for T6a's routing table |
| Health | legend, problems, checks | readiness rows by stage with Fix (the row's operator), Show me, Go fix ▸, Why?; the destination chips (`ctx.setDestination`, `rig.validation.profile`); *Check the model* (`autorig.inspect`) and Auto-Rig's fixes before rigging (`autorig.fix`); poll-gated fixes (`skel.quickRig.center` / `faceForward`, `skel.template.addMissing`, `skel.pose.applyAsRest`, `skin.weights.normalize`, `skin.palette.compact`, `mesh.cleanup`) |
| Help | gestures, glyphs, shortcuts, about, licences | the §5.2 gestures with their twins, the Thumb key and routing modes; the glyph legend; the shortcut sheet from the keymap (plain label, Pro label, keys); About (version, beta note) and the licences |
| About this character | identity, licence, usage, flags, thumbnail | every `CharacterVrmMeta` field through `char.setVrmMeta` (licence presets with none pre-selected); `char.renderThumbnail`; a character from a file is shown read-only |

Screenshots of every sheet in the harness at iPad landscape size were taken for the review (not committed).

## Decisions (`ST-T6B-*`, copied into DECISIONS-OPEN §P)

| ID | Decision | Why |
|---|---|---|
| ST-T6B-1 | **Surfaces have owners; an entry whose surfaces are all owned by packages that have not landed is *pending* and counts in the `searchOnly` ratchet.** The manifest records each operator's intended surfaces once; `BUILT_OWNERS` (T6a + T6b at phase S) decides which exist. Explicit `{searchOnly}` is kept for items with no planned surface. The per-package exit targets follow from the data. | §21 "each stage WP has an exit target on the searchOnly count": a stage package flips one owner and lowers the baseline, and nobody re-curates the manifest |
| ST-T6B-2 | **The browser census goes through a probe the Halo shell installs in e2e builds** (`window.__EKZA_HALO_PARITY__`: `loadAll`, `census`, `join`, `check`). It stays when Halo unmounts, so one page takes the census of Halo, Pro and Auto-Rig on the same EditorApp. The check runs in the page against the bundled manifest. | The test API has no operator list (it is T2's file), and a headless run misses about 70 ids |
| ST-T6B-3 | **A deferred stub is an internal operator whose poll answers "Arrives after the MVP" (or "not available yet") for any arguments.** It is excluded from parity, and an entry for one is a violation. | 48 stubs today; a conditional `fail(NOT_AVAILABLE_YET)` in a live operator (pivot, IK) is not a stub |
| ST-T6B-4 | **Argument predicates** are literal lists per key, with dotted keys for nested objects (`patch.jointAxes`); a missing key reads as null. Several entries per operator need pairwise-disjoint predicates, and at most one entry may leave `when` out (the rest). A `'*'` from the scan or a spread matches *dynamically* and is counted. | Literal JSON keeps the manifest data-only; dynamic matches are honest about what a static scan can know |
| ST-T6B-5 | **Key bindings and marking-menu items are checked like menu items** (1,003 pairs), beyond the spec's menus and call sites. | They are argument shapes Pro sends too (Alt+1–4 presets, the selection-mode marking menu) |
| ST-T6B-6 | **The plumbing allow-list has the spec's five rows plus three**, each with a reason: `shell.halo` (Pro's own switch into this layout), `shell.autoRig` (Pro's switch to Auto-Rig; Halo uses `shell.navigate`), `view.cameraRadial` (Pro's Space-hold radial, replaced by the puck). The agent bookkeeping operator `agent.show` has a real surface (History › Show). | §20.5 test 1 |
| ST-T6B-7 | **PRO_CHROME** = `workspace.preset.*`, `workspace.reset`, `workspace.toggleChrome` / `toggleFocus` / `toggleTimeline`, the panel arguments of `view.toggleMaximize`, `ui.open {layoutPresets}`, and the `workspace.showPanel` panels without a Halo sheet. Every other `workspace.showPanel` panel maps to its Halo surface (meshCheck / validation → Health, outliner → Scene, channels / attributes → Numbers, clipLibrary → Library, graph → Curves, dopeSheet → Keys, …). | §15.15 a, §20.5 test 6 |
| ST-T6B-8 | **The agents' explicit-target writers `key.write` and `key.delete` are `searchOnly`.** `key.adjust`, `key.retime`, `pose.setAt`, `pose.goals`, `pose.transfer` and `clip.makeLoop` are `wraps` of T5a's public wrappers. | Halo keys through Key ◆ (`key.set`), channel rows and the Thread; the wrappers carry the rest |
| ST-T6B-9 | **The call-site scan parses TypeScript** (`typescript`'s AST, no type checker). It recognises wrapper calls (`runOperator`, `runFromUi`, `run`, `runUntyped`, …, with each wrapper's argument positions), `op:` objects, JSX `op=`, menu-row tuples, template ids (`mesh.create.*`), same-file constants and `PANEL.x`. It lists the 74 sites it cannot resolve (40 forwarded parameters) for review rather than failing on them. | Regex scans miss the factory forms (`op(id, label, args)`) and `PANEL.x` |
| ST-T6B-10 | **A dev harness hosts T6b's parts until T6a's frame does**: `/dev-halo` (a `.dev.tsx` route in the `(studio)` group, so a same-page switch keeps the host) and the package subpath `@ekza-studio/halo/dev`. `ha-parity`, `ha-05` and `ha-15` start there; at integration they start at `/app` (one constant each) and the subpath and route go. | T6b mounts into T6a's frame only at integration; the specs had to run now |
| ST-T6B-11 | **Readiness** is pure over the app. It returns one list for the destination: Mesh Check (errors only for *Just exploring*), the triangle budget (Prop for OMOBA: the hand-held 600; a mesh's own budget wins when larger), a missing skeleton for destinations that need one, the Validation rows under the destination's profile (with `select.joints` Show me on skeleton rows), and the clip slots the profile requires. A stage whose chunk is not loaded shows `·` and never loads it. Auto-Rig's model checks (stand up, size, …) are asynchronous (`autorig.inspect`), so Health offers them after *Check the model* and keeps them out of the count. | §7.2, ST-36 |
| ST-T6B-12 | **Settings › Start in is an explanation row with a link to `/?chooser=1`**, not a control. | Until `HALO_ENTRY` is on, a stored `'halo'` reads as Ask, and a third copy of the entry key would sit outside `entry-contract.test.ts`; T12 exports one reader/writer through `@ekza-studio/editor/host` |
| ST-T6B-13 | **Numbers' channel labels are Move / Turn / Scale X / Y / Z**, with Pro's Translate / Rotate / Scale in grey. Bend / Twist / Side per body part are T7's (ST-35, `i18n/channels.ts`). | §1.3 vocabulary; one table per owner |
| ST-T6B-14 | **axe runs from a local copy** (`EKZA_AXE_PATH`, or a resolvable `axe-core`), as in T4. `ha-15` skips its axe test with an annotation when neither is present. | The offline store has no axe-core (checked again), so no dependency was added (T4's ST-T4-13 proposal stands for T12) |
| ST-T6B-15 | **More shows a petal's ▾ choices as rows, one row per literal argument value, and the stage's rows only.** Search lists every operator with an entry in every stage (`searchEntries`), each with its stages and a Pro-layout mark for hand-offs. Transport rows (play, frames, keys, loop, speed) are on the empty space's More in Animate until the Thread lands. | §6.3, §8, §20.5 test 10 |
| ST-T6B-16 | **FEATURES.md row ids are `F<section>:<Feature name>`** in a new §15 column. Duplicated names in a section take their `### N.M` number. A test checks every id names exactly one row. | FEATURES.md has no ids, and its owner (T12) refreshes it |

## Gate and sizes

_(see the end of this note; filled in after the final gate)_

## Patches for other packages

| # | Owner | Patch | Why |
|---|---|---|---|
| P-T6B-1 | T2 / integration | `packages/halo/package.json` gains `"./dev": "./src/manifest/dev/index.ts"` (applied here); `.oxlintrc.json`'s `apps/web/app/**` allow-list could admit `@ekza-studio/halo/dev` (an inline disable is used in `HarnessEntry.tsx`). Both go at T12 with the harness | The harness route imports the dev subpath |
| P-T6B-2 | T6a | The shell, in e2e builds, calls `installParityProbe(app)` from `manifest/probe.ts`. It hosts the sheets through `SHEET_LOADERS` with a `HaloSheetContext`, puts the `Path`, `StatusCorner` and `NextChipView` into the frame, and calls `prefetchSheets()` at idle and on `online`. It feeds the `t6b` slice of `halo()` as the harness does, mounts the `halo.input` rows into Settings' `data-slot="halo.input"`, passes `ctx.hideUi`, and gives every Halo-registered operator (e.g. `halo.proOnlyKey`) a manifest entry. `ha-parity`, `ha-05` and `ha-15` then start at `/app`. The vocabulary lint over `i18n/en.ts` should cover `manifest/labels.ts` too | Integration of T6b into the frame |
| P-T6B-3 | T3 / host | `view.toggleMaximize` (pane form) is registered only by Pro's shell: re-home it to the host so Halo's ⤢ and View › Maximize pane run on `/app`. The host's `prefs.set` `PREF_KEYS` lacks `rigging`: Pro's status-line joint-size buttons (`shell/rig/status.tsx`) poll-fail; use `rig.jointSize.set` there or admit `rigging` | Found while wiring View and Settings |
| P-T6B-4 | T4 | `Sheet`'s scrolling body should carry `tabIndex={0}` (axe `scrollable-region-focusable` in a sheet without controls); `HaloSheet` sets it for now. `Segmented` could take a per-item `data-testid` | Found by `ha-15` |
| P-T6B-5 | T7–T11 | When your surfaces land: add yourself to `BUILT_OWNERS`, add your sheet loaders and sections (`SHEET_SECTIONS`), and regenerate `searchOnly.baseline.json` (it must reach your target). T11: the OMOBA destination's profile against C2's `ekza/omoba-humanoid-v2` for a character bound to a game target | §21 per-stage targets |
| P-T6B-6 | kernel (T0) / T7 | The override layer and Auto Key: while Halo's Rec override holds `autoKey`, `key.toggleAutoKey` and `prefs.set` cannot change Pro's stored value (Settings greys the row). `key.toggleAutoKey` flips the shown, not the stored, value | Found by the Settings sheet |
| P-T6B-7 | kernel / T8 | Image planes have no selection operator: `select.objects` drops their ids, and Pro keeps the plane selection in a module slot of its Outliner. Halo reaches a plane's verbs from its Scene row; an operator or a session field would let the canvas and `resolveNoun` see it. `partsHidden` / `controlsHeld` (Auto-Rig's flow) are not exported, so View and Scene show those as action pairs | Found by the Scene and View sheets |
| P-T6B-8 | T12 | `ST-T6B-*` rows into DECISIONS-OPEN §P (added here as rows), the `@ekza-studio/editor/host` export of the entry choice reader / writer (ST-T6B-12), `axe-core` as a web devDependency when the registry is reachable | Housekeeping |

## Evidence

- `packages/halo`: 12 test files, 101 tests (manifest lints on a headless registry, More and search, nouns, readiness,
  the Path, Numbers, Scene, View, Settings, Help, Health, About, the FEATURES map). `editor-core`
  `test/prefs/descriptors.test.ts` 23. `tooling/test/halo-callsites.test.mjs` 4, `param-lint` with surfaces on:
  `param-lint: OK — 20 forms, 10 UI wrappers, 356 operators (48 with an option box); surfaces: 119`.
- `ha-parity` (chrome), `ha-05` and `ha-15` (chrome, chrome-touch, webkit-ipad, axe from a local axe-core 4.12.1):
  25 passed, 2 skipped (parity on the touch projects by design).
