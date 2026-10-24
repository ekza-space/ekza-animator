# Halo T7 — the Animate stage (`halo/t7-animate`)

Work package T7 of [STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §21 (v0.2, [ADR 0023](../adr/0023-studio-touch-ui.md)):
§7.1 (Animate), §9 J3 and J5, §10 (posing, Rec, the Thread, Keys, the Library), §20.3 items 8 and 18, §22 (ha-06,
the journeys, AS-ST-4, AS-ST-5). Branch off local `dev` `25c0eb43` (T0–T5c, T6a, T6b); `dev` merged again at
`f49d05e6` (m6a-19 B11) and `790e753b` (the DEV contour marks), and `origin/dev` `582aa335` (T6-INT: one touch shell at `/app`) merged before the final gate. Decisions:
[DECISIONS-OPEN §P](../DECISIONS-OPEN.md#p-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24), rows
`ST-T7-1` … `ST-T7-20` and `ST-T7-UNIT` (owner, 2026-10-24: time in frames by default).

## What landed

| Part | Files | What |
|---|---|---|
| The stage | `halo/src/stages/animate/{start,rec,model,reach,ui,slice,sheetContext}.ts`, `AnimateDock.tsx`, `AnimationsRow.tsx`, `DockedHalo.tsx`, `ClipSettings.tsx`, `TimeChip.tsx`, `icons.tsx` | Animate's tray (P-T6A-4: it replaces `shell/Tray.tsx` in Animate): the docked Halo of a Thread noun (its ⋯ More opens the frame's More over that noun, `sheetNoun`), the Animations row (up to three chips or two and `+n`, one tap each; `+ New` with 30 · 60 · 100 f and *Other…*; Blend; `Library ▸`), an animation's Settings in its Halo (fps, start / end / length, loop, travel, contact, tags: `clip.setSettings`), the Thread, the unfolded layer; the Path's Next chip gives way while the row shows two or more chips. ● Rec as the `shell` override of Auto Key; the fitting manipulator of a selected control; Reach; the touch count of canvas drags; the empty state (*Nothing to animate yet → Rig it for me · Try a library animation on a sample*); the test API's `animate` slice |
| The Thread, layer 0 | `halo/src/thread/strip/{model.ts,ThreadStrip.tsx,Thread.tsx}` | Halo's own Canvas2D strip over editor-core's queries: ▶ (hold: repeat · once · ping-pong · backwards), the time readout in frames (tap: the transport — start, previous key, −1 / +1 frame, next key, end, the four speeds, the range), the ruler (whole-frame labels with a zoom-chosen step, beat ticks every 0.25 s on whole frames, the selection's key dots, a faint summary without a selection, hollow in-betweens, the band, the playhead; pinch zoom, double-tap for the whole animation), ● Rec, `[Timeline │ Keys │ Curves]` |
| Settings › Time | `halo/src/thread/{units.ts,TimeSettings.tsx}` | ST-T7-UNIT: *Frames · Seconds*, frames by default, a per-device Halo preference (`ekza-studio:halo:time:v1`; a stored choice is kept); the Settings sheet's Animation section shows it through the `halo.time` slot (a lazy chunk) |
| The band | `halo/src/thread/band/source.ts`, `curve-editor/src/timeline/contributions.ts` (the seam) | `provideBandSource(app, source)`: the focused band source of `time.selectBand` and `timeline.context.*` (§20.3 item 18); the Thread provides it from a lazy chunk when it mounts |
| Keys, layer 1 | `halo/src/thread/keys/KeysLayer.tsx`, `curve-editor/src/adapters/dopesheet.ts` | Studio Pro's `DopeSheetController` behind the new touch adapter `attachDopeSheetTouch` (§20.3 item 8): rows at 36 pt (the controller's 20 px rows shown 1.8×), *Select · Move · Stretch*, *Push later keys*, *Select area*, the rows (selected or the whole character), ‹ › one-frame nudges, the docked key Halo above the rows; a lazy chunk |
| The Library | `halo/src/sheets/library/{LibrarySheet.tsx,model.ts,index.ts}` | The starter pack's cards with search and kinds; tap = preview on the character; expand = ⟨Speed⟩, Trim start / end, *Swap sides*, *Stay in place*, *Arms out*, previewed live; *Add* (`library.useClip`, Pro's call); *Add starter set* (`autorig.clip.add` ×3 with slots); *+ From file* (`file.importAnimation`) |
| Words | `halo/src/i18n/{animate,channels}.ts` | The stage's words and the plain channel labels (Bend · Twist · Side = Rotate X · Y · Z, Move / Scale X · Y · Z), Pro's values (P14) |
| Manifest | `halo/src/manifest/{types,sheets,sheetLoaders}.ts`, `searchOnly.baseline.json` | `BUILT_OWNERS` + T7; the Library's sections and its lazy loader (`STAGE_SHEET_LOADERS`, prefetched with T6b's; the frame renders it through `registerHaloSheet('library', …)`); the baseline lowered to 71 |
| Tests | `halo/test/animate-{words,model,rec,journeys}.test.ts`; `curve-editor/test/{dopesheet/touch-adapter,timeline/band-source}.test.ts`; `apps/web/e2e/{ha-06-thread-keys,ha-J3-wave,ha-J5-library}.spec.ts`, `e2e/helpers/halo-animate.ts`; one test added to `ha-12-round-trip.spec.ts` | below |

