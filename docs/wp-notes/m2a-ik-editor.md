# M2a A2 — IK editor integration, pick-walk, virtual slider, body-part keying: build notes

Branch `m2a/ik-editor` (from `dev` with `m2a/contracts-foundation` merged). Scope:
[M2A-SPEC §8 A2](../M2A-SPEC.md#a2--ik-editor-integration-pick-walk-virtual-slider-body-parts). The spec names this
file `m2a-a2.md` (§3 rule 6); the work package's task asked for `m2a-ik-editor.md`, so the notes live here. Decision
IDs below are `M2A-A2-<n>` for DECISIONS-OPEN §F.

## Status

Built. Every A2 operator, panel and viewport feature is implemented and tested on this branch. A1 (`m2a/rig-ik`) has
not merged, so on this branch the IK unit tests are skipped (`READY.a1`) and E2E-M2A-01…07, 25 and the body-part case
of E2E-M2A-18 are `test.fixme('A1')` (§3 rule 4). They were run against A1 in a scratch merge (`m2a/ik-editor` +
`m2a/rig-ik` at `13c7abf`): see [Against A1](#against-a1-scratch-merge). "Rebases on A4's viewport render-skip
change": A4's branch has not changed `viewport/src/manager` yet, so there was nothing to rebase on.

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
| Virtual slider (§5.18) | kernel `edit/virtualSlider.ts`; DOM side `viewport/src/tools/virtualSliderDrag.ts` (Pointer Lock or capture, `movementX`, `pointerlockchange` cancels, a refused lock falls back to capture); Channel Box rows (MMB on any row, LMB drag ≥ 3 px on a name); viewport plain MMB (`ViewportManager`) |
| Channel Box attribute rows, IK/FK proxy row and switch | `panels/channel-box/ChannelBoxPanel.tsx`, `readout.ts`, `nudge.ts`, `kit/kernel.ts` |
| Attributes Limb section with the foot fields, Add Limb IK | `panels/attributes/LimbSection.tsx`, `layout.tsx`, `AttributesPanel.tsx` |
| E2E-M2A-01…07, 18, 19, 25 | `apps/web/e2e/m2a-*.spec.ts`, helpers `apps/web/e2e/helpers/m2a-a2.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M2A-A2-1 | **One seam to the rig's limb math.** `workflows/ik.ts` calls A1's functions (`limbIkRecords`, `validateFootParams`, `footprintShape`, `evaluateWithLimbMode`, `matchFkToIk`, `matchIkToFk`, `ikControlForEndWorld`, `computeInfluenceKeyTimes`) only through `limbKitOf(app)`; `setLimbKit(app, partial)` is a test seam (not exported from the package) that scripts match results so the key policies are tested without A1. `limbIkAvailable` probes `limbIkRecords` once per program: before A1 the IK operators poll-fail "not available yet", Add Limb IK is disabled with that reason and the "FK limbs only" toast stays quiet. | A2 builds in parallel with A1 (§8); the editor-side rules (keys, steps, warnings) must be testable before the math lands. |
| M2A-A2-2 | **Limb fixtures in the shared test kit**: `withLimbIkRecords(snapshot)` adds IK controls, poles and `ik2` solver records shaped like `limbIkRecords` output to a humanoid FK document, and `createFakeIkEditorApp` lists `RigProgram.limbs` from them (the naive program evaluates no `ik2`). New file `editor-core/src/testing/limbs.ts`, exported from `editor-core/testing` (A0's directory, additive). | Panel and kernel tests (visibility, Channel Box rows, key policies, pick-walk, pole lines) in Node and browser mode without A1. |
| M2A-A2-3 | **The keyAll rule's explicit channels** are the Channel Box's selected channels; the IK/FK proxy row selects `<ikControl>/@ikFk` even while an FK control of the limb is the selection, and `key.set` keys that channel on the IK control. `key.deleteAtFrame` removes attribute keys too, but not `keyAll: false` ones unless they are selected channels (a Delete on the IK foot never removes the limb's mode keys). | §5.1 rule 4, §5.6 UI ("Selecting the proxy row's name makes `@ikFk` a selected Channel Box channel"). |
| M2A-A2-4 | **Body part on a generic rig** keys the selected controls and says so once per rig (info toast: "This rig has no body parts: Key › Body Part keyed the selected controls."). Controls hidden only by the IK/FK rule are keyed (§5.19). | §5.19 "the help line says so"; a toast is the one-time channel the operator has. |
| M2A-A2-5 | **Pick-walk details**: `down` passes through a hidden child to its own first visible descendant; `up` skips hidden ancestors; with nothing selected the walk poll-fails "Nothing is selected"; with `prefs.arrowKeys: 'frames'` the poll and the run are the time operator's. `pickWalkDispatch(app, args)` (exported) names that operator, so the shortcut sheet shows "Next Key", "Previous Key", "Step Frames (−1/1)" instead of "Pick Walk" (§5.17 "the shortcut sheet shows the label of the active behaviour"). | A walk that stops at a hidden FK leg would strand the selection under IK. |
| M2A-A2-6 | **Switch key policies**: `'seamless'` never overwrites a key at f − 1; an existing `@ikFk` key at f is patched to the new value and made stepped. `'none'` writes through `applyChannelEdits(key: 'auto')`, so keyed channels without auto-key become overrides (M1 rule). | §5.6; keys the user set stay theirs. |
| M2A-A2-7 | **Match warnings**: end error > 1e-4 m → "L Leg: IK misses the FK foot by 0.3 mm (soft IK)"; mid error > 1e-3 m → a hyperextension message when the FK and matched IK bend offsets point opposite ways ("L Leg: the knee is hyperextended by 5.0°; IK bends it forward, the knee moves 12 mm"; arms "IK bends it the normal way"), else "the knee is not a clean hinge; IK moves it N mm". The angle is the FK bend between the upper and lower bones. | §5.6 warning texts. |
| M2A-A2-8 | **`matchRange` frames**: `'frames'` = every integer frame of the range (never −0); `'keys'` = the influence key times (the rig's `computeInfluenceKeyTimes`, raw) of the limb's chain-node tracks (upper, mid, end, toes) inside the range. | §5.6, §5.8 "one definition" of influencing curves. |
| M2A-A2-9 | **Import limb warnings** come first in the import result (the import toast shows the first three) and are written from `ImportedClipKeys.limbs` rows with mode `'fk'` unless the rig's own warnings already name "<Limb> kept FK". | §5.8 message; an FK-kept limb is the warning a user must see. |
| M2A-A2-10 | **Virtual slider**: the pressed row's channel, or every selected name when the pressed row is one of them, on every selected control that has it; locked, non-keyable and unknown channels are left out (nothing starts when none remains); the LMB drag's first 3 px are applied as the first increment with the press's modifiers; under pointer capture Esc ends the gesture through `edit.escape`. The viewport's plain MMB runs it only with selected Channel Box channels and `prefs.virtualSlider.viewportMmb` on; Alt+MMB stays navigation. | §5.18. |
| M2A-A2-11 | **Package exports beyond §4** (additive): editor-core `attrChannelsOf`, `attrDefOf`, `attrLabel`, `clampChannelValue`, `isKeyAllChannel`, `isKeyable`, `isLocked`, `beginVirtualSlider`, `virtualSliderFactor/Label/Rate`, `pickWalkTarget`, `pickWalkDispatch`, `LIMB_NAME`, `limbOfControlApp`, `limbOfControlIn`, `limbsOf`, `watchFkOnlyRigs`, `controlVisibilityResolver`, `limbHiddenControls`; viewport `startVirtualSliderDrag` and its types. | The panels and the viewport need the same channel facts, visibility resolver and slider as the kernel; one implementation each. |
| M2A-A2-12 | **E2E-M2A-02 pole step (deviation)**: Polybot's rest knee sits 3.7 cm outward (+x) of its hip→foot line, so a pole moved +0.3 m in x swings the leg's flexion direction outward and turns that offset backwards: the knee's world x drops by 8 mm (A1's rest pole, which keeps the pole in front of the knee) or barely changes (the §5.2.2 pole along m⁰ points +x already). "Knee world x increased by > 5e-3" cannot hold on Polybot. The spec asserts what a pole does instead: the knee's offset from the hip→foot line turns about that line by exactly the pole's turn (1e-6 rad; measured 4e-16), the turn is > 0.1 rad, the knee moves > 5 mm, the foot stays (1e-6). | Fixture geometry; the property is what FR-RIG-11's pole means. |
| M2A-A2-13 | **E2E-M2A-05 (deviation)**: Seed-san's arms are straight in the rest T-pose (reach 0.47498 m of 0.47502 m); with `cog` 5 cm lower the IK hand is 3 mm out of reach and cannot stay. The scenario first bends the left elbow 30° in FK (`fk.lowerArm.L` ry −30°), then switches, records and lowers `cog`; the hand then stays within 1e-16 m. | Fixture geometry. |
| M2A-A2-14 | **E2E-M2A-06 (deviation)**: Polybot's upper legs splay 29° outward, so its §5.2.1 knee hinge is (0.88, 0.48, 0); the knee bend authored about x on Seed-san is 19.4° off that hinge at 40° of bend, above the 2° import tolerance (M2A-D13), and A1 correctly keeps both legs FK. The scenario imports onto two more Seed-sans (hinge (1, 0, 0)): "Seed-san 2" with the default rig and "Seed-san 3" with FK limbs only. "`ik.leg.L` has t and r curves with keys" is asserted as "some t and some r channel": the motion is sagittal, so the importer writes ty, tz and rx (no constant tx, ry, rz tracks). | Fixture geometry; the rule under test is unchanged. |
| M2A-A2-15 | **E2E-M2A-07**: the animation-only GLB has no humanoid map, so the leg nodes are named from the source VRM's `VRMC_vrm.humanoid` (E2E-18 compares by node name too). | The exported file keeps the source node names. |
| M2A-A2-16 | **`pose.mirror` hands the rig the attribute values**: the snapshot passed to `mirrorPose` carries every keyable attribute, so A1's attribute mirroring (which reads a missing `@name` as its default) mirrors the current values; the editor's own `AttrDef.mirror` mapping (same rule) stays as the fallback for a rig whose mirror leaves attributes out. | Found against A1: the mirrored right foot got default roll/bank/twists and `ikFk`. |
| M2A-A2-17 | **Channel Box attribute rows** after TRS in `attrs` order: angle attributes in degrees (typed values are degrees), distance in metres, others 3 decimals, `bool` 0/1, `enum` labels; Lock is disabled on attribute rows; Reset to Default writes `AttrDef.default`; ↑/↓ nudges are unit-aware. The raw `@ikFk` row is hidden; the proxy row shows the limb's value for any control of the limb and writes the IK control's curve; its button switches with match. | §5.1 rules 1 and 5, §5.6. |
| M2A-A2-18 | **M1-rig tests import with `prefs.autoRigIk` off** (headless `ops.m2a-foundation`, `ops.pose` US-25, `ops.undo`): with A1's default rig the legs are IK and those tests would describe a different rig; the IK cases live in `ops.ik.test.ts`. | M2A-D1/§5.7: an M1 rig is an FK-only rig. |

## Against A1 (scratch merge)

A scratch worktree (`m2a-ik-editor-probe`, detached) merges `m2a/ik-editor` with `m2a/rig-ik` at `13c7abf`. There:

- Unit tests: every A2 unit test passes (editor-core 590 + 2 skipped before-A1 cases, editor 305, viewport 97) except
  **`headless-tests/ops.ik.test.ts` "IK → FK → IK keeps the chain (1e-6)"**: the upper leg comes back turned by
  7.6e-4 rad about the hip→foot axis (knee 0.18 mm off). Cause (A1, `limb/match.ts`): Seed-san's rest knee bends 1.0°
  out of its hinge plane, so in a pose the `ik2` op solves, the bend offset `m̂` and the hinge-implied direction
  `h = x̂ × k` differ (7.6e-4 rad here, 1.4e-3 rad at a 43° bend). `ik2` aligns `h` with the pole (A1's rest pole
  keeps `h` on the pole, `records.ts` `restPole`), while `matchIkToFk`'s pole rule picks `m̂` (β = 1 above 10° of
  bend), so the matched pole twists the chain by angle(m̂, h). The same mismatch fails **E2E-M2A-03** ("switching back
  at 15 keeps the pose", 1.9e-3 rad), **E2E-M2A-06** (hips-relative knee 0.19 mm apart at frame 5, tolerance 0.1 mm)
  and the M1 test **`ops.export.test.ts` "exports VRMA … round trip < 1e-4 rad"** (1.6e-3 rad: the VRMA import now
  writes IK legs on Seed-san, §5.8). A1's uncommitted `match.ts` change at the time (the pole offset projected onto
  p̂) does not change these numbers (p̂ = m̂ there).
- E2E (whole suite, real Chrome, port 3142): 74 passed, 3 skipped (stretch), 4 failed. E2E-00…27, the acceptance
  rounds and E2E-M2A-01, 02, 04, 05, 07, 18 (both cases), 19 and 25 pass; E2E-M2A-03 and 06 fail as above; A0's
  `m2a-00-foundation.spec.ts` "M1 rig" cases assert `limbs()` empty and `minWriterVersion` 1 on a default Polybot,
  which A1's default rig changes (A1's merge updates them).
- Also found there and fixed on this branch: `pose.mirror` lost the attribute values under A1's attribute mirroring
  (M2A-A2-16), and the "FK limbs only" toast took the place of the toast under test in an M1 shell test (literal
  update below).

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

## Tests added

| Package | File | What |
|---|---|---|
| editor-core | `test/builtin/m2a-a2-keying.test.ts` | attribute channels in `applyChannelEdits`, stepped tangents, lock skips; `key.set` keyAll rules (`S` on the IK foot keys t, r and five attributes, never `@ikFk`/`@soft`; the selected proxy channel keys `@ikFk`), breakdown keys; body-part keying and `key.setTarget`; reset, clipboard and mirror with attributes; `key.deleteAtFrame` |
| editor-core | `test/builtin/m2a-a2-ik.test.ts` | switch key policies (seamless keys at f − 1 and f, `'key'`, `'auto'`, `'none'`), polls, match and warnings (hyperextension text), `matchRange` frames and keys, `rig.addLimbIk` (structural, undo exact), `rig.setFootParams` (footprint rewritten, validation), Plant Feet on IK legs, the FK-only notice |
| editor-core | `test/builtin/m2a-a2-pickwalk.test.ts` | walk order, siblings and mirror, several selected, hidden controls, `'frames'` dispatch, keymap rows |
| editor-core | `test/kernel/m2a-a2-visibility.test.ts`, `m2a-a2-virtual-slider.test.ts` | rules 2–3 at `ikFk` 0, 0.5, 1, ghosts, the `'ghost'` preference; slider rates, modifiers per move, relative values, auto-key, ranges and clamping, cancel, Esc |
| headless-tests | `test/ops.ik.test.ts` (READY.a1) | Seed-san's four limbs, visibility and body parts; Add Limb IK on an M1 rig (bone locals bit-identical at every frame, undo exact); seamless switch (pose at 9 and 10, 1e-6); round trips and the hyperextension warning; match range; Plant Feet on IK legs; reset and foot pivots |
| viewport | `test/m2a-a2.test.ts` (browser) | drawn set by the rule, animated/overridden `ikFk`, ghosts not pickable and not marquee-selected, pole lines, plain-MMB slider (+20°, one step, no other channel), pref off and Alt+MMB, Shift/Mod, Pointer Lock rules (cancel on `pointerlockchange`, commit, refused lock → capture) |
| editor | `test/panels/m2a-a2-channel-box.test.tsx`, `m2a-a2-attributes.test.tsx`, `m2a-a2-outliner.test.tsx`, `test/m2a-a2-shortcuts.test.tsx` (browser) | attribute rows and units, no raw `@ikFk` row, Lock/Reset, proxy row and switch, row slider (MMB, LMB drag, several names, clamps); Limb section, Match buttons, key mode, foot fields in cm/degrees, Add Limb IK; Outliner dimming; shortcut sheet arrows |
| apps/web | `e2e/m2a-01…07, 18, 19, 25` | §9.1 scenarios (IK ones `test.fixme('A1')` until A1 merges) |

## Gates

On `m2a/ik-editor`: `pnpm run format:check`, `lint`, `typecheck`, `check:deps`, `test` (all packages, browser mode
included), `build` and the whole e2e suite on port 3142 (`EKZA_E2E_PORT=3142 pnpm run test:e2e`, real Chrome) green;
M1's E2E-00…27 unchanged.

## Merge notes

A trial merge (`git merge-tree`) against the sibling branches at the time: `m2a/rig-ik` and `m2a/platform-perf` merge
cleanly; `m2a/graph-posing` and `m2a/dopesheet-timing` conflict only in A0's stub lists
(`editor-core/test/builtin/m2a-operators.test.ts`, and for A3 `apps/web/e2e/m2a-00-foundation.spec.ts`), where each
package removed its own operators: keep both removals.
