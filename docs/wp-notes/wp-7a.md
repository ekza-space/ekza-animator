# WP-7a — editor-core kernel: build notes

Branch `wp/wp-7a`. Scope: MVP-SPEC §7 WP-7a (`packages/editor-core/` except `src/operators/builtin/`,
`src/workflows/`). No contract file changed (`src/types.ts`, `src/operators/args.ts` untouched); no `package.json`
or lockfile change. Additive public exports beyond §7: the types `CoalescingOperatorDef` and `OperatorCoalescing`
(see 16).

## What is implemented

| Responsibility (§7 WP-7a) | Where |
|---|---|
| `createEditorApp` (composition root) | `src/app/createEditorApp.ts` → `src/app/kernel.ts` (`createKernelApp`) |
| Session store, defaults, repair, override lifetime, dirty tracking | `src/session/` (`defaults`, `repair`, `keeper`, `selection`, `location`, `active`) |
| Preferences: defaults, persistence through `services.storage` (versioned JSON, try/catch, per-field validation) | `src/prefs/` |
| Operator registry and runner (§4.11.0) | `src/operators/registry.ts`, `src/operators/runner.ts` |
| Contribution registries and `contribute` | `src/registries/registry.ts`, `src/app/kernel.ts` |
| Editor history (ADR 0013) and doc-entry capture | `src/history/` (`history`, `capture`, `overrides`) |
| Edit kernel helpers | `src/edit/channels.ts`, `src/edit/keys.ts` (+ `context`, `channelMeta`) |
| Keymap manager, `MAYA_KEYMAP`, labels | `src/keymap/` |
| Tool registry | `src/tools/registry.ts` |
| Character registry (async runtimes, recompile, display models, events) | `src/characters/` |
| Evaluation service | `src/evaluation/` |
| Playback clock | `src/playback/clock.ts` |
| Memory asset store (async verify) | `src/services/assets.ts` (also the fake services' asset store) |
| Numeric input parser and display helpers | `src/edit/numeric.ts` |
| `testing` subpath (from WP-0b) | `src/testing/` |

Tests: `packages/editor-core/test/kernel/*.test.ts` (unit + fast-check property tests: history undo-all/redo-all
over random sessions, shape-preserving insert over random curves of every tangent type, numeric round trips) and the
existing kit tests in `test/testing/`, plus property tests for `moveKeys`/`scaleKeys` (curves stay ordered, no
crossing while dragging, unique times after the final update). `test/kernel/create-editor-app.test.ts` exercises
`createEditorApp` over the real packages and **skips itself until WP-1, WP-2 and WP-3 are merged** (probes for
`not-implemented`; §8.1); its model-import case also waits for **WP-4**.

**Integration check against the sibling branches** (not merged; done by temporarily checking out
`wp/wp-1` anim-core, `wp/wp-2` doc, `wp/wp-3` rig and `wp/wp-4` io into this worktree, then restoring them): all
editor-core tests pass, including the 7 gated real-package cases — AnimX evaluation of the wave clip, shape-preserving
insert, rig compile + pose evaluation once per change, exact undo-all/redo-all over `createMemoryStore` (operators,
gestures, direct commits, store coalescing, `undoable: false` camera navigation), partition close/reopen keeping the
history, and asynchronous runtime creation from `seed-san.vrm` through the asset store (`parseGlb`,
`skeletonFromGltf`, `autoRig`, `writeRigDefinition`). The partition case failed with the first kernel version (see
15), which is why it exists.

## Design decisions and deviations (please review)

1. **Dependency seam (`KernelDeps`, `src/app/deps.ts`).** The kernel calls its sibling packages (doc scene clock and
   memory store, anim-core curve engine and shape-preserving insert, rig curve cache / sampler / compiler /
   overrides, io parse + skeleton) through one internal bindings object. `createEditorApp` binds the real
   functions; the test kit binds naive stand-ins. Not exported from the package entry.
2. **The fake app now runs the real kernel.** `createFakeEditorApp` = `createKernelApp` over naive bindings (naive
   store, naive curve engine, naive FK program, naive insert consistent with that engine). The kit's former private
   runner/history/playback/evaluation copies are gone, so panels tested with the fake app see production behaviour.
   Documented defaults kept (B-18): strictPut store, first character and first clips active, `firstRunDone: true`,
   platform `other`, no operators, runtimes only with a `skeleton`, `calls` recording. Changes visible to kit users:
   - the `maya` keymap is contributed (it was an empty preset before);
   - `evaluation.tick()` returns false when no pose changed (e.g. no characters) — the §4.5 contract;
   - a frame change drops override history parts (spec §4.11.0 / ADR 0013 §4), see 4.
3. **History captures every local undoable commit.** Inside an operator's apply or a gesture commit the doc entry
   goes into that ONE step; any other local commit (a panel's `store.transact`, a Graph Editor / time-slider
   `beginPreview(...).commit()`) becomes a step of its own, labelled by the batch. Without this, Mod+Z would skip
   doc entries no step owns. Coalesced commits extend the owning step; coalesced edits that cancel out remove the
   step's doc part; `undoable: false` commits add nothing and keep the redo stack. WP-5/6/6t/9 therefore do not
   call `history.record` for plain transactions or previews.
4. **Override lifetime is a kernel invariant.** Whenever a character's active clip or clip frame changes (scrub,
   playback clock, clip switch, clip settings, scene fps, document load) its overrides leave the session and the
   history (`dropOverrides`). Operators need not do it.
