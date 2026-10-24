# M2a A2 — IK editor integration, pick-walk, virtual slider, body-part keying: build notes

Branch `m2a/ik-editor` (from `dev` with `m2a/contracts-foundation` merged). Scope:
[M2A-SPEC §8 A2](../M2A-SPEC.md#a2--ik-editor-integration-pick-walk-virtual-slider-body-parts). The spec names this
file `m2a-a2.md` (§3 rule 6); the work package's task asked for `m2a-ik-editor.md`, so the notes live here. Decision
IDs below are `M2A-A2-<n>` for DECISIONS-OPEN §F.

## Status

Built, review fix rounds 1 and 2 applied. Every A2 operator, panel and viewport feature is implemented and tested
on this branch. A1 (`m2a/rig-ik`) has not merged, so on this branch the IK unit tests are skipped (`READY.a1`) and
E2E-M2A-01…07, 25 and the body-part case of E2E-M2A-18 are `test.fixme('A1')` (§3 rule 4). They were run against A1
in a scratch merge with `m2a/rig-ik` at `9767a7a` (fix round 2; round 1 used `9955177`): all of them pass there, see
[Against A1](#against-a1-scratch-merge).

Fix round 2: a switch to the mode the limb is already in is refused (M2A-A2-23; before, the pressed IK/FK segment in
Attributes and the always-enabled Rig › IK/FK items re-matched the visible side to the hidden one and moved the
pose), and a seamless switch on a loop clip no longer flips back after f (M2A-A2-24, found while fixing the first:
§5.23's cyclic infinities on the switch's new two-key curves); pole lines loop by index in the per-pose paths;
E2E-M2A-03's ball-roll case no longer locks in open issue 1; notes, merge notes and open issues updated. "Rebases on A4's viewport render-skip change": A4's branch has
not changed `viewport/src/manager` yet, so there was nothing to rebase on.

## What landed (by spec responsibility)

| A2 item | Where |
|---|---|
| `controlVisibility` rules 2–5 (§5.5) | `editor-core/src/workflows/visibility.ts` (`controlVisibility`, a per-call `controlVisibilityResolver`, `limbHiddenControls`), used by the viewport (`viewport/src/sync/SceneSync.ts`), the Outliner (`panels/outliner/limbHidden.ts`), `select.pickWalk` and the test API's `controls()[].visible` |
| Viewport: ghosts, pole lines, footprint and diamond shapes, picking | `viewport/src/controls/ControlLayer.ts` (third line batch for ghosts at 25 % alpha, never pickable or marquee-selected; dashed pole lines mid bone → pole in both passes, `POLE_LINE` = `--rig-pole-line`), `viewport/src/theme.ts`; `diamond` and the `custom` footprint come from the anim-core shape registry and the control's own spline set |
| Attribute channels in the edit kernel (§5.1) | `edit/channelMeta.ts` (`attrDefOf`, `attrChannelsOf`, `isKeyAllChannel`, keyable by `AttrDef.keyable`, never locked, `newKeyTangents`: stepped attributes get in `flat`, out `step`), `edit/channels.ts`, `evaluation/service.ts` (`channelState` for attributes) |
| `key.set` (keyAll rule, body part, breakdown), `key.setTarget`, `key.deleteAtFrame` | `operators/builtin/key.ts` |
| `pose.resetToRest`, pose clipboard, `pose.mirror`, `pose.plantFeet` with attributes and IK legs | `operators/builtin/pose.ts`, `workflows/pose.ts` |
| IK operators (§4.9): `rig.addLimbIk`, `rig.ikFk.switch`, `rig.ikFk.match`, `rig.ikFk.matchRange`, `rig.setFootParams`; warnings | `operators/builtin/ik.ts`, `workflows/ik.ts` |
| Import: `prefs.autoRigIk`, `ik: 'auto'`, limb warnings | `workflows/importModel.ts`, `workflows/importAnimation.ts`, `importLimbWarnings` in `workflows/ik.ts` |
| "FK limbs only" toast (§5.7) | `watchFkOnlyRigs` (`workflows/ik.ts`), mounted by the viewport panel |
| `select.pickWalk` and the `prefs.arrowKeys` dispatch (§5.17) | `operators/builtin/select.ts`; the shortcut sheet labels the arrows with the active behaviour (`pickWalkDispatch`, `editor/src/dialogs/ShortcutsDialog.tsx`) |
| Virtual slider (§5.18) | kernel `edit/virtualSlider.ts`; DOM side `viewport/src/tools/virtualSliderDrag.ts` (Pointer Lock or capture, `movementX`, `pointerlockchange` cancels, a refused lock falls back to capture); Channels panel rows (MMB on any row, LMB drag ≥ 3 px on a name); viewport plain MMB (`ViewportManager`) |
| Channels panel attribute rows, IK/FK proxy row and switch | `panels/channels/ChannelsPanel.tsx`, `readout.ts`, `nudge.ts`, `kit/kernel.ts` |
| Attributes Limb section with the foot fields, Add Limb IK | `panels/attributes/LimbSection.tsx`, `layout.tsx`, `AttributesPanel.tsx` |
| E2E-M2A-01…07, 18, 19, 25 | `apps/web/e2e/m2a-*.spec.ts`, helpers `apps/web/e2e/helpers/m2a-a2.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M2A-A2-1 | **One seam to the rig's limb math.** `workflows/ik.ts` calls A1's functions (`limbIkRecords`, `validateFootParams`, `footprintShape`, `evaluateWithLimbMode`, `matchFkToIk`, `matchIkToFk`, `ikControlForEndWorld`, `computeInfluenceKeyTimes`) only through `limbKitOf(app)`; `setLimbKit(app, partial)` is a test seam (not exported from the package) that scripts match results so the key policies are tested without A1. `limbIkAvailable` probes `limbIkRecords` once per program: before A1 the IK operators poll-fail "not available yet", Add Limb IK is disabled with that reason and the "FK limbs only" toast stays quiet. | A2 builds in parallel with A1 (§8); the editor-side rules (keys, steps, warnings) must be testable before the math lands. |
| M2A-A2-2 | **Limb fixtures in the shared test kit**: `withLimbIkRecords(snapshot)` adds IK controls, poles and `ik2` solver records shaped like `limbIkRecords` output to a humanoid FK document, and `createFakeIkEditorApp` lists `RigProgram.limbs` from them (the naive program evaluates no `ik2`). New file `editor-core/src/testing/limbs.ts`, exported from `editor-core/testing` (A0's directory, additive). | Panel and kernel tests (visibility, Channels panel rows, key policies, pick-walk, pole lines) in Node and browser mode without A1. |
| M2A-A2-3 | **The keyAll rule's explicit channels** are the Channels panel's selected channels; the IK/FK proxy row selects `<ikControl>/@ikFk` even while an FK control of the limb is the selection, and `key.set` keys that channel on the IK control. `key.deleteAtFrame` removes attribute keys too, but not `keyAll: false` ones unless they are selected channels (a Delete on the IK foot never removes the limb's mode keys). | §5.1 rule 4, §5.6 UI ("Selecting the proxy row's name makes `@ikFk` a channel selected in the Channels panel"). |
| M2A-A2-4 | **Body part on a generic rig** keys the selected controls and says so once per rig (info toast: "This rig has no body parts: Key › Body Part keyed the selected controls."). Controls hidden only by the IK/FK rule are keyed (§5.19). | §5.19 "the help line says so"; a toast is the one-time channel the operator has. |
| M2A-A2-5 | **Pick-walk details**: `down` passes through a hidden child to its own first visible descendant; `up` skips hidden ancestors; with nothing selected the walk poll-fails "Nothing is selected"; with `prefs.arrowKeys: 'frames'` the poll and the run are the time operator's. `pickWalkDispatch(app, args)` (exported) names that operator, so the shortcut sheet shows "Next Key", "Previous Key", "Step Frames (−1/1)" instead of "Pick Walk" (§5.17 "the shortcut sheet shows the label of the active behaviour"). | A walk that stops at a hidden FK leg would strand the selection under IK. |
| M2A-A2-6 | **Switch key policies**: `'seamless'` never overwrites a key at f − 1; an existing `@ikFk` key at f is patched to the new value and made stepped. `'none'` writes through `applyChannelEdits(key: 'auto')`, so keyed channels without auto-key become overrides (M1 rule). | §5.6; keys the user set stay theirs. |
| M2A-A2-19 | **`'seamless'` holds the matched channels at f − 1** (fix round 1): before keying them at f, every matched channel gets a key at f − 1 holding its curve value there (`insertKeyOnCurve`, shape-preserving, so no earlier frame moves; out tangent `step` like the `@ikFk` key), unless a key exists at f − 1. Without it the key at f reached back: the ik2 toes rule reads `fk.toes` under IK too (the toes at f − 1 turned 20° with a ball roll, 0.6° with an animated `fk.toes`), and an `@ikFk` between 0 and 1 at f − 1 reads the whole FK chain. `'key'` and `'none'` add no hold keys. | §5.6 "the pose at f − 1 … unchanged (1e-6)". |
| M2A-A2-20 | **Toes warnings** (fix round 1): an IK match of a leg with toes measures the toes' turn relative to the foot in the matched pose and warns above 1e-3 rad ("L Leg: IK bends the toes by 20° (foot roll); set Roll to 0 to keep the FK toes"); an FK match measures how far the toes joint moved and warns above 0.1 mm ("L Leg: FK moves the toes by 5.4 mm (foot roll); set Roll to 0 to keep the IK toes"). Switch, match and match range warn on both sides now (before, only the IK side warned). | The ik2 toes rule keeps planted toes under a ball roll that FK cannot reproduce; see [Open issues](#open-issues-for-the-integration-agent-and-a1). |
| M2A-A2-7 | **Match warnings**: end error > 1e-4 m → "L Leg: IK misses the FK foot by 0.3 mm (soft IK)"; mid error > 1e-3 m → a hyperextension message when the FK and matched IK bend offsets point opposite ways ("L Leg: the knee is hyperextended by 5.0°; IK bends it forward, the knee moves 12 mm"; arms "IK bends it the normal way"), else "the knee is not a clean hinge; IK moves it N mm". The angle is the FK bend between the upper and lower bones. | §5.6 warning texts. |
| M2A-A2-8 | **`matchRange` frames**: `'frames'` = every integer frame of the range (never −0); `'keys'` = the influence key times (the rig's `computeInfluenceKeyTimes`, raw) of the limb's chain-node tracks (upper, mid, end, toes) inside the range. | §5.6, §5.8 "one definition" of influencing curves. |
| M2A-A2-9 | **Import limb warnings** come first in the import result (the import toast shows the first three) and are written from `ImportedClipKeys.limbs` rows with mode `'fk'` unless the rig's own warnings already name "<Limb> kept FK". | §5.8 message; an FK-kept limb is the warning a user must see. |
| M2A-A2-10 | **Virtual slider**: the pressed row's channel, or every selected name when the pressed row is one of them, on every selected control that has it; locked, non-keyable and unknown channels are left out (nothing starts when none remains); the LMB drag's first 3 px are applied as the first increment with the press's modifiers; under pointer capture Esc ends the gesture through `edit.escape`. The viewport's plain MMB runs it only with channels selected in the Channels panel and `prefs.virtualSlider.viewportMmb` on; Alt+MMB stays navigation. | §5.18. |
| M2A-A2-11 | **Package exports beyond §4** (additive): editor-core `attrChannelsOf`, `attrDefOf`, `attrLabel`, `clampChannelValue`, `isKeyAllChannel`, `isKeyable`, `isLocked`, `beginVirtualSlider`, `virtualSliderFactor/Label/Rate`, `pickWalkTarget`, `pickWalkDispatch`, `LIMB_NAME`, `limbOfControlApp`, `limbOfControlIn`, `limbsOf`, `watchFkOnlyRigs`, `controlVisibilityResolver`, `limbHiddenControls`, `limbVisibilityState` (fix round 1); viewport `startVirtualSliderDrag` and its types. | The panels and the viewport need the same channel facts, visibility resolver and slider as the kernel; one implementation each. |
| M2A-A2-12 | **E2E-M2A-02 pole step (deviation)**: Polybot's rest knee sits 3.7 cm outward (+x) of its hip→foot line, so a pole moved +0.3 m in x swings the leg's flexion direction outward and turns that offset backwards: the knee's world x drops by 8 mm (A1's rest pole, which keeps the pole in front of the knee) or barely changes (the §5.2.2 pole along m⁰ points +x already). "Knee world x increased by > 5e-3" cannot hold on Polybot. The spec asserts what a pole does instead: the knee's offset from the hip→foot line turns about that line by exactly the pole's turn (1e-6 rad; measured 4e-16), the turn is > 0.1 rad, the knee moves > 5 mm, the foot stays (1e-6). | Fixture geometry; the property is what FR-RIG-11's pole means. |
| M2A-A2-13 | **E2E-M2A-05 (deviation)**: Seed-san's arms are straight in the rest T-pose (reach 0.47498 m of 0.47502 m); with `cog` 5 cm lower the IK hand is 3 mm out of reach and cannot stay. The scenario first bends the left elbow 30° in FK (`fk.lowerArm.L` ry −30°), then switches, records and lowers `cog`; the hand then stays within 1e-16 m. | Fixture geometry. |
| M2A-A2-14 | *Withdrawn in fix round 1.* E2E-M2A-06 had been moved onto two more Seed-sans because Polybot's old knee hinge (29° off x) kept both legs FK. A1's lower-leg knee hinge (`3e0aec3`) fixed that, so the scenario imports onto Polybot again as §9.1 says; only its "t and r curves with keys" is read as some t and some r curve (the importer writes the moving channels: tx, ty, tz, rx). | The original cross-character scenario passes against A1. |
| M2A-A2-15 | **E2E-M2A-07**: the animation-only GLB has no humanoid map, so the leg nodes are named from the source VRM's `VRMC_vrm.humanoid` (E2E-18 compares by node name too). | The exported file keeps the source node names. |
| M2A-A2-16 | **`pose.mirror` hands the rig the attribute values**: the snapshot passed to `mirrorPose` carries every keyable attribute, so A1's attribute mirroring (which reads a missing `@name` as its default) mirrors the current values; the editor's own `AttrDef.mirror` mapping (same rule) stays as the fallback for a rig whose mirror leaves attributes out. | Found against A1: the mirrored right foot got default roll/bank/twists and `ikFk`. |
| M2A-A2-17 | **Channels panel attribute rows** after TRS in `attrs` order: angle attributes in degrees (typed values are degrees), distance in metres, others 3 decimals, `bool` 0/1, `enum` labels; Lock is disabled on attribute rows; Reset to Default writes `AttrDef.default`; ↑/↓ nudges are unit-aware. The raw `@ikFk` row is hidden; the proxy row shows the limb's value for any control of the limb and writes the IK control's curve; its button switches with match. | §5.1 rules 1 and 5, §5.6. |
| M2A-A2-18 | **M1-rig tests import with `prefs.autoRigIk` off** (headless `ops.m2a-foundation`, `ops.pose` US-25, `ops.undo`; e2e `m2a-00-foundation` "M1 rig" and "minWriterVersion 1"): with A1's default rig the legs are IK and those tests would describe a different rig; the IK cases live in `ops.ik.test.ts` and the IK e2e files. | M2A-D1/§5.7: an M1 rig is an FK-only rig. |
| M2A-A2-21 | **Reset and the pose clipboard with `keyAll: false` attributes** (fix round 1): `pose.resetToRest` never resets `@ikFk` or `@soft`, also when they are channels selected in the Channels panel (rule 6; rule 4's selected-channel exception is for keying and the clipboard). `pose.copy` carries them when selected and `pose.paste` writes them when that channel is selected on the target control; otherwise both leave them out. | §5.1 rules 4 and 6. |
| M2A-A2-23 | **A switch to the limb's current mode is refused** (fix round 2): `rig.ikFk.switch` poll-fails "L Leg is IK already" / "… is FK already" when the limb's evaluated `ikFk` at the current frame is ≥ 0.999 for `to: 'ik'` or ≤ 0.001 for `to: 'fk'` (§5.5 rule 2's thresholds, the ones the Attributes segments and the viewport use; `switchAlreadyReason` in `workflows/ik.ts`), whatever `match` and `key` say. The Rig › IK/FK › Switch items are disabled with that reason (the menu shows poll reasons), the pressed Attributes segment does nothing, and the Channels panel's ⇄ always targets the other mode. A blend between the thresholds switches both ways. | §5.6 "the pose at f … unchanged": the match of a same-mode switch snaps the visible side onto the hidden one (Seed-san's raised IK foot dropped 0.2 m, an FK elbow reset to rest). Keying the current `@ikFk` is `S` on the proxy row (M2A-A2-3). |
| M2A-A2-24 | **Seamless switch curves on loop clips** (fix round 2): the curves a `'seamless'` switch puts their first keys on (the `@ikFk` curve and matched channels that had no keys, fresh or static) get `constant` pre and post infinities. Curves that had keys keep theirs; `'key'` and `'none'` change no infinity (a single key reads the same under any infinity). | §5.23 makes every new curve on a loop clip cycle over its key range; the switch's keys at f − 1 and f then cycled with period 1, so on every integer frame after f the limb read the old mode again and the matched channels their hold values (Seed-san on a 0…24 loop clip: IK again on frame 11). The residual case, a cyclic curve that already had keys, is open issue 4. |
| M2A-A2-22 | **No per-frame work for the IK/FK display** (fix round 1): the Attributes Limb section reads the mode and the 3-decimal `ikFk` as one primitive `useSyncExternalStore` snapshot (commits only when that changes); the viewport keeps each limb's rule-2 state (`limbVisibilityState`: IK, between, FK) per character and re-runs `controlVisibility` per pose only when one changed; the Outliner compares the states in place before rebuilding its dimmed set; `limbHiddenControls` returns one shared empty set when nothing is hidden. | §5.5 rule 5; MVP-SPEC §3 rule 5 and WP-9 "no per-frame React renders". |

## Against A1 (scratch merge)

Fix round 2: a fresh `git clone --shared` in the scratchpad (deleted afterwards) merged `m2a/ik-editor` with
`m2a/rig-ik` at `9767a7a` (A1's head, after `46c5af0`, `76440c5` and `9767a7a`). Conflicts and the one-line literal
update as in [Merge notes](#merge-notes). There:

- Headless `ops.ik.test.ts`: 10 of 10, among them the two new cases: a same-mode switch is cancelled and leaves the
  document, the overrides and the leg and arm worlds exactly (0) as they were; a seamless IK → FK switch on a 0…24
  loop clip keeps the leg FK and in the matched pose on 11, 12, 17 and 24 (1e-6). With the infinity fix disabled the
  loop case fails on frame 11 (`ikFk` 1), so it reproduces the defect on A1's rig.
- E2E-M2A-03 in real Chrome with the new first-case steps: the pressed IK segment leaves the undo label, the curves
  and the pose at 10, the run is cancelled with "L Leg is IK already", and Rig › IK/FK › Switch L Leg to IK is
  `aria-disabled` with that title while "… to FK" is enabled. The ball-roll case passes with its neutral toes check;
  on `9767a7a` the toes joint still moves at f (the headless ball-roll case, which requires both toes warnings,
  passes there too).
- Unit tests, e2e: see [Gates](#gates).

Fix round 1: an independent `git clone --shared` in the scratchpad (deleted afterwards; the repository and the other
worktrees were not touched) merged `m2a/ik-editor` with `m2a/rig-ik` at `9955177` (A1's head, including
`3e0aec3` "take the knee hinge from the lower leg"). The only conflict is the ROADMAP status table (A1's and A2's
rows are adjacent): keep A1's A1 row and A2's A2 row. There:

- Headless `ops.ik.test.ts`: 8 of 8 pass, among them the seamless switch with a 20° ball roll and an animated
  `fk.toes` (frames 0…9 unchanged to 1e-6), the IK → FK → IK round trip and the hyperextension warning. The earlier
  report that E2E-M2A-03, E2E-M2A-06, the headless round trip and the M1 `ops.export` VRMA round trip failed because
  of A1's `matchIkToFk` is out of date: A1's current match is exact there.
- Measured with a 20° roll (Seed-san, IK foot keyed at 10, seamless switch to FK at 10): before this round the toes
  at 9 turned 0.349 rad; now the chain at 9 is unchanged exactly (0) and at 0, 3 and 6 within 1e-6 (the headless
  test's tolerance), and at 10 the upper leg, lower leg and foot are within 3e-16 and the toes' rotation within
  4e-16, while the toes joint moves 5.4 mm (8.0 mm at 45°): the ball pivot lies off the toes joint (see the open
  issues). Roll 0 and roll −15° are exact at 10 too.
- Unit tests, e2e: see [Gates](#gates).

## Open issues for the integration agent and A1

1. **Toes under a ball roll (§5.3.1 toes rule vs §5.6 match).** With `@roll` inside the ball range the toes rule
   keeps the toes bone world planted by turning it about the ball pivot, which lies off the toes joint on the
   fixtures. FK keeps the toes joint on the foot, so an IK → FK match is exact for the chain and the toes' rotation
   but moves the toes joint (5.4 mm at 20° on Seed-san); an FK → IK match keeps the foot but bends the toes by the
   ball roll (0.349 rad at 20°), and `matchIkToFk` reports no error for it. §5.6's "pose at f unchanged whenever
   the match is exact" therefore does not hold at f with a ball roll. A2 now warns on both sides (M2A-A2-20) and the
   seamless switch keeps f − 1 and earlier exact (M2A-A2-19). A contract decision is needed: the IK-side match could
   also set `fk.toes` (or zero the roll), and the toes rule could pivot the toes about their own joint, or §5.6
   could state the exception.
   E2E-M2A-03's ball-roll case no longer asserts that the toes joint moves (fix round 2): it requires the toes
   warning with the measured distance when the joint moves more than 0.1 mm and no warning otherwise, so it holds
   under either decision. The headless ball-roll case in `ops.ik.test.ts` still asserts today's A1 behaviour (both
   toes warnings, the IK side "bends the toes by 20°"), as a regression check of the warnings; it follows the
   decision when one is made.
2. **Contract items awaiting the integration agent's sign-off** (§3 rule 1; A2 cannot approve its own):
   - the E2E-M2A-02 and -05 rows and the amendment note in M2A-SPEC §9.1, which A2 edited itself (M2A-A2-12, -13).
     Both hold against A1 at `9767a7a`: Polybot's knee world x drops for a +x pole, and Seed-san's straight rest arm
     cannot reach after the cog edit;
   - the package exports beyond §4 (M2A-A2-11; §8 A2 lists none);
   - `'seamless'` also keying the matched channels at f − 1 (M2A-A2-19), beyond §5.6's literal definition;
   - fix round 2: the same-mode refusal (M2A-A2-23) and the constant infinities of the curves a seamless switch
     starts (M2A-A2-24), both of which §5.6 leaves unsaid.
3. **anim-core flakes (outside A2):** two fast-check properties in `anim-core/test/curve/evaluate.test.ts` fail
   now and then on curves with post 'cycle', where a sample at (or a rounding step past) the last key evaluates the
   first key's value through the cycle: "auto types never overshoot their neighbours" (seed −160331587, 0 instead of
   −1e-12; fix round 1) and "clamped is flat between equal keys (no foot slide)" (seed 1584343940, last key −1e-12,
   "expected 1e-12 to be less than 1e-12"; the round 1 review's trial merge). Reruns are green. For A0/A5 or the
   integration agent: pin both seeds as regression cases and decide whether `t = last key` belongs to the last span
   or the next cycle (or clamp the samples to `t1`).
4. **Cyclic curves with keys and the switch (fix round 2, §5.23 vs §5.6).** M2A-A2-24 covers curves the seamless
   switch starts. A curve that already had keys keeps its infinities, and on a loop clip it cycles over its key
   range, not the clip's: a user who keyed the IK/FK proxy row once at 0 (`S`, a cyclic `@ikFk` curve) and then
   switches to FK at 10 gets keys {0, 9, 10} cycling with period 10, so 11…19 read IK again; the same holds for a
   matched channel whose keys all lie before f. That is §5.23's keying rule (any `S` beyond the last key does the
   same), so A2 leaves it; a contract decision could make `@ikFk` curves never cycle, or cycle over the clip range.
5. **A1's allocation test under load (outside A2):** on the round 2 trial merge `rig/test/limb-op.test.ts` "allocates
   no bytes per evaluation, counted in the young generation" (added in A1's `9767a7a`) failed once in the parallel
   `pnpm run test` (`[0.6, 0, 0.0216, true]` against `[0.6, 0, 0, true]`); the file and the rig package pass alone.
   A load-dependent count for A1.

## Edits in files other packages own

Each is additive and small: `editor-core/src/evaluation/service.ts` (A4 after A0: `channelState` for attributes, one
line), `editor-core/src/index.ts` (exports, M2A-A2-11), `editor-core/src/testing/{index.ts,limbs.ts}` (A0's kit,
M2A-A2-2), `editor/src/dialogs/ShortcutsDialog.tsx` (A5's directory: the arrow rows' label, M2A-A2-5),
`apps/web/e2e/m2a-00-foundation.spec.ts` and `editor-core/test/builtin/m2a-operators.test.ts` (A0's stub lists drop
A2's operators), `editor/test/m2a-foundation.test.tsx` (A0), `editor/test/shell.test.tsx` (M1/A5),
`headless-tests/test/{ops.m2a-foundation,ops.pose,ops.undo}.test.ts` (M1/A0).

## Literal updates (§3 rule 8)

Every assertion kept; each commit message names the test and the contract row.

| Test | Literal | Contract row |
|---|---|---|
| `editor-core/test/builtin/m2a-operators.test.ts` | `select.pickWalk`, `key.setTarget` and the five `rig.*` IK operators leave the stub list; the `key.set` refusal case asserts the landed behaviour | §4.9 rows |
| `editor/test/m2a-foundation.test.tsx` | the status-line key-target items are enabled by the built-in `key.setTarget` | §4.9 `key.setTarget` |
| `apps/web/e2e/m2a-00-foundation.spec.ts` | A2's operators leave the "poll-fail cleanly" list | §4.9 rows |
| `headless-tests/test/ops.m2a-foundation.test.ts`, `ops.pose.test.ts`, `ops.undo.test.ts` | M1 rigs are imported with `prefs.autoRigIk` off | §5.7, M2A-D1 |
| `editor/test/shell.test.tsx` "shows toasts with an Undo action" | the toast under test is found by its text (the FK-only toast may show beside it once A1 lands) | §5.7 |
| `apps/web/e2e/m2a-00-foundation.spec.ts` "the M2a test API answers on an M1 rig…", "saving writes schema 2 / minWriterVersion 1…" | both import Polybot with `prefs.autoRigIk` off (A2's import passes the preference, so with A1's default rig Polybot would get IK legs, `limbs()` would not be empty and an enabled ik2 makes `minWriterVersion` 2) | §5.7, M2A-D1 |

## Tests added

| Package | File | What |
|---|---|---|
| editor-core | `test/builtin/m2a-a2-keying.test.ts` | attribute channels in `applyChannelEdits`, stepped tangents, lock skips; `key.set` keyAll rules (`S` on the IK foot keys t, r and five attributes, never `@ikFk`/`@soft`; the selected proxy channel keys `@ikFk`), breakdown keys; body-part keying and `key.setTarget`; reset, clipboard and mirror with attributes; `key.deleteAtFrame`; fix round 1: reset leaves selected `@ikFk`/`@soft` alone, a selected `@ikFk` rides the clipboard both ways |
| editor-core | `test/builtin/m2a-a2-ik.test.ts` | switch key policies (seamless keys at f − 1 and f, `'key'`, `'auto'`, `'none'`), polls, match and warnings (hyperextension text), `matchRange` frames and keys, `rig.addLimbIk` (structural, undo exact), `rig.setFootParams` (footprint rewritten, validation), Plant Feet on IK legs, the FK-only notice; fix round 1: seamless hold keys at f − 1 (both directions, an animated `fk.toes` keeps frames 0…9, a user key at f − 1 stays), the toes warnings on both sides, the Euler filter after `matchRange` (±2π jumps removed); fix round 2: a same-mode switch is cancelled with its reason (every key mode, match on and off, IK and FK) and leaves the document, overrides, history, pose and toasts unchanged, the menu poll gives the reason; the mode thresholds at the current frame (1, 0.9995, 0.99, 0.5, 0.01, 0.0005, 0, out-of-range values clamped, an animated mode); a seamless switch on the loop clip gives the curves it starts constant infinities (a user's cyclic curve keeps its own, `'key'` keeps §5.23's) and holds FK on 11…30 |
| editor-core | `test/builtin/m2a-a2-pickwalk.test.ts` | walk order, siblings and mirror, several selected, hidden controls, `'frames'` dispatch, keymap rows |
| editor-core | `test/kernel/m2a-a2-visibility.test.ts`, `m2a-a2-virtual-slider.test.ts` | rules 2–3 at `ikFk` 0, 0.5, 1, ghosts, the `'ghost'` preference; slider rates, modifiers per move, relative values, auto-key, ranges and clamping, cancel, Esc; fix round 1: `limbVisibilityState`, the shared empty set |
| headless-tests | `test/ops.ik.test.ts` (READY.a1) | Seed-san's four limbs, visibility and body parts; Add Limb IK on an M1 rig (bone locals bit-identical at every frame, undo exact); seamless switch (pose at 9 and 10, 1e-6); round trips and the hyperextension warning; match range; Plant Feet on IK legs; reset and foot pivots; fix round 1: seamless switch with a 20° ball roll and an animated `fk.toes` (frames 0…9 to 1e-6, chain and toes rotation at 10, both toes warnings); fix round 2: a same-mode switch on Seed-san leaves the raised IK foot, an FK elbow and the document exactly; a seamless switch on a 0…24 loop clip holds FK and the matched pose on 11…24 |
| viewport | `test/m2a-a2.test.ts` (browser) | drawn set by the rule, animated/overridden `ikFk`, ghosts not pickable and not marquee-selected, pole lines, plain-MMB slider (+20°, one step, no other channel), pref off and Alt+MMB, Shift/Mod, Pointer Lock rules (cancel on `pointerlockchange`, commit, refused lock → capture); fix round 1: no visibility refresh over steady frames, one at a crossed threshold |
| editor | `test/panels/m2a-a2-channels.test.tsx`, `m2a-a2-attributes.test.tsx`, `m2a-a2-outliner.test.tsx`, `test/m2a-a2-shortcuts.test.tsx` (browser) | attribute rows and units, no raw `@ikFk` row, Lock/Reset, proxy row and switch, row slider (MMB, LMB drag, several names, clamps); Limb section, Match buttons, key mode, foot fields in cm/degrees, Add Limb IK; Outliner dimming; shortcut sheet arrows; fix round 1: the Limb section commits only when its display changes (pose events per frame), the Outliner's limb-state reader; fix round 2: the pressed Attributes segment (IK on an IK leg, FK on an FK arm) runs nothing and changes nothing, a blend at 0.5 switches both ways |
| apps/web | `e2e/m2a-01…07, 18, 19, 25` | §9.1 scenarios (IK ones `test.fixme('A1')` until A1 merges); fix round 1: E2E-M2A-03's file adds the ball-roll and animated-toes case; E2E-M2A-06 back on Polybot; fix round 2: E2E-M2A-03's first case clicks the pressed IK segment (nothing changes, the run is cancelled, the Rig › IK/FK item is disabled with the reason), the ball-roll case's toes check is neutral on open issue 1 |

## Gates

Fix round 2, on `m2a/ik-editor` (HEAD at the time of the runs: `18c91af`): `pnpm run format:check`, `lint`,
`typecheck`, `check:deps`, `check:fixtures`, `check:licenses` exit 0; `pnpm run test --force --continue` 13 of 13
tasks green (editor-core 601 + 1 skipped, editor 308 + 1, viewport 98 + 1, curve-editor 137 + 3, headless-tests 107
+ 10 skipped `ops.ik` cases (READY.a1), io 142, rig 124, anim-core 642, doc 175, doc-yjs 69, ui 73); `pnpm run
build` exit 0; the whole e2e suite on port 3142 (`EKZA_E2E_PORT=3142 pnpm run test:e2e`, real Chrome): 69 passed,
13 skipped (the A1-gated A2 scenarios and the stretch entries), 0 failed.

On the trial merge with A1 at `9767a7a` (see [Against A1](#against-a1-scratch-merge)), with the `rig.ik.export`
line of the merge notes: `typecheck` exit 0; `pnpm run test --continue`: every package green (headless-tests 142 of
142, editor-core 600 + 2 skipped by `skipIf(READY.a1)`, anim-core 642) except one case outside A2's code, A1's rig
allocation count under load (open issue 5; the rig package passes alone, 202 of 202); the two new `ops.ik` cases
added afterwards: `ops.ik.test.ts` 10 of 10; `pnpm run build` exit 0; the whole e2e suite in real Chrome: 79
passed, 3 skipped (stretch), 0 failed, among them E2E-M2A-01…07, 18 (both cases), 19, 25 and m2a-00; A2's
scenarios and m2a-00 in `chromium-swiftshader`: 17 of 17 passed.

Fix round 1, on `m2a/ik-editor` (HEAD at the time of the runs: `8e66419`): `pnpm run format:check`, `lint`,
`typecheck`, `check:deps`, `check:fixtures`, `check:licenses` exit 0; `pnpm run test --force --continue` 13 of 13
tasks green (editor-core 598 + 1 skipped, editor 307 + 1, viewport 98 + 1, curve-editor 137 + 3, headless-tests 107 +
8 skipped `ops.ik` cases (READY.a1), io 142, rig 124, anim-core 642, doc 175, doc-yjs 69, ui 73); `pnpm run build`
exit 0 (cache miss, rebuilt); the whole e2e suite on port 3142 (`EKZA_E2E_PORT=3142 pnpm run test:e2e`, real
Chrome): 69 passed, 13 skipped (the A1-gated A2 scenarios, including the new E2E-M2A-03 ball-roll case, and the
stretch entries), 0 failed; M1's E2E-00…27 and the acceptance rounds unchanged.

On the trial merge with A1 at `9955177` (see [Against A1](#against-a1-scratch-merge)): unit tests green except two
cases outside A2's code: A1's `rig.ik.export.test.ts`, which needs the M1-rig preference on merge (see
[Merge notes](#merge-notes); with that one line the headless package is 142 of 142), and the anim-core fast-check
flake (open issue 3; seed −160331587 failed after 470 runs in one of two runs). The whole e2e suite in real Chrome:
79 passed, 3 skipped (stretch), 0 failed, so E2E-M2A-01…07 (and the ball-roll case), 18 (both cases), 19, 25 and
m2a-00 all pass; A2's scenarios and m2a-00 in `chromium-swiftshader`: 17 of 17 passed.

Build round (before the review): the same gates were green on `m2a/ik-editor` (e2e 69 passed, 12 skipped). A second
full run under load average 58 from other builds failed `acceptance-round1` "Insert+Q is no double-click" once (its
two key presses 467 ms apart against a 400 ms window, a timing check); the spec passes alone.

## Merge notes

Fix round 2, `git merge-tree` of `m2a/ik-editor` against the sibling heads of 2026-10-18 (`m2a/rig-ik` `9767a7a`,
`m2a/platform-perf` `09f1944`, `m2a/graph-posing` `440ab06`, `m2a/dopesheet-timing` `d064b59`,
`m2a/contracts-foundation` `0357037`):

- **`m2a/rig-ik`**: `docs/ROADMAP.md` only (the A1 and A2 status rows are adjacent): keep A1's A1 row and A2's A2
  row. Then the one-line literal update in **A1's `headless-tests/test/rig.ik.export.test.ts`** ("exports
  byte-identical files after limb IK is added at ikFk 0", added in A1's `7806f2f`): it imports Seed-san as an M1 rig
  and asserts `def.solvers` empty, but with A2's import passing `prefs.autoRigIk` the default rig has IK legs. Add
  `app.prefs.setState({ autoRigIk: { legs: false, arms: false } })` before `importFixture` (as M2A-A2-18 did for
  the other M1-rig tests; verified green on both trial merges). The file exists only on A1's branch, so A1 adds the
  line there (harmless before A2) or the A1 + A2 merge commit does.
- **`m2a/platform-perf`** (no longer clean): A5's `f58454f` ("the import pipelines are a lazy chunk") moved
  `clipNameTaken` and `clipNamesOf` to `workflows/importChecks.ts`, so `packages/editor-core/src/workflows/importModel.ts`
  conflicts in its import lines next to A2's `importLimbWarnings` import. Keep A2's `import { importLimbWarnings }
  from './ik';`, A5's names import without `nameKey`, and A5's re-export `export { clipNamesOf, clipNameTaken } from
  './importChecks';` (the function body A5 removed stays removed; A2's `importLimbWarnings` call in the import
  warnings is untouched). Everything else auto-merges (M2A-SPEC, ROADMAP, `index.ts`, `importAnimation.ts`, the
  stub lists, `shell.test.tsx`).
- **`m2a/graph-posing`**: `packages/editor-core/test/builtin/m2a-operators.test.ts`, the doc comment of A0's stub
  list (each side names the operators it removed): keep both sentences; the list itself auto-merges.
- **`m2a/dopesheet-timing`**: A0's stub lists in `packages/editor-core/test/builtin/m2a-operators.test.ts` and
  `apps/web/e2e/m2a-00-foundation.spec.ts` (A3 removed `key.toggleRipple`, A2 the rig IK operators,
  `select.pickWalk` and `key.setTarget`: keep both removals), and the ROADMAP A2/A3 rows (keep each package's own
  row).
- **`m2a/contracts-foundation`**: merged already (no conflicts).
