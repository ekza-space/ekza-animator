# P1 — Explicit-target operators and the run scope (M-AI)

Branch `mcp/operators-scope` (worktree `mcp-operators-scope`), on top of `mcp/spec` with `mcp/contracts-foundation`
(D0) merged. Binding definition: [MCP-SPEC §8 P1](../MCP-SPEC.md#p1--explicit-target-operators-and-the-scope-editor-core),
§4.10, §5.5–§5.7, §5.13–§5.14. The spec names this file `mai-operators-scope.md`; the build orchestration asked for
`mcp-operators-scope.md`.

## What landed

| Item (§8 P1) | Where | State |
|---|---|---|
| The ten §4.10 operators | `editor-core/src/operators/builtin/{agentKeys,agentPose,agentClip,revert}.ts` (definitions; `revert.ts` also its polls), `agentLoad.ts` (the eager side: the definition factory with the two-phase poll, the loader, the §5.5 constants); loaded on first use: `agentKeyChecks.ts` and `agentPoseChecks.ts` (full polls and plans), `agentImpl.ts` (applies, the loop poll, `AGENT_POLLS`, the merge key writer), `agentCommon.ts` (shared checks) | working; D0's stubs are gone |
| Workflows | `editor-core/src/workflows/{goals,goalTargets,loop,retime,adjust}.ts` | aim math and IK goal placement, the IK range switch, loop methods and seam metrics, value adjustment, cyclic offset and deterministic time edits (`warp` is stretch: poll-fails "not available yet") |
| The twelve scope-ready operators | `graph.ts` (tangent set/break/unify/lockWeight, setWeighted, infinity, setFields, simplify, Euler filter), `tween.ts` + `edit/tween.ts` (`key.tween {frames}`), `breakdown.ts` (`key.convert`), `mirrorAnimation.ts`; target resolution in `operators/builtin/scoped.ts` | user runs unchanged (every shipped test green); agent runs read the `RunScope` |
| Actor-safe migrations | `graph.key.insert` (`graph.ts`), `clip.delete` (`clip.ts`), `rig.ikFk.matchRange {clip}` (`ik.ts`, `workflows/ik.ts` `limbContext` explicit clip and frame) | the D0 `[P1]` gates of the policy test run green |
| `clip.new {loop, activate}`, `clip.duplicate {name, activate}` | `clip.ts` | working |
| Labels through `label` args, `hiddenByOverrides`, the §5.5 limits | `agentLoad.ts`, `agentCommon.ts` and the operators | working |
| Tests | `editor-core/test/agent/{support,keys,pose,loop,revert,scope,load}.test.ts`, `headless-tests/test/ops.agent.test.ts`, `agent-tools/test/policy.test.ts` (P1's pinned outcomes), `*/test/ready.ts` (`p1: true`) | green |

DoD: every §8 P1 test is green (list below); no shipped test changed; the policy test passes with the `runScope:
true` entries (it also checks that every scope-ready operator has one).

## Decisions and deviations (INT copies them to DECISIONS-OPEN §N as MAI-P1-n)

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
  "needs frames": the playhead is the user's); `session.tools.tweenTarget`/`keyTarget` are not read. **Fix round 1:**
  user runs with `frames` also plan from the keyed values (§4.10 "the playhead is not read"), so they neither read nor
  drop the overrides of the current frame (a key written there under a user override shows once the frame changes,
  like any `frames` key); without `frames` they are unchanged. `key.convert` under an agent converts the scope's keys
  only (no "keys at the current frame" fallback).
- **MAI-P1-3 `clip.duplicate {activate}` defaults to false**, the shipped behaviour (the shipped duplicate never
  activated the copy; §4.10's "default true: the shipped behaviour" holds for `clip.new` only). `name` is validated
  like `clip.rename` (and must be unused). `activate: true` for agents is a View change (P3 runs it with `access:
  'view'`, MAI-D0-24).
- **MAI-P1-4 Deterministic static values.** A curve that loses its last key through `key.delete` or `key.retime
  {deleteTime}` keeps its value at the **clip's range start** as `staticValue` (the shipped `deleteKeys` keeps the
  value at the user's current frame, which an agent run must not read; the result is the same live and headless).
  **Fix round 1:** `key.delete` needs exactly one of `frames` and `range` (§4.10 "nothing else"): neither poll-fails
  `expects frames or range (key.delete deletes only the keys at frames or inside a range)`, both `expects frames or
  range, not both`. P2's `keys_delete` without `frames`/`rangeFrames` passes the range it means (for example the clip
  range) explicitly.
- **MAI-P1-5 `key.write`.** A locked, non-keyable or Graph-Editor-locked channel in `keys` poll-fails naming it
  (`fk.lowerArm.L.rx is locked`); `poseAt` keys `keyChannelsOf(…, 'all')` without the session's channel choice
  (keyAll: false modes such as `@ikFk` stay unkeyed) and skips locked curves; `poseAt.channels: 'selected'` is
  refused (it reads the user's Channels panel selection). Explicit `inType`/`outType` also apply to a key already at the
  frame; an explicit `breakdown` sets the flag on it. Empty `keys` → refusal.
  **Fix round 1:** the keys are written per curve in one merge pass (each curve read once, the items merged in call
  order, a later item at a frame wins); `pose.transfer`, `pose.setAt {mode: 'key'}` and agent `rig.ikFk.matchRange`
  runs share the writer. 50,000 keys on one curve take ≈ 0.2 s (one `writeKeyAt` curve scan per key: 8,000 keys 21 s,
  50,000 ≈ 14 min); a 5,000-frame `pose.transfer` ≈ 20 ms (≈ 50 s before). `written` counts each channel and frame
  once (two items on one frame write one key).
- **MAI-P1-6 `key.retime`.** Breakdowns are not edited keys: they follow their anchors proportionally (M2A-SPEC
  §5.12) and stay where they are with `retimeBreakdowns: false` (a key moving past one then stops short of it:
  `clamped`). `offset` is not snapped (the spec snaps `scale` and `warp`). `deleteTime` reports the keys it removes
  in `merged`. Only an offset or a scale of every keyed curve of the clip moves the contact frame (clamped into the
  range). `wrap` (loop clips) is the cyclic offset: a shape-preserving key at the old time that lands on the range
  start, a seam key at the range end that repeats the start key dropped (the start key takes its in side), times
  modulo the range length (the later old key wins a collision), the new start key repeated at the range end.
  **Fix round 1 (§5.5):** the poll counts the keys the call moves or deletes (offset and scale: every key of the
  target curves, breakdowns that stay with `retimeBreakdowns: false` excepted; insert/delete time: the keys after
  `at`; `wrap`: three seam keys per curve more) and refuses above 50,000 (`The call would move more than 50000 keys`);
  every moved key must land within ±100,000 frames and at most 100,000 frames outside the clip range (`A key would
  land at frame 9900000, outside ±100000 frames`, `… more than 100000 frames outside the clip range a…b`). Both bounds
  hold for every run (the operator is internal). At the bound the retime modes take 0.1–0.5 s.
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
  **Fix round 1 (§5.5):** the poll counts the keys the call would write before planning — per animated, unlocked base
  curve the two seam keys, every key of a travel curve made in place, and for `blend` (not on cycleOffset travel
  curves) one baked key per whole tail frame plus the tail-start key and the keys inside the tail — and refuses above
  50,000 for every run (`Blending would write more than 50000 keys; pass fewer blendFrames`): the 81-curve blend that
  baked 810,164 keys in 52.5 s is refused in milliseconds.
- **MAI-P1-12 `edit.revertSteps`.** Keys (and most tables) merge per record, so their `skippedFields` rows carry
  `fields: null`; a curve created by a reverted step and still used by a later key stays and is reported. A step
  with no write is listed in `skipped` (`changed since` when something was skipped, else `nothing to revert`).
  `edit.restoreDocument` also refuses agent runs in its poll (besides the policy).
  **Fix round 1:** a step named twice is reverted once and counted once in both labels (`AI: Revert 1 step`).
- **MAI-P1-13 Bounds.** Frame arguments lie in ±100,000 and an extended range spans ≤ 100,000 frames for every run of
  the new operators (they are internal); the span limits of the shipped operators (`graph.curves.simplify` over a
  curve's key span, `rig.ikFk.matchRange`'s range, `clip.makeLoop`'s clip, `key.adjust {pivot: 'mean'}`) apply to
  agent runs only, user runs are unchanged. An agent `rig.ikFk.matchRange` needs `clip` and `range` (poll otherwise).
  **Fix round 1:** an agent Match Range also poll-fails above 50,000 keys (frames × the side's keyable channels: `The
  match would write more than 50000 keys (6001 frames × 12 channels); pass a shorter range`) and writes through the
  merge writer (2,000 frames: 2.6 s → 0.3 s); `limbContext` with an explicit clip and no frame takes the clip's range
  start, so the agent path reads nothing of the session. `key.adjust {frames}` and `key.delete {frames}` match keys by
  a sorted search (`frameMatcher`, `workflows/adjust.ts`): 50,000 keys at 50,000 frames 7.3 s → 0.16 s.
- **MAI-P1-14 `graph.key.insert`** under an agent snaps to whole frames always and selects nothing; `clip.delete`
  under an agent writes no session field: the keeper re-points `activeClip` to the character's first clip (the
  shipped user path picks the next sibling and clamps the frame).
- **MAI-P1-15 Files.** `key.convert` lives in `breakdown.ts`, which §8.1 does not list; it is an animation file
  without an M6a owner, migrated here. New P1 files: `agentCommon.ts`, `scoped.ts`, `agentImpl.ts`, `agentLoad.ts`,
  `agentKeyChecks.ts` and `agentPoseChecks.ts` (fix round 1), `workflows/goalTargets.ts`.
- **MAI-P1-16 First-visit size.** **Fix round 1:** everything of the explicit-target operators but their definitions
  loads on first use: the full polls moved behind the lazy chunk (`agentKeyChecks.ts`, `agentPoseChecks.ts`, the loop
  poll in `agentImpl.ts`; MAI-P1-19), and so did `revert.ts`'s applies and the agent Match Range bound. Measured
  2026-10-20 on this machine with the same Next cache, `ANIMATOR_SOURCE_MAPS=1` builds and `check:size`: D0
  (`523228b`, rebuilt for the comparison) 848,490 B; P1 before the round 858,930 B (+10,440 B); **P1 now 853,613 B:
  +5,123 B gzip -9 over D0, 3,613 B over the 850,000 B target, the 900,000 B gate holds with 46,387 B headroom**;
  without source maps (the gate's build): 853,487 B, +5,120 B over D0's 848,367 B. What stays eager (minified bytes
  over D0, source-map attribution): `doc/src/undo/restorePlan.ts` +3,689 with its helpers in `doc/src/store`
  (`memory.ts`, `rows.ts`, `references.ts`, `patchUndo.ts`, ≈ +0.9 kB) — not P1 code: `memory.ts` imports
  `RESTORE_HOST` from `restorePlan.ts`, so the whole module joins the first-visit chunk as soon as anything uses
  `planRestore`, even from a lazy chunk; the scope migrations of the user-facing operators (`scoped.ts` +2,194,
  `scope.ts` +620 (D0's helpers, now used), `tween.ts` +1,145, `ik.ts` +891, `clip.ts` +814, `graph.ts` +490,
  `breakdown.ts`, `mirrorAnimation.ts`, `workflows/ik.ts` ≈ +0.8 kB); the eager definitions (`agentLoad.ts` +1,416,
  `revert.ts` +1,480, `agentKeys.ts`/`agentPose.ts`/`agentClip.ts` ≈ +650). Two contract PRs outside P1's files would
  shrink it further (INT's call): (1) **doc**: move `RESTORE_HOST` into its own module (`doc/src/undo/restoreHost.ts`,
  re-exported by `restorePlan.ts`; `memory.ts` imports it from there) — measured on a scratch copy of this branch
  without source maps: 852,418 B against the branch's 853,487 B, −1,069 B; (2) **editor-core root**: export
  `loadAgentImpl` so hosts prefetch the chunk at pairing (MAI-P1-19). **What remains still needs explicit acceptance
  by INT or the owner** (with MAI-D0-22).
- **MAI-P1-17 Policy test (agent-tools).** As the test said, P1 pins its outcomes: the hand-written arguments of the
  seven explicit-target operators now name real targets (they ran to refusals on empty lists in D0), `EXPECTED_P1`
  pins every scope-ready, explicit-target and gated operator's outcome (patterns for generated ids and the solved
  aim), the stub test checks P1's poll reasons, and the coverage test requires a pinned outcome and `runScope: true`
  for every scope-ready operator. `READY.p1` is `true` in all five M-AI packages.
- **MAI-P1-18 Reads for reports.** `hiddenByOverrides` (and `pose.setAt` propose) read the session's overrides,
  active clip and current frame — reads for the §5.12 report, never writes.
- **MAI-P1-19 Two-phase polls (fix round 1).** Before the implementation chunk has loaded, an explicit-target
  operator's poll answers the shape check only (`expects { clip, … }`, a read-only document, `The clip does not
  exist`) and starts the load; once it has loaded, the full check. Runs are unaffected: the runner polls again after
  `prepare`, which awaits the load, so a run is refused with the full reason (`load.test.ts` pins both). A bare `poll`
  before the first load — P3's `operator_run {dryRun}` and `operators_list` availability — can answer available where
  the run would refuse; P3 should await the chunk before a dry run (contract PR: export `loadAgentImpl` from the
  editor-core root) or report the run's own refusal. `edit.revertSteps` and `edit.restoreDocument` keep their full
  polls eager; their applies load with the chunk.

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

Fix round 1 added editor-core 12 (now 78: keys 26, pose 12, loop 7, revert 6, scope 26, load 1) and headless-tests 1
(now 14), listed in the table below.

## Fix round 1 (review of 2026-10-20)

| Review item | Resolution | Pinned by |
|---|---|---|
| major: `clip.makeLoop {blend}` unbounded (810,164 keys, 52.5 s) | poll counts the writes up front, refuses above 50,000 (MAI-P1-11) | `loop.test.ts` "refuses a blend that would bake more than 50,000 keys, up front" (81 curves; agent and user refused in < 2 s, document unchanged; a fitting tail runs) |
| major: `key.retime` without write or domain bound | poll counts moved/deleted keys (≤ 50,000) and checks where they land (±100,000, ≤ 100,000 outside the clip range) (MAI-P1-6) | `keys.test.ts` "moves at most 50,000 keys per call" (60,003 keys: offset, scale, insert, delete time refused; a late insert moving 10,001 runs) and "never moves keys beyond ±100,000 frames…" (scale 100 about −100,000, insert at −100,000, offset 99,971; a far clip) |
| major: first-visit size +10,440 B | full polls, revert applies and the Match Range bound behind the lazy chunk (two-phase polls, MAI-P1-19): 858,807 → **853,487 B** (D0 848,367 B: +5,120 B); the doc `RESTORE_HOST` contract PR measured at −1,069 B; the rest **awaits INT/owner acceptance** (MAI-P1-16) | `load.test.ts` (shape check before the load, full reason after, run outcome unchanged) |
| minor: `key.write` quadratic | per-curve merge writer, shared with `pose.transfer`, `pose.setAt` and agent Match Range; Match Range also bounded at 50,000 keys for agents; `key.adjust`/`key.delete` frames matched by search (MAI-P1-5, MAI-P1-13) | `keys.test.ts` "writes 50,000 keys on one curve in one pass" (< 10 s; ≈ 0.2 s), "matches keys against many frames by search" (< 3 s; was 7 s); `pose.test.ts` 5,000-frame transfer; `ops.agent.test.ts` "writes at most 50,000 keys per agent call…" |
| minor: duplicate counts | `edit.revertSteps` label counts unique steps; `key.write` `written` counts unique channel-frames (MAI-P1-12, MAI-P1-5) | `revert.test.ts` "counts a step named twice once…"; `keys.test.ts` "counts each channel and frame once: the later item at a frame wins" |
| minor: user `key.tween {frames}` read the playhead and overrides | `keyed: true` whenever `frames` is present (MAI-P1-2) | `scope.test.ts` "a user tween with frames reads the keyed values too" |
| minor: `limbContext` read the session with an explicit clip | an explicit clip without a frame uses its range start, no session read (MAI-P1-13) | `scope.test.ts` "limbContext with an explicit clip never reads the session" (`getState` spy throws) |
| minor: `graph.tangent.unify` missing from the scope cases | added on a broken key; every case must now change the document (`graph.curves.simplify` got a redundant key) | `scope.test.ts` CASES (15) |
| minor: `key.delete` without frames or range deleted every key | refused: §4.10 "nothing else" (MAI-P1-4; INT may still choose otherwise) | `keys.test.ts` "polls targets, frames xor range" |

## Gates (2026-10-20, local, fix round 1)

`format:check` (1,063 files, no changes), `lint`, `typecheck` (`tsc -b`) rc 0, `check:deps` (18 packages),
`check:licenses` (174 production packages), `check:fixtures` (4) green; `turbo run test test:tooling --force` with
`CI` unset: 19/19 tasks (editor-core 847, headless-tests 187, agent-tools 116 / 1 skipped, editor 355 / 1, viewport
104 / 1, curve-editor 209 / 3, anim-core 650, rig 202, doc 196, io 166, ui 78, doc-yjs 69, mcp-server 13, web 9,
agent-evals 3, motion-analysis 1, schematic-render 1); `turbo run build --force` green; `check:size` **853,487 B** ≤
900,000 B (46,513 B headroom; 3,487 B over the 850,000 B target; MAI-P1-16). E2E with `--project=chrome` (local
Chrome, GPU) on port 3271 (`EKZA_E2E_PORT=3271`) after `pnpm run mcp:build`: P1 has no e2e scenario of its own, so the
full suite ran once against one fresh e2e build: 116 tests, 107 passed, 9 skipped (pre-existing fixmes), 0 failed. The
web server stopped by itself; port 3271 is free; no `ekza-ai-e2e-*` folder is left in `$TMPDIR`. Probes ran from
throwaway test files (deleted).