5. **Runner rule 7 clarifications** (cf. DECISIONS-OPEN B-23): an operator that navigated the history
   (`edit.undo`/`edit.redo`) records no step; override deltas are recorded for any operator, but only when the
   active character, clip and clip frame are the same before and after `apply` (a run that moved time had its
   overrides discarded); when a step writes the document and consumes overrides (keying), earlier steps lose their
   override parts for those controls (§4.11.1 rule 5) and the new step's delta restores them on undo.
6. **Session repair** after every committed batch: an active character when any exists, a live active clip per
   character (first clip as fallback), selection / overrides / feet pins without deleted ids, `dirty` set by commits
   and cleared by loads, project name taken on load. `restoreSelection` drops ids that no longer exist.
7. **Playback**: real time with frame dropping from the elapsed time; integer active-clip frames when
   `snapToFrames` (floor in the play direction); `loop` wraps into `[start, end)` like clip evaluation (§4.11.8), so
   the end frame is not shown twice in a closed loop; `once` stops at the end and starts over when played at the
   end; `oscillate` bounces and writes `time.direction`; a frame outside the range moves into it on start; a frame
   set during playback continues from there.
8. **Keymap**: precedence on equal chord + scope + trigger = user overrides > preference bindings (Space tap =
   `time.togglePlay` when `spaceBehaviour: 'play'`) > contributions (latest first); a more specific scope always
   wins. Auto-repeat fires only `time.step`, `time.prevKey/nextKey`, `view.manipulatorSize`, `edit.undo/redo`.
   `keymap.setOverrides` writes `prefs.keymapOverrides` and vice versa. Labels: US key names, macOS symbols
   `⌃⌥⇧⌘`. `MAYA_KEYMAP` is contributed by `registerBuiltins` (WP-7b, §7): until 7b lands, `createEditorApp` has
   no key bindings.
9. **Display models**: `app.services.models` is a wrapper whose loads wait for `setRenderer`; hosts must call
   `app.services.models.setRenderer(gl)` on the app's services, not on the loader they passed in.
10. **Edit kernel interpretations**:
    - `applyChannelEdits` does not toast (it runs on every drag update); `beginChannelEditGesture` toasts skipped
      channels once on commit; operators toast from `result.skipped`. Unknown controls and non-finite values throw
      `invalid-record`; a character without an active clip throws `unsupported`.
    - Handle "length" (`setKeyHandle`): weighted curves keep the Maya weight `3·hypot(|dt|/fps, dv·k)`
      (weight-locked keys, the collinear opposite side); non-weighted handles keep `|dt|` (direction only matters).
      A handle dragged across its key becomes vertical. Weighted unlocked `dt` is limited to the span by scaling the
      handle (angle kept).
    - `moveKeys` stops a run of moved keys as a block at a non-moved neighbour; two moved keys snapping onto one
      frame keep the one nearer the landing time (scale: the one farther from the pivot, as specified).
    - Locked curves (`CurveRecord.locked`) are skipped by move/scale/tangent/handle/delete; `insertKeyOnCurve`
      throws `unsupported` on them. Inserting on a key-less curve keys its static value with the default tangents.
    - Gestures register per app; `cancelChannelEditGestures(app)` (`src/edit/channels.ts`) cancels them for
      `edit.escape`, including override-only gestures whose preview is empty.
11. **Numeric input** returns display units: `rad` converts to degrees, `deg`/`°` are display units, `*`/`/` take
    no unit, a decimal comma is accepted when there is no point, U+2212 counts as minus.
