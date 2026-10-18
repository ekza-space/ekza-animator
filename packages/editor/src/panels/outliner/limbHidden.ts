// M2A-SPEC §5.5 in the Outliner (A2): the controls the IK/FK rule hides at the current frame (FK chains of IK limbs,
// IK controls and poles of FK limbs), dimmed like user-hidden controls. Checked per evaluated pose, so an animated
// ikFk updates the rows: each limb's rule-2 state is compared in place first (no allocation per frame), and the set
// is rebuilt only when one changed; it keeps its identity while it does not change (no re-render during playback).
import type { ControlId } from '@ekza-animator/doc';
import { type EditorApp, limbHiddenControls, limbVisibilityState } from '@ekza-animator/editor-core';
import { useCallback, useRef, useSyncExternalStore } from 'react';

const EMPTY: ReadonlySet<ControlId> = new Set();

function sameSet(a: ReadonlySet<ControlId>, b: ReadonlySet<ControlId>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Every character's IK/FK-hidden controls (rule 2 of §5.5). */
export function readLimbHidden(app: EditorApp): ReadonlySet<ControlId> {
  let out: Set<ControlId> | null = null;
  for (const runtime of app.characters.list()) {
    if (runtime.program.limbs.length === 0) continue;
    for (const id of limbHiddenControls(app, runtime.id)) (out ??= new Set()).add(id);
  }
  return out ?? EMPTY;
}

/**
 * Writes every limb's rule-2 state (all characters, registry order) into `states`; true when one differs from what
 * it held or the limb count changed (then `states.length` is updated). Allocation-free while the count is stable.
 */
export function readLimbStates(app: EditorApp, states: number[]): boolean {
  let i = 0;
  let changed = false;
  for (const runtime of app.characters.list()) {
    for (const limb of runtime.program.limbs) {
      const state = limbVisibilityState(app.evaluation.ikFk(runtime.id, limb.id) ?? 0);
      if (states[i] !== state) {
        states[i] = state;
        changed = true;
      }
      i++;
    }
  }
  if (states.length !== i) {
    states.length = i;
    changed = true;
  }
  return changed;
}

export function useLimbHiddenControls(app: EditorApp): ReadonlySet<ControlId> {
  const current = useRef<ReadonlySet<ControlId>>(EMPTY);
  const states = useRef<number[]>([]);
  /** The characters changed (added, removed, recompiled): the limbs may be other ones even with the same states. */
  const structure = useRef(true);
  const subscribe = useCallback(
    (notify: () => void) => {
      const restructured = (): void => {
        structure.current = true;
        notify();
      };
      const disposers = [
        app.evaluation.subscribe(notify),
        // Structural edits (controls, solvers) recompile the rig and arrive as character events; other document
        // changes (curves during a drag) only need the states compared.
        app.characters.subscribe(restructured),
        app.store.subscribe(() => notify()),
        app.session.subscribe((state, previous) => {
          if (state.overrides !== previous.overrides || state.time !== previous.time) notify();
        }),
      ];
      return () => {
        for (const dispose of disposers) dispose();
      };
    },
    [app],
  );
  const read = useCallback(() => {
    const statesChanged = readLimbStates(app, states.current);
    if (!statesChanged && !structure.current) return current.current;
    structure.current = false;
    const next = readLimbHidden(app);
    if (!sameSet(next, current.current)) current.current = next;
    return current.current;
  }, [app]);
  return useSyncExternalStore(subscribe, read, read);
}
