import { useMemo, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand';

/**
 * Subscribes to a zustand store through a selector. The component re-renders only when the selected value changes
 * under `equality` (default `Object.is`): an equal value keeps its previous identity, so a selector may build an
 * object or array as long as it passes a structural `equality`. Wrap inline selectors in `useCallback` to keep that
 * identity across renders caused by something else.
 */
export function useStoreSelector<S, T>(
  store: StoreApi<S>,
  selector: (state: S) => T,
  equality: (a: T, b: T) => boolean = Object.is,
): T {
  const getSelection = useMemo(() => memoizedSelection(store, selector, equality), [store, selector, equality]);
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

/** `getSnapshot` for useSyncExternalStore: recomputes only for a new store state, keeps equal values' identity. */
function memoizedSelection<S, T>(
  store: StoreApi<S>,
  selector: (state: S) => T,
  equality: (a: T, b: T) => boolean,
): () => T {
  let memo: { readonly state: S; readonly value: T } | null = null;
  return () => {
    const state = store.getState();
    if (memo !== null && Object.is(memo.state, state)) return memo.value;
    const next = selector(state);
    const value = memo !== null && equality(memo.value, next) ? memo.value : next;
    memo = { state, value };
    return value;
  };
}
