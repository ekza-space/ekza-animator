// Small React bindings shared by the data panels, on top of the editor hooks (useSession, useDocQuery).
import type { Disposer } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import type { EditorApp, SessionState } from '@ekza-animator/editor-core';
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/** Increments on every character registry event (runtime added, removed, recompiled, display loaded). */
export function useCharactersVersion(app: EditorApp): number {
  const source = useMemo(() => versionSource((listener) => app.characters.subscribe(listener)), [app]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

function versionSource(subscribe: (listener: () => void) => Disposer): {
  readonly subscribe: (notify: () => void) => () => void;
  readonly getSnapshot: () => number;
} {
  let version = 0;
  return {
    subscribe: (notify) =>
      subscribe(() => {
        version++;
        notify();
      }),
    getSnapshot: () => version,
  };
}

export function sameIds<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((id, i) => id === b[i]));
}

/** `useSession` selector of the selected controls (lead = last); pair it with `sameIds`. */
export const selectedControls = (state: SessionState): readonly ControlId[] => state.selection.controls;

/**
 * A callback with a stable identity that always runs the latest `fn` (for memoized children). Call it from event
 * handlers and effects, not during render.
 */
export function useStableCallback<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
