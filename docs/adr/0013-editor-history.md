# ADR 0013 — Editor history: document undo plus unkeyed session edits

- Status: Accepted (2026-10-17, design review rev. 2). Extended 2026-10-19 by [ADR 0016](0016-modeling-interaction-paradigm.md)
  D12 (a third, session-only step part for selection and hiding in the Model workspace; `onDrop`/`dropOldest` for
  the mesh undo byte budget; contracts in [M6A-SPEC](../M6A-SPEC.md) §4.6); decisions 1–5 below are unchanged
- Inputs: research [01](../research/01-dcc-animation-features.md) §3.4 (KY-*, CB-02 "changed" state),
  [06](../research/06-collaboration.md) §9 (per-user patch undo), [08](../research/08-extensibility-modeling.md) §5.1,
  [09](../research/09-ui-ux-spec.md) §6.3 (undo granularity); ADR 0002; design review (animator lens).

## Context

As in a leading commercial desktop DCC, a keyed channel edited with auto-key off does not write the document: it
becomes a **session override** (light pink in the Channels panel) that is discarded on frame change and turned into keys
by `S`. v0.1 made overrides non-undoable. In the desktop DCC those edits *are* undoable. With v0.1, an animator who
rotates an arm the wrong way and presses `Z` would undo the previous document transaction — for example a `Set Key` at
another frame — while the bad pose stayed on screen: silent data loss in the most common gesture, and a break of "one
gesture = one undo step".

The document undo stack must stay store-level and collaboration-safe (ADR 0002): per user, compare-before-restore,
covered by the conformance suite. Overrides are U state and must never enter the document (R12).

## Decision

1. `editor-core` owns an **`EditorHistory`** (contract MVP-SPEC §4.5) whose steps interleave two kinds of change:
   - a **document part**: the `txId` of the doc `UndoEntry` the step created (`docTxId`);
   - an **override part**: `{ character, clip, clipFrame, before, after }` for the controls the step changed.
   A step may have either part or both (a drag over a keyed and an unkeyed channel).
2. **Recording**: the operator runner records one step per undoable operator (new doc entry and/or override
   delta); `beginChannelEditGesture` records one step per committed gesture; coalesced transactions and nudges
   with the same `coalesceKey` merge into the previous step. Any new step clears the redo stack.
3. **`edit.undo` / `edit.redo`** pop the newest step. The doc part calls `store.undo.undo()` only if the step's
   `docTxId` is still the top doc entry (it can only differ if the 500-entry limit evicted it), else it is skipped
   with a warning. The override part restores `before` (`after` on redo) when the active clip and clip frame still
   match. Selection snapshots are restored as before.
4. **Lifetime**: override parts are dropped (`dropOverrides`) when their overrides are cleared — clip-frame change,
   clip switch, `file.new/open`. A step left with neither part is removed. Override steps therefore never resurrect
   stale state at another frame. Keying consumes overrides: the key step records that in its own override part
   (override → none), and the earlier steps keep theirs, so undo removes the key, then the edit that made the
   override (amended 2026-10-18 after acceptance round 1: dropping the earlier parts left the typed value as an
   override no step owned, and the next undo skipped it).
5. The doc `UndoManager`, its compare-before-restore rules and the conformance suite are unchanged. Remote and
   import batches never create steps.

## Alternatives

| Alternative | Why not |
|---|---|
| Overrides not undoable (v0.1) | Undo hits an unrelated earlier transaction; the bad pose stays. |
| Write overrides to the document | Violates the D/U/P split and would sync scratch poses to collaborators (06 R12). |
| Push session entries into the doc `UndoManager` | Couples the store contract to editor state and breaks the store-agnostic conformance suite. |

## Consequences

- E2E-24 and US-22 verify "rotate a keyed control with auto-key off, `Mod+Z` restores the pose, keys deep-equal".
- In collaboration (M3) each user's history is local, like the doc stack it wraps.
- A History panel (V1) lists steps with labels; override-only steps are marked "unkeyed".
