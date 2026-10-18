// M2A-SPEC §5.5 in the Outliner (A2): the controls the IK/FK rule hides at the current frame (FK chains of IK limbs,
// IK controls and poles of FK limbs), dimmed like user-hidden controls. Re-read per evaluated pose, so an animated
// ikFk updates the rows; the set keeps its identity while it does not change (no re-render during playback).
import type { ControlId } from '@ekza-animator/doc';
import { type EditorApp, limbHiddenControls } from '@ekza-animator/editor-core';
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

export function useLimbHiddenControls(app: EditorApp): ReadonlySet<ControlId> {
  const current = useRef<ReadonlySet<ControlId>>(EMPTY);
  const subscribe = useCallback(
    (notify: () => void) => {
      const disposers = [
        app.evaluation.subscribe(notify),
        app.characters.subscribe(notify),
        app.store.subscribe(notify),
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
    const next = readLimbHidden(app);
    if (!sameSet(next, current.current)) current.current = next;
    return current.current;
  }, [app]);
  return useSyncExternalStore(subscribe, read, read);
}