### The touches, as counted

The test API's counter (`halo().touches`) counts one per tap on the chrome, one per filled text field (on its tap),
one per drag that edits (a tool's drag on the manipulator or a selected thing, a Reach drag, a ruler scrub or band, a
chip scrub), and the grammar's own taps, long-presses and petals. Orbit, pan and zoom are not counted (§9).

| Journey | Target (AS-ST-4) | Measured | Steps |
|---|---|---|---|
| J3 Pose and key a two-second wave | ≤ 15 | **15** | + New · name "Wave" · 60 f (3); tap R Upper Arm · drag its ring (2); frame 15 · forearm · drag; 30 · drag; 45 · drag (7); Wave chip · Loop it · ▶ (3) |
| J5 Mix animations from the library | ≤ 6 | **6** | Library · tap Walk (it previews) · expand · ⟨Speed⟩ scrub · Stay in place · Add |
| J5 with the left/right pair | (9) | **9** | + the new chip · Duplicate ▾ · + swap sides |

## Exit test (§21 T7)

| Check | Result |
|---|---|
| J3 ≤ 15, J5 ≤ 6 from fresh projects with the real defaults | **15 and 6** (9 with the pair): `ha-J3`, `ha-J5` on `chrome-touch` — Seed-san from `file.loadSample`, Rec on by default, nothing curated |
| Reach is one undo step | `ha-06` › Reach: the L Leg IK goal dragged by its shape moves (`controlWorld`), the history gains exactly one step `Reach (L Leg)`, one undo restores it |
| The Rec override is removed on unmount (ha-12) | `ha-12` › *Rec is a shell override of Auto Key*: `state().autoKey` true in Halo with an animation active, false in Pro after the switch (Pro's own Auto Key), true again back in Halo; the stored preference unchanged (all three projects). Unit: `animate-rec.test.ts` |
| ha-06, ha-J3, ha-J5 green on `chrome-touch`, booting on `webkit-ipad` | Green on `chrome-touch`: `ha-06` (at rest ≤ 22 with one animation and the Next chip; with three and with four animations ≤ 22 and the Next chip hidden; Rec and the layers; key dots; the band; the playhead's Halo; Reach; Keys; the Animations row with Settings ≤ 36; frames by default, Settings › Time, *Other…*; ruler pinch), `ha-J3`, `ha-J5`; `webkit-ipad` boots the Thread and taps it (`ha-06` › webkit). In the final gate: 470 passed, 0 failed |
| Exports byte-equal to Pro's for J3 and J5 (§22, AS-ST-5) | `animate-journeys.test.ts` (headless, production kernel, Seed-san): J3's sequence as Halo's code builds it (Rec's override, the 60 f preset through `newLengths` and `newAnimationCall`, the poses at frames 0 / 15 / 30 / 45, `loopItCall`) exports the same VRMA bytes as Pro's (Auto Key on in mode *all*, `clip.new {character}` + rename, the same poses, `clip.makeLoop`); J5's (`library.useClip {params}`, `swapSidesCalls`) the same two VRMAs as Auto-Rig ④'s `autorig.clip.add {params}` and Pro's Duplicate Clip + Mirror Animation over the selected controls |
| Parity ratchet: `searchOnly` to T7's target | **71** (target 71): explicit 4, pending 67 (Animate 14, from 52); **281** operators reachable without search (from 241) of 352 live; regenerated by `ha-parity` on `/app` after the T6-INT merge (`EKZA_HALO_PARITY_WRITE=1`). With T7 built the remaining packages' targets read T8 55 · T9 50 · T10 54 · T11 58 (each counted from 71) |

## Measurements

Production build of the final gate (`check:size`, gzip -9, first visit):

| Route | Bytes | Gate (SIZE-1) | Target (report-only) |
|---|---|---|---|
| `/editor` | 897,211 B | 5,000,000 B — OK | 850,000 B (+47,211) |
| `/autorig` | 657,809 B | 5,000,000 B — OK | 620,000 B (+37,809) |
| `/app` | 715,694 B | 5,000,000 B — OK | 660,000 B (+55,694) |

The curve editor stays a lazy chunk group on `/app` (15.3 kB, "curve editor (Graph Editor, Dope Sheet)"); ha-12's
first test checks that an empty `/app` never loads it. The Thread's band source, the Keys layer, the Library, Settings ›
Time and the numpad are lazy chunks too.

## Gate

`EKZA_E2E_PORT=3187 pnpm run ci` on the branch head: format, lint, typecheck, deps, fixtures, licences, unit tests
(Halo 178), the production build, `check:size` and e2e — **green, 470 passed, 99 skipped, 0 failed**. Before it, the
load-flaky `ha-03` › *Make: clearing the selection* failed once in a parallel `ha-*` run and passed alone.

## Lines outside the row, and the shell hooks

The row is `halo/src/stages/animate/**`, `thread/{strip,band,keys}/**`, `sheets/library/**`,
`curve-editor/src/adapters/dopesheet.ts`, the band-source seam in `curve-editor/src/timeline/contributions.ts`, and
ha-06 / ha-J3 / ha-J5. Outside it, each the smallest seam-shaped change:

| File (owner) | Lines | Why |
|---|---|---|
| `halo/src/shell/controller.ts` (T6a, T6-INT) | 2 imports; `disposers.push(startAnimate(controller))` in `start()`; `animate: animateSlice(controller)` in the test API's slices | P-T6A-4: Rec as the shell override, the stage's lifecycle, the test API slice |
| `halo/src/shell/Frame.tsx` (T6a, T6-INT) | 1 import; `const animate = useAnimateDock(controller, size, height)`; `insetBottom` + `animate.lift`; `{animate.dock ?? <Tray …/>}`; `{animate.hideNext ? null : <FrameNext …/>}` | P-T6A-4: the stage tray replaces `Tray.tsx` in Animate; the floating grammar and the corners rise with the dock (its measured height); ST-T7-18 |
| `halo/src/shell/Sheets.tsx` (T6-INT) | 1 lazy import; `renderSlot` fills `halo.time` with `TimeSettings` | ST-T7-UNIT, the way `halo.input` is filled |
| `halo/src/sheets/settings/{model.ts,SettingsSheet.tsx}` (T6b) | the slot type takes `'halo.time'`; the Animation section returns `{slot: 'halo.time'}`; the slot's test id and its input-only fallback text | ST-T7-UNIT: Settings › Time sits in Settings › Animation |
| `halo/src/manifest/{types,sheets,sheetLoaders}.ts`, `searchOnly.baseline.json` (T6b) | `BUILT_OWNERS` + T7; `SHEET_SECTIONS.library`; `STAGE_SHEET_LOADERS` + `prefetchSheets` | P-T6B-5 |
| `curve-editor/src/index.ts` | export lines of the adapter and the seam | the package's barrel |
| `apps/web/e2e/ha-04-chips-forms-session.spec.ts` (T6a) | `trayVerb` reaches *+ New animation* through empty space's ring | Animate's tray is the Thread now (the + New card is T7's; the form is still the ring's) |
| `apps/web/e2e/helpers/halo.ts` (T6-INT) | `openSheetFromShell('more')` opens empty space's ring (a right-click) where the stage has no verb tray | ha-15 opens More in Animate |
| `apps/web/e2e/ha-12-round-trip.spec.ts` (T2) | one test appended (the file says "T7 and T12 extend this file") | the exit test |
| `halo/test/animate-journeys.test.ts` | a Node test in the Halo package (not `headless-tests`) | it builds the calls with Halo's own modules; the package already reads the fixtures (`test/support.ts`) |

## Patches for other packages

| # | File (owner) | Patch | Why |
|---|---|---|---|
| P-T7-1 | `editor-core/src/operators/builtin/uiWrapperChunk.ts` (T5a) | Export `solveReach` from the wrappers' lazy chunk (e.g. `loadReachSolver(app): Promise<typeof solveReach>`), so Reach previews the solved limb as session overrides while dragging (§10.1) | It is in the chunk but not reachable from Halo; Reach shows a target ring until then (ST-T7-4) |
| P-T7-2 | `halo/src/manifest/sheets.ts` + `shell/Sheets.tsx` (shell) | `HaloSheetContext.touch?(): void`, wired by the frame to the journeys' counter; then `stages/animate/start.ts`'s `libraryHost` can register `LibrarySheet` as it is | The Library counts J5's touches through it (`CountingSheetContext`) |
| P-T7-3 | `halo/test/rules.test.ts` (T6-INT) | Run the vocabulary lint over `animateWords` too (allowed *animation* paths: `dock.*`, `clip.*`, `library.*`, `thread.clearRange`, `thread.noClip`), or fold the words into `en.ts` | One catalogue rule; `animate-words.test.ts` holds it until then |
| P-T7-4 | `halo/src/thread/curves/**`, `stages/animate/AnimateDock.tsx` (T10) | Replace `CurvesStandIn` (layer 2) with the Curves layer; dock the key Halo in its header with `DockedHalo`; reuse `attachDopeSheetTouch`'s pattern for the graph adapter and the Keys layer's scale; label the time axis with `useTimeUnit` / `timeText` / `frameStep` (frames by default, ST-T7-UNIT) | §10.5 |
| P-T7-5 | `editor/src/panels/timeline/host.ts` (Pro, optional) | Provide Pro's slider through `provideBandSource` instead of `registerTimelineContributions`, so both shells share one registration | Today each registers when the other has not (tested in `band-source.test.ts`) |
| P-T7-6 | `docs/STUDIO-TOUCH-SPEC.md` §20.2 (T12) | The files as built: `stages/animate/{start,rec,model,reach,ui,slice,sheetContext}.ts`, `thread/strip/model.ts`, `thread/band/source.ts`, `i18n/animate.ts`; §10.4: rows at 36 pt by showing the controller's rows 1.8× | the spec follows the code |
| P-T7-7 | `halo/src/halo/grammar.ts` (T6a, optional) | A tap on a manipulator handle over another body part selects that part (T7 does it for Animate in `reach.ts`; Make's handles are T8's) | §6.1 "tap = select" |
| P-T7-8 | `halo/src/chips/EchoChips.tsx` (T6a) + `editor-core` ParamDefs | A time parameter (frames) shows `f`, and seconds under Settings › Time *Seconds* (`timeUnitOf(controller)`, `thread/units.ts`); it needs a ParamDef kind for time | Echo chips show Pro's plain frame counts today, which is right for the default |

## Follow-ups

- Echo channel chips ⟨Bend⟩ ⟨Twist⟩ ⟨Side⟩ beside a selected control: the labels and values are here
  (`i18n/channels.ts`, `channelChips`); the floating chip layer is the grammar's (T6a's `EchoChips` shows after-run
  chips only).
- Reach for the head and the hips needs a spine solve in `pose.goals` (P-T5A-5).
- Pencil hover on the ruler (a preview of the frame) and the Pencil band on the Keys layer need a device (D5).
