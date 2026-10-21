// The registry of status-line group bodies (M6A-SPEC §8.10; B9): eager and tiny. B10 and B12a replace Model's
// default bodies (./statusGroups.tsx, a lazy chunk) with `registerStatusGroup(id, Component)`.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { type ComponentType, useSyncExternalStore } from 'react';

export interface StatusGroupProps {
  readonly app: EditorApp;
  /** Runs an operator for the status line (`source: 'menu'`, the viewport as panel). */
  readonly run: (op: string, args?: unknown) => void;
}

const groups = new Map<string, ComponentType<StatusGroupProps>>();
const listeners = new Set<() => void>();
let version = 0;

/** Replaces the body of a status-line group (Model's `mode`, `symmetry`, `soft`, `snap`, `pivot`). */
export function registerStatusGroup(id: string, component: ComponentType<StatusGroupProps>): Disposer {
  const previous = groups.get(id);
  groups.set(id, component);
  version += 1;
  for (const listener of listeners) listener();
  return () => {
    if (groups.get(id) !== component) return;
    if (previous === undefined) groups.delete(id);
    else groups.set(id, previous);
    version += 1;
    for (const listener of listeners) listener();
  };
}

/** The registered body of a group, or null (the default body draws). */
export function useStatusGroup(id: string): ComponentType<StatusGroupProps> | null {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
  return groups.get(id) ?? null;
}