12. **IDs**: `idSource` seeds the kernel's records and is also set as doc's default source while the app lives (so
    other packages' `newId()` calls are seeded under `?e2e=1`); `dispose` resets it.
13. Channel facts (`isRotation`, `channelDefault`, TRS slots) are local constants mirroring doc's
    `isRotationChannel` / `defaultChannelValue` so numeric display has no app-level dependency.
14. Platform defaults to `'other'`: headless code cannot inspect the browser; the editor passes the platform.
15. **Document loads vs partition batches.** WP-2's memory store also emits `origin: 'load'` batches when a
    partition is opened or closed and when a write reveals records of an unopened partition; those leave the doc
    undo stacks alone, while `store.load` clears them. The kernel treats a `'load'` batch as a document load only
    when both doc undo stacks are empty afterwards (`src/session/loads.ts`): only then is the history cleared, the
    session marked clean and the project name taken; partition batches still repair the session and re-evaluate.
    Separately, whenever the doc undo stacks become empty (e.g. a `load` that changed nothing visible and so emitted
    no batch, or `undo.clear()`), every history step loses its document part.
16. **Coalescing operators** (runner rule 7 needs a way for an operator to coalesce, e.g. Channel Box ↑/↓ nudges
    through `channel.setValues`): an operator definition may carry `coalesce(args) → { key, ms } | null`
    (`CoalescingOperatorDef`, exported). The runner passes `coalesceKey`/`coalesceMs` to its transaction, so the store
    merges the document part, and records the step with that `coalesceKey`, so override-only steps merge in the
    history within the same window. Without `coalesce` nothing changes.
17. **Coalescing is recognised by entry identity**: a commit counts as coalesced only when the doc undo top keeps
    its `txId` but is a new entry object (what both the naive store and WP-2's `PatchUndoManager` do), so an
    `undoable: false` commit touching the same fields as the top entry no longer extends that step or clears the
    redo stack (cf. B-23).
18. **`edit.escape` during a gesture** (§4.11.0 rule 3 exception): the runner lets `edit.escape`
    (`GESTURE_SAFE_OPERATORS`) run while a preview is active, so Esc can cancel it, and records no step for any run
    that started during a gesture. Every other operator still gets `cancelled: 'gesture in progress'`.
19. A step's label is the final label of its new doc entry, so `tx.annotate({ label })` inside `apply` names the
    step ("Delete 3 Keys"); otherwise `undoLabel(args) ?? label`.
20. A gesture whose `preview.commit` throws ends like a cancel (overlay dropped, overrides restored, no step) and
    rethrows.
21. An override delta holds only the controls of the character it is located at (the active one): it restores at
    that character's clip frame, so another character's values in it could return at a frame they no longer belong
    to (ADR 0013 §4). Override edits of other characters in the same run are not undoable; the MVP limits selection
    to one character, so edits normally target the active one.

## Notes for other work packages

- **WP-7b**: build on `createKernelApp` internals from the same package — `newRecordId(app, kind)`
  (`src/app/internals.ts`) for record IDs, `writeKeyAt`/`ensureCurve` (`src/edit/keys.ts`),
  `cancelChannelEditGestures` for `edit.escape`, `activeLocation` (`src/session/location.ts`). `registerBuiltins`
  must contribute `MAYA_KEYMAP`. `file.new`/`file.openProject` get history clearing and session repair from the
  kernel on the `load` batch. `edit.escape` runs during gestures (18) and must not write the document while a
  preview is active; `channel.setValues` should declare `coalesce` for Channel Box nudges (16).
- **WP-2**: the kernel assumes the memory store records a local batch's undo entry before emitting the batch (the
  naive store does; a lazy fallback attributes the entry at the next history access otherwise), that coalescing
  keeps the entry's `txId` in a new entry object (17), and that partition batches leave the undo stacks alone (15).
  All three hold for `wp/wp-2` as of ca9777a.
- **WP-8**: call `app.services.models.setRenderer` (see 9); pass `KeyInput.repeat`; editor-core imports io's
  headless entry at runtime, so once WP-4 lands the editor's Vitest `optimizeDeps.include` may need io's runtime
  dependencies (`@gltf-transform/*`, `fflate`) to avoid mid-run reloads (B-21).
- **WP-5/6/6t/9**: plain `store.transact` and preview commits become history steps automatically (3); channel
  edits go through `beginChannelEditGesture` / `applyChannelEdits`; `characters` 'recompiled' replaces a runtime's
  program, channel and pose buffers in place (same runtime object). WP-9 nudges: run `channel.setValues` and let
  WP-7b give that operator a `coalesce` (16).

## Requested contract changes and clarifications

- §4.11.0 runner rule 7: add the history-navigation exception and the same-location condition for override deltas
  (5 above).
- §4.11.0 editor history: state that direct local commits outside operators and gestures become steps (3 above).
- §4.5 `EvaluationService.tick`: "returns true when any pose changed" — the kit previously returned true on the
  first tick regardless.
- §4.11.0 rule 3: exempt `edit.escape` from the "gesture in progress" cancel, and record no step for it (18).
- §4.5 `OperatorDef`: add `coalesce?(args: A): { readonly key: string; readonly ms: number } | null` (16); until
  then editor-core exports `CoalescingOperatorDef`.
- §4.2: say whether partition open/close and revealed records are announced with `origin: 'load'` (WP-2 does) or
  with a distinct origin; the kernel copes with both (15).

## Gates (run in this worktree)

`format:check`, `lint`, `typecheck`, `check:deps`, `test` (all packages; editor's browser tests use the new fake
app), `build`, and `test:e2e` on port 3108 (00-webgl, dev-panels, tailwind-smoke): all pass. editor-core alone: 317
tests pass, 7 skip until WP-1/2/3(/4) are merged (they pass against those branches, see above).
