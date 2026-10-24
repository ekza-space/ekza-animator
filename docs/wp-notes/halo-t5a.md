# Halo T5a — forms, lint and wrappers (`halo/t5a-forms`)

[STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §5.6, §20.3 items 6–7, §20.4 (`FormDef`), §20.5 test 9, §21 (T5a row).
Decisions: [DECISIONS-OPEN §P](../DECISIONS-OPEN.md#p-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24),
rows ST-T5A-1…12. Studio Pro, Repeat Last / Adjust Last and the agent toolset do not change.

## What landed

| Part | Where |
|---|---|
| Ten public UI wrappers of the AI-only operators, a lazy chunk | `editor-core/src/operators/builtin/uiWrappers.ts` |
| Their ids, argument types (declaration merging into `OperatorMap`) and `loadUiWrappers(app)` | `editor-core/src/operators/builtin/uiWrapperChunk.ts`; exported from the package root |
| Halo-only pre-run forms: `FormDef` typing, 20 forms, `formOf` / `formDefaults` / `formArgs` / `formProblems` | `editor-core/src/forms/{types,defs,index}.ts`; package export `./forms` |
| Agent policy rows: the ten wrappers **denied** | `agent-tools/src/policy.ts` |
| `param-lint` (static + run-time registry checks), its test and violation fixture | `tooling/param-lint.mjs`, `tooling/test/param-lint.test.mjs`, `tooling/test/fixtures/param-lint-violation/` |
| Tests | `editor-core/test/wrappers/*` (18), `editor-core/test/forms/*` (7 + compile-time `@ts-expect-error` cases), `agent-tools/test/ui-wrappers-policy.test.ts` (4) |

### The wrappers (ST-T5A-1)

| Id | Label (Pro name) | Wraps | Session defaults | Undo label |
|---|---|---|---|---|
| `pose.hold` | Hold Pose | `pose.transfer` | from = band start (else playhead), to = band end; controls = selection, else the whole character | `Hold Pose` |
| `pose.pasteAt` | Paste Pose at Frame | `pose.setAt {key}` | frame = playhead; the copied pose (session, else system clipboard), selected controls only when they overlap; playhead not moved | `Paste Pose [Mirrored] at Frame 20` |
| `pose.placeGoal` | Place IK Goal | `pose.goals {ik}` | limb = lead selected control's limb; frame = playhead; an FK limb switches to IK over the band only | `Place Goal (L Arm)` |
| `pose.lookAt` | Look At | `pose.goals {aims}` | bone = head (neck 0.4 / head 0.6), weight 1, keep twist | `Look At` |
| `pose.reach` | Reach | `pose.goals {ik}`, or `pose.setAt {propose}` | `key` = effective auto key (Halo's Rec override); without it the solved limb becomes unkeyed edits | `Reach (L Leg)` |
| `clip.loop` | Make Loop | `clip.makeLoop` | active clip, match ends, cycle offset | `Make Loop "walk"` |
| `key.scaleValues` | Scale Key Values | `key.adjust {factor, pivot}` | targets = selected keys → channels → animated channels of selected controls; range = the selected keys' frames, else the band | `Scale Values ×2` |
| `key.offsetValues` | Offset Key Values | `key.adjust {offset}` | as above; offsets per channel kind in stored units | `Offset Values` |
| `key.offsetInLoop` | Offset in Loop | `key.retime {offset, wrap}` | as above (whole curves); the clip must loop | `Offset in Loop (+5 frames)` |
| `imagePlane.replace` | Replace Image | `imagePlane.delete` + `imagePlane.import` + `imagePlane.set` | keeps name, view, offset, size, opacity, depth, visibility; locked planes refused | `Replace Image` |

Mechanism (ST-T5A-2): a wrapper's poll checks its own arguments in plain words, resolves the explicit arguments from
the session and asks the wrapped operator's poll; its `prepare` runs the wrapped `prepare` (loading the agent
implementation) and the full poll; its `apply` runs the wrapped `apply` inside the wrapper's single transaction and
annotates the wrapper's label. One run is one undo step under the wrapper's label, also for override-only runs (Reach
without Rec). The wrappers declare no ParamDefs (never `lastRun`, never adjustable or repeatable). Agent runs are
refused by the poll (`AGENT_REFUSAL`) as well as by the policy table. Positions are character space, the space of
`pose.goals` (ST-T5A-5).

`solveReach(app, clip, limb, frame, {position, rotation?})` (same chunk) returns the solved channel values without
writing: the drag preview for T7; the test pins that it equals what Reach keys.

### The forms (ST-T5A-9, ST-T5A-10)

`FormDef<K>` is the §20.4 sketch plus two additions: param names may be **dotted paths** into object arguments
(`tolerance.rotationRad`, `range.end`, `params.speed`; a ParamDef is a scalar), and `base` holds fixed starting
values (`library.useClip` starts from the identity `ClipParams`). Kinds, defaults and enum options are typed against the
argument at that path; `test/forms/types.test.ts` has the `@ts-expect-error` cases (`pnpm typecheck` fails if one
compiles).

Forms: `graph.curves.simplify`, `graph.infinity.set`, `key.tween`, `time.insertTime`, `time.deleteTime`,
`pose.mirrorAnimation`, `clip.new`, `rig.ikFk.switch`, `rig.ikFk.matchRange`, `library.useClip` and the ten wrappers.
Defaults are the operator's own when the argument is left out (a form left alone runs what Pro's menu item runs);
`null` with `nullable` means "auto" and is left out of the run arguments.

Run-time API (`@ekza-studio/editor-core/forms`, imported by `packages/halo` only):
- `formOf(id, def)`: the form; else, for a non-adjustable operator with ParamDefs, those (`source: 'params'`); else
  `null` (adjustable operators get after-run chips through `edit.adjustLast`).
- `formDefaults(form)`, `formArgs(form, values, base) → { args, problems }` (coerced like an option box, nested by
  path over the form's and the caller's base), `formProblems(form)`.

### param-lint (ST-T5A-11)

`node tooling/param-lint.mjs` (also `tooling/test/param-lint.test.mjs`, run by `test:tooling`):
- static: only `packages/halo` (and the forms themselves, editor-core tests) import the forms; no `addParams`;
- registry (headless app with every lazy chunk: rig workspace, clip library, Model, agent, wrappers; TypeScript loaded
  through a `typescript` transpile hook): forms name live, non-adjustable operators without ParamDefs, pass
  `assertParams`; the wrappers are registered, public, undoable, labelled, without ParamDefs, have forms, are denied;
- surfaces: once `packages/halo/src/manifest/paramSurfaces.ts` exports `PARAM_SURFACES: { op, surface: 'chips' |
  'form' | 'options' }[]` (T6b), chips need an adjustable operator, forms a FormDef or ParamDefs, and every public
  operator with visible ParamDefs (a Studio Pro option box; 48 today) an `options` surface. Until then: skipped, said
  in the summary.

Today: `param-lint: OK — 20 forms, 10 UI wrappers, 356 operators (48 with an option box); surfaces: not checked until
packages/halo/src/manifest/paramSurfaces.ts exists (T6b)`.

## Patches needed from other packages

1. **T3 (host registrations)**: call `loadUiWrappers(app)` from the host at idle (and from Halo's prefetch), so the
   wrappers are registered for every shell and Studio Pro's search lists them. T5a does not wire it into Pro's eager
   registration or into `lazyOperatorChunk` (`editor-core/src/workspaces/rig.ts`), to keep `/editor` at +0 B; the
   optional `lazyOperatorChunk` line (`if (UI_WRAPPER_IDS.includes(id)) return loadUiWrappers(app);`) costs eager bytes
   and is the integration agent's call (ST-T5A-4).
2. **T2 (contracts)**: optionally move the ten `OperatorMap` rows of `uiWrapperChunk.ts`'s `declare module '../args'`
   block into `operators/args.ts` and delete the block (no behaviour change). Halo's `no-restricted-imports` block must
   allow `@ekza-studio/editor-core/forms`.
3. **T12 (or T2)**: `turbo.json` `//#test:tooling` inputs should add `packages/*/src/**` (param-lint reads the
   packages' sources; today a source change alone can reuse a cached `test:tooling` pass). Optionally a root
   `check:params` script.
4. **T6b**: export `PARAM_SURFACES` from `packages/halo/src/manifest/paramSurfaces.ts` (from the Disclosure Manifest)
   to turn on the surface checks; manifest entries `{ wraps: … }` for the operators reached only through a wrapper.
5. **T7**: Reach for the head and the hips is not in `pose.reach` (`pose.goals` has no spine solve): Look At for the
   head, a Move for the hips, or a new kernel solve (ST-T5A-6).

## Evidence (2026-10-24)

- `editor-core` `test/wrappers` 4 files, 18 passed; `test/forms` 2 files, 7 passed; `tsc -b packages/editor-core` with
  the compile-time cases.
- `agent-tools` `ui-wrappers-policy`, `policy`, `reference`, `manifest`: 66 passed, 2 skipped;
  `docs/agent-tools-reference.md` and `tools.manifest.json` unchanged.
- `node tooling/param-lint.mjs`: OK (above); `node --test tooling/test/param-lint.test.mjs`: 3 passed.
- Gate and sizes: see the last section, filled in after the gate run.
