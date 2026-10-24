# Halo T6-INT — the two phase-S packages as one shell (`halo/t6-int`)

[STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §4–§8, §16.4, §20.1–§20.6, §21 (the T6a and T6b rows, phase S);
[ADR 0023](../adr/0023-studio-touch-ui.md). Branch `halo/t6-int` from local `dev` `25c0eb43` (T6a and T6b merged),
with `dev` `f49d05e6` (the m6a-19 capture fix) merged in. It joins T6a's input grammar shell
([halo-t6a.md](halo-t6a.md)) and T6b's manifest, verbs, Path and sheets ([halo-t6b.md](halo-t6b.md)) into one touch
shell at `/app`, applies the patches both notes asked for (P-T6A-1…8, P-T6B-1…6) and removes T6b's harness.
Decisions: [DECISIONS-OPEN §P](../DECISIONS-OPEN.md#p-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24) rows
`ST-T6INT-1` … `ST-T6INT-15`.

## What changed

| Part | Where | What |
|---|---|---|
| Verbs | `halo/verbSource.ts` | The `VerbSource` seam now runs on T6b's `resolveNoun`, verb table and derived More (P-T6A-1). Its `more` is async, so the manifest stays in the More chunk. It adapts T6b's data to the grammar: crumbs, icons (T6b's lucide names to the Halo's own line icons), `{op}` / `{stage}` / `{sheet}` actions, and the in-place variants (⟳ Again, Paste, Unpin, Make editable). The stand-in table and the stand-in More sheet are gone. Noun kinds are T6b's everywhere (`empty`, `mesh`, `faces`, …), including the test API |
| Focused nouns | `halo/{grammar,Breadcrumb}.ts(x)`, `shell/store.ts` | The breadcrumb's character crumb opens the **character's** Halo (§6.2 "the breadcrumb root"); a long-press on the manipulator opens the **manipulator's** (§6.2). The focus ends with the Halo or a new selection |
| The Path, status corner, Next chip | `shell/{PathParts.tsx,readiness.ts}`, `path/Path.tsx` | T6b's `Path` replaces `PathTabs` in the top bar (Wide), the second row (Regular) and the bottom tab bar (Compact). The status corner sits above the View puck, and the Next chip above the tray (hidden while a Halo, card, form or sheet is open). All three read **one** readiness list per change: it is marked stale on document, mesh-runtime, active-character, workspace, rig-chunk or destination changes |
| Sheets | `shell/Sheets.tsx`, `manifest/sheets.ts`, `sheets/more/{kit,MoreSheet}.tsx` | T6b's eight sheets load through `SHEET_LOADERS`; other packages register theirs with `registerHaloSheet(id, body)`, which now takes `HaloSheetProps`. The frame's `HaloSheetContext` adds `compact` (full-height sheets on phones), `hideUi`, `startTarget` (More's *Parent to…* waits for its target, §6.4) and `renderSlot`. `prefetchSheets()` runs at idle and on `online`. More also lists the noun's petals that go somewhere (Checks, About this character): a Compact verb bar that folds them keeps them one tap away. *Make default* runs `prefs.set` |
| Settings › Input | `input/InputSettings.tsx` | Halo's own `halo.input` rows (§4.5, §5.1, §18) at `data-slot="halo.input"`: Pencil and fingers, Halo opens on, Reduce gestures, quick pinch, Thumb key, hand you draw with. They write this device's localStorage record (`controller.setInput`) and never Pro's prefs. A lazy chunk |
| Project menu | `shell/ProjectMenu.tsx` | *View* and *Health* join the menu as the visible twins (§18) of the puck's long-press and of the Path's ⚠ / status pill (those show only when there is something to fix). The menu scrolls on short screens |
| Parity | `shell/controller.ts`, `manifest/{disclosure,paramSurfaces,types}.ts` | `installParityProbe(app)` on `/app` in e2e builds (a lazy chunk). `halo()` carries the `t6b` slice (readiness, Next chip, sheet section) and `grammar.focus`. `halo.proOnlyKey` has its plumbing entry. `PARAM_SURFACES` follows the chips and forms, and a test now checks both lists against a registry with every chunk loaded. `TARGET_OPS` is in one place |
| Reach | `sheets/scene/model.ts`, `manifest/types.ts` | The canvas cannot select an image plane (no selection operator keeps its id, P-T6B-7), so the plane noun's petals and More are T8's (pending). A reference's Scene row gains **Delete** and **Replace image…** (a file pick, then `imagePlane.replace`), so both operators stay reachable |
| Vocabulary | `test/rules.test.ts`, `manifest/labels.ts` | The lint covers the catalogue, `manifest/labels.ts`, the manifest's per-argument `plain` words and the verb table. Two labels renamed: *Clear selection* and *Clear points, edges and faces* (*Unselect* is the Thumb key's word) |
| Preference rule | `test/rules.test.ts` | Exact, not file-blind: `prefs.setState` is banned everywhere; the operator id `'prefs.set'` is a write only outside a table key, and only Settings' rows and More's *Make default* may run it. Positive and negative cases |
| e2e | `apps/web/e2e/{ha-parity,ha-05,ha-15,ha-02,ha-03,ha-04,ha-13}.spec.ts`, `helpers/{halo,touch}.ts` | `ha-parity`, `ha-05` and `ha-15` start at `/app`. `ha-15` opens all eight sheets from the real shell (`openSheetFromShell`: the tray's ⋯, the breadcrumb's Numbers, the project menu, the character's Halo in Rig) at three sizes on `chrome`, `chrome-touch` and `webkit-ipad`. `ha-05` picks destinations in Health's *For:* chips. The ratchet also fails when `reachable` drops. `/dev-halo` and `@ekza-studio/halo/dev` are removed (nothing else used them) |
| Host | `editor/src/host/operators.ts`, `shell/{operators,createShell}.ts` | `view.toggleMaximize` is the host's on every route. The pane form is shell-neutral; the panel form asks the mounted shell's maximize port, which only Studio Pro provides (P-T6B-3). `prefs.set` admits `rigging`: Pro's status-line joint-size buttons no longer poll-fail. Regression tests: `editor/test/{commands,m6b-rig-shell,ar-host-shells}` |
| Kit | `ui/src/touch/{sheet,segmented}.tsx` | The Sheet's scrolling body has `tabIndex={0}` (axe `scrollable-region-focusable`), so `HaloSheet` drops its workaround. `Segmented` items get test ids `<group>-<value>` (P-T6B-4) |
| Kernel | `editor-core/src/prefs/overrides.ts`, `operators/builtin/key.ts` | Under Halo's Rec override, Studio Pro's Auto Key stays writable (P-T6B-6, below) |
| Forms | `editor-core/src/forms/problems.ts` | `formProblems` has moved to its own module. It is not re-exported from the index, because a re-export kept the bytes; param-lint and the test load it by path (P-T6A-6, below) |
| Touch helper | `apps/web/e2e/helpers/touch.ts` | Its doc now says CDP's `touchEnd` lifts the points it lists. It also takes explicit finger ids, which `ha-03` uses (P-T6A-8) |

## The kernel note (P-T6B-6): fixed

**What was wrong.** While a shell override held `autoKey` (Halo's Rec), Pro's stored Auto Key could not always be
changed, for two reasons:
- The override layer treated any write of the *shown* value as carried back, so the base kept its own value.
  `prefs.set {autoKey: true}` therefore never stored `true` under Rec.
- `key.toggleAutoKey` flipped the *shown* value. Under Rec it wrote `false` whatever was stored, so when the stored
  value was already `false` it did nothing.

**The fix.**
- **The override layer.** A top-level scalar named in a plain partial write (`setState({autoKey: true})`, which is
  what `prefs.set` does) is always meant: it lands in the base. Functional writes, replace writes and nested spread
  writes (`{modeling: {...modeling, gridStep}}`) still carry every field, so they keep the carried-back rule, and its
  tests are unchanged. Nothing in the codebase writes a whole prefs object as a plain partial (checked), so no write
  starts landing values it did not mean.
- **The toggle.** It flips the stored value (`basePrefs`). Without an override this is the same value as before.
- **Settings.** *Auto Key in Studio Pro* now writes under Rec, with a note in place of the disabled reason.

**Tests.** `editor-core/test/kernel/prefs-overrides.test.ts` (fails without the fix) and `halo/test/sheets/settings.test.ts`.

## Parity after integration (`ha-parity` at `/app`, chrome)

| | T6b (harness) | T6-INT (`/app`) |
|---|---|---|
| Live operators (every mount, every chunk; 48 deferred stubs excluded) | 351 | **352** (+ `halo.proOnlyKey`, plumbing) |
| By kind | surfaces 326 · proOnly 8 · plumbing 7 · wraps 6 · searchOnly 4 | surfaces 326 · proOnly 8 · **plumbing 8** · wraps 6 · searchOnly 4 |
| Pairs checked (scan 362, menus 253, marking menus 164, key bindings 233) | 1,012 (2 dynamic) | 1,012 (2 dynamic) |
| Violations | 0 | **0** |
| Reachable without search | 241 (T6a's surfaces assumed) | **241**, now true in the integrated shell (see below) |
| `searchOnly` (explicit 4, pending) | 114 (110 pending) | **114** (110 pending): make 1 · paint 12 · rig 18 · animate 52 · all stages 31 |
| Per-package targets | T7 71 · T8 98 · T9 93 · T10 91 · T11 100 · GA 4 | unchanged |

**What "actually reach" took.** I checked every surface the manifest gives T6a against the integrated frame:
- **The noun Halos.**
  - The character's Halo was unreachable: nothing resolved a `character` noun. It now opens from the breadcrumb.
  - The manipulator's Halo was unreachable too. It now opens on a long-press of the manipulator.
  - The image plane's Halo cannot be reached, because no selection holds a plane. Its noun is now T8's. That would
    have moved `imagePlane.delete` and `imagePlane.replace` to *pending* (searchOnly 116, reachable 239), so the
    plane's Scene row carries both instead, as real surfaces.
- **Petals that go somewhere.** These had no More row, so a Compact verb bar that folded them made them
  unreachable. More now lists them.
- **More's *Parent to…*.** Its poll asked for a selected target, so it was always greyed. It now waits for the
  target.

The regenerated baseline differs from T6b's only in `live`. The ratchet keeps its rules (no new item, never above
the total or any stage), and it also fails now when `reachable` falls below the baseline.

## Exit test

| Check | Result |
|---|---|
| `/app` shows the frame with the Path on `chrome-touch` and `webkit-ipad`; More, Numbers, Scene, View, Settings, Health, Help and About open from the real shell | `ha-15` (landscape 1194×834, portrait 834×1194, phone 390×844) on `chrome`, `chrome-touch`, `webkit-ipad`: every sheet a named dialog with 44 px targets and 16 px inputs, on screen, no sideways overflow; `ha-05` (the Path, readiness, Health's destinations, the budget ring) on all three |
| ha-02 / 03 / 04 / 05 / 12 / 13 / 15 / parity on `/app` | GATE_HA |
| Visible targets (`halo().visibleTargets`, iPad landscape 1194×834, chrome-touch) | at rest **18** (Animate, Polybot: Path, top bar, tray, ↶, Thumb key, puck, Next chip) ≤ 22; with a Halo **27** (a control) and **31** (a face in Make) ≤ 36; Make after Pull with its chips, the reduced Halo and the session bar **35** ≤ 36; phone at rest 13 |
| Screenshots | `t6int-ipad-landscape-{rest,halo,more,numbers,settings-input,make-pull}.png`, `t6int-phone-{rest,halo,more,numbers}.png` (production e2e build, Chrome with touch @2x; in the session's scratchpad `halo/`, not committed) |

## Sizes (production build, `check:size`, gzip -9; SIZE-1: one gate of 5,000,000 B per route, targets report-only)

| Route | `dev` `f49d05e6` (measured the same way) | T6-INT | Δ |
|---|---|---|---|
| `/editor` | 896,865 B | **896,828 B** | −37 B |
| `/autorig` | 657,694 B | **657,808 B** | +114 B |
| `/app` | 685,639 B | **695,520 B** | +9,881 B (report-only; target 660,000 B) |

Where the deltas come from:
- **`/editor`.** −380 B from `formProblems`, against the host's eager `view.toggleMaximize` and port and the
  override layer's line.
- **`/autorig`.** The host now registers `view.toggleMaximize` there (≈ +430 B), less `formProblems` (−323 B).
- **`/app`** (attributed through source maps):
  - the shell 9.3 kB and the Halo layer 9.1 kB (T6a);
  - the verb table and noun resolver 3.9 kB;
  - the Path, readiness, the status corner and the Next chip 3.4 kB (T6b's probe estimated +5.3 kB with the touch
    kit's parts);
  - the manifest's small tables 1.4 kB (types, sheet sections, loaders).

A static `moreFor` import had put the whole manifest in `/app`'s initial scripts (+10.8 kB). `VerbSource.more` is
now async, and a rule test (`test/rules.test.ts`, *lazy on /app*) keeps the manifest, the parity check, More, the
sheets, the input chunk and search out of the static import graph.

The lazy boundaries hold:
- No Halo module is in `/editor`'s or `/autorig`'s scripts (`ekza-halo-shell` boundary).
- Neither dockview nor the curve editor is in `/app`'s initial scripts.

The manifest, the probe, every sheet, the Input rows, the forms and the numpad are lazy on `/app`. The Path,
readiness, the status corner and the Next chip are eager, as §20.6 asks.

**The `formProblems` split (P-T6A-6).** As T6a proposed it (a separate module re-exported from the forms index) it
saved **0 B**: Turbopack keeps a re-exported module's exports in the shared module. With no re-export it saves
**/editor −380 B, /autorig −323 B, /app −374 B**, measured on otherwise identical production builds.

## Gate

GATE_RECORD

## Deviations and lines outside the row

- **Files of T6b's that the integration changed:**
  - `verbs/{nouns,derive}.ts`: a control id without its record is still a control, and `TARGET_OPS` rows wait for
    their target.
  - `path/Path.tsx`: a `bar` mode.
  - `manifest/{sheets,types,disclosure,labels,paramSurfaces}.ts`: the context fields, `TARGET_OPS`, the plane noun's
    owner, two entries, two labels and the chips/forms lists.
  - `sheets/{more,settings,scene,help}/**`.
  - `editor-core/src/prefs/descriptors.ts`: rigging reasons now that `prefs.set` admits `rigging`.
- **Files of T6a's:** every file the patches named, plus the vocabulary lint and the preference rule in
  `test/rules.test.ts`.
- **Studio Pro:**
  - `view.toggleMaximize` moved to the host. Its behaviour is unchanged: the panel form goes through the port.
  - `ar-host-shells.test.tsx` now expects the operator after Pro unmounts.
- **The status-line joint size** keeps writing `prefs.set {rigging}`. Admitting `rigging` fixes it with no
  change to Pro's UI code.
- **The image plane noun** is T8's until a plane can be selected (P-T6B-7 stands for kernel / T8).

## For T7–T12

- **T7.**
  - Add `T7` to `BUILT_OWNERS` and register the Library sheet (`registerHaloSheet('library', …)`, `HaloSheetProps`).
  - Apply Rec (`store.rec`) as the `shell` override. Pro's Auto Key now stays writable under it.
  - Lower the baseline to its target (71).
  - The animate tray replaces `shell/Tray.tsx`.
- **T8.**
  - Planes: a selection that keeps their id makes the plane noun real again.
  - Palette sheet, the make/paint trays, Make editable's report sheet. Target 98.
- **T9.**
  - Rig trays and the rig card, dots and brush sessions (`registerSession`), the checks / bones / weights sheets.
    Target 93.
  - Weld to… and Bridge are tool sessions, not target mode (`TARGET_OPS` is *Parent to…* only).
- **T10.**
  - Curves, History (↶'s long-press), Ask. Target 91.
- **T11.**
  - The real Home replaces the stub (its *Rig a model for me* and *Try a sample* are already there but stay counted
    under T11).
  - The Share sheet, `provideRecoveryHook(app, {firstRun: false, offer})`. Target 100.
- **T12.**
  - Flip `HALO_ENTRY` (three copies, P-T6A-5) and the Pro title.
  - Write §20.2's file list as built (P-T6A-7), adding `shell/{PathParts,readiness}`, `input/InputSettings` and
    `forms/problems.ts`.
  - Enforce `routes.app` in `size-baseline.json`.
  - Add `axe-core` as a devDependency when the registry is reachable (`ha-15`'s axe test skips without it).
  - The `.oxlintrc` allow-list for `@ekza-studio/halo/dev` (P-T6B-1) is moot: the subpath is gone.
