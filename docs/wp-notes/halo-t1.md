# Halo T1 — input foundation: build notes

Branch `halo/t1-input` from `dev` @ `7af76d0d`. Scope: [STUDIO-TOUCH-SPEC §21 T1](../STUDIO-TOUCH-SPEC.md#21-build-plan)
and §20.3 items 1–4, 17, 20; the contract is §20.4 (rewritten here as built). Starting point: the T1a spike
([halo-t1a.md](halo-t1a.md), branch `halo/t1a-spike` @ `e2b31105`), of which T1 ports the arbiter, the manager hook,
`navigate`, the tool-event fields, the 23 arbiter tests and the touch e2e helpers; the spike's Halo stub, `/app` route,
models subpath and Pro switch items stay with T2, T5c and T3. Decisions: `ST-B1-T1` and `ST-T1-1` … `ST-T1-11` in
[DECISIONS-OPEN §P](../DECISIONS-OPEN.md#p-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24).

## Commits

| # | Commit | What |
|---|---|---|
| 1 | `370828d1` feat(editor-core): document the Rig & Skin holds … | §20.3 item 20: `TOOL_MODIFIERS` rows (joint D, X on joints and markers, skin B / M / N / I, Graph Shift, time-slider Shift and Mod); `HOLD_CODES`; a test that every hold code has a row |
| 2 | `08f242a0` feat(viewport): the pointer arbiter as the first stage … | the spike's arbiter, hook, `navigate` / `steer`, tool-event fields and 23 tests, verbatim (Pro regressions bisect to one diff) |
| 3 | `95511b6f` feat(viewport): arbiter host, navigate gestures, absorbed taps, chrome filter, tolerances by pointer | A12–A15 (below) |
| 4 | `516f2331` refactor(viewport,autorig): move touch navigation into the viewport … | §20.3 item 1; Auto-Rig's two-finger handler as a stage |
| 5 | `a3a60406` feat(viewport): virtual modifiers and the display overlay | §20.3 items 3 and 17 |
| 6 | `2c9dc862` feat(viewport,curve-editor): tolerances by pointer type … | §20.3 item 4; also the byte trims of 3–5 (A16) |
| 7 | `5766a0e6` fix(curve-editor): keep the per-pointer tables out of Studio Pro's eager Graph Editor | −484 B on `/editor` |
| 8 | `cdfe8021` test(e2e): shared CDP touch and Pencil helpers … | `e2e/helpers/touch.ts`, `ar-t1-touch` |
| 9 | `6b299bf0` docs(spec): STUDIO-TOUCH-SPEC §20.4 … | the contract as built |
| 10 | `cdb7e060` feat(viewport): quick pinch and contact-size palm rejection … | C5, D14 |
| 11 | docs(halo): T1 notes and decisions | this file, `ST-B1-T1`, `ST-T1-*` (after the gate; docs only) |

## What was built

**The arbiter stage** (`viewport/src/input/arbiter.ts`, lazy: only a shell imports it). The T1a state machine, with:
- **A12 — bound to the manager.** `setPointerArbiter(stage)` calls `stage(this)`; the stage builds its port from the
  manager's public queries (`paneRect`, `pick`, `paneState`, `navigate`, `endNavigate`) and one internal step,
  `pipe(paneId, e, step, coalesced?)` (`'down' | 'move' | 'up' | 'cancel' | 'capture'` or a navigation gesture). The
  spike's port object left the manager (−94 B on `/editor`). Unit tests drive the state machine through a recorded port
  (`pointerArbiter(config, port)`).
- **A13 — `navigate` is a gesture.** A shot camera's `navigate` moves stay one preview until `endNavigate()` (public;
  it is also the wheel burst's end), whatever the pauses; the wheel keeps its 120 ms idle commit. A pair calls
  `endNavigate` before `onTwoFingerTap` (an undo must not meet an open preview) and `cancel()` ends it (T1a risk 3).
- **A14 — the tool's double-click (C17, T1a risk 2).** A double-tap is any press within the second press's multi-tap
  window and radius of the previous tap, whatever pointer made the first; taps after a double-tap within the window are
  absorbed silently; a press the tool would pair with the last click it was handed is a double-tap too. The Model select
  runtime's double-click uses the same table (`POINTER_TOLERANCE`), so it never pairs what it is handed: a randomised
  test over 400 taps by finger, pen and mouse checks the invariant (a mutation that drops the absorption fails it).
  The mouse window is Pro's 500 ms (§5.4 says 400; `ST-T1-3`).
- **A15 — every event, first.** The stage reports each event's pointer type before anything else; the port switches
  `PICK` to that pointer's §5.4 tolerances (`input/tolerance.ts`, `setPointerTolerance`) and `cancel()` (Esc, blur,
  the stage replaced or removed) restores the mouse's. A press whose target is `[data-ekza-chrome]` inside the pane is
  taken and dropped (C6, T1a risk 5). A buffered press puts `user-select: none` and `-webkit-touch-callout: none` on its
  pane (T1a risks 7 and 8; `touch-action: none` was already on every pane).
- **Quick pinch (C5) and contact-size palms (D14)**, off unless configured: `quickPinch {ms, scale}` + `onQuickPinch`,
  `palmContactPx`.

**`ViewportManager`** (eager): the stage slot (`setPointerArbiter`), `pipe`, the handler split (`pointerDown` /
`pointerMove` / `pointerUp` → the stage, else `pressDown` / `pressMove` / `pressUp`, the old bodies minus two lines that
moved up), `busy()`, `navigate` / `endNavigate` over the shared `steer()`, the tool-event fields (`pressure`,
`pointerId`, `coalesced` on the arbiter's path; `virtual` while virtual modifiers are on), and:
- **`setModifierSource(source)`** (§20.3 item 3; **A16**): the source is `get()` + `attach(deliver)` — the manager
  hands it the active tool's key path and the source sends its held codes' downs and ups (`createModifierSource` keeps
  the diff, in the lazy `input/modifiers.ts`). Shift / Mod / Alt and the stand-in button merge into every tool pointer
  event (`virtual: true`); the rig runtime's `Held` reads `modifierSource` (its one hook). A virtual X is the Model
  transform runtime's grid-snap hold (tested on the real runtime).
- **`setDisplayOverlay(paneId, overlay)`** (§20.3 item 17): the pane keeps its own display (`base`: pane memory, pane
  state, Pro's display port); what it draws and picks is `base` under the overlay, also for panes registered later and
  across workspace switches; `xrayOpacity` is in force while that pane draws (theme `XRAY_OPACITY` is now the value in
  force, which SceneSync reads).

**Touch navigation in the viewport** (§20.3 item 1, T1a risk 4): `viewport/src/navigation/touch/` holds Auto-Rig's
Simple navigation (`simpleGesture`, `toolClaims`, `addNavigationClaim`, `installSimpleNavigation`; `BRUSH_TOOLS` gains
Paint Colour, `MESH_TOOLS` adds the Quick Rig markers) and the two-finger handler rebuilt as a stage
(`createTwoFingerStage`, a 0.9 kB lazy chunk): one finger stays the pipeline's; a second finger in the same pane ends
the first one's orbit or cancels its tool drag, and the pair pans and dollies through `navigate` / `endNavigate`. No
document listeners, no synthetic PointerEvents, no `paneAt`. It sits in the arbiter's slot, so the two never run
together. `autorig/src/nav/{index,touch}.ts` re-export; the shell controller imports from the viewport.

**Tolerances by pointer type** (§20.3 item 4, ST-8): `POINTER_TOLERANCE` (touch 22 px pick / 10 px slop / 450 ms /
24 px, pen 9 / 4 / 350 / 8, mouse Pro's); `PICK` follows the stage; the Model select runtime's double-click and its
component pick radius (`PickOptions.radiusPx`); `markerPickPx()` for the Quick Rig markers; `handleGrowPx()` for the
extrude cap's handles; the Dope Sheet's glyph, region and slop (`setDopeSheetPointer`, called by its lazy controller);
the Graph Editor's hit radii (`setGraphPointer`, for T10's adapter — the Graph controller is eager on `/editor`,
`ST-T1-4`). Not built: the manipulator's touch scale (`ST-T1-5`).

## Measurements (check:size, production build, gzip -9)

`dev` @ `7af76d0d`: `/editor` **891,790 B**, `/autorig` **652,528 B** (measured here). T1's share: **≤ 768 B** on each.

| Step | `/editor` | Δ dev | `/autorig` | Δ dev |
|---|---|---|---|---|
| 2: the spike's hook, verbatim | 892,267 | +477 | 653,006 | +478 |
| 3: the stage bound through `pipe()`, navigate gestures | 892,173 | +383 | 652,904 | +376 |
| 4: touch navigation moved (first with a coarse-pointer gate) | 892,173 | +383 | 652,948 | +420 |
| 5: virtual modifiers, display overlay (first cut) | 892,626 | **+836** | 653,458 | **+930** |
| 5, trimmed: `attach`, `endNavigate` = the burst end, `modifierSource`, the old gate | 892,514 | +724 | 653,279 | +751 |
| 6: per-pointer tables in the curve editors' controllers | 892,996 | **+1,206** | 653,279 | +751 |
| 7: the Graph Editor's table moved out of its eager controller | **892,512** | **+722** | **653,279** | **+751** |
| gate, `cdb7e060` (head of the code) | **892,512** | **+722** | **653,279** | **+751** |

What the numbers say:
1. **Anything a stage can carry, it should** (T1a finding 1 again): the port object, the held-key diff and the
   tolerance switch each cost every route when the manager held them.
2. **The Graph Editor is eager on `/editor`**: one per-pointer table plus two calls in its controller cost +482 B.
   Studio Pro's curve editors keep their constants; the Dope Sheet (lazy) switches its own.
3. **Gzip is not additive**: removing code moved `/editor` by +16 B once (step 5 trimmed vs a first trim) while
   `/autorig` fell by 58 B. Margins below ~20 B are noise (AR-D4-S).

## Tests

- **Unit** (Vitest browser mode): `viewport/test/arbiter.test.ts` **36** (the spike's 23, adapted to the port, plus the
  C17 rules and their randomised invariant, the pointer hook, the pair's order and cancel, quick pinch, contact-size
  palms, and in a real manager: chrome inside a pane, PICK following the pointer and restored on removal, the press
  policy, a shot camera's `navigate` committing once); `touch-navigation.test.ts` 6 (the two-finger stage in a real
  manager: one finger orbits, pinch and pan, a cancelled tool drag, a shot camera committing once, one slot with the
  arbiter; the claim sets); `modifiers.test.ts` 5 (pointer events, the stand-in button, holds as downs and ups and
  their release, a replaced source, the real transform runtime's grid snap); `display-overlay.test.ts` 4;
  `tolerance.test.ts` 4; `curve-editor/test/pointer-tolerance.test.ts` 3; `editor-core/test/keymap.tool-modifiers.test.ts`
  2. Whole packages: viewport 34 files, 336 passed + 1 skipped; curve-editor 22 files, 212 + 3 skipped; autorig 14
  files, 112; editor 63 files, 615 + 1 skipped.
- **e2e, Chrome**: `ar-t1-touch` (new: one finger orbits, pinch and pan, a two-finger tap changes nothing, the Pencil is
  a left press), `ar-12-layouts` (the touch cases run the moved stage) and `ar-as-12-devices`: **8/8**.
- **WebKit** (Playwright's WebKit as an iPad Pro 11, installed build `webkit-2370` through `EKZA_WEBKIT`, a scratch
  config like T1a's, not committed — T0's `webkit-ipad` project replaces it on `halo/int`): `/autorig` boots, a tapped
  sample loads, ② renders, a touchscreen tap reaches the pane; `/editor` boots and renders; `ar-00` 3/3; `ar-02` 7/8 (the
  failing one tabs to the chooser's links, which WebKit leaves out of the Tab order by default; `ST-T1-11`).

## Gate

`EKZA_E2E_PORT=3167 pnpm run ci` at `cdb7e060` (local Chrome, 7 workers): **green** (exit 0) — format, lint,
typecheck, check:deps, check:fixtures, check:licenses, the unit tests (22 turbo tasks), the production build,
check:size (`/editor` **892,512 B**, `/autorig` **653,279 B**, both OK; AR-B1's eager delta −3,176 B, enforced; the
Model workspace chunk's 250,203 B warning is `dev`'s) and **e2e: 390 tests, 366 passed, 24 skipped, 0 failed, 0 flaky**
(2.9 min). The 24 skips are `dev`'s (`stretch`, `m6a-stretch` `test.fixme`s and the conditional skip in
`m6b-skin-03`); `ar-t1-touch` ran in it.

Four earlier runs stopped at the unit tests while the machine's load average was 55–95 (other agents' builds):
`ekza-studio-mcp`'s socket and file tests timed out twice (they pass alone in 7 s), and viewport's
`m6a-transform/runtime.test.ts` "Esc (cancel) during a drag" failed twice — the load flake M6b's notes record (the
scale chunk's dynamic import fails, so the drag never arms); it passes alone and in four full viewport runs. The green
run replayed turbo's cached viewport, editor and curve-editor results from an identical-input run that had passed.

## T1a's risks

| # | Risk | Status |
|---|---|---|
| 1 | State machines out of the manager | Kept out: A1 + A12 (`pipe`), the held-key diff in the source (A16), the tolerance table and switch in `input/tolerance.ts` |
| 2 | The tool's double-click outlives the arbiter's | A14 + the per-pointer table in the select runtime; randomised invariant test |
| 3 | Shot cameras commit through the wheel burst | A13: `navigate` / `endNavigate` |
| 4 | Auto-Rig's `touch.ts` alongside an arbiter | Rebuilt as a stage in the same slot; deleted the document listeners and synthetic events |
| 5 | Chrome inside a pane | `[data-ekza-chrome]` taken and dropped |
| 6 | The models subpath's fixed cost | T5c's (not T1) |
| 7 | Coalesced Pencil samples on real devices | Unchanged: unit-tested replay; the device gate (D5) proves it |
| 8 | iOS long-press against `pointercancel` | The press policy (no selection, no callout) on the pane; check on the device first |
| 9 | Land the stage in its own commit | Commit 2 is the spike's hook alone |

## Patches needed from other WPs

- **T2** (`editor-core/src/types.ts`): the additive lines this branch carries — `ToolPointerEvent.pressure`,
  `pointerId`, `coalesced`, `virtual`; `ToolKeyEvent.virtual`.
- **T0 / integration** (`viewport/src/index.ts`): T1's exports sit beside T0's `applyTextureCap` line (trivial merge);
  `playwright.config.ts`: add `ar-*` to `chrome-touch` (they use `helpers/touch.ts`) and, if wanted, to `webkit-ipad`
  minus the keyboard case of `ar-02`.
- **T6a**: Halo's arbiter config (`buffered`, the §5.4 numbers from `POINTER_TOLERANCE`, `multiTapMs.mouse: 500`,
  `quickPinch`, `palmContactPx`), its claims over `BRUSH_TOOLS` / `MESH_TOOLS`, chrome marked `data-ekza-chrome` when it
  floats inside a pane, `gesturechange` ignored while `stage.touches() ≥ 2` (C15), the Thumb key's
  `createModifierSource` (re-set a latched hold after a tool switch), the manipulator scale (`ST-T1-5`, needs bytes).
- **T6a / T9**: the overlay's x-ray opacity in `manager/shading.ts` (`XRAY_ALPHA` → theme `XRAY_OPACITY`, cache key with
  the opacity) and in mesh-view's x-ray (`MeshPaneDisplay` gains the opacity) — one line each.
- **T10**: the Graph adapter calls `setGraphPointer(e.pointerType)` before forwarding events.

## Reproduce

```sh
# sizes
pnpm --filter web clean:next && pnpm run build && pnpm --filter web check:size
# unit
pnpm --filter @ekza-studio/viewport exec vitest run test/arbiter.test.ts test/touch-navigation.test.ts \
  test/modifiers.test.ts test/display-overlay.test.ts test/tolerance.test.ts
pnpm --filter @ekza-studio/curve-editor exec vitest run test/pointer-tolerance.test.ts
# e2e on Chrome with touch
EKZA_E2E_PORT=3167 pnpm --filter web exec playwright test e2e/ar-t1-touch.spec.ts e2e/ar-12-layouts.spec.ts \
  e2e/ar-as-12-devices.spec.ts
# WebKit: T0's `webkit-ipad` project on halo/int, or T1a's scratch config with EKZA_WEBKIT pointing at
# ~/Library/Caches/ms-playwright/webkit-2370/pw_run.sh
```
