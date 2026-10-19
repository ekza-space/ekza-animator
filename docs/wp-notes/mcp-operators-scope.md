# P1 — Explicit-target operators and the run scope (M-AI)

Branch `mcp/operators-scope` (worktree `mcp-operators-scope`), on top of `mcp/spec` with `mcp/contracts-foundation`
(D0) merged. Binding definition: [MCP-SPEC §8 P1](../MCP-SPEC.md#p1--explicit-target-operators-and-the-scope-editor-core),
§4.10, §5.5–§5.7, §5.13–§5.14. The spec names this file `mai-operators-scope.md`; the build orchestration asked for
`mcp-operators-scope.md`.

## What landed

| Item (§8 P1) | Where | State |
|---|---|---|
| The ten §4.10 operators | `editor-core/src/operators/builtin/{agentKeys,agentPose,agentClip,revert}.ts` (definitions and polls), `agentImpl.ts` (applies, loaded on first use by `agentLoad.ts`), `agentCommon.ts` (shared checks) | working; D0's stubs are gone |
| Workflows | `editor-core/src/workflows/{goals,goalTargets,loop,retime,adjust}.ts` | aim math and IK goal placement, the IK range switch, loop methods and seam metrics, value adjustment, cyclic offset and deterministic time edits (`warp` is stretch: poll-fails "not available yet") |
| The twelve scope-ready operators | `graph.ts` (tangent set/break/unify/lockWeight, setWeighted, infinity, setFields, simplify, Euler filter), `tween.ts` + `edit/tween.ts` (`key.tween {frames}`), `breakdown.ts` (`key.convert`), `mirrorAnimation.ts`; target resolution in `operators/builtin/scoped.ts` | user runs unchanged (every shipped test green); agent runs read the `RunScope` |
| Actor-safe migrations | `graph.key.insert` (`graph.ts`), `clip.delete` (`clip.ts`), `rig.ikFk.matchRange {clip}` (`ik.ts`, `workflows/ik.ts` `limbContext` explicit clip and frame) | the D0 `[P1]` gates of the policy test run green |
| `clip.new {loop, activate}`, `clip.duplicate {name, activate}` | `clip.ts` | working |
| Labels through `label` args, `hiddenByOverrides`, the §5.5 limits | `agentCommon.ts` and the operators | working |
| Tests | `editor-core/test/agent/{support,keys,pose,loop,revert,scope}.test.ts`, `headless-tests/test/ops.agent.test.ts`, `agent-tools/test/policy.test.ts` (P1's pinned outcomes), `*/test/ready.ts` (`p1: true`) | green |

DoD: every §8 P1 test is green (list below); no shipped test changed; the policy test passes with the `runScope:
true` entries (it also checks that every scope-ready operator has one).

## Decisions and deviations (INT copies them to DECISIONS-OPEN §H as MAI-P1-n)

- **MAI-P1-1 No targets.** An agent run of a scope-ready operator whose `RunScope` selection names no controls, keys
  or channels poll-fails `No targets: an agent run acts only on the controls, keys or channels of its context` —
  also when the scope names a clip: the user-run fallback "every curve of the clip" never applies to agents (P2's
  `curves_euler_filter` "every rotation curve" passes those curves' keys or controls). A scope of keys or channels
  alone names their controls for the control-level operators (`graph.eulerFilter`, `pose.mirrorAnimation`,
  `key.tween {frames}`). Agent runs snap to whole frames, never write the selection (the session keeper prunes
  deleted keys after the commit) and read the scope's clip (`scopedClipOf`).
- **MAI-P1-2 `key.tween`.** With `frames`: one plan per frame on the run's controls (else its keys' controls), the
  channels of the run's channel selection or the pose channels, in the run's clip; agent runs read the keyed values
  (never the overrides). Without `frames` an agent run tweens its scope's keys only (`target: 'frame'` poll-fails
  "needs frames": the playhead is the user's); `session.tools.tweenTarget`/`keyTarget` are not read. User runs with
  `frames` leave the overrides alone; without `frames` they are unchanged. `key.convert` under an agent converts the
  scope's keys only (no "keys at the current frame" fallback).
- **MAI-P1-3 `clip.duplicate {activate}` defaults to false**, the shipped behaviour (the shipped duplicate never
  activated the copy; §4.10's "default true: the shipped behaviour" holds for `clip.new` only). `name` is validated
  like `clip.rename` (and must be unused). `activate: true` for agents is a View change (P3 runs it with `access:
  'view'`, MAI-D0-24).
- **MAI-P1-4 Deterministic static values.** A curve that loses its last key through `key.delete` or `key.retime
  {deleteTime}` keeps its value at the **clip's range start** as `staticValue` (the shipped `deleteKeys` keeps the
  value at the user's current frame, which an agent run must not read; the result is the same live and headless).
  `key.delete` without `frames` and `range` deletes every key of the targets; both → refusal.
- **MAI-P1-5 `key.write`.** A locked, non-keyable or Graph-Editor-locked channel in `keys` poll-fails naming it
  (`fk.lowerArm.L.rx is locked`); `poseAt` keys `keyChannelsOf(…, 'all')` without the session's channel choice
  (keyAll: false modes such as `@ikFk` stay unkeyed) and skips locked curves; `poseAt.channels: 'selected'` is
  refused (it reads the user's Channel Box selection). Explicit `inType`/`outType` also apply to a key already at the
  frame; an explicit `breakdown` sets the flag on it. Empty `keys` → refusal.
- **MAI-P1-6 `key.retime`.** Breakdowns are not edited keys: they follow their anchors proportionally (M2A-SPEC
  §5.12) and stay where they are with `retimeBreakdowns: false` (a key moving past one then stops short of it:
  `clamped`). `offset` is not snapped (the spec snaps `scale` and `warp`). `deleteTime` reports the keys it removes
  in `merged`. Only an offset or a scale of every keyed curve of the clip moves the contact frame (clamped into the
  range). `wrap` (loop clips) is the cyclic offset: a shape-preserving key at the old time that lands on the range
  start, a seam key at the range end that repeats the start key dropped (the start key takes its in side), times
  modulo the range length (the later old key wins a collision), the new start key repeated at the range end.
- **MAI-P1-7 `key.adjust`.** Offset kinds: `rotate` = rx/ry/rz and angle attributes, `translate` = tx/ty/tz,
  `scale` = sx/sy/sz, `attr` = every other attribute. Stored handle slopes scale by the effective factor
  `1 + w·(factor − 1)` on every key (tangent types, `dt`, weights and broken flags stay). `mean` samples the whole
  frames of the range. The §5.5 bound counts the keys inside the range and its falloff (or at the frames).
- **MAI-P1-8 `pose.setAt {mode: 'propose'}` writes an override for every edited channel**, also on channels
  without keys, where the editor's `applyChannelEdits(…, key: 'none')` would set a static value (a proposal must
  never change the document: one override-only step, discarded by a frame change, keyed with `S`). It needs the
  clip to be the active clip of the **active character** (the history records override steps there) at its current
  frame. In key mode the synced axes read the keyed values before any write and skip locked axes silently; an
  explicit `tangent` also applies to a key already at the frame. Empty `edits` → refusal.
- **MAI-P1-9 `pose.goals`.** A bone's aim axis is the direction to its humanoid child (Seed-san's `forearm.L` has a
  twist node first), else to its first child node, else the parent line; the humanoid `head` looks forward (+Z), so a
  head aim is a look direction. `keepTwist: false` starts from the rest orientation relative to the current parent.
  `split` turns the neck by `neck / (neck + head)` of the weighted turn and the head completes it. "FK at the frame"
  is `ikFk < 0.999` (a blended limb also needs `ensureIk: 'auto'`); `'auto'` also removes `@ikFk` keys strictly
  inside `(start − 1, end + 1)` besides the four it writes (step tangents), so the switch holds over the range. `pole`
  is the pole control's position in character space. `reached` = error ≤ 1 mm; aims run before IK goals; a bone
  aimed twice, a limb placed twice, more than 64 aims → refusal.
- **MAI-P1-10 `pose.transfer`** keys the keyable, unlocked TRS channels and keyAll attributes; with `mirror` it keys
  the controls `mirrorPose` writes (the counterparts). Empty `controls` → refusal.
- **MAI-P1-11 `clip.makeLoop`.** Root travel = tx/tz of the in-place node's driver (hips → `fk.hips`) and of its
  space parents (`cog`, `root`). Every method sets `loop` and cycle infinities (`cycleOffset` on travel curves with
  `rootTravel: 'cycleOffset'`); `inPlace` removes the linear travel with every method (also `cycleOnly`). `matchEnds`
  gives both seam keys fixed handles with the start key's out slope, so C¹ holds whatever the tangent types compute
  (E2E-M2A-23's 1e-9). `blend` bakes one key per whole frame of the tail, smoothstep toward the start pose continued
  along its slope, then matches. Stepped seams keep their tangents. `SeamMetrics`: c0 = |v(end) − v(start)| (0 on a
  cycleOffset travel curve), c1 from the resolved slopes, `worst` ≤ 5 rows; travel curves kept with `keep` are not
  measured. The step label is `Make Loop "<clip>" (<method>)` (the args have no `label`, §4.10).
- **MAI-P1-12 `edit.revertSteps`.** Keys (and most tables) merge per record, so their `skippedFields` rows carry
  `fields: null`; a curve created by a reverted step and still used by a later key stays and is reported. A step
  with no write is listed in `skipped` (`changed since` when something was skipped, else `nothing to revert`).
  `edit.restoreDocument` also refuses agent runs in its poll (besides the policy).
- **MAI-P1-13 Bounds.** Frame arguments lie in ±100,000 and an extended range spans ≤ 100,000 frames for every run of
  the new operators (they are internal); the span limits of the shipped operators (`graph.curves.simplify` over a
  curve's key span, `rig.ikFk.matchRange`'s range, `clip.makeLoop`'s clip, `key.adjust {pivot: 'mean'}`) apply to
  agent runs only, user runs are unchanged. An agent `rig.ikFk.matchRange` needs `clip` and `range` (poll otherwise).
- **MAI-P1-14 `graph.key.insert`** under an agent snaps to whole frames always and selects nothing; `clip.delete`
  under an agent writes no session field: the keeper re-points `activeClip` to the character's first clip (the
  shipped user path picks the next sibling and clamps the frame).
- **MAI-P1-15 Files.** `key.convert` lives in `breakdown.ts`, which §8.1 does not list; it is an animation file
  without an M6a owner, migrated here. New P1 files: `agentCommon.ts`, `scoped.ts`, `agentImpl.ts`, `agentLoad.ts`,
  `workflows/goalTargets.ts`.
- **MAI-P1-16 First-visit size.** The applies and the four workflows load on first use (`agentLoad.ts`, an 8.4 kB
  gzip lazy chunk, the `loadWritePath` pattern), polls stay eager so poll answers do not depend on the load. Measured
  2026-10-20 (`pnpm --filter web build`, `check:size`): **858,807 B**, D0 848,367 B: +10,440 B gzip -9 (8,807 B over
  the 850,000 B target; the 900,000 B gate holds with 41,193 B headroom). Eager minified bytes per new or grown file
  (source-map attribution): `agentPose.ts` 8.8 kB, `agentKeys.ts` 8.5 kB, `agentCommon.ts` 4.3 kB, `revert.ts` 2.6
  kB, `scoped.ts` 2.2 kB, plus the migrations in `graph.ts`, `tween.ts`, `clip.ts`, `ik.ts`. All of it is poll and
  definition code. **Needs explicit acceptance by INT or the owner** (with MAI-D0-22). A contract PR exporting
  `loadAgentImpl` from the editor-core root would let hosts prefetch on pairing (the first agent edit waits for one
  chunk otherwise).
- **MAI-P1-17 Policy test (agent-tools).** As the test said, P1 pins its outcomes: the hand-written arguments of the
  seven explicit-target operators now name real targets (they ran to refusals on empty lists in D0), `EXPECTED_P1`
  pins every scope-ready, explicit-target and gated operator's outcome (patterns for generated ids and the solved
  aim), the stub test checks P1's poll reasons, and the coverage test requires a pinned outcome and `runScope: true`
  for every scope-ready operator. `READY.p1` is `true` in all five M-AI packages.
- **MAI-P1-18 Reads for reports.** `hiddenByOverrides` (and `pose.setAt` propose) read the session's overrides,
  active clip and current frame — reads for the §5.12 report, never writes.

## Tests added

editor-core 66 (`test/agent/`: keys 21, pose 11, loop 6, revert 5, scope 23 — per operator: poll, apply,
undo/redo exact as one `AI:` step carrying the actor, stored units, explicit targets only with a simulated user
selection, band and override, out-of-range frames and `extendRange`, the limits; pose-to-pose blocking at f0 then f10
on a fresh clip keeps both poses and a one-axis edit keys all three rotation axes; static mode skips animated
channels; propose is one override-only step at the user's frame; `key.adjust` pivots, offsets per kind, falloff,
slope scaling, skips; `key.retime` snap collisions, insert/delete time, wrap on a loop, proportional breakdowns, the
contact frame; `clip.makeLoop` seams, travel modes, dry run; `edit.revertSteps` around a user step and with a field
the user changed; `edit.restoreDocument`; every scope-ready operator gives the user-selection result under the
scope and refuses without one; the actor-safe migrations and the clip options). headless-tests 13
(`ops.agent.test.ts`: aims within 0.5° on Seed-san and Polybot over the wave script's seven frames; IK legs within
1 mm and an out-of-reach goal reported; `ensureIk: 'never'` refusal on an FK limb and the IK-driven aim refusal;
`'auto'` on both samples' arms: within 1 mm, FK keys outside `[start − 1, end + 1]` byte-identical, `@ikFk` 0/1/1/0
step keys, one exact undo step; a Polybot walk's seam closed by `matchEnds` and `blend` (C0 1e-6, C1 1e-9, pose at
24 = pose at 0), `cycleOffset` and `cycleOnly`; an agent Match Range on its own clip). agent-tools: the policy test's
P1 pins (54 tests, 0 skipped of P1's).

## Gates

See the final report of this work package (recorded below when run).
